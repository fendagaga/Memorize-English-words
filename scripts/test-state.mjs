/**
 * 状态层测试 —— assets/api.js：浏览器缓存键位、并发正确性、降级行为、本地导出。
 *
 *   node scripts/test-state.mjs
 *
 * 状态全部存在 localStorage，所以这一套**不需要服务器、也不碰网络**：
 * 下面装了一个「网络哨兵」fetch，只要状态层敢发请求就会被断言抓住。
 */

/* ========================== 浏览器环境桩 ========================== */

class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
  clear() { this.map.clear(); }
}

/**
 * 装浏览器环境桩。
 *
 * @param {object} [opts]
 * @param {string} [opts.protocol]  location.protocol，'file:' 用来测无服务器环境
 * @param {boolean} [opts.readFail] localStorage 读就抛（隐私模式/被策略禁用）
 * @param {boolean} [opts.writeFail] localStorage 写就抛（配额超限）
 * @param {object} [opts.seed]     预置 localStorage 内容（字符串原样写入，其余 JSON 化）
 */
function installStubs({ protocol = 'http:', readFail = false, writeFail = false, seed = {} } = {}) {
  const storage = new MemoryStorage();
  for (const [k, v] of Object.entries(seed)) {
    storage.map.set(k, typeof v === 'string' ? v : JSON.stringify(v));
  }
  if (readFail) {
    storage.getItem = () => { throw new Error('SecurityError: localStorage 被禁用'); };
  }
  if (writeFail) {
    storage.setItem = () => {
      const err = new Error('QuotaExceededError: 超出配额');
      err.name = 'QuotaExceededError';
      throw err;
    };
  }

  globalThis.localStorage = storage;
  globalThis.location = { protocol, href: `${protocol}//localhost/` };

  // 网络哨兵：状态层不该碰它，checkHealth 才会用。
  const net = { calls: 0, paths: [] };
  globalThis.fetch = async (url) => {
    net.calls += 1;
    net.paths.push(String(url));
    return jsonResponse({ ok: true, units: 42, cards: 2458, entries: 2251, builtAt: '2026-01-01T00:00:00.000Z', port: 8787 });
  };

  delete globalThis.window;
  return { storage, net };
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

/** 每次测试都重新 import，避免模块级状态串台。 */
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
  installStubs({});
  const api = await freshApi();

  // 同一张卡并发错两次 → 错次必须是 2
  await Promise.all([
    api.recordMistake('card-x', 'en'),
    api.recordMistake('card-x', 'en'),
  ]);
  const state = await api.loadState();
  ok('并发两次 recordMistake → count=2', state.mistakes['card-x'].count === 2,
    `实际 ${state.mistakes['card-x'].count}`);
}

{
  installStubs({});
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
  installStubs({});
  const api = await freshApi();

  await Promise.all([
    api.recordMistake('card-a', 'en'),
    api.recordMistake('card-b', 'pos'),
  ]);
  const state = await api.loadState();
  ok('并发写不同卡 → 两张都在', !!state.mistakes['card-a'] && !!state.mistakes['card-b'],
    JSON.stringify(Object.keys(state.mistakes)));
}

{
  installStubs({});
  const api = await freshApi();

  // 并发：星标 + 错题 + 进度，互不干扰（三类数据分三个键）
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
  installStubs({});
  const api = await freshApi();

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

  await api.clearAllMistakes();
  state = await api.loadState();
  ok('一键清空后错题本为空', api.mistakeList(state).length === 0);
  ok('清空后原始记录仍在（只是销号）', Object.keys(state.mistakes).length === 1);
}

/* ========================== 3. 星标 / 进度 / 设置 ========================== */

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
  ok('星标记下了所属单元', state.stars.s1.unitId === '7a-u1');

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

/* ========================== 4. 浏览器缓存键位 ========================== */

group('浏览器缓存键位');

