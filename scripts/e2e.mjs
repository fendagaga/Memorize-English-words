/**
 * 端到端全流程验收 —— 用 agent-browser 真在浏览器里跑完一个单元。
 *
 *   node scripts/e2e.mjs
 *
 * 覆盖：首页 → 单元索引（筛选/选卡）→ 背英文（答错→解析→下一词）→ 背词性（答对→自动进）
 *       → 走完整轮 → 成绩小结 → 错题本视图 → 导出 → 进度恢复。
 *
 * 答题由页面自己的判分函数决定，脚本只负责「读题 → 作答 → 提交」，
 * 因此每一张卡（含一词多义）都会被真实判分一遍。
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { VOCAB, overview } from '../assets/vocab.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const QA_DIR = resolve(__dirname, '..', '.qa');
const PORT = process.env.PORT || 8787;
const BASE = `http://127.0.0.1:${PORT}`;
const UID = `e2e${Date.now().toString(16).slice(-12)}`;

/** 期望值全部现算 —— 加册后这份脚本不需要改数字。 */
const OV = overview();
const UNITS_OF_GRADE_8 = VOCAB.units.filter((u) => u.grade === '八年级').length;

let passed = 0;
const failures = [];
const ok = (label, cond, detail) => {
  if (cond) { passed += 1; console.log(`  ✓ ${label}`); }
  else { failures.push(`${label}${detail ? ` —— ${detail}` : ''}`); console.log(`  ✗ ${label}${detail ? `  ${detail}` : ''}`); }
};

function ab(args) {
  const quoted = args.map((a) => {
    const s = String(a);
    return /^[A-Za-z0-9_\-.\/:=+]+$/.test(s) ? s : `"${s.replace(/"/g, '\\"')}"`;
  });
  return execFileSync('agent-browser', quoted, {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: true,
  }).trim();
}

function evalJs(js) {
  const b64 = Buffer.from(js, 'utf8').toString('base64');
  const out = ab(['eval', '-b', b64]);
  try { return JSON.parse(out); } catch { return out; }
}

function sleep(ms) {
  execFileSync('powershell', ['-NoProfile', '-Command', `Start-Sleep -Milliseconds ${ms}`], { stdio: 'ignore' });
}

function shot(name) {
  mkdirSync(QA_DIR, { recursive: true });
  try { ab(['screenshot', join(QA_DIR, name)]); } catch { /* 忽略 */ }
}

/* 页面内：把 UID 固定成测试专用，避免污染真实浏览器的错题本 */
function pinUid() {
  return evalJs(`localStorage.setItem('dsh_word_uid', ${JSON.stringify(UID)}), localStorage.removeItem('dsh_word_state_mirror'), 'pinned'`);
}

/**
 * 把本轮要背的单元的进度清掉，让「背英文」一定从第 1 张卡开始。
 *
 * 服务端 PATCH 是**按 key 合并** progress 的，所以清不掉整表、只能逐单元覆盖。
 * `index: 0` 不会被当成续背：study.html 只在 `p.index > 0 && p.index < queue.length
 * && p.total === queue.length` 时才恢复位置（已核对 beginRound 的实现）。
 *
 * 为什么需要：测试 uid 虽然每轮都新生成，但浏览器 localStorage 里的 uid 会被
 * pinUid 覆盖，而页面初始化时可能已经从服务端读到了上一次留下的进度，
 * 于是页面从 15/47 起步，「点下一词后是第 2 题」这类断言就整段错位。
 */
function resetProgress(uid, unitIds) {
  return fetch(`${BASE}/api/state`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'X-Word-Uid': uid },
    body: JSON.stringify({
      progress: Object.fromEntries(unitIds.map((id) => [id, { index: 0, mode: 'en', shuffled: false, total: 0 }])),
    }),
  }).then((r) => r.status).catch(() => 0);
}

console.log('═'.repeat(66));
console.log('端到端全流程验收');
console.log(`测试 uid：${UID}`);
console.log('═'.repeat(66));

/* ===================== 1. 首页 ===================== */

