/**
 * 状态层测试 —— assets/api.js 的并发正确性与离线降级。
 *
 *   node scripts/test-state.mjs
 *
 * api.js 依赖浏览器环境（localStorage / fetch / location），
 * 这里用最小桩件在 Node 里跑真实模块，测的是真实代码路径。
 */

/* ========================== 浏览器环境桩 ========================== */

class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
  clear() { this.map.clear(); }
}

/** 服务端桩：记录所有 PATCH，可注入延迟模拟网络。 */
function installStubs({ delayMs = 0, fail = false, protocol = 'http:' } = {}) {
  const storage = new MemoryStorage();
  const server = { state: { version: 1, mistakes: {}, stars: {}, progress: {}, settings: {} }, patches: 0, concurrent: 0, maxConcurrent: 0 };

  globalThis.localStorage = storage;
  globalThis.location = { protocol, href: `${protocol}//localhost/` };

  globalThis.fetch = async (url, options = {}) => {
    server.concurrent += 1;
    server.maxConcurrent = Math.max(server.maxConcurrent, server.concurrent);
    try {
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      if (fail) throw new Error('connection refused');

      const path = String(url);
      if (path.endsWith('/api/state') && options.method === 'PATCH') {
        const patch = JSON.parse(options.body);
        server.patches += 1;
        if (patch.mistakes) Object.assign(server.state.mistakes, patch.mistakes);
        if (patch.stars) Object.assign(server.state.stars, patch.stars);
        if (patch.progress) Object.assign(server.state.progress, patch.progress);
        if (patch.settings) Object.assign(server.state.settings, patch.settings);
        return jsonResponse({ ok: true, state: server.state });
      }
      if (path.endsWith('/api/state')) {
        return jsonResponse({ ok: true, state: server.state });
      }
      return jsonResponse({ ok: true });
    } finally {
      server.concurrent -= 1;
    }
  };

  delete globalThis.window;
  return { storage, server };
}

function jsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}

/** 每次测试都重新 import，避免模块级 cache 串台。 */
async function freshApi() {
  const url = new URL('../assets/api.js', import.meta.url).href;
  return import(`${url}?t=${Date.now()}${Math.random()}`);
}

/* ========================== 断言 ========================== */

let passed = 0;
const failures = [];

function ok(label, condition, detail) {
  if (condition) passed += 1;
  else failures.push(`${label}${detail ? ` —— ${detail}` : ''}`);
}

function group(name) {
  console.log(`\n── ${name} ${'─'.repeat(Math.max(0, 52 - name.length))}`);
}

/* ========================== 1. 并发累加 ========================== */

group('并发写不丢更新');

{
  installStubs({ delayMs: 20 });
  const api = await freshApi();

  // 同一张卡并发错两次 → 错次必须是 2
  await Promise.all([
    api.recordMistake('card-x', 'en'),
    api.recordMistake('card-x', 'en'),
  ]);
  let state = await api.loadState();
  ok('并发两次 recordMistake → count=2', state.mistakes['card-x'].count === 2,
    `实际 ${state.mistakes['card-x'].count}`);
}

{
  installStubs({ delayMs: 10 });
  const api = await freshApi();

  // 并发 5 次，两种模式 → count=5，modes 并集 [en,pos]
  await Promise.all([
    api.recordMistake('card-y', 'en'),
    api.recordMistake('card-y', 'pos'),
    api.recordMistake('card-y', 'en'),
    api.recordMistake('card-y', 'pos'),
    api.recordMistake('card-y', 'en'),
  ]);
  const state = await api.loadState();
  ok('并发五次 → count=5', state.mistakes['card-y'].count === 5,
    `实际 ${state.mistakes['card-y'].count}`);
  ok('并发五次 → modes 并集 [en,pos]',
    JSON.stringify([...state.mistakes['card-y'].modes].sort()) === '["en","pos"]',
    JSON.stringify(state.mistakes['card-y'].modes));
}

{
  installStubs({ delayMs: 10 });
  const api = await freshApi();

  // 并发写不同卡 → 两张都要在
  await Promise.all([
    api.recordMistake('card-a', 'en'),
    api.recordMistake('card-b', 'pos'),
  ]);
  const state = await api.loadState();
  ok('并发写不同卡 → 两张都在', !!state.mistakes['card-a'] && !!state.mistakes['card-b'],
    JSON.stringify(Object.keys(state.mistakes)));
}

