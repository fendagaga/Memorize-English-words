/**
 * 服务器 API 验收测试。
 *
 *   node scripts/test-server.mjs            # 需要服务器已在 8787 跑着
 *   node scripts/test-server.mjs --port 8787
 *
 * 覆盖：健康检查、词库、**状态接口已彻底移除**、服务端不再往 userData/ 落盘、
 *       静态资源、路径穿越防护。
 *
 * 用户状态（错题本 / 星标 / 进度 / 设置）现在存在浏览器本机，服务端只是静态
 * 文件 + 词库，所以这里不再有状态读写用例 —— 那一部分归 scripts/test-state.mjs。
 *
 * 期望值一律从 data/vocab.js 现算，不写死册数/单元数 —— 加册后本文件不需要改。
 */

import { VOCAB } from '../assets/vocab.js';

const PORT = (() => {
  const i = process.argv.indexOf('--port');
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : 8787;
})();
const BASE = `http://127.0.0.1:${PORT}`;

let passed = 0;
const failures = [];

function ok(label, condition, detail) {
  if (condition) passed += 1;
  else failures.push(`${label}${detail ? ` —— ${detail}` : ''}`);
}

function group(name) {
  console.log(`\n── ${name} ${'─'.repeat(Math.max(0, 52 - name.length))}`);
}

/** 测试专用的伪 uid：确认服务端即使收到它也不写盘、不认状态。 */
const UID = `test${Date.now().toString(16).slice(-12)}`;

async function req(path, { method = 'GET', uid, body, raw = false } = {}) {
  const headers = {};
  if (uid) headers['X-Word-Uid'] = uid;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (raw) return res;
  const type = res.headers.get('Content-Type') || '';
  const payload = type.includes('json') ? await res.json() : await res.text();
  return { status: res.status, payload, headers: res.headers };
}

/* ========================== 1. 健康检查与词库 ========================== */

group('健康检查与词库');

{
  const r = await req('/api/health');
  ok('GET /api/health 返回 200', r.status === 200, `实际 ${r.status}`);
  ok('health.ok 为 true', r.payload.ok === true);
  // 以 data/vocab.js 为基准，而不是写死数字 —— 加册后这里不该再需要跟着改一遍。
  ok(`health.units = ${VOCAB.stats.units}`, r.payload.units === VOCAB.stats.units, `实际 ${r.payload.units}`);
  ok(`health.cards = ${VOCAB.stats.cards}`, r.payload.cards === VOCAB.stats.cards, `实际 ${r.payload.cards}`);
  ok(`health.entries = ${VOCAB.stats.entries}`, r.payload.entries === VOCAB.stats.entries, `实际 ${r.payload.entries}`);
  ok('health.port 与启动端口一致', r.payload.port === PORT, `实际 ${r.payload.port}`);
  console.log(`  units=${r.payload.units} cards=${r.payload.cards} entries=${r.payload.entries}`);

  const v = await req('/api/vocab');
  ok('GET /api/vocab 返回 200', v.status === 200);
  ok('词库带 stats', !!v.payload.stats);
  ok('单元数组长度一致', v.payload.units.length === v.payload.stats.units);
  ok('卡片数组长度一致', v.payload.cards.length === v.payload.stats.cards);
  ok('词性选项含「短语」', v.payload.posOptions.includes('短语'));
  ok('不含已剔除的专有名词卡片',
    !v.payload.cards.some((c) => /专有名词|缩写/.test(c.rawPos || '')));

  // 抽查 call 的两张义项卡
  const call = v.payload.cards.filter((c) => c.word === 'call');
  ok('call 有两张义项卡', call.length === 2, `实际 ${call.length}`);
  ok('call 的义项角标正确',
    call.map((c) => `${c.senseIndex}/${c.senseTotal}`).join(',') === '1/2,2/2',
    call.map((c) => `${c.senseIndex}/${c.senseTotal}`).join(','));
  ok('call 的词性判分范围是 v./n.',
    JSON.stringify(call[0].posScopes) === '["v.","n."]',
    JSON.stringify(call[0].posScopes));
}

/* ========================== 2. 状态接口已移除 ========================== */

group('状态接口已移除');

{
  const get = await req('/api/state', { uid: UID, raw: true });
  ok('GET /api/state 返回 404', get.status === 404, `实际 ${get.status}`);
  await get.text();

  const patch = await req('/api/state', {
    method: 'PATCH', uid: UID, raw: true,
    body: { mistakes: { '7a-u1#L37#1': { count: 1, modes: ['en'], clearedAt: null } } },
  });
  ok('PATCH /api/state 返回 405', patch.status === 405, `实际 ${patch.status}`);
  await patch.text();

  const post = await req('/api/state', { method: 'POST', uid: UID, raw: true, body: { stars: {} } });
  ok('POST /api/state 返回 405', post.status === 405, `实际 ${post.status}`);
  await post.text();

  const del = await req('/api/state', { method: 'DELETE', uid: UID, raw: true });
  ok('DELETE /api/state 返回 405', del.status === 405, `实际 ${del.status}`);
  await del.text();

  const exp = await req('/api/export/wrongbook.md', { uid: UID, raw: true });
  ok('GET /api/export/wrongbook.md 返回 404', exp.status === 404, `实际 ${exp.status}`);
  await exp.text();

  const health = await req('/api/health');
  ok('词库接口不受影响（health 仍 200）', health.status === 200);
}

