/**
 * 词条解析器 —— 把「词语raw」里的 markdown 表格解析成结构化词库。
 *
 * 这是整个项目唯一的真相来源：构建脚本、测试、服务器都从 parseVocabText 出发。
 * 所有可调策略都集中在下面「策略常量」区，改一行就能改行为。
 *
 * 源文件格式：
 *   ## Starter Unit 1            ← 单元标题（## 开头）
 *   | 英文 | 词性 | 中文释义 |    ← 表头，跳过
 *   |---|---|---|                  ← 分隔行，跳过
 *   | hello | interj. | 你好；喂 |
 */

/* ============================ 策略常量 ============================ */

/** 词性 / 释义的分隔符：半角斜杠与全角斜杠都会出现（八上大量使用 ／）。 */
const SENSE_SEPARATORS = /[/／]/;

/** 剔除策略：词性里出现这些词条的整行丢掉（专有名词、缩写）。 */
const DROP_POS_PATTERNS = [/专有名词/, /缩写/];

/**
 * 词性列里可能是「语法说明」而不是真词性。
 * 只有**整段是括号注释**的才算说明 —— `短语` / `句型` 是真实词性标签，不能误伤。
 */
const NOTE_AS_POS = /^[（(][^）)]*[）)]$/;

/** 从词性里挑出复数提示，例如 `n. (pl. wolves)` → note: "pl. wolves"。 */
const PLURAL_NOTE = /\((?:pl\.|usually pl\.)[^)]*\)/i;

/** 合法的基线词性集合（长词优先匹配，避免 "aux v." 被 "v." 抢走）。 */
const KNOWN_POS = [
  'modal v.', 'aux v.', 'interj.', 'prep.', 'conj.', 'pron.', 'adv.',
  'adj.', 'art.', 'num.', 'det.', 'n.', 'v.', '短语', '句型',
];

/** 词性回退推断规则（源数据里 5 条词性列只有语法说明，按词条特征猜）。 */
const POS_FALLBACKS = [
  { test: /\bsb'?s\b|\bsb\b|\bsth\b|^take\b|^look\b|^pick\b|^cut\b|^made\b|^have\b|^turn\b|^one\b/i, pos: '短语' },
  { test: /ly$/i, pos: 'adv.' },
  { test: /(ing|ed)$/i, pos: 'v.' },
  { test: /(tion|sion|ment|ness|ity|ance|ence|ship|hood|ist|er|or|ism)$/i, pos: 'n.' },
];

/** 显示时给「大写专名类」词条的默认词性。 */
const DEFAULT_INFERRED_POS = 'n.';

/** 中文释义里的「虚词」——做关键词匹配时丢掉，避免「……的」这类噪声判对。 */
const CN_STOPWORDS = [
  '某人', '某事', '某物', '某处', '某个', '某些', '某种',
  '用于', '常用', '表示', '指', '即', '等等', '之意', '的人', '的事物',
  '不定式', '原形', '单数', '复数', '第三人称',
];

/** 中文释义的关键词切分符（；只切关键词，不切卡）。 */
const CN_KEYWORD_SPLIT = /[；;，,、·]+/;

/* ============================== 工具 ============================== */

/** 判断一个串能否当成「词性」用 —— true 表示是真词性，false 表示是语法说明。 */
export function looksLikePos(text) {
  const s = String(text || '').trim();
  if (!s) return false;
  return !NOTE_AS_POS.test(s);
}

/** 把 POS 串切分成词性段，同时剥掉括号注释。返回 { raw, pos, note } 数组。 */
function splitPosSegments(rawPos) {
  return String(rawPos || '')
    .split(SENSE_SEPARATORS)
    .map((seg) => {
      const raw = seg.trim();
      const plural = raw.match(PLURAL_NOTE);
      const pos = raw.replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
      return { raw, pos, note: plural ? plural[0].replace(/\s+/g, ' ') : '' };
    });
}

/** 整段是不是「纯括号注释」——`（用于……）` 是，`interj., v. & n.` 不是。 */
function isPureAnnotation(text) {
  return /^[（(][^）)]*[）)]$/.test(String(text || '').trim());
}

/** 词性段是否为「整段都是语法说明」——剥掉括号后什么都不剩。 */
function isAnnotationOnly(seg) {
  const raw = String(seg.raw || '').trim();
  if (isPureAnnotation(raw)) return true;
  // 剥掉括号注释后仍有内容 → 是真词性（如 `（说明）/ prep.` 切出来的 `prep.`）。
  return !seg.pos && !looksLikePos(raw) && isPureAnnotation(raw.replace(/[（(][^）)]*[）)]/g, '').trim());
}