{
  const { storage } = installStubs({});
  const api = await freshApi();

  await api.recordMistake('k1', 'en');
  await api.toggleStar('k2', '7a-u1');
  await api.saveProgress('7a-u1', { index: 1, total: 47 });
  await api.saveSettings({ senseSplit: true });

  ok('错题写在 dsh_word_mistakes', !!storage.getItem('dsh_word_mistakes'));
  ok('星标写在 dsh_word_stars', !!storage.getItem('dsh_word_stars'));
  ok('进度写在 dsh_word_progress', !!storage.getItem('dsh_word_progress'));
  ok('设置写在 dsh_word_settings', !!storage.getItem('dsh_word_settings'));

  ok('错题键里只有错题', Object.keys(JSON.parse(storage.getItem('dsh_word_mistakes'))).join() === 'k1',
    storage.getItem('dsh_word_mistakes'));
  ok('星标键里只有星标', Object.keys(JSON.parse(storage.getItem('dsh_word_stars'))).join() === 'k2',
    storage.getItem('dsh_word_stars'));
  ok('进度键里只有进度', Object.keys(JSON.parse(storage.getItem('dsh_word_progress'))).join() === '7a-u1',
    storage.getItem('dsh_word_progress'));

  // 只写变化的键：写错题不该碰星标键的字节
  const starRaw = storage.getItem('dsh_word_stars');
  await api.recordMistake('k3', 'pos');
  ok('写错题不动星标键', storage.getItem('dsh_word_stars') === starRaw);

  // 删掉错题键 → 只有错题本清空，星标还在（键位互相独立）
  storage.removeItem('dsh_word_mistakes');
  const after = await api.loadState();
  ok('单独删错题键只清空错题本', api.mistakeList(after).length === 0);
  ok('单独删错题键不影响星标', api.starList(after).length === 1, JSON.stringify(api.starList(after)));
}

{
  // 跨会话（刷新页面）：同一份 localStorage，全新的模块实例
  const { storage } = installStubs({});
  const api1 = await freshApi();
  await api1.recordMistake('persist-1', 'en');
  await api1.toggleStar('persist-2', '7b-u1');
  await api1.saveProgress('7b-u1', { index: 7, mode: 'pos', total: 20 });
  await api1.saveSettings({ senseSplit: false, ttsAccent: 'en-US' });

  const api2 = await freshApi();
  const state = await api2.loadState();
  ok('刷新后错题还在', state.mistakes['persist-1'].count === 1);
  ok('刷新后错题模式还在', JSON.stringify(state.mistakes['persist-1'].modes) === '["en"]');
  ok('刷新后星标还在', api2.isStarred(state, 'persist-2'));
  ok('刷新后进度还在', state.progress['7b-u1'].index === 7 && state.progress['7b-u1'].mode === 'pos');
  ok('刷新后设置还在', state.settings.senseSplit === false && state.settings.ttsAccent === 'en-US',
    JSON.stringify(state.settings));
  ok('刷新后存储模式仍是 browser', api2.getStorageMode() === 'browser', api2.getStorageMode());
  ok('磁盘上确实落了四个键', ['dsh_word_mistakes', 'dsh_word_stars', 'dsh_word_progress', 'dsh_word_settings']
    .filter((k) => storage.getItem(k)).length === 4);
}

{
  // 旧键（服务端时代的遗留）：不读、不删、不影响
  const legacy = {
    dsh_word_state_mirror: JSON.stringify({
      version: 1,
      mistakes: { 'old-mistake': { count: 9, modes: ['en'], clearedAt: null } },
      stars: { 'old-star': { at: '2026-01-01T00:00:00Z', unitId: '7a-u1', removedAt: null } },
      progress: { '7a-u1': { index: 5, total: 47, updatedAt: '2026-01-01T00:00:00Z' } },
      settings: { senseSplit: false },
    }),
    dsh_word_pending_sync: '1',
    dsh_word_uid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  };
  const { storage } = installStubs({ seed: legacy });
  const api = await freshApi();

  const state = await api.loadState();
  ok('旧镜像里的错题不会被读进来', api.mistakeList(state).length === 0,
    JSON.stringify(api.mistakeList(state)));
  ok('旧镜像里的星标不会被读进来', api.starList(state).length === 0);
  ok('旧镜像里的进度不会被读进来', api.lastStudied(state) === null);
  ok('旧镜像里的设置不会被读进来', JSON.stringify(state.settings) === '{}', JSON.stringify(state.settings));

  await api.recordMistake('fresh-1', 'en');
  ok('旧镜像原样留着（不删）', storage.getItem('dsh_word_state_mirror') === legacy.dsh_word_state_mirror);
  ok('旧 pending 标记原样留着（不删）', storage.getItem('dsh_word_pending_sync') === '1');
  ok('旧 uid 原样留着（不删）', storage.getItem('dsh_word_uid') === legacy.dsh_word_uid);
  ok('新写入只落新键', !!storage.getItem('dsh_word_mistakes'));
}

