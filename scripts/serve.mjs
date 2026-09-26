/**
 * 本地服务器 —— 零依赖（只用 Node 内置模块）。
 *
 *   node scripts/serve.mjs              # 起在 http://127.0.0.1:8787
 *   node scripts/serve.mjs --port 9000  # 换端口
 *
 * 提供两件事：
 *   1. word/ 目录下的静态文件（三个页面 + assets + data）
 *   2. 状态 API：错题本 / 星标 / 进度 / 设置，按 uid 分文件存在 userData/
 *
 * 词库只从 data/vocab.json 读（由 scripts/build.mjs 产出）。
 */

import { createServer } from 'node:http';
import { readFile, writeFile, rename, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const USER_DIR = join(ROOT, 'userData');
const VOCAB_JSON = join(ROOT, 'data', 'vocab.json');

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

/* ========================== 状态存储 ========================== */

const UID_RE = /^[a-z0-9]{8,32}$/;

function uidFrom(req) {
  const raw = String(req.headers['x-word-uid'] || '').trim().toLowerCase();
  return UID_RE.test(raw) ? raw : null;
}

function statePath(uid) {
  return join(USER_DIR, `${uid}.json`);
}

function emptyState() {
  return { version: 1, mistakes: {}, stars: {}, progress: {}, settings: {}, updatedAt: null };
}

function normalizeState(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  return {
    version: 1,
    mistakes: s.mistakes && typeof s.mistakes === 'object' ? s.mistakes : {},
    stars: s.stars && typeof s.stars === 'object' ? s.stars : {},
    progress: s.progress && typeof s.progress === 'object' ? s.progress : {},
    settings: s.settings && typeof s.settings === 'object' ? s.settings : {},
    updatedAt: s.updatedAt || null,
  };
}

async function readState(uid) {
  const file = statePath(uid);
  if (!existsSync(file)) return emptyState();
  try {
    return normalizeState(JSON.parse(await readFile(file, 'utf8')));
  } catch (err) {
    console.error(`[serve] 读取状态失败 ${file}：${err.message}，按空状态处理`);
    return emptyState();
  }
}

/** 原子写：先写临时文件再 rename，避免断电/并发写出半个 JSON。 */
async function writeState(uid, state) {
  await mkdir(USER_DIR, { recursive: true });
  const file = statePath(uid);
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(state, null, 2), 'utf8');
  await rename(tmp, file);
}

/** 每个 uid 一条写入队列，避免并发 PATCH 互相覆盖。 */
const writeQueues = new Map();
function enqueue(uid, task) {
  const prev = writeQueues.get(uid) || Promise.resolve();
  const next = prev.then(task, task);
  writeQueues.set(uid, next.catch(() => {}));
  return next;
}

/** 客户端下发的 patch 做白名单校验，防止写进乱七八糟的字段。 */
function sanitizePatch(patch) {
  const out = {};
  if (patch.mistakes && typeof patch.mistakes === 'object') out.mistakes = patch.mistakes;
  if (patch.stars && typeof patch.stars === 'object') out.stars = patch.stars;
  if (patch.progress && typeof patch.progress === 'object') out.progress = patch.progress;
  if (patch.settings && typeof patch.settings === 'object') out.settings = patch.settings;
  return out;
}

function mergeState(base, patch) {
  return normalizeState({
    ...base,
    ...patch,
    mistakes: { ...base.mistakes, ...(patch.mistakes || {}) },
    stars: { ...base.stars, ...(patch.stars || {}) },
    progress: { ...base.progress, ...(patch.progress || {}) },
    settings: { ...base.settings, ...(patch.settings || {}) },
    updatedAt: new Date().toISOString(),
  });
}

/* ========================== 导出错题本 ========================== */

const MODE_LABEL = { en: '拼写', pos: '词性', cn: '释义' };