/** 按 / 与 ／ 切分中文释义。 */
function splitCnSegments(rawCn) {
  return String(rawCn || '')
    .split(SENSE_SEPARATORS)
    .map((s) => s.trim());
}

/** 中文释义里还有没有真实内容（纯括号注释不算内容）。 */
function hasRealText(text) {
  return String(text || '').replace(/[（(][^）)]*[）)]/g, '').trim().length > 0;
}

/** 提取单词候选（`a / an` 记成两个都算对）。 */
export function wordCandidates(rawWord) {
  const word = String(rawWord || '').trim();
  const parts = word.split(SENSE_SEPARATORS).map((s) => s.trim()).filter(Boolean);
  return parts.length > 1 ? parts : [word];
}

/** 词性回退推断。 */
export function inferPos(word) {
  for (const rule of POS_FALLBACKS) {
    if (rule.test.test(word)) return rule.pos;
  }
  return DEFAULT_INFERRED_POS;
}

/**
 * 把「一个词条的一行」拆成若干张背记卡（义项粒度）。
 * 返回 { senses: [{pos, cn, meaningMissing}], hadNoteOnlyPos, note }
 *
 * 关键点：词性与释义按同一个 / 顺序一一对应，所以丢掉「纯语法说明」的词性段时
 * 必须用一个占位段保住位置，否则后面的义项会整体错位（`to` 就是这种情况）。
 */
export function splitSenses(rawPos, rawCn) {
  const posSegs = splitPosSegments(rawPos);
  const cnSegs = splitCnSegments(rawCn);

  const keptPos = [];
  let hadNoteOnlyPos = false;
  for (const seg of posSegs) {
    if (isAnnotationOnly(seg)) { hadNoteOnlyPos = true; continue; }
    keptPos.push(seg);
  }

  // 有一整段释义为空 → 只考词性。
  if (!cnSegs.some(hasRealText)) {
    const first = keptPos[0] || posSegs[0];
    return {
      senses: [{ pos: first ? first.pos : '', cn: '', meaningMissing: true }],
      hadNoteOnlyPos,
      note: posSegs.find((s) => s.note)?.note || '',
    };
  }

  let posList;
  if (hadNoteOnlyPos && cnSegs.length === posSegs.length) {
    // 段数对得上 → 注释段留一个空位保住对应关系。
    posList = posSegs.map((seg) => (isAnnotationOnly(seg) ? '' : seg.pos));
  } else if (hadNoteOnlyPos && cnSegs.length === keptPos.length) {
    // 释义本身也只写了有效词性那么多段 → 直接用过滤后的。
    posList = keptPos.map((seg) => seg.pos);
  } else {
    // 对不上就退回过滤后的词性表，宁可少一张卡也不要错位。
    posList = keptPos.length ? keptPos.map((seg) => seg.pos) : posSegs.map((seg) => seg.pos);
  }

  let senses;
  if (cnSegs.length === posList.length) {
    senses = cnSegs.map((cn, i) => ({ pos: posList[i], cn, meaningMissing: false }));
  } else if (cnSegs.length > posList.length) {
    // 释义更细 → 多出来的挂在最后一个词性上。
    senses = cnSegs.map((cn, i) => ({
      pos: posList[Math.min(i, posList.length - 1)] || '',
      cn,
      meaningMissing: false,
    }));
  } else if (cnSegs.length === 1) {
    // 词性有好几段、但中文整体只写了一段（**一个 / 都没有**，例如
    // `program | v. / n. | 编写程序；程序；(=programme) 节目；项目`）。
    // 这时候按词性拆卡会造出没有中文的第二张卡 —— 题干空白，
    // 且判分时没有任何关键词可用（judgeCn 对空释义永远返回 true），
    // 等于白送一张「答什么都对」的卡。所以不拆：合成一张，
    // 词性判分范围放宽到这一行所有词性，释义保留完整原文。
    senses = [{
      pos: posList.filter(Boolean).join(' / '),
      cn: cnSegs[0],
      meaningMissing: false,
      merged: true,
    }];
  } else {
    // 词性更多 → 多出来的只考词性。
    senses = posList.map((pos, i) => ({
      pos,
      cn: cnSegs[i] !== undefined ? cnSegs[i] : '',
      meaningMissing: cnSegs[i] === undefined,
    }));
  }

  return {
    senses,
    hadNoteOnlyPos,
    note: posSegs.find((s) => s.note)?.note || '',
  };
}

/* ============================ 主解析器 ============================ */

/**
 * 解析一个册次的 markdown 文本。
 * @param {string} text      文件全文
 * @param {object} meta      { volumeId, grade, term, source }
 * @returns {{ units: object[], entries: object[], dropped: object[] }}
 */
