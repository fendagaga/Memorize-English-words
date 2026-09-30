/**
 * 状态访问层 —— 错题本 / 星标 / 进度 / 设置**全部存在浏览器本机**（localStorage）。
 *
 * 四类数据各占一个键，互不干扰：
 *   dsh_word_mistakes  错题本      { <cardId>: { count, modes, lastWrongAt, clearedAt } }
 *   dsh_word_stars     星标生词本  { <cardId>: { at, unitId, removedAt } }
 *   dsh_word_progress  背诵进度    { <unitId>: { index, mode, shuffled, total, updatedAt, seq } }
 *   dsh_word_settings  设置        { senseSplit, ttsAccent }
 *
 * 为什么分四个键：一次只写发生变化的那个键 —— 多标签页同时写「错题」与「星标」
 * 不会互相整表覆盖；万一某个键被写坏也只坏这一份；用户想单独清掉错题本、保住
 * 星标，删一个键就行。
 *
 * 不经过服务器：这个模块里没有任何状态请求，`fetch` 只出现在 checkHealth()
 * （首页拿词库构建时间用）。
 *
 * 降级：localStorage 不可用（隐私模式、被策略禁用）或写失败（配额超限）时，
 * 改动落到模块内存里，功能照常、本会话内读写一致，关掉页面就没了 ——
 * 界面通过 getStorageMode() === 'memory' 提示用户。
 *
 * 旧键（`dsh_word_state_mirror` / `dsh_word_pending_sync` / `dsh_word_uid`）
 * 是本层服务端时代的遗留，**不读也不删**；想清干净见 README。
 */

const KEYS = {
  mistakes: 'dsh_word_mistakes',
  stars: 'dsh_word_stars',
  progress: 'dsh_word_progress',
  settings: 'dsh_word_settings',
};
const STATE_KEYS = Object.keys(KEYS);

/** 卡片查表：导出错题本时要把 cardId 还原成单词、词性、释义、单元名。 */
let CARD_INDEX = null;
export async function cardIndex() {
  if (!CARD_INDEX) {
    const { VOCAB } = await import('./vocab.js');
    CARD_INDEX = new Map(VOCAB.cards.map((c) => [c.id, c]));
  }
  return CARD_INDEX;
}

/* ========================== 存储 ========================== */

/** 'browser' 已落 localStorage ｜ 'memory' 只能用内存（关页即失）。 */
let storageMode = 'browser';
/** 最近一次存储异常，界面可以提示。 */
let lastError = null;
/**
 * localStorage 不可用时的兜底：key -> 原始 JSON 串。
 * 只保存「比 localStorage 更新」的那些键，落盘成功后立刻移出。
 */
const memory = new Map();

function degrade(err) {
  lastError = (err && err.message) ? err.message : String(err);
  storageMode = 'memory';
}

/** localStorage 对象本身在部分环境下取用即抛异常，这里统一收口。 */
function store() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function parseObject(raw) {
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};                      // 键被外部写坏：按空处理，下一次写入自然修好
  }
}

function readFeature(name) {
  const key = KEYS[name];
  if (memory.has(key)) return parseObject(memory.get(key));   // 内存里那份更新
  const s = store();
  if (!s) return {};
  try {
    const raw = s.getItem(key);
    return raw ? parseObject(raw) : {};
  } catch (err) {
    degrade(err);
    return {};
  }
}

function writeFeature(name, value) {
  const key = KEYS[name];
  let raw;
  try {
    raw = JSON.stringify(value);
  } catch (err) {
    degrade(err);
    return false;
  }
  memory.set(key, raw);
  const s = store();
  try {
    if (!s) throw new Error('localStorage 不可用');
    s.setItem(key, raw);
    // 落盘后再读回来确认一次：有的环境「写得进、读不出」（存取被策略拦住），
    // 这时内存那份必须留着，否则刚记下的错题当场就没了。
    if (s.getItem(key) !== raw) throw new Error('localStorage 写入后读不回来');
    memory.delete(key);
    // 内存里已经没有待落盘的键 → 说明四类数据都在磁盘上，回到 browser 模式。
    if (!memory.size) {
      storageMode = 'browser';
      lastError = null;
    }
    return true;
  } catch (err) {
    degrade(err);
    return false;
  }
}