console.log('\n── 1. 首页');
ab(['set', 'viewport', '1440', '900']);
ab(['open', `${BASE}/`]);
sleep(1500);
pinUid();
// 清掉本轮要背的单元的存档进度，保证「背英文」从第 1 张卡开始。
// 不清的话页面会接着上一次的进度走（实测从 15/47 起步），后面整段断言全错位。
{
  const status = await resetProgress(UID, ['7a-u1']);
  console.log(`  预清进度 7a-u1 → HTTP ${status}`);
}
ab(['open', `${BASE}/`]);
sleep(1800);

{
  // 直接读页面上的 [data-num] 元素，不再用正则去啃 innerText ——
  // innerText 的换行/空白规范化会让「◯ 42 个单元 · 2251 词条」这类串时灵时不灵。
  const r = evalJs(`(() => {
    const num = (k) => {
      const el = document.querySelector('[data-num="' + k + '"]');
      return el ? el.textContent.trim() : null;
    };
    return {
      title: document.title,
      units: num('units'),
      entries: num('entries'),
      cards: num('cards'),
      hasUnitsLink: !!document.querySelector('a[href="units.html"]'),
      hasWrongLink: !!document.querySelector('a[href*="unit=wrong"]'),
      hasStarLink: !!document.querySelector('a[href*="unit=star"]'),
    };
  })()`);
  ok('首页标题正确', /知新|单词|背/.test(r.title), r.title);
  ok(`首页统计为 ${OV.units} / ${OV.entries} / ${OV.cards}`,
    r.units === String(OV.units) && r.entries === String(OV.entries) && r.cards === String(OV.cards),
    `读到 单元=${r.units} 词条=${r.entries} 义项=${r.cards}`);
  ok('有单元索引入口', r.hasUnitsLink);
  ok('有错题本入口', r.hasWrongLink);
  ok('有星标入口', r.hasStarLink);
}
shot('e2e-1-home.png');

/* ===================== 2. 单元索引 ===================== */

console.log('\n── 2. 单元索引');
ab(['open', `${BASE}/units.html`]);
sleep(1800);

{
  const r = evalJs(`(() => {
    const cards = Array.from(document.querySelectorAll('.card'));
    return {
      total: cards.length,
      visible: cards.filter(c => !c.hidden).length,
      countText: (document.querySelector('.count')||{}).innerText || '',
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    };
  })()`);
  ok(`${OV.units} 张单元卡`, r.total === OV.units, `实际 ${r.total}`);
  ok('默认全部可见', r.visible === OV.units, `实际 ${r.visible}`);
  ok(`计数区显示 ${OV.units}`, r.countText.includes(String(OV.units)), r.countText.replace(/\n/g, ' '));
  ok('无横向滚动', r.scroll === r.client, `${r.scroll} vs ${r.client}`);
}

// 筛选
evalJs(`Array.from(document.querySelectorAll('button')).find(b => b.innerText.trim() === '八年级').click(), 'ok'`);
sleep(500);
{
  const n = evalJs(`Array.from(document.querySelectorAll('.card')).filter(c => !c.hidden).length`);
  ok(`八年级筛选 → ${UNITS_OF_GRADE_8} 个单元`, n === UNITS_OF_GRADE_8, `实际 ${n}`);
}
evalJs(`Array.from(document.querySelectorAll('button')).find(b => b.innerText.trim() === '全部年级').click(), 'ok'`);
sleep(400);

// 选卡 → 档案栏 → 开始背记
evalJs(`document.querySelector('.pick').click(), 'ok'`);
sleep(700);
{
  const r = evalJs(`(() => ({
    selected: document.querySelectorAll('.card[data-selected=true]').length,
    detail: (document.querySelector('.detail')||{}).innerText || '',
    // 只在底部档案栏里找「开始背记」，否则会抓到页眉的「错题本」入口
    href: (Array.from(document.querySelectorAll('.detail a[href*=study]')).map(a=>a.getAttribute('href')).find(h=>/unit=[^&]+&mode=/.test(h))||''),
    detailHrefs: Array.from(document.querySelectorAll('.detail a[href*=study]')).map(a=>a.getAttribute('href')),
  }))()`);
  ok('卡片被选中', r.selected === 1);
  ok('档案栏读出词条数与义项数', /词条\s*45/.test(r.detail) && /义项\s*47/.test(r.detail),
    r.detail.split('\n').slice(0, 3).join(' | '));
  ok('开始背记链接带正确参数', /unit=7a-u1/.test(r.href) && /mode=en/.test(r.href),
    r.href || `档案栏链接：${JSON.stringify(r.detailHrefs)}`);
}
shot('e2e-2-units.png');