/* ========================== 3. 服务端不再落盘 ========================== */

group('服务端不再写 userData/');

{
  const { readdir } = await import('node:fs/promises');
  const { join, dirname, resolve } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const USER_DIR = resolve(__dirname, '..', 'userData');

  const list = async () => {
    try { return (await readdir(USER_DIR)).sort().join(','); } catch { return '<不存在>'; }
  };

  const before = await list();
  ok('userData/ 目录仍然存在（旧的运行时状态文件留在原处）', before !== '<不存在>', before);

  // 把以前会写盘的那套请求全发一遍（带 uid、带状态体），服务端必须一个文件都不新增
  await Promise.all([
    req('/api/state', { uid: UID, raw: true }).then((r) => r.text()),
    req('/api/state', {
      method: 'PATCH', uid: UID, raw: true,
      body: {
        mistakes: { '7a-u1#L37#1': { count: 3, modes: ['en', 'pos'], clearedAt: null } },
        stars: { '7a-u1#L37#1': { at: '2026-01-01T00:00:00Z', unitId: '7a-u1', removedAt: null } },
        progress: { '7a-u1': { index: 9, mode: 'en', total: 47 } },
        settings: { senseSplit: true },
      },
    }).then((r) => r.text()),
    req('/api/export/wrongbook.md', { uid: UID, raw: true }).then((r) => r.text()),
  ]);
  // 等一拍，给任何（不该存在的）异步写入机会落地
  await new Promise((r) => setTimeout(r, 150));

  const after = await list();
  ok('发完写请求后 userData/ 一个文件都没新增', after === before,
    `前 ${before} ／ 后 ${after}`);

  const { existsSync } = await import('node:fs');
  ok('没有为测试 uid 生成 json', !existsSync(join(USER_DIR, `${UID}.json`)));

  const stray = (await (async () => { try { return await readdir(USER_DIR); } catch { return []; } })())
    .filter((f) => f.endsWith('.tmp'));
  ok('没有留下半截临时文件', stray.length === 0, stray.join(','));
}

/* ========================== 4. 静态资源与安全 ========================== */

group('静态资源与安全');

{
  for (const path of ['/', '/units.html', '/study.html', '/assets/paper.css', '/assets/api.js', '/assets/vocab.js', '/data/vocab.json']) {
    const res = await req(path, { raw: true });
    ok(`GET ${path} 返回 200`, res.status === 200, `实际 ${res.status}`);
    await res.text();
  }

  const css = await req('/assets/paper.css', { raw: true });
  ok('CSS 的 Content-Type 正确',
    (css.headers.get('Content-Type') || '').includes('text/css'),
    css.headers.get('Content-Type'));
  await css.text();

  const notFound = await req('/nope.html', { raw: true });
  ok('不存在的路径返回 404', notFound.status === 404, `实际 ${notFound.status}`);
  await notFound.text();

  // 路径穿越必须被挡住。
  // 注意：`/../x` 这种明文写法会被 fetch/URL 在发出前就规范化掉，测不到服务端；
  // 真正能打到服务端的是百分号编码的 `..%2f`。而且这里刻意挑一个**确实存在于
  // 项目根之外**的文件（../pages/02-neon-poster.html）——它若是 200，就是真漏了。
  const outsidePages = '..%2fpages%2f02-neon-poster.html';
  const traversal = await req(`/${outsidePages}`, { raw: true });
  ok('编码后的路径穿越打到服务端也被挡住（非 200）', traversal.status !== 200, `实际 ${traversal.status}`);
  await traversal.text();

  const traversal2 = await req('/%2e%2e%2fpages%2f02-neon-poster.html', { raw: true });
  ok('全编码的 .. 一样被挡住（非 200）', traversal2.status !== 200, `实际 ${traversal2.status}`);
  await traversal2.text();

  const traversal3 = await req('/..%2f..%2f..%2fWindows%2fwin.ini', { raw: true });
  ok('多层向上穿越被挡住（非 200）', traversal3.status !== 200, `实际 ${traversal3.status}`);
  await traversal3.text();

  // 明文写法（客户端会先规范化）：最终不该命中项目外的文件
  const traversal4 = await req('/../pages/02-neon-poster.html', { raw: true });
  ok('明文 ../ 写法拿不到项目外的文件（非 200）', traversal4.status !== 200, `实际 ${traversal4.status}`);
  await traversal4.text();

  // 非 GET/HEAD 的静态请求
  const put = await req('/index.html', { method: 'PUT', raw: true });
  ok('PUT 静态文件返回 405', put.status === 405, `实际 ${put.status}`);
  await put.text();

  // 旧的 userData/（历史状态备份）不再对外提供下载
  const legacy = await req('/userData/.gitkeep', { raw: true });
  ok('GET /userData/ 下的文件返回 403', legacy.status === 403, `实际 ${legacy.status}`);
  await legacy.text();
  const legacyJson = await req(`/userData/${UID}.json`, { raw: true });
  ok('GET /userData/<uid>.json 返回 403', legacyJson.status === 403, `实际 ${legacyJson.status}`);
  await legacyJson.text();
}

/* ========================== 汇总 ========================== */

console.log(`\n${'═'.repeat(62)}`);
if (failures.length) {
  console.log(`✗ 失败 ${failures.length} 项，通过 ${passed} 项\n`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
} else {
  console.log(`✓ 服务器 API 全部通过 —— ${passed} 项断言`);
}
