/**
 * 解析器 + 判分规则测试。
 *
 *   node scripts/test-parser.mjs
 *
 * 不依赖任何测试框架，退出码非 0 即为失败。
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseVocabText, splitSenses, wordCandidates, inferPos, looksLikePos,
} from './parse-vocab.mjs';
import {
  normalizeEn, judgeEn, normalizeCn, judgeCn, cnKeywords, judgePos, answerPosText,
} from '../assets/vocab.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORD_DIR = resolve(__dirname, '..');
/** 与 build.mjs 同源：原始词表在项目根的「词语raw」里。 */
const RAW_DIR = join(WORD_DIR, '词语raw');

let passed = 0;
const failures = [];

function ok(label, condition, detail) {
  if (condition) {
    passed += 1;
  } else {
    failures.push(`${label}${detail ? ` —— ${detail}` : ''}`);
  }
}

function eq(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  ok(label, a === e, `实际 ${a}，期望 ${e}`);
}

function group(name) {
  console.log(`\n── ${name} ${'─'.repeat(Math.max(0, 56 - name.length))}`);
}

/* ===================== 1. 单行义项拆分 ===================== */

group('单行义项拆分 splitSenses');

{
  const r = splitSenses('v. / n.', '把……叫作；（给……）打电话；呼唤 / 打电话；大声呼叫');
  eq('call 拆成两张卡', r.senses.map((s) => `${s.pos}|${s.cn}`), [
    'v.|把……叫作；（给……）打电话；呼唤',
    'n.|打电话；大声呼叫',
  ]);
}

{
  // 八上大量使用全角 ／ 作为义项分隔符 —— 必须与半角 / 等价。
  const r = splitSenses('n. / v.', '手势；迹象；标志 ／ 签（名）；签字');
  eq('全角 ／ 也能切', r.senses.map((s) => `${s.pos}|${s.cn}`), [
    'n.|手势；迹象；标志',
    'v.|签（名）；签字',
  ]);
}

{
  // 词性列第一段是纯语法说明 → 丢掉，且不能把后面的 prep. 顶到前面去。
  const r = splitSenses('（常用于原形动词之前，表示该动词为不定式）/ prep.', '朝；至');
  eq('to 只留 prep. 且释义不错位', r.senses.map((s) => `${s.pos}|${s.cn}`), ['prep.|朝；至']);
  ok('to 标记了 hadNoteOnlyPos', r.hadNoteOnlyPos === true);
}

{
  // 整段都是语法说明 → 没有可用词性，交由词性回退处理。
  const r = splitSenses('（用于女子姓氏或姓名前，不指明婚否）', '女士');
  eq('Ms 词性段为空', r.senses.map((s) => `${s.pos}|${s.cn}`), ['|女士']);
  ok('Ms 触发推断', inferPos('Ms') === 'n.');
}

{
  const r = splitSenses('n. (pl. wolves)', '狼');
  eq('复数提示进 note', r.note, '(pl. wolves)');
  eq('wolf 词性剥掉注释', r.senses.map((s) => s.pos), ['n.']);
}

{
  const r = splitSenses('adj. / interj., v. & n.', '受欢迎的 / 欢迎');
  eq('组合词性原样保留', r.senses.map((s) => s.pos), ['adj.', 'interj., v. & n.']);
}

{
  const r = splitSenses('n. / v. / adj.', '甲 / 乙');
  eq('词性多于释义时仍不对位错乱', r.senses.length, 3);
  ok('多出的词性标记缺释义', r.senses[2].meaningMissing === true);
}

{
  const r = splitSenses('n.', '');
  ok('空释义标记 meaningMissing', r.senses[0].meaningMissing === true);
}

ok('looksLikePos 认真词性', looksLikePos('n.') && looksLikePos('短语') && looksLikePos('modal v.'));
ok('looksLikePos 不认语法说明', !looksLikePos('（用于女子姓氏或姓名前）'));

eq('a / an 存两个拼写候选', wordCandidates('a / an'), ['a', 'an']);
eq('普通词只有一个候选', wordCandidates('hello'), ['hello']);

/* ===================== 2. 真实文件解析 ===================== */

group('真实文件解析 parseVocabText');

const RAW_FILES = [
  { file: '七年级上册.md', volumeId: '7a', grade: '七年级', term: '上册' },
  { file: '七年级下册.md', volumeId: '7b', grade: '七年级', term: '下册' },
  { file: '八年级上册.md', volumeId: '8a', grade: '八年级', term: '上册' },
];

let allEntries = [];
let allUnits = [];
let totalDropped = 0;