/* ========================== 5. 降级与异常 ========================== */

group('存储不可用时的降级');

{
  // 配额超限：写得进不去，但功能不能断
  const { storage } = installStubs({ writeFail: true });
  const api = await freshApi();

  let threw = false;
  let state;
  try {
    state = await api.recordMistake('q1', 'en');
  } catch {
    threw = true;
  }
  ok('配额超限时不抛异常', threw === false);
  ok('配额超限后错题仍记在内存里', state && state.mistakes.q1.count === 1);
  ok('配额超限降级为 memory 模式', api.getStorageMode() === 'memory', api.getStorageMode());
  ok('记录了失败原因供界面提示', /Quota/i.test(api.getLastError() || ''), String(api.getLastError()));

  await api.recordMistake('q1', 'en');
  const again = await api.loadState();
  ok('内存模式下累加仍然正确', again.mistakes.q1.count === 2, `实际 ${again.mistakes.q1.count}`);
  ok('内存模式下星标也能用', (await api.toggleStar('q2', '7a-u1'), api.isStarred(await api.loadState(), 'q2')));
  ok('写不进去时磁盘上确实没有数据', storage.getItem('dsh_word_mistakes') === null);
}

{
  // localStorage 读被禁（隐私模式）：按空处理，读写都在内存里
  installStubs({ readFail: true });
  const api = await freshApi();

  let threw = false;
  let state;
  try {
    state = await api.loadState();
  } catch {
    threw = true;
  }
  ok('读被禁时不抛异常', threw === false);
  ok('读被禁时按空状态处理', Object.keys(state.mistakes).length === 0);
  ok('读被禁时降级为 memory 模式', api.getStorageMode() === 'memory', api.getStorageMode());

  const next = await api.recordMistake('r1', 'en');
  ok('读被禁时仍在内存里记录错题', next.mistakes.r1.count === 1);
  const reread = await api.loadState();
  ok('读被禁时读回来的是内存里那份（没被立刻丢掉）', reread.mistakes.r1.count === 1,
    JSON.stringify(reread.mistakes));
}

{
  // 键被外部写坏 / 环境不支持 localStorage 对象
  const { storage } = installStubs({
    seed: {
      dsh_word_mistakes: '{ 这不是 JSON',
      dsh_word_progress: { '7a-u1': { index: 3, mode: 'en', total: 47, updatedAt: '2026-01-01T00:00:00Z' } },
    },
  });
  const api = await freshApi();

  let threw = false;
  let state;
  try {
    state = await api.loadState();
  } catch {
    threw = true;
  }
  ok('坏 JSON 不抛异常', threw === false);
  ok('坏 JSON 按空处理', Object.keys(state.mistakes).length === 0);
  ok('坏了的那个键不影响其它键', state.progress['7a-u1'].index === 3);

  const fixed = await api.recordMistake('fix-1', 'en');
  ok('下一次写入把坏数据修好', fixed.mistakes['fix-1'].count === 1);
  ok('修好后的键是合法 JSON',
    JSON.parse(storage.getItem('dsh_word_mistakes'))['fix-1'].count === 1);
}

{
  // 连 localStorage 对象都取不到（被策略整个禁用）
  installStubs({});
  delete globalThis.localStorage;
  const api = await freshApi();

  let threw = false;
  let state;
  try {
    state = await api.loadState();
    state = await api.recordMistake('n1', 'en');
  } catch {
    threw = true;
  }
  ok('localStorage 不存在时不抛异常', threw === false);
  ok('localStorage 不存在时写在内存里', state && state.mistakes.n1.count === 1);
  ok('localStorage 不存在时标注 memory 模式', api.getStorageMode() === 'memory', api.getStorageMode());
}

/* ========================== 6. 跨标签页 / 不读缓存 ========================== */