{
  installStubs({ delayMs: 10 });
  const api = await freshApi();

  // 并发：星标 + 错题 + 进度，互不干扰
  await Promise.all([
    api.toggleStar('card-z', '7a-u1'),
    api.recordMistake('card-z', 'en'),
    api.saveProgress('7a-u1', { index: 5, total: 47 }),
  ]);
  const state = await api.loadState();
  ok('星标与错题并发互不覆盖',
    api.isStarred(state, 'card-z') && state.mistakes['card-z'].count === 1,
    JSON.stringify({ star: api.isStarred(state, 'card-z'), count: state.mistakes['card-z'] && state.mistakes['card-z'].count }));
  ok('进度写入同时成功', state.progress['7a-u1'].index === 5);
}

{
  installStubs({ delayMs: 10 });
  const api = await freshApi();

  // 并发 20 张不同卡
  const jobs = [];
  for (let i = 0; i < 20; i += 1) jobs.push(api.recordMistake(`bulk-${i}`, 'en'));
  await Promise.all(jobs);
  const state = await api.loadState();
  ok('并发 20 张卡一条不丢', Object.keys(state.mistakes).length === 20,
    `实际 ${Object.keys(state.mistakes).length}`);
}

/* ========================== 2. 错题本语义 ========================== */

group('错题本语义');

{
  installStubs({});
  const api = await freshApi();

  await api.recordMistake('c1', 'en');
  await api.recordMistake('c1', 'pos');
  let state = await api.loadState();
  ok('按 cardId 去重（只有一条）', Object.keys(state.mistakes).length === 1);
  ok('错次累加', state.mistakes.c1.count === 2);
  ok('模式取并集', JSON.stringify([...state.mistakes.c1.modes].sort()) === '["en","pos"]');

  ok('未销号的出现在错题本', api.mistakeList(state).length === 1);

  await api.clearMistake('c1');
  state = await api.loadState();
  ok('销号后不再出现在错题本', api.mistakeList(state).length === 0);
  ok('销号记录仍保留在原始数据里（可追溯）', !!state.mistakes.c1.clearedAt);

  await api.recordMistake('c1', 'en');
  state = await api.loadState();
  ok('再错一次会复活', api.mistakeList(state).length === 1);
  ok('复活后错次继续累加', state.mistakes.c1.count === 3, `实际 ${state.mistakes.c1.count}`);
  ok('复活后 clearedAt 清空', state.mistakes.c1.clearedAt === null);

  await api.clearMistake('never-existed');
  state = await api.loadState();
  ok('销号不存在的卡不报错也不写入', api.mistakeList(state).length === 1);
}

/* ========================== 3. 星标与进度 ========================== */

group('星标与进度');

{
  installStubs({});
  const api = await freshApi();

  let state = await api.loadState();
  ok('初始未星标', api.isStarred(state, 's1') === false);

  await api.toggleStar('s1', '7a-u1');
  state = await api.loadState();
  ok('星标成功', api.isStarred(state, 's1') === true);
  ok('星标列表含 s1', api.starList(state).length === 1);

  await api.toggleStar('s1', '7a-u1');
  state = await api.loadState();
  ok('再点取消星标', api.isStarred(state, 's1') === false);
  ok('取消后不在星标列表', api.starList(state).length === 0);

  await api.saveProgress('7a-u1', { index: 10, mode: 'en', total: 47 });
  await api.saveProgress('7a-u1', { index: 20 });
  state = await api.loadState();
  ok('进度增量合并（保留 mode 与 total）',
    state.progress['7a-u1'].index === 20
    && state.progress['7a-u1'].mode === 'en'
    && state.progress['7a-u1'].total === 47,
    JSON.stringify(state.progress['7a-u1']));

  await api.saveProgress('7b-u1', { index: 3, mode: 'pos' });
  state = await api.loadState();
  ok('lastStudied 取最近更新的单元', api.lastStudied(state).unitId === '7b-u1',
    JSON.stringify(api.lastStudied(state)));

  await api.saveSettings({ senseSplit: false });
  await api.saveSettings({ ttsAccent: 'en-US' });
  state = await api.loadState();
  ok('设置增量合并', state.settings.senseSplit === false && state.settings.ttsAccent === 'en-US',
    JSON.stringify(state.settings));
}

/* ========================== 4. 离线降级 ========================== */

group('离线降级');

