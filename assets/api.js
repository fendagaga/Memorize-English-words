/**
 * 服务端状态访问层。
 *
 * 服务端（scripts/serve.mjs）把每个浏览器的「错题本 / 星标 / 进度 / 设置」
 * 存成 userData/<uid>.json。这个模块负责：
 *   1. 生成并记住 uid（localStorage）
 *   2. 读写 /api/state，带离线降级
 *   3. 提供错题本、星标、进度的语义化操作
 *
 * 离线降级：如果页面不是通过 http 打开（比如直接双击 html），或服务器挂了，
 * 会自动切到 localStorage 存一份，功能照常可用，只是不跟服务端同步。
 * 状态里的 `storage` 字段会告诉界面当前是哪种模式。
 */

const UID_KEY = 'dsh_word_uid';
const MIRROR_KEY = 'dsh_word_state_mirror';
const UID_RE = /^[a-z0-9]{8,32}$/;

/** 卡片查表：离线导出错题本时要把 cardId 还原成单词、词性、释义、单元名。 */
let CARD_INDEX = null;
export async function cardIndex() {
  if (!CARD_INDEX) {
    const { VOCAB } = await import('./vocab.js');
    CARD_INDEX = new Map(VOCAB.cards.map((c) => [c.id, c]));
  }
  return CARD_INDEX;
}

/* ========================== uid ========================== */

function randomUid() {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function getUid() {
  let uid = null;
  try { uid = localStorage.getItem(UID_KEY); } catch { /* 隐私模式下会抛 */ }
  if (!uid || !UID_RE.test(uid)) {
    uid = randomUid();
    try { localStorage.setItem(UID_KEY, uid); } catch { /* 忽略 */ }
  }
  return uid;
}

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
    updatedAt: s.updatedAt || null,
  };
}

/* ========================== 本地镜像 ========================== */

function readMirror() {
  try {
    const raw = localStorage.getItem(MIRROR_KEY);
    return raw ? normalizeState(JSON.parse(raw)) : emptyState();
  } catch {
    return emptyState();
  }
}

function writeMirror(state) {
  try { localStorage.setItem(MIRROR_KEY, JSON.stringify(state)); } catch { /* 忽略 */ }
}

/* ========================== HTTP ========================== */

/** 当前页面是否处于「可以用 fetch 访问同源 API」的环境。 */
export function canReachServer() {
  return typeof location !== 'undefined' && /^https?:$/.test(location.protocol);
}