group('跨标签页与陈旧数据');

{
  const { storage } = installStubs({});
  const api = await freshApi();

  await api.recordMistake('mine', 'en');
  ok('本标签页写入已落盘', !!storage.getItem('dsh_word_mistakes'));

  // 模拟另一个标签页写星标（直接改磁盘，绕过本实例）
  storage.setItem('dsh_word_stars', JSON.stringify({
    'other-star': { at: '2026-02-01T00:00:00Z', unitId: '7a-u1', removedAt: null },
  }));
  let state = await api.loadState();
  ok('loadState 立刻能看到另一标签页写的星标', api.isStarred(state, 'other-star'),
    JSON.stringify(state.stars));

  // 另一标签页往同一个键里加了一张卡，本标签页再写自己那张 → 两张都要在
  storage.setItem('dsh_word_mistakes', JSON.stringify({
    'other-card': { count: 4, modes: ['en'], lastWrongAt: '2026-02-01T00:00:00Z', clearedAt: null },
  }));
  await api.recordMistake('mine-2', 'pos');
  const merged = JSON.parse(storage.getItem('dsh_word_mistakes'));
  ok('同键写入会与磁盘现值合并（另一标签页的卡还在）', !!merged['other-card'],
    JSON.stringify(Object.keys(merged)));
  ok('同键写入自己的卡也在', !!merged['mine-2'], JSON.stringify(Object.keys(merged)));
  ok('另一标签页的错次没被改小', merged['other-card'].count === 4, String(merged['other-card'].count));

  state = await api.loadState();
  ok('两张卡都在读回来的一致状态里',
    !!state.mistakes['other-card'] && !!state.mistakes['mine-2']);
}

/* ========================== 7. 不访问网络 ========================== */

group('状态层不碰网络');

{
  const { net } = installStubs({});
  const api = await freshApi();

  await api.loadState();
  await api.recordMistake('net-1', 'en');
  await api.toggleStar('net-2', '7a-u1');
  await api.saveProgress('7a-u1', { index: 2, total: 47 });
  await api.saveSettings({ senseSplit: true });
  await api.clearMistake('net-1');
  await api.refreshState();
  await api.buildWrongbookMarkdown(await api.loadState());

  ok('全部状态操作一次网络请求都没发', net.calls === 0, `实际 ${net.calls} 次：${net.paths.join(', ')}`);

  const health = await api.checkHealth();
  ok('checkHealth 才发一次请求', net.calls === 1, `实际 ${net.calls} 次`);
  ok('checkHealth 解析服务端返回', health.ok === true && health.units === 42, JSON.stringify(health));
}

{
  // 不是 http(s) 打开（例如 file:）—— checkHealth 直接给结论，不尝试请求
  const { net } = installStubs({ protocol: 'file:' });
  const api = await freshApi();

  const health = await api.checkHealth();
  ok('file: 协议下 checkHealth 返回 file-protocol', health.ok === false && health.reason === 'file-protocol',
    JSON.stringify(health));
  ok('file: 协议下不发请求', net.calls === 0, `实际 ${net.calls} 次`);

  const state = await api.recordMistake('file-1', 'en');
  ok('file: 协议下状态照样写本机', state.mistakes['file-1'].count === 1);
}

/* ========================== 8. 导出 ========================== */

group('本地导出错题本');

{
  installStubs({});
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
  ok('所属单元用可读标签', md.includes('七年级上册 · Starter Unit 1'),
    md.split('\n').find((l) => l.startsWith('| call')));
  ok('统计行格式完整', md.includes('- 错词数量：1') && md.includes('- 覆盖单元：1'));
  console.log(md.split('\n').filter((l) => l.startsWith('| call') || l.startsWith('- ')).map((l) => `  ${l}`).join('\n'));

  // 传自定义 lookup 也要能用
  const index = new Map(VOCAB.cards.map((c) => [c.id, c]));
  const md2 = await api.buildWrongbookMarkdown(state, (id) => index.get(id));
  ok('传入自定义 lookup 也正确', md2.includes('call'));
}

{
  // 孤儿 id（词库重建后删掉的行）：不该吐出一行空数据，也不该静默吞掉。
  installStubs({});
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