for (const spec of RAW_FILES) {
  const path = join(RAW_DIR, spec.file);
  if (!existsSync(path)) {
    failures.push(`源文件缺失：${path}`);
    continue;
  }
  const text = readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
  const parsed = parseVocabText(text, spec);

  // 用 ## 标题数反推单元数，确保没有漏单元也没有把注释行当单元。
  const headingCount = text.split(/\r?\n/).filter((l) => /^##\s+/.test(l)).length;
  ok(`${spec.file} 单元数与标题数一致`, parsed.units.length === headingCount,
    `解析 ${parsed.units.length}，标题 ${headingCount}`);

  // 逐行核算：每一行表格要么产出至少一张背记卡，要么被显式剔除；一行多义项会多产卡。
  const tableRows = text.split(/\r?\n/)
    .filter((l) => l.startsWith('|') && !/^\|[\s|:-]+\|?\s*$/.test(l))
    .filter((l) => {
      const c = l.split('|').map((x) => x.trim());
      return !(c[1] === '英文' && c[2] === '词性');
    }).length;

  const cardsPerRow = new Map(); // sourceLine → 该行产出的卡数
  for (const card of parsed.entries) {
    cardsPerRow.set(card.sourceLine, (cardsPerRow.get(card.sourceLine) || 0) + 1);
  }
  for (const d of parsed.dropped) {
    ok(`${spec.file} 被剔除的行没有同时产出卡片`, !cardsPerRow.has(d.sourceLine), `L${d.sourceLine} ${d.word}`);
    cardsPerRow.set(d.sourceLine, 0);
  }

  ok(`${spec.file} 每一行表格都被处理到`,
    cardsPerRow.size === tableRows,
    `表格 ${tableRows} 行，处理到 ${cardsPerRow.size} 行`);

  // 守恒：保留下来的行各出 1 张，多义项额外多出 (n-1) 张。
  const keptRows = tableRows - parsed.dropped.length;
  const extraSenses = [...cardsPerRow.values()].reduce((n, x) => n + Math.max(0, x - 1), 0);
  ok(`${spec.file} 卡片总数 = 保留行数 + 额外义项`,
    keptRows + extraSenses === parsed.entries.length,
    `${keptRows} 行 + ${extraSenses} 义项 ≠ ${parsed.entries.length} 卡`);

  for (const card of parsed.entries) {
    ok(`${spec.file} 卡片 id 唯一`, true); // 唯一性在下面全局校验
    ok(`${spec.file} 卡片有词性`, !!card.pos, `${card.word} 缺词性`);
    ok(`${spec.file} 卡片有拼写候选`, card.wordCandidates.length > 0, card.word);
  }

  allEntries = allEntries.concat(parsed.entries);
  allUnits = allUnits.concat(parsed.units);
  totalDropped += parsed.dropped.length;
  console.log(`  ${spec.file}: ${parsed.units.length} 单元 · ${parsed.entries.length} 卡 · 剔除 ${parsed.dropped.length}`);
}

const idSet = new Set(allEntries.map((c) => c.id));
ok('全库卡片 id 唯一', idSet.size === allEntries.length,
  `${allEntries.length} 张卡只有 ${idSet.size} 个不同 id`);

ok('单元总数为 26', allUnits.length === 26, `实际 ${allUnits.length}`);
ok('词条数为 1298',
  new Set(allEntries.map((c) => `${c.unitId}|${c.sourceLine}`)).size === 1298,
  `实际 ${new Set(allEntries.map((c) => `${c.unitId}|${c.sourceLine}`)).size}`);
ok('剔除 62 条专有名词/缩写', totalDropped === 62, `实际 ${totalDropped}`);
ok('剔除的全部是专名或缩写',
  allEntries.every((c) => !/专有名词|缩写/.test(c.rawPos)));

// 关键真实词条
const cardOf = (word, pos) => allEntries.find((c) => c.word === word && (!pos || c.pos === pos));

eq('call 有两张卡', allEntries.filter((c) => c.word === 'call').length, 2);
eq('call 的义项角标是 1/2、2/2',
  allEntries.filter((c) => c.word === 'call').map((c) => `${c.senseIndex}/${c.senseTotal}`),
  ['1/2', '2/2']);
eq('call 的 posScopes', cardOf('call').posScopes, ['v.', 'n.']);
ok('call 的 posPrimary 是 v.', cardOf('call').posPrimary === 'v.');

const toCard = allEntries.filter((c) => c.word === 'to');
eq('to 只有一张卡', toCard.length, 1);
eq('to 的词性是 prep.', toCard[0].pos, 'prep.');
eq('to 的释义没被注释挤掉', toCard[0].meaning, '朝；至');

eq('wolf 的复数提示保留', cardOf('wolf').note, '(pl. wolves)');
eq('a / an 的拼写候选', cardOf('a / an').wordCandidates, ['a', 'an']);

const phraseCards = allEntries.filter((c) => c.pos === '短语');
ok('短语被当作词性而非语法说明', phraseCards.length === 194, `实际 ${phraseCards.length}`);
ok('短语词条没有被错误推断成 n.', phraseCards.every((c) => c.posInferred === false));
eq('look after 的词性', cardOf('look after').pos, '短语');
eq('look after 的词性判分范围', cardOf('look after').posScopes, ['短语']);

ok('只有 4 张卡需要词性回退',
  allEntries.filter((c) => c.posInferred).length === 4,
  `实际 ${allEntries.filter((c) => c.posInferred).length}`);
ok('回退的正是 Ms/Mr/Miss/Mrs',
  allEntries.filter((c) => c.posInferred).map((c) => c.word).sort().join(','),
  'Miss,Mr,Mrs,Ms');

ok('没有缺释义的卡（源数据里唯一的空释义已修复）',
  allEntries.filter((c) => c.meaningMissing).length === 0,
  `实际 ${allEntries.filter((c) => c.meaningMissing).length}`);

ok('每张卡都能取到释义便于判分', allEntries.every((c) => c.cn && c.cn.length > 0));

/* ===================== 3. 英文判分 ===================== */

group('背英文模式判分 judgeEn');

const callCard = cardOf('call');
const aAnCard = cardOf('a / an');
const wolfCard = cardOf('wolf');

ok('精确匹配', judgeEn('call', callCard));
ok('忽略大小写', judgeEn('Call', callCard) && judgeEn('CALL', callCard));
ok('忽略首尾空格', judgeEn('  call  ', callCard));
ok('忽略全角字符', judgeEn('ｃａｌｌ', callCard));
ok('拼错一个字母判错', !judgeEn('cal', callCard) && !judgeEn('calll', callCard));
ok('空输入判错', !judgeEn('', callCard) && !judgeEn('   ', callCard));
ok('中文输入判错', !judgeEn('打电话', callCard));
ok('a / an 两个写法都对', judgeEn('a', aAnCard) && judgeEn('an', aAnCard));
ok('a / an 不接受整串', !judgeEn('a / an', aAnCard));
ok('wolf 正常匹配', judgeEn('wolf', wolfCard));

// 撇号容错
const dontCard = { word: "don't", wordCandidates: ["don't"] };
ok('弯撇号容错', judgeEn('don\u2019t', dontCard), 'don’t 应判对');
ok('直撇号正常', judgeEn("don't", dontCard));

/* ===================== 4. 中文判分 ===================== */

group('背词性模式·释义判分 judgeCn');

const saveCard = cardOf('save');
eq('save 的释义', saveCard.cn, '救；储蓄；保存');
for (const good of ['救', '储蓄', '保存', '救人', '救人的', '储蓄（钱）', '我要保存']) {
  ok(`「${good}」应判对`, judgeCn(good, saveCard));
}
for (const bad of ['杀', '丢失', '结束']) {
  ok(`「${bad}」应判错`, !judgeCn(bad, saveCard));
}

// 「的」不该被无脑剔除：橙红色 与 橙红色（的）是同一个义项
const orangeCard = cardOf('orange');
ok('「橙红色」判对', judgeCn('橙红色', orangeCard));
ok('「橘黄色」判对', judgeCn('橘黄色', orangeCard));
ok('「橙子」是与本卡不同的义项', !judgeCn('橙子', orangeCard),
  '本卡释义是「橙红色（的）；橘黄色（的）」，橙子属于另一义项');

// 关键词拆分行为
const kw = cnKeywords('照顾；处理');
ok('关键词切分含「照顾」与「处理」', kw.includes('照顾') && kw.includes('处理'), JSON.stringify(kw));

const takeCareCard = cardOf('take care of');
ok('短语释义命中', judgeCn('照顾', takeCareCard));

// 空释义（保留行为）：不该因为释义判错
const blankCard = { cn: '', meaning: '' };
ok('空释义不因释义判错', judgeCn('随便', blankCard));

// 括号注释不该污染关键词
const cnCard = cardOf('a / an');
ok('a / an 关键词不含注释', cnKeywords(cnCard.cn).every((k) => !k.includes('用于')), JSON.stringify(cnKeywords(cnCard.cn)));

ok('normalizeCn 去标点', normalizeCn('救；储蓄，保存。') === '救 储蓄 保存');
ok('normalizeEn 压缩空白', normalizeEn('  Take   Care  ') === 'take care');

/* ===================== 5. 词性判分 ===================== */

group('背词性模式·词性判分 judgePos');

ok('call 选 v. 对', judgePos('v.', callCard));
ok('call 选 n. 对', judgePos('n.', callCard));
ok('call 选 adj. 错', !judgePos('adj.', callCard));

const welcomeCard = cardOf('welcome');
eq('welcome 的判分范围', welcomeCard.posScopes, ['adj.', 'interj.', 'v.', 'n.']);
ok('welcome 选 v. 对', judgePos('v.', welcomeCard));
ok('welcome 选 pron. 错', !judgePos('pron.', welcomeCard));

ok('短语卡选「短语」对', judgePos('短语', takeCareCard));
ok('短语卡选 n. 错', !judgePos('n.', takeCareCard));

ok('to 选 prep. 对', judgePos('prep.', toCard[0]));
ok('to 选 n. 错', !judgePos('n.', toCard[0]));
ok('空选择判错', !judgePos('', callCard));

eq('正确答案展示用原写法', answerPosText(cardOf('orange')), 'n.'.replace('n.', cardOf('orange').pos));

/* ===================== 汇总 ===================== */

console.log(`\n${'═'.repeat(62)}`);
if (failures.length) {
  console.log(`✗ 失败 ${failures.length} 项，通过 ${passed} 项\n`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
} else {
  console.log(`✓ 全部通过 —— ${passed} 项断言`);
}