export function parseVocabText(text, meta) {
  const lines = String(text || '').split(/\r?\n/);
  const units = [];
  const entries = [];
  const dropped = [];

  let currentUnit = null;
  let unitOrder = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const lineNo = i + 1;

    // 单元标题
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      unitOrder += 1;
      currentUnit = {
        id: `${meta.volumeId}-u${unitOrder}`,
        volumeId: meta.volumeId,
        grade: meta.grade,
        term: meta.term,
        name: heading[1],
        order: unitOrder,
        sourceLine: lineNo,
      };
      units.push(currentUnit);
      continue;
    }

    // 只处理表格行
    if (!line.startsWith('|')) continue;
    if (/^\|[\s|:-]+\|?\s*$/.test(line)) continue; // |---|---|

    const cells = line.split('|').map((c) => c.trim());
    // "| a | b | c |".split('|') → ['', 'a', 'b', 'c', '']，取中间三格
    if (cells.length < 5) continue;
    const rawWord = cells[1];
    const rawPos = cells[2];
    const rawCn = cells[3];

    if (rawWord === '英文' && rawPos === '词性') continue; // 表头

    if (!rawWord) continue;

    if (!currentUnit) {
      // 文件开头就出现表格（理论上不会）——造一个兜底单元，避免丢数据。
      unitOrder += 1;
      currentUnit = {
        id: `${meta.volumeId}-u${unitOrder}`,
        volumeId: meta.volumeId,
        grade: meta.grade,
        term: meta.term,
        name: '未命名单元',
        order: unitOrder,
        sourceLine: lineNo,
      };
      units.push(currentUnit);
    }

    const entry = {
      unitId: currentUnit.id,
      word: rawWord,
      wordCandidates: wordCandidates(rawWord),
      rawPos,
      rawCn,
      sourceLine: lineNo,
    };

    // 剔除策略
    if (DROP_POS_PATTERNS.some((re) => re.test(rawPos))) {
      dropped.push({ ...entry, reason: 'proper-noun-or-abbrev' });
      continue;
    }

    const { senses, hadNoteOnlyPos, note } = splitSenses(rawPos, rawCn);
    let posInferred = false;
    const resolved = senses.map((s) => {
      let pos = s.pos;
      if (!pos || !looksLikePos(pos)) {
        pos = inferPos(rawWord);
        posInferred = true;
      }
      return { ...s, pos };
    });

    // 词性去重后的清单（一张卡可能同时属于多个词性，如 `adj. & n.`）。
    const posSegments = [...new Set(resolved.map((s) => s.pos))];
    /** 判分范围：把组合写法摊平，选这些里的任意一个都算对。 */
    const posScopes = [...new Set(
      resolved.flatMap((s) => expandScopeText(s.pos)).filter((p) => CARD_POS_OPTIONS.includes(p)),
    )];
    if (!posScopes.length) {
      const c = canonicalPos(resolved[0] ? resolved[0].pos : '');
      if (c) posScopes.push(c);
    }
    const posPrimary = posScopes[0] || '';

    // 「义项 1/2」角标：同一个单词在这一行里总共有几张卡。
    const senseTotal = resolved.length;

    resolved.forEach((sense, idx) => {
      entries.push({
        // id 用**源文件行号**锚定，不用全局计数器：
        // 这样加册/改词库后重跑构建，已有卡片的 id 不会整体漂移，
        // 已经存下来的错题本与星标才不会指到别的词上。
        id: `${currentUnit.id}#L${lineNo}#${idx + 1}`,
        unitId: currentUnit.id,
        word: rawWord,
        wordCandidates: wordCandidates(rawWord),
        pos: sense.pos,
        posPrimary,
        posScopes,
        posSegments,
        senseTotal,
        senseIndex: idx + 1,
        /** 这一张卡要考的中文释义（显示给用户、也是关键词判分的依据）。 */
        meaning: sense.cn,
        /** 关键词判分用的原文，与 meaning 一致；留作以后接入其它判分策略。 */
        cn: sense.cn,
        meaningMissing: !!sense.meaningMissing,
        posInferred,
        hadNoteOnlyPos,
        note,
        rawPos,
        rawCn,
        sourceLine: lineNo,
      });
    });
  }

  return { units, entries, dropped };
}

/* ========================== 词库装配层 ========================== */

/** 词性排序权重，用来输出稳定的 posOptions。 */
const POS_ORDER = [
  'n.', 'v.', 'modal v.', 'aux v.', 'adj.', 'adv.', 'prep.', 'pron.',
  'conj.', 'interj.', 'art.', 'num.', '短语', '句型',
];

/**
 * 「固定全套词性选项」的选项表。
 * 源数据里有 28 种组合写法（`adj., adv. & n.` 之类），不能直接当选项平铺；
 * 这里把所有组合收敛到下面这一套，同时用 scope 保住判分范围。
 */
