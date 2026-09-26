/**
 * 卡片工具 —— 判分规则、卡片构造、词序、设置。
 *
 * 这个文件是**纯函数库**，不碰 DOM，方便 Node 端直接跑测试。
 * 判分规则全部是可导出的纯函数，见文件末尾的 judges。
 */

import { VOCAB } from '../data/vocab.js';

export { VOCAB };

/* ========================== 规范化 ========================== */

/** 全角 → 半角（含全角字母数字、全角标点、全角空格）。 */
export function toHalfWidth(text) {
  return String(text || '')
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/\u3000/g, ' ');
}

/** 各种撇号统一成 ASCII 撇号，弯引号统一。 */
export function normalizeApostrophes(text) {
  return String(text || '')
    .replace(/[\u2018\u2019\u02BC\u02B9\u2032`´]/g, "'")
    .replace(/[\u201C\u201D]/g, '"');
}

/* ========================== 英文判分 ========================== */

/**
 * 英文拼写规范化：全角转半角、撇号统一、压缩内部空白、首尾去空格、转小写。
 * 按用户确认的规则：忽略大小写与首尾空格，其余严格。
 */
export function normalizeEn(text) {
  return normalizeApostrophes(toHalfWidth(text)).replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * 背英文模式判分。
 * @param {string} input 用户输入
 * @param {object} card  卡片（用 wordCandidates 兼容 `a / an` 这类多写法词条）
 */
export function judgeEn(input, card) {
  const value = normalizeEn(input);
  if (!value) return false;
  const candidates = (card && card.wordCandidates) || [card && card.word];
  return candidates.some((c) => normalizeEn(c) === value);
}

/* ========================== 中文判分 ========================== */

/** 中文释义里的虚词/结构词，做关键词时丢掉，避免「……的」这类噪声判对。 */
const CN_NOISE = [
  '某人', '某事', '某物', '某处', '某个', '某些', '某种', '某地',
  '用于', '常用于', '常用', '表示', '指的是', '指', '即', '等等', '之意',
  '不定式', '原形', '第三人称', '单数', '复数', '形式', '语气',
  '相当于', '相当于', '多用于', '尤指', '特指', '泛指',
];

/**
 * 中文规范化：全角转半角、去标点、压缩空白。
 * **不去「的」** —— 因为「橙红色（的）」里的「的」在括号内，去掉标点后
 * 会粘成「橙红色」，反而帮助匹配；真正的噪声靠关键词拆分处理。
 */
export function normalizeCn(text) {
  return toHalfWidth(normalizeApostrophes(text))
    .replace(/[；;，,、·。.！!？?：:（）()〔〕【】\[\]「」『』“”‘’…—\-_/／\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 从一张卡的中文释义里抽出「关键词」。
 * 「救；储蓄；保存」→ ['救','储蓄','保存']；「把……叫作；（给……）打电话」→ ['把……叫作','给……打电话']
 */
export function cnKeywords(cn) {
  const raw = String(cn || '');
  // 括号里的补充说明先拿掉，避免「（用于单数可数名词前，表示未曾提到的）」污染关键词。
  const stripped = raw.replace(/[（(][^）)]*[）)]/g, ' ');
  const parts = stripped.split(/[；;，,、·/／]+/);
  const out = [];
  for (const part of parts) {
    let word = normalizeCn(part);
    if (!word) continue;
    for (const noise of CN_NOISE) word = word.split(noise).join('');
    word = word.replace(/\s+/g, '');
    if (!word) continue;
    // 只保留还有实义的字词（至少一个汉字或字母）。
    if (!/[\u4e00-\u9fffA-Za-z0-9]/.test(word)) continue;
    out.push(word);
  }
  // 去重 + 长词优先（长词更能代表义项）。
  return [...new Set(out)].sort((a, b) => b.length - a.length);
}

/**
 * 背词性模式的中文释义判分：关键词命中即算对。
 * 「救；储蓄；保存」对 `救`、`储蓄`、`保存`、`救人的` 都判对，对 `杀` 判错。
 */
export function judgeCn(input, card) {
  const value = normalizeCn(input).replace(/\s+/g, '');
  if (!value) return false;
  const keywords = cnKeywords(card && (card.cn || card.meaning));
  if (!keywords.length) return true; // 没有可判的关键词（缺释义卡）→ 不因释义判错
  return keywords.some((k) => value.includes(k.replace(/\s+/g, '')));
}

/* ========================== 词性判分 ========================== */

/**
 * 背词性模式的词性判分。
 * 卡片给的是「判分范围」（posScopes），例如 `v. & n.` → 选 v. 或 n. 都对；
 * `adj., adv. & n.` → 选 adj. / adv. / n. 任意一个都对。
 */
export function judgePos(selected, card) {
  const value = String(selected || '').trim();
  if (!value) return false;
  const scopes = (card && card.posScopes && card.posScopes.length)
    ? card.posScopes
    : [card && card.pos].filter(Boolean);
  return scopes.includes(value);
}

/** 正确答案的展示文本：单个词性显示原文写法（`v. & n.`），多个就并列。 */
export function answerPosText(card) {
  if (!card) return '';
  return card.pos || (card.posScopes || []).join(' / ');
}

/* ======================== 卡片 / 词序 ======================== */

/** 按单元取卡；unitId 为 'all' 时返回全库。 */
export function cardsOfUnit(unitId) {
  if (!unitId || unitId === 'all') return VOCAB.cards.slice();
  return VOCAB.cards.filter((c) => c.unitId === unitId);
}

/** 取单元元信息。 */
export function unitById(unitId) {
  return VOCAB.units.find((u) => u.id === unitId) || null;
}

/** 取册次元信息。 */
export function volumeById(volumeId) {
  return VOCAB.volumes.find((v) => v.id === volumeId) || null;
}

/** 一个单元里某个词的「全部义项」，答错时用来对比展示。 */
export function siblingSenses(card) {
  if (!card) return [];
  return VOCAB.cards.filter((c) => c.unitId === card.unitId && c.sourceLine === card.sourceLine);
}

/** Fisher–Yates 洗牌；传入 rng 方便测试可复现。 */
export function shuffle(list, rng = Math.random) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * 构造本轮背记的卡序列。
 * @param {object} opts { unitId, shuffle, senseSplit }
 *   senseSplit=true （默认）按义项拆卡：一词多义各自成卡
 *   senseSplit=false 整词合并：同一个词的多个义项连着出，只在最后一张结算
 */
export function buildQueue({ unitId = 'all', shuffled = false, senseSplit = true, ids = null } = {}) {
  let cards = ids ? ids.map((id) => VOCAB.cards.find((c) => c.id === id)).filter(Boolean) : cardsOfUnit(unitId);
  if (!senseSplit) {
    // 整词合并：同一个词条（同 unit + 同 sourceLine）归成一张卡，义项全部列出。
    const groups = new Map();
    for (const card of cards) {
      const key = `${card.unitId}|${card.sourceLine}`;
      if (!groups.has(key)) {
        groups.set(key, { ...card, senses: [] });
      }
      groups.get(key).senses.push(card);
    }
    cards = [...groups.values()];
  }
  if (shuffled) cards = shuffle(cards);
  return cards;
}

/** 判断当前卡在合并模式下要考的全部义项。 */
export function cardSenses(card) {
  if (card && Array.isArray(card.senses) && card.senses.length) return card.senses;
  return [card];
}

/* ======================== 设置读写 ======================== */

export const DEFAULT_SETTINGS = {
  /** true = 按义项拆卡；false = 整词合并 */
  senseSplit: true,
  /** TTS 口音偏好 */
  ttsAccent: 'en-GB',
};

/** 合并设置，缺字段补默认值。 */
export function mergeSettings(settings) {
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

/* ========================== 统计 ========================== */

/** 全库概览数字，首页与索引页共用。 */
export function overview() {
  const { stats } = VOCAB;
  return {
    volumes: stats.volumes,
    units: stats.units,
    entries: stats.entries,
    cards: stats.cards,
    multiSense: stats.multiSense,
  };
}

/** 把树形结构挂到 window 上，方便别人在控制台里排查。 */
if (typeof window !== 'undefined') {
  window.DSH_VOCAB = {
    VOCAB,
    normalizeEn, judgeEn, normalizeCn, judgeCn, cnKeywords, judgePos,
    cardsOfUnit, unitById, buildQueue, shuffle, overview,
  };
}