/** 从磁盘现读一份完整状态。不留长驻缓存：另一标签页刚写的值这里能立刻看到。 */
function readAll() {
  return normalizeState({
    mistakes: readFeature('mistakes'),
    stars: readFeature('stars'),
    progress: readFeature('progress'),
    settings: readFeature('settings'),
  });
}

export function getStorageMode() { return storageMode; }
export function getLastError() { return lastError; }

/* ========================== 空状态 ========================== */

export function emptyState() {
  return {
    version: 1,
    mistakes: {},
    stars: {},
    progress: {},
    settings: {},
    updatedAt: null,
  };
}

/** 补齐缺失字段，避免界面到处判空。 */
export function normalizeState(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  return {
    version: 1,
    mistakes: s.mistakes && typeof s.mistakes === 'object' ? s.mistakes : {},
    stars: s.stars && typeof s.stars === 'object' ? s.stars : {},
    progress: s.progress && typeof s.progress === 'object' ? s.progress : {},
    settings: s.settings && typeof s.settings === 'object' ? s.settings : {},
    // 数据分四个键存，没有统一的落盘时间戳；这个字段只为形状兼容保留。
    updatedAt: s.updatedAt || null,
  };
}

/* ========================== 状态读写 ========================== */

/**
 * 读取状态。始终从 localStorage 现读，任何环境都不抛异常。
 * @param {{force?: boolean}} [options] 兼容旧调用（已无缓存可失效）
 */
export async function loadState(options = {}) {
  void options;            // 参数只为兼容旧调用（已经没有任何缓存需要失效）
  return readAll();
}

/**
 * 写操作串行化。
 * `读 → 算 → 写` 这一段必须**整体**排队。只把写排队是不够的：两个并发调用会在
 * 排队前各自读到同一份旧值，各算出 count=1，落盘还是 1。
 */
let writeChain = Promise.resolve();

function serialize(task) {
  const run = writeChain.then(task, task);
  // 接住失败，避免一次出错把后续所有写操作都带崩。
  writeChain = run.then(() => {}, () => {});
  return run;
}

/**
 * 把 patch 合进 current，只把**出现过的**字段落盘。
 * 只写变化的键，是为了不动另一个标签页刚写好的其它键。
 */
function commit(current, patch) {
  const changed = [];
  const next = normalizeState({
    ...current,
    ...patch,
    mistakes: patch.mistakes ? { ...current.mistakes, ...patch.mistakes } : current.mistakes,
    stars: patch.stars ? { ...current.stars, ...patch.stars } : current.stars,
    progress: patch.progress ? { ...current.progress, ...patch.progress } : current.progress,
    settings: patch.settings ? { ...current.settings, ...patch.settings } : current.settings,
  });
  for (const name of STATE_KEYS) if (patch[name]) changed.push(name);
  for (const name of changed) writeFeature(name, next[name]);
  return next;
}

/**
 * 读-改-写原子操作：在队列内**现读**当前状态，避免拿到陈旧副本。
 * @param {(state: object) => object} fn 拿到当前状态，返回要合的 patch
 */
function mutate(fn) {
  return serialize(() => {
    const current = readAll();
    return commit(current, fn(current) || {});
  });
}

/**
 * 局部更新状态（错题本 / 星标 / 进度 / 设置），返回新状态。
 * 注意：这个接口是**整体覆盖语义**，不要用它做「读旧值再累加」的事 —— 那要用 mutate。
 */
export function patchState(patch) {
  return serialize(() => commit(readAll(), patch || {}));
}

/** 重新读一次状态（跨标签页改动后刷新用）。 */
export async function refreshState() {
  return loadState({ force: true });
}