export const CARD_POS_OPTIONS = [
  'n.', 'v.', 'modal v.', 'aux v.', 'adj.', 'adv.', 'prep.', 'pron.',
  'conj.', 'interj.', 'art.', 'num.', '短语', '句型',
];

/** 把 `adj., adv. & n.` 拆成 ['adj.','adv.','n.']。 */
function expandPosText(text) {
  return String(text || '')
    .split(/[,&、]/)
    .map((s) => s.trim())
    .filter((s) => s && looksLikePos(s));
}

/**
 * 把**判分范围**摊平成规范选项：`v. / n.` → ['v.','n.']。
 * 比 expandPosText 多认 `/` 与 `／` —— 整行合卡（词性多段、中文没写 /）时
 * resolved 里那个 pos 形如 `v. / n.`，不摊开的话 posScopes 会变成
 * ["v. / n."]，用户选 `v.` 或 `n.` 全判错，而显示的正确答案偏偏是「v. / n.」。
 */
function expandScopeText(text) {
  return String(text || '')
    .split(/[/／,&、]/)
    .map((s) => s.trim())
    .filter((s) => s && looksLikePos(s));
}

/** 组合词性 → 规范选项：`v. & n.` → `v.`（取选项表里最先出现的那个）。 */
function canonicalPos(text) {
  const parts = expandPosText(text);
  return CARD_POS_OPTIONS.find((p) => parts.includes(p)) || parts[0] || '';
}

/**
 * 把多册解析结果装配成最终词库。
 * @param {Array<{text:string, meta:object}>} sources
 */
export function buildVocab(sources, { builtAt = new Date().toISOString() } = {}) {
  const volumes = [];
  const units = [];
  const cards = [];
  const droppedEntries = [];

  for (const { text, meta } of sources) {
    const { units: u, entries, dropped } = parseVocabText(text, meta);

    volumes.push({
      id: meta.volumeId,
      grade: meta.grade,
      term: meta.term,
      label: `${meta.grade}${meta.term}`,
      source: meta.source,
      units: u.length,
      entries: entries.length,
      cards: entries.length,
    });

    for (const unit of u) units.push(unit);
    for (const entry of entries) cards.push(entry);
    for (const d of dropped) droppedEntries.push({ ...d, volumeId: meta.volumeId });
  }

  // 每册 / 每单元统计回填
  for (const unit of units) {
    const own = cards.filter((c) => c.unitId === unit.id);
    unit.cardCount = own.length;
    unit.entryCount = new Set(own.map((c) => `${c.word}|${c.sourceLine}`)).size;
    /** 该单元真实出现过的规范词性（背词性模式的选项就是它）。 */
    unit.posPresent = POS_ORDER.filter((p) => own.some((c) => c.posScopes.includes(p)));
  }

  // 把「七年级上册 · Starter Unit 1」这类可读标签挂到卡片上，
  // 让离线导出的「所属单元」列与服务端导出的写法一致。
  const labelOfUnit = new Map(units.map((u) => [u.id, `${u.grade}${u.term} · ${u.name}`]));
  for (const card of cards) {
    card.unitLabel = labelOfUnit.get(card.unitId) || card.unitId;
  }
  for (const vol of volumes) {
    const own = units.filter((u) => u.volumeId === vol.id);
    vol.units = own.length;
    vol.entries = own.reduce((n, u) => n + u.entryCount, 0);
    vol.cards = own.reduce((n, u) => n + u.cardCount, 0);
  }

  const presentPos = new Set(cards.flatMap((c) => c.posScopes));
  const posOptions = CARD_POS_OPTIONS.filter((p) => presentPos.has(p));

  return {
    version: 1,
    builtAt,
    /** 「固定全套词性选项」——背词性模式的选项表。 */
    posOptions,
    /** 源数据里真实出现过的词性写法（用于展示，如 `v. & n.`）。 */
    posTags: [...new Set(cards.map((c) => c.pos))].sort(),
    stats: {
      volumes: volumes.length,
      units: units.length,
      entries: volumes.reduce((n, v) => n + v.entries, 0),
      cards: cards.length,
      dropped: droppedEntries.length,
      multiSense: cards.filter((c) => c.senseTotal > 1).length,
      inferredPos: cards.filter((c) => c.posInferred).length,
      meaningMissing: cards.filter((c) => c.meaningMissing).length,
    },
    volumes,
    units,
    cards,
    dropped: droppedEntries.map((d) => ({
      volumeId: d.volumeId, unitId: d.unitId, word: d.word,
      rawPos: d.rawPos, reason: d.reason, sourceLine: d.sourceLine,
    })),
  };
}