async function request(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Word-Uid': getUid(),
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText}${detail ? ` —— ${detail.slice(0, 200)}` : ''}`);
  }
  const type = res.headers.get('Content-Type') || '';
  return type.includes('application/json') ? res.json() : res.text();
}

/* ========================== 状态读写 ========================== */

/** 整体缓存，减少往返；每次写操作后同步更新。 */
let cache = null;
/** 'server' | 'local' —— 当前实际生效的存储方式。 */
let storageMode = 'server';
/** 最近一次同步错误信息，界面可以提示。 */
let lastError = null;
/**
 * 本地有没有「还没推上服务端」的改动。
 * 离线背了几个词、之后服务器又活了，这些改动必须补同步，否则看起来没丢、
 * 一换设备就全没了。补同步成功后清标记。
 *
 * **必须持久化**：只放内存的话，用户离线背完一课、切个页面或刷新一下，
 * 标记归零，下次 loadState() 就会拿服务端的旧值把镜像覆盖掉 —— 这一课的
 * 错题与进度静默消失。所以下面这个 key 要跟着 mirror 一起落 localStorage。
 */
const PENDING_KEY = 'dsh_word_pending_sync';
/** 正在补同步，避免并发触发多次全量推送。 */
let syncing = false;

function readPending() {
  try { return localStorage.getItem(PENDING_KEY) === '1'; } catch { return false; }
}
function writePending(on) {
  try {
    if (on) localStorage.setItem(PENDING_KEY, '1');
    else localStorage.removeItem(PENDING_KEY);
  } catch { /* 忽略 */ }
}

export function getStorageMode() { return storageMode; }
export function getLastError() { return lastError; }
/** 是否还有未同步到服务端的本地改动（能跨刷新/换页）。 */
export function hasPendingSync() { return readPending(); }

/**
 * 把本地状态整份推给服务端（离线期间的改动补同步）。
 * 服务端是「按字段浅合并」，同名 key 以本次推送为准 —— 正是我们要的方向：
 * 离线期间本地是最新的。
 */
async function flushPending() {
  if (!hasPendingSync() || syncing) return;
  if (!canReachServer()) return;
  syncing = true;
  try {
    if (!cache) cache = readMirror();
    const data = await request('/api/state', { method: 'PATCH', body: JSON.stringify(cache) });
    const merged = normalizeState(data.state || data);
    cache = merged;
    writeMirror(merged);
    writePending(false);
    storageMode = 'server';
    lastError = null;
  } catch (err) {
    lastError = err.message || String(err);
    // 还是不通 —— 保持 pending，等下次写操作或 refreshState 再试。
  } finally {
    syncing = false;
  }
}

/**
 * 读取状态。服务器不可达时自动降级到本地镜像，不抛异常。
 */
export async function loadState({ force = false } = {}) {
  if (cache && !force) return cache;

  if (!canReachServer()) {
    storageMode = 'local';
    cache = readMirror();
    return cache;
  }

  // 本地还有没推上去的改动（可能是上一次会话离线时攒的）→ 以本地为准先补推，
  // 绝不能用服务端的旧值把镜像盖掉。
  if (readPending()) {
    cache = readMirror();
    await flushPending();
    if (storageMode !== 'server') return cache;   // 还没推通，继续用本地
  }

  try {
    const data = await request('/api/state');
    cache = normalizeState(data.state || data);
    storageMode = 'server';
    lastError = null;
    writeMirror(cache);
    return cache;
  } catch (err) {
    storageMode = 'local';
    lastError = err.message || String(err);
    cache = readMirror();
    return cache;
  }
}

/**
 * 写操作串行化。
 * `loadState → 算 → 写回` 这一段必须**整体**排队。只把写回排队是不够的：
 * 两个并发调用会在排队前各自读到同一份旧 cache，各算出 count=1，落盘还是 1。
 */
let writeChain = Promise.resolve();

function serialize(task) {
  const run = writeChain.then(task, task);
  // 接住失败，避免一次出错把后续所有写操作都带崩。
  writeChain = run.then(() => {}, () => {});
  return run;
}

/**
 * 读-改-写原子操作。
 * @param {(state: object) => object} fn 拿到当前状态，返回要合的 patch
 *
 * 所有会「先读旧值再算新值」的操作都必须走这里，不能在队列外先读。
 */
function mutate(fn) {
  return serialize(async () => {
    const state = await loadState();
    return applyPatch(fn(state) || {});
  });
}

/**
 * 局部更新状态（错题本 / 星标 / 进度 / 设置），返回新状态。
 * 服务端与本地镜像双写，任何一边失败都不阻塞用户。
 * 注意：这个接口是**整体覆盖语义**，不要用它做「读旧值再累加」的事 —— 那要用 mutate。
 */
export function patchState(patch) {
  return serialize(() => applyPatch(patch));
}

async function applyPatch(patch) {
  const current = await loadState();
  const next = normalizeState({
    ...current,
    ...patch,
    mistakes: patch.mistakes ? { ...current.mistakes, ...patch.mistakes } : current.mistakes,
    stars: patch.stars ? { ...current.stars, ...patch.stars } : current.stars,
    progress: patch.progress ? { ...current.progress, ...patch.progress } : current.progress,
    settings: patch.settings ? { ...current.settings, ...patch.settings } : current.settings,
  });
  cache = next;
  writeMirror(next);

  if (!canReachServer()) {
    // file:// 打开等场景 —— 本地写就是最终形态，不记 pending（没有服务端可补）。
    storageMode = 'local';
    return next;
  }

  // 之前就有没推上去的改动 → 先把整份补推，再落这一次，
  // 避免只推这一条而把离线期间攒的其它改动留在本地。
  if (hasPendingSync()) {
    await flushPending();
    if (storageMode !== 'server') return cache || next;
  }

  try {
    const data = await request('/api/state', { method: 'PATCH', body: JSON.stringify(patch) });
    storageMode = 'server';
    lastError = null;
    cache = normalizeState(data.state || data);
    writeMirror(cache);
  } catch (err) {
    lastError = err.message || String(err);
    storageMode = 'local';
    // 写失败 —— 这次改动只在本地，标记待补同步，别让它悄悄消失。
    // 标记要持久化，否则刷新/换页后就再也不会补推了。
    writePending(true);
  }
  return cache || next;
}

/** 重新拉一次服务端状态（跨设备同步用）。 */
export async function refreshState() {
  cache = null;
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
 * 触发错题本 Markdown 下载。
 * 服务端可用时走 /api/export/wrongbook.md（内容更全），否则本地拼。
 */
export function exportWrongbookUrl() {
  return '/api/export/wrongbook.md';
}

/**
 * 本地拼 Markdown，作为服务端不可用时的兜底。
 * 表头与「所属单元」写法刻意与服务端 /api/export/wrongbook.md 保持一致，
 * 免得用户在两种模式下导出的文件长得不一样。
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

export async function checkHealth() {
  if (!canReachServer()) return { ok: false, reason: 'file-protocol' };
  try {
    const data = await request('/api/health');
    return { ok: true, ...data };
  } catch (err) {
    return { ok: false, reason: err.message || String(err) };
  }
}

if (typeof window !== 'undefined') {
  window.DSH_API = {
    getUid, loadState, patchState, refreshState, getStorageMode, getLastError, hasPendingSync,
    mistakeList, recordMistake, clearMistake, clearAllMistakes,
    starList, isStarred, toggleStar,
    saveProgress, getProgress, lastStudied, saveSettings,
    cardIndex, exportWrongbookUrl, buildWrongbookMarkdown, downloadText, checkHealth,
  };
}