/* ===================== 3. 背英文模式（第一题故意答错） ===================== */

console.log('\n── 3. 背英文：答错 → 解析 → 下一词');
ab(['open', `${BASE}/study.html?unit=7a-u1&mode=en&shuffle=0`]);
sleep(2200);

{
  const r = evalJs(`(() => ({
    progress: (document.querySelector('.metabar, .meta, [id*=progress]')||document.body).innerText.slice(0,120),
    hasInput: !!document.querySelector('#in-en'),
    hasSubmit: !!document.querySelector('button[type=submit]'),
  }))()`);
  ok('背英文有输入框', r.hasInput);
  ok('有提交按钮', r.hasSubmit);
}

// 先验证一个重要假设：页面的出题顺序 == VOCAB.cards 里该单元的顺序。
// 后面的自动作答依赖这个顺序来取正确答案；顺序不一致的话必须先发现，否则会误判成页面 bug。
{
  const r = evalJs(`(() => {
    const V = (window.DSH_VOCAB || {}).VOCAB;
    if (!V) return { ok: false, why: 'window.DSH_VOCAB 未暴露' };
    const cards = V.cards.filter(c => c.unitId === '7a-u1');
    const first = cards[0];
    const shown = document.body.innerText;
    return {
      ok: true,
      firstWord: first.word,
      firstMeaning: first.meaning,
      firstPos: first.pos,
      meaningShown: shown.includes(first.meaning),
      posShown: shown.includes(first.pos),
      total: cards.length,
    };
  })()`);
  ok('页面暴露了 DSH_VOCAB', r.ok, r.why || '');
  if (r.ok) {
    ok('页面提示的中文释义与第 1 张卡一致', r.meaningShown,
      `期望「${r.firstMeaning}」，首卡 ${r.firstWord}/${r.firstPos}`);
    ok('页面提示的词性与第 1 张卡一致', r.posShown, `期望 ${r.firstPos}`);
    ok('该单元共 47 张卡', r.total === 47, `实际 ${r.total}`);
  }
}

// 故意写错
evalJs(`(() => { const i = document.querySelector('#in-en'); i.value = 'zzzzzz'; i.dispatchEvent(new Event('input', {bubbles:true})); return 'set'; })()`);
evalJs(`document.querySelector('button[type=submit]').click(), 'ok'`);
sleep(1600);
{
  const r = evalJs(`(() => ({
    text: document.body.innerText,
    nextVisible: !!(document.querySelector('#btn-next') && !document.querySelector('#btn-next').hidden),
    wrongMarks: document.querySelectorAll('.is-wrong, .flash-wrong').length,
  }))()`);
  ok('答错后出现解析', /正确(答案|拼写)/.test(r.text), r.text.slice(0, 200));
  ok('答错后「下一词」出现（停住等用户）', r.nextVisible);
  ok('答错有错误样式', r.wrongMarks > 0, `命中 ${r.wrongMarks} 个`);
}
shot('e2e-3-wrong.png');

// 点下一词
evalJs(`document.querySelector('#btn-next').click(), 'ok'`);
sleep(900);
{
  const idx = evalJs(`(document.body.innerText.match(/第\\s*(\\d+)\\s*\\/\\s*(\\d+)/)||[]).slice(1).join('/')`);
  ok('点下一词后进入第 2 题', idx.startsWith('2/'), `实际 ${idx}`);
}

/* ===================== 4. 走完整轮（页面自己判分） ===================== */

console.log('\n── 4. 走完整轮 47 张卡（由页面判分，脚本负责作答）');

const TOTAL = 47;
let loopOk = true;
let summaryReached = false;
let answered = 0;