/* ========================== 错题本 ========================== */

/** 错题本的 key 是卡片 id；按单词去重由卡片本身的一词一卡保证。 */
export function mistakeList(state) {
  const list = [];
  for (const [cardId, rec] of Object.entries(state.mistakes || {})) {
    if (!rec || rec.clearedAt) continue;
    list.push({ cardId, ...rec });
  }
  return list.sort((a, b) => (b.count || 0) - (a.count || 0));
}

/** 记一次错误：错次累加、错误模式并集、时间戳刷新。 */
export function recordMistake(cardId, mode) {
  return mutate((state) => {
    const prev = state.mistakes[cardId] || { count: 0, modes: [] };
    const modes = new Set(prev.modes || []);
    modes.add(mode);
    return {
      mistakes: {
        [cardId]: {
          count: (prev.count || 0) + 1,
          modes: [...modes],
          lastWrongAt: new Date().toISOString(),
          clearedAt: null,
        },
      },
    };
  });
}

/** 答对一次 → 销号（「已掌握」）。 */
export function clearMistake(cardId) {
  return mutate((state) => {
    if (!state.mistakes[cardId]) return {};   // 不在错题本里，什么也不做
    return {
      mistakes: { [cardId]: { ...state.mistakes[cardId], clearedAt: new Date().toISOString() } },
    };
  });
}

/** 把某个词答对后自动销号（重练模式用）。 */
export function autoClearOnCorrect(cardId) {
  return clearMistake(cardId);
}

/** 全部销号。注意这是**读全表再算**的操作，必须走 mutate，否则会吞掉并发写入。 */
export function clearAllMistakes() {
  return mutate((state) => {
    const now = new Date().toISOString();
    const mistakes = {};
    for (const [id, rec] of Object.entries(state.mistakes)) {
      mistakes[id] = { ...rec, clearedAt: rec.clearedAt || now };
    }
    return { mistakes };
  });
}

/* ========================== 星标生词本 ========================== */

export function starList(state) {
  return Object.entries(state.stars || {})
    .filter(([, rec]) => rec && !rec.removedAt)
    .map(([cardId, rec]) => ({ cardId, ...rec }));
}

export function isStarred(state, cardId) {
  const rec = state.stars[cardId];
  return !!(rec && !rec.removedAt);
}

export function toggleStar(cardId, unitId) {
  return mutate((state) => {
    const on = isStarred(state, cardId);
    const prev = state.stars[cardId] || {};
    return {
      stars: {
        [cardId]: on
          ? { ...prev, removedAt: new Date().toISOString() }
          : { ...prev, removedAt: null, at: new Date().toISOString(), unitId },
      },
    };
  });
}

/* ========================== 进度 ========================== */

/**
 * 严格单调递增的时间戳。
 * `new Date().toISOString()` 只有毫秒精度，同一个毫秒内保存两个单元会得到**完全相同**
 * 的字符串，靠它排序结果不确定。这里保证同一进程内每次调用都比上一次大。
 */
let lastStamp = 0;
function monotonicNow() {
  let t = Date.now();
  if (t <= lastStamp) t = lastStamp + 1;
  lastStamp = t;
  return new Date(t).toISOString();
}

/** 保存单元背诵进度（同一单元并发的多次保存会正确按顺序合并）。 */
export function saveProgress(unitId, patch) {
  return mutate((state) => {
    const prev = state.progress[unitId] || {};
    return {
      progress: {
        [unitId]: {
          ...prev,
          ...patch,
          updatedAt: monotonicNow(),
          seq: (typeof prev.seq === 'number' ? prev.seq : 0) + 1,
        },
      },
    };
  });
}

export function getProgress(state, unitId) {
  return (state.progress || {})[unitId] || null;
}

/**
 * 最近一次背诵过的单元（首页「继续上次」用）。
 * updatedAt 已保证单调递增；仍留 seq 做二次保险（老数据可能没有 seq）。
 */