function buildWrongbookMarkdown(state) {
  const byId = new Map((vocab ? vocab.cards : []).map((c) => [c.id, c]));
  const unitName = new Map((vocab ? vocab.units : []).map((u) => [u.id, `${u.grade}${u.term} · ${u.name}`]));

  // 过滤孤儿 id：词库重建后删掉了某一行，旧错题里的 cardId 就解析不到了。
  // 这类条目在导出里只会变成一行空数据，直接丢掉，并在下面如实说明跳过了几条。
  const all = Object.entries(state.mistakes || {})
    .filter(([, rec]) => rec && !rec.clearedAt)
    .map(([cardId, rec]) => ({ cardId, rec, card: byId.get(cardId) }));
  const rows = all.filter((r) => r.card).sort((a, b) => (b.rec.count || 0) - (a.rec.count || 0));
  const orphans = all.length - rows.length;

  const lines = [];
  lines.push('# 错题本');
  lines.push('');
  lines.push(`- 导出时间：${new Date().toLocaleString('zh-CN')}`);
  lines.push(`- 错词数量：${rows.length}`);
  lines.push(`- 覆盖单元：${new Set(rows.map((r) => r.card.unitId)).size}`);
  if (orphans) {
    lines.push(`- 另有 ${orphans} 条记录对应的词条已不在当前词库中（词表更新过），未列入下表`);
  }
  lines.push('');
  lines.push('| 单词 | 词性 | 中文释义 | 错误次数 | 错误模式 | 所属单元 |');
  lines.push('|---|---|---|---|---|---|');
  for (const { rec, card } of rows) {
    const modes = (rec.modes || []).map((m) => MODE_LABEL[m] || m).join('、') || '—';
    const esc = (s) => String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
    lines.push(`| ${esc(card.word)} | ${esc(card.pos)} | ${esc(card.cn)} | ${rec.count || 1} | ${modes} | ${esc(unitName.get(card.unitId) || card.unitId)} |`);
  }
  lines.push('');
  return lines.join('\n');
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

function readBody(req, limit = 4 * 1024 * 1024) {
  return new Promise((resolvePromise, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
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

/** 把 URL 路径安全地映射到 ROOT 下的真实文件，挡住 ../ 穿越。 */
function resolveStatic(urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  if (rel.endsWith('/')) rel += 'index.html';
  const cleaned = normalize(rel).replace(/^([/\\])+/, '');
  const full = resolve(ROOT, cleaned);
  if (full !== ROOT && !full.startsWith(ROOT + sep)) return null;
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

  /* ---- 状态 ---- */
  if (path === '/api/state') {
    const uid = uidFrom(req);
    if (!uid) return sendJson(res, 400, { error: '缺少或非法的 X-Word-Uid 请求头' });

    if (method === 'GET') {
      const state = await readState(uid);
      return sendJson(res, 200, { ok: true, uid, storage: 'server', state });
    }

    if (method === 'PATCH' || method === 'POST') {
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        return sendJson(res, 400, { error: '请求体不是合法 JSON' });
      }
      const patch = sanitizePatch(body && body.state ? body.state : body);
      const state = await enqueue(uid, async () => {
        const merged = mergeState(await readState(uid), patch);
        await writeState(uid, merged);
        return merged;
      });
      return sendJson(res, 200, { ok: true, uid, storage: 'server', state });
    }

    return sendJson(res, 405, { error: `不支持的方法：${method}` });
  }

  /* ---- 导出错题本 ---- */
  if (path === '/api/export/wrongbook.md') {
    const uid = uidFrom(req);
    if (!uid) return sendText(res, 400, '缺少或非法的 X-Word-Uid 请求头');
    const state = await readState(uid);
    const md = buildWrongbookMarkdown(state);
    const stamp = new Date().toISOString().slice(0, 10);
    return sendText(res, 200, md, 'text/markdown; charset=utf-8', {
      'Content-Disposition': `attachment; filename="wrongbook-${stamp}.md"`,
    });
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
    console.log(`        状态目录    ${USER_DIR}`);
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