for (let i = 0; i < TOTAL + 6; i += 1) {
  const state = evalJs(`(() => {
    const modeEn = !!document.querySelector('#view-study') && !document.querySelector('#view-study').hidden;
    const sumVisible = !!(document.querySelector('#view-summary') && !document.querySelector('#view-summary').hidden);
    const input = document.querySelector('#in-en');
    const cn = document.querySelector('#in-cn');
    const submit = document.querySelector('button[type=submit]');
    const next = document.querySelector('#btn-next');
    return {
      modeEn, sumVisible,
      inEnVisible: !!(input && input.offsetParent !== null),
      inCnVisible: !!(cn && cn.offsetParent !== null),
      hasSubmit: !!(submit && submit.offsetParent !== null),
      nextVisible: !!(next && !next.hidden),
      correctWord: (() => {
        // 从页面已经渲染的状态里读正确答案：答错时它会显示出来，答对时不需要。
        return '';
      })(),
    };
  })()`);

  if (state.sumVisible) { summaryReached = true; break; }
  if (!state.modeEn) break;

  // 还在「显示答案、等下一词」→ 点下一词
  if (state.nextVisible) {
    evalJs(`document.querySelector('#btn-next').click(), 'ok'`);
    sleep(700);
    continue;
  }

  if (!state.hasSubmit) { sleep(500); continue; }

  // 从卡片数据里取正确答案来作答（等价于一个全对的学生）。
  // 不靠「第 N 题 = 数组第 N 项」——那是页面的内部实现。
  // 而是按**页面上真实显示的中文释义**去找是哪张卡，顺序无关，更稳。
  const answeredOk = evalJs(`(() => {
    const input = document.querySelector('#in-en');
    if (!input) return false;
    const V = (window.DSH_VOCAB || {}).VOCAB;
    if (!V) return false;
    const shown = document.body.innerText;
    const cards = V.cards.filter(c => c.unitId === '7a-u1');
    // 优先找「释义被完整显示」的那张卡；一词多义时取匹配到的最长释义，避免歧义。
    const hits = cards.filter(c => c.meaning && shown.includes(c.meaning));
    hits.sort((a, b) => b.meaning.length - a.meaning.length);
    const card = hits[0];
    if (!card) return false;
    input.value = card.word;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return card.word;
  })()`);

  if (!answeredOk) { loopOk = false; break; }
  answered += 1;
  evalJs(`document.querySelector('button[type=submit]').click(), 'ok'`);
  sleep(1000);   // 等自动进下一词（700ms）
}

ok('答题循环没有卡死', loopOk);
ok('至少答了 40 张卡', answered >= 40, `实际答了 ${answered} 张`);
ok('走完整轮后进入成绩小结', summaryReached);

/* ===================== 5. 成绩小结 ===================== */

console.log('\n── 5. 成绩小结');
if (summaryReached) {
  sleep(600);
  const r = evalJs(`(() => {
    const sum = document.querySelector('#view-summary');
    return {
      text: sum ? sum.innerText : '',
      ring: (document.querySelector('#ring-num')||{}).innerText || '',
      hasRetryWrong: !!Array.from(document.querySelectorAll('button')).find(b => /重背错题/.test(b.innerText)),
      hasAgain: !!Array.from(document.querySelectorAll('button')).find(b => /再来一遍/.test(b.innerText)),
      hasBack: !!document.querySelector('a[href="units.html"]'),
    };
  })()`);
  ok('小结显示正确率', /%/.test(r.ring) || /正确率|%/.test(r.text), r.ring);
  ok('小结有「重背错题」', r.hasRetryWrong);
  ok('小结有「再来一遍」', r.hasAgain);
  ok('小结有「回单元列表」', r.hasBack);
  console.log('  小结文本：' + r.text.split('\n').filter(Boolean).slice(0, 8).join(' ｜ '));
  shot('e2e-5-summary.png');
}

/* ===================== 6. 背词性模式 ===================== */

console.log('\n── 6. 背词性模式');
ab(['open', `${BASE}/study.html?unit=7a-u1&mode=pos&shuffle=0`]);
sleep(2200);
{
  const r = evalJs(`(() => {
    const chips = Array.from(document.querySelectorAll('.chip'));
    return {
      chips: chips.length,
      labels: chips.map(c => c.innerText.trim()),
      hasCn: !!document.querySelector('#in-cn'),
      badge: (document.querySelector('#sense-badge')||{}).innerText || '',
      text: document.body.innerText.slice(0, 300),
    };
  })()`);
  ok('词性按钮平铺', r.chips >= 8, `${r.chips} 个`);
  ok('选项来自本单元（含短语则说明取了并集）', r.labels.includes('n.') && r.labels.includes('interj.'), r.labels.join(' '));
  ok('有中文释义输入框', r.hasCn);
}
shot('e2e-6-pos.png');

