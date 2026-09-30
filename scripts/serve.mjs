/**
 * 本地服务器 —— 零依赖（只用 Node 内置模块）。
 *
 *   node scripts/serve.mjs              # 起在 http://127.0.0.1:8787
 *   node scripts/serve.mjs --port 9000  # 换端口
 *
 * 只提供两件事：
 *   1. word/ 目录下的静态文件（三个页面 + assets + data）
 *   2. 词库接口（/api/health、/api/vocab）
 *
 * 错题本、星标、进度与设置都存在**浏览器本机**（localStorage），服务端不保存、
 * 也不接收任何用户状态，因此这里没有状态读写路由，也没有 userData/ 写入。
 *
 * 词库只从 data/vocab.json 读（由 scripts/build.mjs 产出）。
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, extname, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const VOCAB_JSON = resolve(ROOT, 'data', 'vocab.json');
/** 旧版把状态存在这里；现在只当历史备份，不再读写，也不允许通过 HTTP 拿走。 */
const LEGACY_STATE_DIR = resolve(ROOT, 'userData');

/* ========================== 参数 ========================== */

function argValue(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.split('=').slice(1).join('=');
  return fallback;
}

const PORT = Number(process.env.PORT || argValue('port', 8787));
const HOST = argValue('host', '127.0.0.1');

/* ========================== 词库 ========================== */

let vocab = null;
async function loadVocab() {
  const raw = await readFile(VOCAB_JSON, 'utf8');
  vocab = JSON.parse(raw);
  return vocab;
}

/* ========================== HTTP 工具 ========================== */

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendText(res, status, text, type = 'text/plain; charset=utf-8', extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': type,
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(text);
}

/* ========================== 静态文件 ========================== */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

/** 把 URL 路径安全地映射到 ROOT 下的真实文件，挡住 ../ 穿越与旧的 userData 目录。 */
function resolveStatic(urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  if (rel.endsWith('/')) rel += 'index.html';
  const cleaned = normalize(rel).replace(/^([/\\])+/, '');
  const full = resolve(ROOT, cleaned);
  if (full !== ROOT && !full.startsWith(ROOT + sep)) return null;
  if (full === LEGACY_STATE_DIR || full.startsWith(LEGACY_STATE_DIR + sep)) return null;
  return full;
}

async function serveStatic(req, res, urlPath) {
  const file = resolveStatic(urlPath);
  if (!file) return sendText(res, 403, 'Forbidden');

  let info;
  try {
    info = await stat(file);
  } catch {
    return sendText(res, 404, `404 Not Found: ${urlPath}`, 'text/plain; charset=utf-8');
  }
  if (info.isDirectory()) {
    return serveStatic(req, res, `${urlPath.replace(/\/$/, '')}/index.html`);
  }

  try {
    const data = await readFile(file);
    const ext = extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': data.length,
      // 开发期不缓存，避免改了文件刷新还是旧的。
      'Cache-Control': 'no-cache',
      'Last-Modified': info.mtime.toUTCString(),
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch (err) {
    sendText(res, 500, `500 ${err.message}`);
  }
}

/* ========================== 路由 ========================== */

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
  const path = url.pathname;
  const method = req.method || 'GET';

  /* ---- 健康检查 ---- */
  if (path === '/api/health') {
    return sendJson(res, 200, {
      ok: true,
      units: vocab ? vocab.units.length : 0,
      cards: vocab ? vocab.cards.length : 0,
      entries: vocab ? vocab.stats.entries : 0,
      builtAt: vocab ? vocab.builtAt : null,
      port: PORT,
    });
  }

  /* ---- 词库 ---- */
  if (path === '/api/vocab') {
    if (!vocab) return sendJson(res, 503, { error: '词库尚未构建，请先运行 node scripts/build.mjs' });
    return sendJson(res, 200, vocab);
  }

  /* ---- 静态 ---- */
  if (method === 'GET' || method === 'HEAD') {
    const target = path === '/' ? '/index.html' : path;
    return serveStatic(req, res, target);
  }

  return sendText(res, 405, 'Method Not Allowed');
}

/* ========================== 启动 ========================== */

async function main() {
  if (!existsSync(VOCAB_JSON)) {
    console.error('[serve] 缺少 data/vocab.json，请先运行：node scripts/build.mjs');
    process.exit(1);
  }
  await loadVocab();

  const server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error(`[serve] 处理 ${req.method} ${req.url} 出错：`, err);
      if (!res.headersSent) sendJson(res, 500, { error: err.message || 'Internal Error' });
      else res.end();
    });
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[serve] 端口 ${PORT} 已被占用。换一个：node scripts/serve.mjs --port 8788`);
    } else {
      console.error('[serve] 服务器错误：', err);
    }
    process.exit(1);
  });

  server.listen(PORT, HOST, () => {
    const { stats } = vocab;
    console.log('─'.repeat(62));
    console.log(`[serve] 单词记背系统已启动`);
    console.log(`        首页        http://${HOST}:${PORT}/`);
    console.log(`        单元索引    http://${HOST}:${PORT}/units.html`);
    console.log(`        背记界面    http://${HOST}:${PORT}/study.html`);
    console.log(`        词库        ${stats.volumes} 册 · ${stats.units} 单元 · ${stats.entries} 词条 · ${stats.cards} 义项`);
    console.log(`        用户状态    存在浏览器本机（localStorage），服务端不保存`);
    console.log('─'.repeat(62));
  });

  const shutdown = () => {
    console.log('\n[serve] 正在关闭…');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[serve] 启动失败：', err);
  process.exit(1);
});