{
  // file:// 协议 → 完全不碰 fetch，走本地镜像
  installStubs({ protocol: 'file:' });
  const api = await freshApi();

  await api.recordMistake('offline-1', 'en');
  const state = await api.loadState();
  ok('file:// 下仍能记录错题', state.mistakes['offline-1'].count === 1);
  ok('存储模式标注为 local', api.getStorageMode() === 'local', api.getStorageMode());
}

{
  // http 但 fetch 一直失败 → 降级且不抛异常
  installStubs({ fail: true });
  const api = await freshApi();

  let threw = false;
  try {
    await api.loadState();
    await api.recordMistake('offline-2', 'en');
    await api.saveProgress('7a-u1', { index: 1 });
  } catch {
    threw = true;
  }
  ok('服务器失败时不抛异常', threw === false);
  const state = await api.loadState();
  ok('失败后错题仍记在本地', state.mistakes['offline-2'].count === 1);
  ok('降级为 local', api.getStorageMode() === 'local');
  ok('记录了错误信息供界面提示', !!api.getLastError(), String(api.getLastError()));
}

/* ========================== 4.5 离线补同步 ========================== */

group('离线 → 上线补同步');

{
  // 一开始服务器不可达；本地写几个错题；然后服务器恢复，必须补推上去。
  const { server } = installStubs({ fail: true });
  const api = await freshApi();

  await api.recordMistake('off-1', 'en');
  await api.recordMistake('off-2', 'pos');
  let state = await api.loadState();
  ok('离线期间错题记在本地', Object.keys(state.mistakes).length === 2);
  ok('离线期间标记为 local', api.getStorageMode() === 'local', api.getStorageMode());
  ok('离线期间有未同步改动', api.hasPendingSync() === true);
  ok('离线期间服务端一条都没收到', Object.keys(server.state.mistakes).length === 0,
    JSON.stringify(Object.keys(server.state.mistakes)));

  // 服务器恢复
  server.concurrent = 0;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).includes('/api/state') && options.method === 'PATCH') {
      const patch = JSON.parse(options.body);
      server.patches += 1;
      if (patch.mistakes) Object.assign(server.state.mistakes, patch.mistakes);
      if (patch.stars) Object.assign(server.state.stars, patch.stars);
      if (patch.progress) Object.assign(server.state.progress, patch.progress);
      if (patch.settings) Object.assign(server.state.settings, patch.settings);
      return jsonResponse({ ok: true, state: server.state });
    }
    return jsonResponse({ ok: true, state: server.state });
  };

  // 触发一次刷新 → 应该把本地那份推上去，而不是被服务端的空状态盖掉
  await api.refreshState();

  ok('恢复后服务端收到离线期间的错题',
    Object.keys(server.state.mistakes).length === 2,
    `服务端只有 ${Object.keys(server.state.mistakes).length} 条：${JSON.stringify(Object.keys(server.state.mistakes))}`);
  ok('补同步后 pending 清零', api.hasPendingSync() === false);
  ok('补同步后回到 server 模式', api.getStorageMode() === 'server', api.getStorageMode());

  state = await api.loadState();
  ok('本地错题没有被服务端空状态覆盖', Object.keys(state.mistakes).length === 2,
    JSON.stringify(Object.keys(state.mistakes)));
  ok('错次信息完整保留', state.mistakes['off-1'].count === 1 && state.mistakes['off-2'].modes[0] === 'pos');

  // 恢复后再写一条 → 正常走服务端
  await api.recordMistake('off-3', 'en');
  ok('恢复后新写入直接落服务端', !!server.state.mistakes['off-3']);
}

{
  // 离线写 → 上线后**继续写**（不主动 refresh）也应补同步
  const { server } = installStubs({ fail: true });
  const api = await freshApi();

  await api.recordMistake('p1', 'en');
  ok('离线写入 pending', api.hasPendingSync() === true);

  // 服务器恢复
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).includes('/api/state') && options.method === 'PATCH') {
      const patch = JSON.parse(options.body);
      if (patch.mistakes) Object.assign(server.state.mistakes, patch.mistakes);
      return jsonResponse({ ok: true, state: server.state });
    }
    return jsonResponse({ ok: true, state: server.state });
  };

  await api.recordMistake('p2', 'en');
  ok('恢复后的下一次写入会把离线改动一起补上',
    !!server.state.mistakes.p1 && !!server.state.mistakes.p2,
    JSON.stringify(Object.keys(server.state.mistakes)));
  ok('补完后 pending 清零', api.hasPendingSync() === false);
}