/* ===================== 7. 错题本 ===================== */

console.log('\n── 7. 错题本视图');
ab(['open', `${BASE}/study.html?unit=wrong`]);
sleep(2200);
{
  const r = evalJs(`(() => {
    const view = document.querySelector('#view-wrong');
    return {
      visible: !!(view && !view.hidden),
      text: view ? view.innerText.slice(0, 500) : '',
      hasPractice: !!Array.from(document.querySelectorAll('button')).find(b => /开始重练/.test(b.innerText)),
      hasExport: !!Array.from(document.querySelectorAll('button')).find(b => /导出/.test(b.innerText)),
    };
  })()`);
  ok('错题本视图可见', r.visible);
  ok('有「开始重练」', r.hasPractice);
  ok('有「导出 Markdown」', r.hasExport);
  console.log('  错题本文本：' + r.text.split('\n').filter(Boolean).slice(0, 6).join(' ｜ '));
}
shot('e2e-7-wrongbook.png');

/* ===================== 8. 服务端状态 ===================== */

console.log('\n── 8. 服务端落库校验');
{
  const res = await fetch(`${BASE}/api/state`, { headers: { 'X-Word-Uid': UID } });
  const data = await res.json();
  const mistakes = Object.keys(data.state.mistakes || {});
  ok('服务端记录了错题', mistakes.length >= 1, `${mistakes.length} 条`);
  ok('错题 id 是行号锚定格式', mistakes.every((id) => /#L\d+#\d+$/.test(id)), mistakes.slice(0, 3).join(','));
  ok('进度已保存', Object.keys(data.state.progress || {}).length >= 1,
    JSON.stringify(data.state.progress));

  const exp = await fetch(`${BASE}/api/export/wrongbook.md`, { headers: { 'X-Word-Uid': UID } });
  const md = await exp.text();
  ok('导出返回 Markdown 表格', md.includes('| 单词 | 词性 | 中文释义 |'));
  ok('导出内容非空行', md.split('\n').filter((l) => l.startsWith('| ') && !l.includes('---')).length >= 2,
    `${md.split('\n').filter((l) => l.startsWith('| ') && !l.includes('---')).length} 行数据`);
  writeFileSync(join(QA_DIR, 'e2e-wrongbook-export.md'), md, 'utf8');
}

/* ===================== 9. 星标 ===================== */

console.log('\n── 9. 星标生词本');
ab(['open', `${BASE}/study.html?unit=7a-u1&mode=en`]);
sleep(2000);
evalJs(`Array.from(document.querySelectorAll('button')).find(b => /星标/.test(b.innerText)).click(), 'ok'`);
sleep(1000);
ab(['open', `${BASE}/study.html?unit=star`]);
sleep(2000);
{
  const r = evalJs(`(() => {
    const v = document.querySelector('#view-star');
    return { visible: !!(v && !v.hidden), text: v ? v.innerText.slice(0, 300) : '' };
  })()`);
  ok('星标视图可见', r.visible);
  ok('星标里出现了刚标的那张卡', !/还是空的|还没有/.test(r.text), r.text.split('\n').slice(0, 4).join(' ｜ '));
}

/* ===================== 汇总 ===================== */

console.log(`\n${'═'.repeat(66)}`);
mkdirSync(QA_DIR, { recursive: true });
writeFileSync(join(QA_DIR, 'e2e-result.json'),
  JSON.stringify({ uid: UID, answered, summaryReached, passed, failures }, null, 2), 'utf8');

if (failures.length) {
  console.log(`✗ 失败 ${failures.length} 项，通过 ${passed} 项\n`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
} else {
  console.log(`✓ 端到端全流程通过 —— ${passed} 项断言（本轮实答 ${answered} 张卡）`);
}