export function lastStudied(state) {
  const rows = Object.entries(state.progress || {})
    .filter(([, p]) => p && p.updatedAt)
    .sort((a, b) => {
      const ta = String(a[1].updatedAt);
      const tb = String(b[1].updatedAt);
      if (ta !== tb) return tb.localeCompare(ta);
      const sa = typeof a[1].seq === 'number' ? a[1].seq : 0;
      const sb = typeof b[1].seq === 'number' ? b[1].seq : 0;
      return sb - sa;
    });
  return rows.length ? { unitId: rows[0][0], ...rows[0][1] } : null;
}

/* ========================== 设置 ========================== */

export function saveSettings(patch) {
  return mutate((state) => ({ settings: { ...state.settings, ...patch } }));
}

/* ========================== 导出 ========================== */

/**
 * 拼错题本 Markdown。数据就在本机，导出完全在浏览器里完成。
 *
 * 解析不到的 cardId（词库重建后删掉了对应行）会被跳过，并如实说明跳过了几条，
 * 而不是吐出一行空数据。
 *
 * @param {object} state      状态
 * @param {Function} [cardLookup] (cardId) => card；不传就自动加载完整卡片索引
 */
export async function buildWrongbookMarkdown(state, cardLookup) {
  let lookup = cardLookup;
  if (!lookup) {
    const index = await cardIndex();
    lookup = (id) => index.get(id) || null;
  }

  const rows = mistakeList(state);
  const resolved = rows.map((r) => ({ row: r, card: lookup(r.cardId) }));
  const cards = resolved.filter((r) => r.card);
  const orphans = resolved.length - cards.length;

  const lines = [
    '# 错题本',
    '',
    `- 导出时间：${new Date().toLocaleString('zh-CN')}`,
    `- 错词数量：${cards.length}`,
    `- 覆盖单元：${new Set(cards.map((r) => r.card.unitId)).size}`,
  ];
  if (orphans) {
    lines.push(`- 另有 ${orphans} 条记录对应的词条已不在当前词库中（词表更新过），未列入下表`);
  }
  lines.push(
    '',
    '| 单词 | 词性 | 中文释义 | 错误次数 | 错误模式 | 所属单元 |',
    '|---|---|---|---|---|---|',
  );
  const esc = (s) => String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  for (const { row, card } of cards) {
    const modes = (row.modes || []).map((m) => ({ en: '拼写', pos: '词性', cn: '释义' }[m] || m)).join('、') || '—';
    lines.push(`| ${esc(card.word)} | ${esc(card.pos)} | ${esc(card.cn)} | ${row.count || 1} | ${esc(modes)} | ${esc(card.unitLabel || card.unitId)} |`);
  }
  lines.push('');
  return lines.join('\n');
}

/** 触发浏览器下载。 */
export function downloadText(filename, text, mime = 'text/markdown;charset=utf-8') {
  const blob = new Blob([`\uFEFF${text}`], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ========================== 健康检查 ========================== */

/**
 * 探一次服务端（首页用来显示词库构建时间、比对单元数）。
 * 与状态无关：拿不到就返回 { ok:false }，页面自己兜底。
 */
export async function checkHealth() {
  if (typeof location === 'undefined' || !/^https?:$/.test(location.protocol)) {
    return { ok: false, reason: 'file-protocol' };
  }
  try {
    const res = await fetch('/api/health');
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const data = await res.json();
    return { ok: true, ...data };
  } catch (err) {
    return { ok: false, reason: err.message || String(err) };
  }
}

if (typeof window !== 'undefined') {
  window.DSH_API = {
    loadState, patchState, refreshState, getStorageMode, getLastError,
    emptyState, normalizeState,
    mistakeList, recordMistake, clearMistake, autoClearOnCorrect, clearAllMistakes,
    starList, isStarred, toggleStar,
    saveProgress, getProgress, lastStudied, saveSettings,
    cardIndex, buildWrongbookMarkdown, downloadText, checkHealth,
  };
}