{
  // 跨会话：离线写入 → **重新加载页面**（重新 import 模块，内存全清）→ 网络恢复。
  // pending 标记与镜像都必须活过这次「刷新」，否则离线那批改动会被服务端旧值覆盖掉。
  //
  // 注意：这里必须让 **GET 和 PATCH 一起失败**（真实断网就是这样）。
  // 如果 GET 还能通，applyPatch 里的 loadState() 会先拿到服务端状态、
  // 之后写成功、pending 被清掉 —— 那就测不出「刷新后标记是否还在」。
  const { storage, server } = installStubs({ fail: true });
  const api1 = await freshApi();

  await api1.recordMistake('reload-1', 'en');
  await api1.recordMistake('reload-2', 'pos');
  const mirrorBefore = JSON.parse(storage.getItem('dsh_word_state_mirror'));
  ok('刷新前镜像里有 2 条错题', Object.keys(mirrorBefore.mistakes).length === 2,
    JSON.stringify(Object.keys(mirrorBefore.mistakes)));
  ok('刷新前 pending 标记已落 localStorage',
    storage.getItem('dsh_word_pending_sync') === '1',
    String(storage.getItem('dsh_word_pending_sync')));
  ok('离线期间服务端一条都没收到', Object.keys(server.state.mistakes).length === 0,
    JSON.stringify(Object.keys(server.state.mistakes)));

  // —— 模拟刷新：同一份 localStorage，全新的模块实例；此时网络已恢复 ——
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).includes('/api/state') && options.method === 'PATCH') {
      const patch = JSON.parse(options.body);
      if (patch.mistakes) Object.assign(server.state.mistakes, patch.mistakes);
      if (patch.stars) Object.assign(server.state.stars, patch.stars);
      if (patch.progress) Object.assign(server.state.progress, patch.progress);
      if (patch.settings) Object.assign(server.state.settings, patch.settings);
      return jsonResponse({ ok: true, state: server.state });
    }
    return jsonResponse({ ok: true, state: server.state });
  };

  const api2 = await freshApi();          // 新会话：内存全空

  ok('新会话能从 localStorage 看到 pending 标记',
    storage.getItem('dsh_word_pending_sync') === '1',
    String(storage.getItem('dsh_word_pending_sync')));

  const state = await api2.loadState();   // 首次读取

  ok('新会话读到的仍是本地那 2 条（没被服务端空状态覆盖）',
    Object.keys(state.mistakes).length === 2,
    JSON.stringify(Object.keys(state.mistakes)));
  ok('新会话把离线改动补推到了服务端',
    Object.keys(server.state.mistakes).length === 2,
    `服务端有 ${Object.keys(server.state.mistakes).length} 条`);
  ok('补推后 pending 标记被清掉', api2.hasPendingSync() === false);
  ok('补推后回到 server 模式', api2.getStorageMode() === 'server', api2.getStorageMode());

  const mirrorAfter = JSON.parse(storage.getItem('dsh_word_state_mirror'));
  ok('镜像没有被清空', Object.keys(mirrorAfter.mistakes).length === 2,
    JSON.stringify(Object.keys(mirrorAfter.mistakes)));
}

{
  // 判别性用例：证明「pending 标记」是真的在起决策作用，而不是镜像里碰巧有数据。
  // 造法：本地有错题、**服务端也有错题但内容不同**，且带 pending 标记。
  // 有标记 → 必须以本地为准并把本地推上去；
  // 没标记（上一个用例的对照组）→ 必须以服务端为准。
  const { storage, server } = installStubs({});
  server.state.mistakes = {
    'server-old': { count: 9, modes: ['en'], lastWrongAt: '2026-01-01T00:00:00Z', clearedAt: null },
  };
  storage.setItem('dsh_word_state_mirror', JSON.stringify({
    version: 1,
    mistakes: { 'local-new': { count: 1, modes: ['pos'], lastWrongAt: '2026-02-01T00:00:00Z', clearedAt: null } },
    stars: {}, progress: {}, settings: {},
  }));
  storage.setItem('dsh_word_pending_sync', '1');   // ← 关键：带着待同步标记进入新会话

  const api = await freshApi();
  const state = await api.loadState();

  ok('带 pending 时以本地为准（本地错题保留）', !!state.mistakes['local-new'],
    JSON.stringify(Object.keys(state.mistakes)));
  ok('带 pending 时把本地改动推给了服务端', !!server.state.mistakes['local-new'],
    JSON.stringify(Object.keys(server.state.mistakes)));
  ok('带 pending 时不会丢掉服务端原有的其它错题', !!server.state.mistakes['server-old'],
    JSON.stringify(Object.keys(server.state.mistakes)));
  ok('推送成功后 pending 被清', api.hasPendingSync() === false);
}

