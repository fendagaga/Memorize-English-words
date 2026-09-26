/**
 * 服务器 API 验收测试。
 *
 *   node scripts/test-server.mjs            # 需要服务器已在 8787 跑着
 *   node scripts/test-server.mjs --port 8787
 *
 * 覆盖：健康检查、词库、状态读写往返、并发 PATCH 不丢数据、
 *       uid 校验、导出 Markdown、静态资源、路径穿越防护。
 */

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

/** 测试专用 uid，跑完自己清理，不污染真实数据。 */
const UID = `test${Date.now().toString(16).slice(-12)}`;
/** 需要额外清理的 uid（孤儿 id 用例等）。 */
const EXTRA_UIDS = [];

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

/* ========================== 1. 健康检查 ========================== */

group('健康检查与词库');

{
  const r = await req('/api/health');
  ok('GET /api/health 返回 200', r.status === 200, `实际 ${r.status}`);
  ok('health.ok 为 true', r.payload.ok === true);
  ok('health.units = 26', r.payload.units === 26, `实际 ${r.payload.units}`);
  ok('health.cards = 1451', r.payload.cards === 1451, `实际 ${r.payload.cards}`);
  ok('health.entries = 1298', r.payload.entries === 1298, `实际 ${r.payload.entries}`);
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

/* ========================== 2. uid 校验 ========================== */

group('uid 校验');

{
  const noUid = await req('/api/state');
  ok('缺 uid 的 GET /api/state 返回 400', noUid.status === 400, `实际 ${noUid.status}`);

  const badUid = await req('/api/state', { uid: 'x' });
  ok('过短 uid 返回 400', badUid.status === 400, `实际 ${badUid.status}`);

  const badChars = await req('/api/state', { uid: '../../etc/passwd' });
  ok('含路径字符的 uid 返回 400', badChars.status === 400, `实际 ${badChars.status}`);

  const upper = await req('/api/state', { uid: 'ABCDEF0123456789' });
  ok('大写 uid 被规范化为小写后可用', upper.status === 200, `实际 ${upper.status}`);
}

/* ========================== 3. 状态读写往返 ========================== */

group('状态读写往返');

{
  const init = await req('/api/state', { uid: UID });
  ok('新 uid 返回空状态', init.status === 200 && Object.keys(init.payload.state.mistakes).length === 0);
  ok('新 uid 状态标注 storage=server', init.payload.storage === 'server');

  const cardId = '7a-u1#L37#1';
  const patch = {
    mistakes: { [cardId]: { count: 1, modes: ['en'], lastWrongAt: '2026-01-01T00:00:00Z', clearedAt: null } },
    settings: { senseSplit: true, ttsAccent: 'en-GB' },
  };
  const w = await req('/api/state', { method: 'PATCH', uid: UID, body: patch });
  ok('PATCH 返回 200', w.status === 200, `实际 ${w.status}`);
  ok('PATCH 后 mistakes 写入成功', w.payload.state.mistakes[cardId].count === 1);
  ok('PATCH 后 settings 写入成功', w.payload.state.settings.ttsAccent === 'en-GB');
  ok('PATCH 会打上 updatedAt', typeof w.payload.state.updatedAt === 'string');

  const r = await req('/api/state', { uid: UID });
  ok('重新 GET 能读回写入的内容', r.payload.state.mistakes[cardId].count === 1);
  ok('读回的 settings 一致', r.payload.state.settings.ttsAccent === 'en-GB');

  // 增量合并：再错一次应该累加，而不是覆盖整条
  await req('/api/state', {
    method: 'PATCH', uid: UID,
    body: { mistakes: { [cardId]: { count: 2, modes: ['en', 'pos'], lastWrongAt: '2026-01-02T00:00:00Z', clearedAt: null } } },
  });
  const r2 = await req('/api/state', { uid: UID });
  ok('同一个 cardId 再写是覆盖该条（错次由客户端累加）', r2.payload.state.mistakes[cardId].count === 2);
  ok('别的字段没被清掉', r2.payload.state.settings.ttsAccent === 'en-GB');

  // 新增第二条错题，第一条必须保留
  await req('/api/state', {
    method: 'PATCH', uid: UID,
    body: { mistakes: { '7a-u1#L38#1': { count: 1, modes: ['pos'], lastWrongAt: '2026-01-03T00:00:00Z', clearedAt: null } } },
  });
  const r3 = await req('/api/state', { uid: UID });
  ok('新增错题不会挤掉已有错题', Object.keys(r3.payload.state.mistakes).length === 2,
    `实际 ${Object.keys(r3.payload.state.mistakes).length}`);

  // 星标与进度
  await req('/api/state', {
    method: 'PATCH', uid: UID,
    body: {
      stars: { [cardId]: { at: '2026-01-04T00:00:00Z', unitId: '7a-u1', removedAt: null } },
      progress: { '7a-u1': { index: 12, mode: 'en', shuffled: false, total: 48 } },
    },
  });
  const r4 = await req('/api/state', { uid: UID });
  ok('星标写入成功', r4.payload.state.stars[cardId].unitId === '7a-u1');
  ok('进度写入成功', r4.payload.state.progress['7a-u1'].index === 12);
}

/* ========================== 4. 并发 PATCH ========================== */

group('并发 PATCH 不丢数据');

{
  const uid = `race${Date.now().toString(16).slice(-12)}`;
  // 同时发 20 个 PATCH，每个写一个不同的错题条目。
  const jobs = [];
  for (let i = 0; i < 20; i += 1) {
    jobs.push(req('/api/state', {
      method: 'PATCH',
      uid,
      body: { mistakes: { [`unit#${String(i).padStart(4, '0')}#1`]: { count: 1, modes: ['en'], lastWrongAt: '2026-01-01T00:00:00Z', clearedAt: null } } },
    }));
  }
  const results = await Promise.all(jobs);
  ok('20 个并发 PATCH 全部返回 200', results.every((r) => r.status === 200),
    `失败 ${results.filter((r) => r.status !== 200).length} 个`);

  const final = await req('/api/state', { uid });
  const count = Object.keys(final.payload.state.mistakes).length;
  ok('20 个并发写入一条都没丢', count === 20, `只落盘 ${count} 条`);
}

/* ========================== 5. 导出错题本 ========================== */

group('导出 Markdown 错题本');

{
  const res = await req('/api/export/wrongbook.md', { uid: UID, raw: true });
  ok('导出返回 200', res.status === 200, `实际 ${res.status}`);
  ok('Content-Type 是 markdown',
    (res.headers.get('Content-Type') || '').includes('markdown'),
    res.headers.get('Content-Type'));
  ok('带 Content-Disposition 附件头',
    (res.headers.get('Content-Disposition') || '').includes('attachment'),
    res.headers.get('Content-Disposition'));

  const md = await res.text();
  ok('导出内容是表格', md.includes('| 单词 | 词性 | 中文释义 | 错误次数 | 错误模式 | 所属单元 |'));
  ok('导出含已写入的错词 call', md.includes('call'));
  ok('导出含错误模式中文标签', md.includes('拼写'));
  // 前面往 call 卡写了两次（第二次覆盖第一次 → 错次 2、模式并集），另加一张 me 卡
  ok('导出统计错词数量为 2', /错词数量：2/.test(md), md.split('\n').find((l) => l.includes('错词数量')));
  ok('同一张卡的错次累加为 2', /\| call \|.*\| 2 \|/.test(md), md.split('\n').find((l) => l.startsWith('| call')));
  ok('错误模式取并集（拼写+词性）', /拼写、词性/.test(md), md.split('\n').find((l) => l.startsWith('| call')));
  ok('所属单元用可读标签而非裸 id', md.includes('七年级上册 · Starter Unit 1'), md.split('\n').find((l) => l.startsWith('| call')));
  console.log(md.split('\n').filter((l) => l.startsWith('| ') || l.includes('错词数量') || l.includes('覆盖单元')).map((l) => `  ${l}`).join('\n'));
}

{
  // 孤儿 cardId（词库重建后删行）：导出应跳过并如实说明，而不是吐空行
  const uid = `orph${Date.now().toString(16).slice(-12)}`;
  await req('/api/state', {
    method: 'PATCH', uid,
    body: {
      mistakes: {
        '7a-u1#L37#1': { count: 1, modes: ['en'], lastWrongAt: '2026-01-01T00:00:00Z', clearedAt: null },
        '7a-u1#L99999#1': { count: 2, modes: ['pos'], lastWrongAt: '2026-01-01T00:00:00Z', clearedAt: null },
      },
    },
  });
  const res = await req('/api/export/wrongbook.md', { uid, raw: true });
  const md = await res.text();
  const dataRows = md.split('\n').filter((l) => l.startsWith('| ') && !l.includes('---') && !l.startsWith('| 单词'));
  ok('服务端导出跳过孤儿 id', dataRows.length === 1, `实际 ${dataRows.length} 行`);
  ok('服务端导出错词数只算可解析的', /错词数量：1/.test(md), md.split('\n').find((l) => l.includes('错词数量')));
  ok('服务端导出说明跳过了孤儿条目', /另有\s*1\s*条记录对应的词条已不在当前词库中/.test(md),
    md.split('\n').find((l) => l.includes('另有')));
  EXTRA_UIDS.push(uid);
}

/* ========================== 6. 静态资源 ========================== */

group('静态资源与安全');

{
  for (const path of ['/', '/units.html', '/study.html', '/assets/paper.css', '/assets/api.js', '/assets/vocab.js', '/data/vocab.json']) {
    const res = await req(path, { raw: true });
    ok(`GET ${path} 返回 200`, res.status === 200, `实际 ${res.status}`);
  }

  const css = await req('/assets/paper.css', { raw: true });
  ok('CSS 的 Content-Type 正确',
    (css.headers.get('Content-Type') || '').includes('text/css'),
    css.headers.get('Content-Type'));
  await css.text();

  const notFound = await req('/nope.html', { raw: true });
  ok('不存在的路径返回 404', notFound.status === 404, `实际 ${notFound.status}`);

  // 路径穿越必须被挡住
  const traversal = await req('/../SPEC.md', { raw: true });
  ok('路径穿越被挡住（非 200）', traversal.status !== 200, `实际 ${traversal.status}`);
  const traversal2 = await req('/%2e%2e%2fSPEC.md', { raw: true });
  ok('编码后的路径穿越被挡住（非 200）', traversal2.status !== 200, `实际 ${traversal2.status}`);
  const traversal3 = await req('/..%2f..%2fSPEC.md', { raw: true });
  ok('多层编码穿越被挡住（非 200）', traversal3.status !== 200, `实际 ${traversal3.status}`);

  // 不支持的方法
  const del = await req('/api/state', { method: 'DELETE', uid: UID, raw: true });
  ok('DELETE /api/state 返回 405', del.status === 405, `实际 ${del.status}`);
}

/* ========================== 7. 清理 ========================== */

group('清理测试数据');

{
  const { rm } = await import('node:fs/promises');
  const { join, dirname, resolve } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const USER_DIR = resolve(__dirname, '..', 'userData');

  // 清掉本次测试与并发测试的 uid 文件，避免污染真实数据目录
  let removed = 0;
  for (const uid of [UID, `race${UID.slice(4)}`, ...EXTRA_UIDS]) {
    try {
      await rm(join(USER_DIR, `${uid}.json`), { force: true });
      removed += 1;
    } catch { /* 忽略 */ }
  }
  // 并发/孤儿用例的 uid 前缀与上面推导可能不一致，按前缀兜底扫一遍
  const { readdir } = await import('node:fs/promises');
  try {
    for (const f of await readdir(USER_DIR)) {
      if (/^(test|race|orph|repro)[0-9a-f]+\.json$/.test(f) || f.includes('.tmp')) {
        await rm(join(USER_DIR, f), { force: true });
        removed += 1;
      }
    }
  } catch { /* 忽略 */ }
  ok('测试数据已清理', true);
  console.log(`  清理了 ${removed} 个测试文件`);
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