{
  // 反向断言：**没有** pending 标记时，loadState 应该以服务端为准（而不是永远偏向本地）。
  // 没有这条，上面那组即使「永远走本地分支」也会绿，等于没测到东西。
  const { storage, server } = installStubs({});
  server.state.mistakes = { 'server-only': { count: 3, modes: ['en'], lastWrongAt: '2026-01-01T00:00:00Z', clearedAt: null } };
  storage.setItem('dsh_word_state_mirror', JSON.stringify({
    version: 1, mistakes: { 'stale-local': { count: 1, modes: ['en'], clearedAt: null } },
    stars: {}, progress: {}, settings: {},
  }));
  // 注意：不设 pending 标记

  const api = await freshApi();
  const state = await api.loadState();
  ok('没有 pending 时以服务端为准', !!state.mistakes['server-only'],
    JSON.stringify(Object.keys(state.mistakes)));
  ok('没有 pending 时本地陈旧数据不覆盖服务端', !state.mistakes['stale-local'],
    JSON.stringify(Object.keys(state.mistakes)));
}

/* ========================== 5. 导出 ========================== */

group('离线导出错题本');

{
  installStubs({ fail: true });
  const api = await freshApi();
  const { VOCAB } = await import('../assets/vocab.js');

  await api.recordMistake('7a-u1#L37#1', 'en');
  await api.recordMistake('7a-u1#L37#1', 'pos');
  const state = await api.loadState();

  const md = await api.buildWrongbookMarkdown(state);
  ok('导出含表头', md.includes('| 单词 | 词性 | 中文释义 | 错误次数 | 错误模式 | 所属单元 |'));
  ok('导出含单词 call', md.includes('call'));
  ok('导出含错误模式中文', md.includes('拼写') && md.includes('词性'));
  ok('导出含错次 2', /\| call \|.*\| 2 \|/.test(md), md.split('\n').find((l) => l.startsWith('| call')));
  ok('所属单元用可读标签（与服务端一致）',
    md.includes('七年级上册 · Starter Unit 1'),
    md.split('\n').find((l) => l.startsWith('| call')));
  ok('统计行格式与服务端一致', md.includes('- 错词数量：1') && md.includes('- 覆盖单元：1'));
  console.log(md.split('\n').filter((l) => l.startsWith('| call') || l.startsWith('- ')).map((l) => `  ${l}`).join('\n'));

  // 传自定义 lookup 也要能用
  const index = new Map(VOCAB.cards.map((c) => [c.id, c]));
  const md2 = await api.buildWrongbookMarkdown(state, (id) => index.get(id));
  ok('传入自定义 lookup 也正确', md2.includes('call'));
}

{
  // 孤儿 id（词库重建后删掉的行）：不该吐出一行空数据，也不该静默吞掉。
  installStubs({ fail: true });
  const api = await freshApi();

  await api.recordMistake('7a-u1#L37#1', 'en');       // 真实存在
  await api.recordMistake('7a-u1#L99999#1', 'en');    // 不存在（模拟词库删行）
  const state = await api.loadState();

  const md = await api.buildWrongbookMarkdown(state);
  const dataRows = md.split('\n')
    .filter((l) => l.startsWith('| ') && !l.includes('---') && !l.startsWith('| 单词'));
  ok('孤儿 id 不产生表格数据行', dataRows.length === 1, `实际 ${dataRows.length} 行：${dataRows.join(' / ')}`);
  ok('错词数量只算能解析的', /- 错词数量：1/.test(md), md.split('\n').find((l) => l.includes('错词数量')));
  ok('如实说明跳过了孤儿条目', /另有\s*1\s*条记录对应的词条已不在当前词库中/.test(md),
    md.split('\n').find((l) => l.includes('另有')));
}

/* ========================== 汇总 ========================== */

console.log(`\n${'═'.repeat(62)}`);
if (failures.length) {
  console.log(`✗ 失败 ${failures.length} 项，通过 ${passed} 项\n`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
} else {
  console.log(`✓ 状态层全部通过 —— ${passed} 项断言`);
}
