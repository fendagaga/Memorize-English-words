/**
 * 无障碍与结构自动审计 —— 用 agent-browser 在真实浏览器里跑。
 *
 *   node scripts/audit-a11y.mjs
 *
 * 需要一个已启动的服务器（默认 127.0.0.1:8787）与已安装的 agent-browser。
 * 产出：控制台报告 + word/.qa/a11y.json
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const QA_DIR = resolve(__dirname, '..', '.qa');

const PORT = process.env.PORT || 8787;
const BASE = `http://127.0.0.1:${PORT}`;

const PAGES = [
  { name: '首页', path: '/' },
  { name: '单元索引', path: '/units.html' },
  { name: '背英文', path: '/study.html?unit=7a-u1&mode=en' },
  { name: '背词性', path: '/study.html?unit=7a-u1&mode=pos' },
  { name: '错题本', path: '/study.html?unit=wrong' },
  { name: '星标', path: '/study.html?unit=star' },
];

function ab(args) {
  // URL 里常带 ?a=b&c=d，直接拼进 shell 会被 PowerShell 拆成多个参数，
  // 所以统一加引号；引号本身再转义一层。
  const quoted = args.map((a) => {
    const s = String(a);
    if (/^[A-Za-z0-9_\-.\/:=]+$/.test(s)) return s;   // 安全字符不用包
    return `"${s.replace(/"/g, '\\"')}"`;
  });
  return execFileSync('agent-browser', quoted, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
  }).trim();
}

/** 小工具：在同一个 pwsh 调用里设置视口。 */
function setViewport(w, h) {
  return execFileSync('agent-browser', ['set', 'viewport', String(w), String(h)], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: true,
  }).trim();
}

function sleep(ms) {
  execFileSync('powershell', ['-NoProfile', '-Command', `Start-Sleep -Milliseconds ${ms}`], { stdio: 'ignore' });
}

function evalJs(js) {
  // 走 base64 而不是把 JS 直接塞进命令行：换行与引号经过 shell 会被吃掉，
  // agent-browser 的 `eval -b` 就是为这种情况准备的。
  const b64 = Buffer.from(js, 'utf8').toString('base64');
  const out = ab(['eval', '-b', b64]);
  try { return JSON.parse(out); } catch { return out; }
}

/** 页面内执行的审计脚本，返回结构化结果。 */
const AUDIT_JS = `(() => {
  const q = (s) => Array.from(document.querySelectorAll(s));
  const out = {};

  out.title = document.title;
  out.lang = document.documentElement.lang;
  out.charset = document.characterSet;
  out.viewportMeta = (document.querySelector('meta[name=viewport]')||{}).content || null;
  out.scrollWidth = document.documentElement.scrollWidth;
  out.clientWidth = document.documentElement.clientWidth;
  out.horizontalOverflow = document.documentElement.scrollWidth > document.documentElement.clientWidth;

  // 标题层级
  // 注意：只统计**真正可见**的标题。DOM 里同时存在多个视图（study.html 就是这样），
  // 隐藏视图里的 h1 不会被读屏软件读到，不算违规 —— 但如果祖先只是 visually-hidden
  // 之外的方式藏起来，就必须排除，否则会误判。
  const isVisible = (el) => {
    let node = el;
    while (node && node.nodeType === 1) {
      if (node.hasAttribute('hidden')) return false;
      const cs = getComputedStyle(node);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') return false;
      node = node.parentElement;
    }
    return true;
  };
  const allHeadings = q('h1,h2,h3,h4,h5,h6');
  const visibleHeadings = allHeadings.filter(isVisible);
  out.headingsAll = allHeadings.map(h => h.tagName + ':' + h.innerText.trim().slice(0,30));
  out.headings = visibleHeadings.map(h => h.tagName + ':' + h.innerText.trim().slice(0,30));
  out.headingsHidden = allHeadings.length - visibleHeadings.length;
  out.h1Count = visibleHeadings.filter(h => h.tagName === 'H1').length;
  out.h1CountAll = allHeadings.filter(h => h.tagName === 'H1').length;

  // landmark
  out.landmarks = {
    header: q('header').length,
    main: q('main').length,
    nav: q('nav').length,
    footer: q('footer').length,
  };

  // 装饰性 SVG 必须 aria-hidden 或有 aria-label
  out.svgTotal = q('svg').length;
  out.svgUnlabelled = q('svg').filter(s =>
    s.getAttribute('aria-hidden') !== 'true'
    && !s.getAttribute('aria-label')
    && !s.getAttribute('role')
    && !(s.querySelector('title'))
  ).length;

  // 图片必须有 alt
  out.imgNoAlt = q('img').filter(i => !i.hasAttribute('alt')).length;

  // 交互元素可读名称
  const nameOf = (el) =>
    (el.getAttribute('aria-label') || el.innerText || el.getAttribute('title') || el.value || '').trim();
  out.buttonsNoName = q('button').filter(b => !nameOf(b)).length;
  out.linksNoName = q('a[href]').filter(a => !nameOf(a)).length;

  // 表单控件标签
  out.inputsUnlabelled = q('input,textarea,select').filter(el => {
    if (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')) return false;
    if (el.id && document.querySelector('label[for="' + el.id + '"]')) return false;
    if (el.closest('label')) return false;
    if (el.type === 'hidden' || el.type === 'submit' || el.type === 'button') return false;
    return true;
  }).map(el => el.tagName + '#' + (el.id || '') + '[placeholder=' + (el.placeholder||'') + ']');

  // 全局 outline:none 是很常见的无障碍杀手
  out.globalOutlineNone = q('*').length > 0 && (() => {
    let found = [];
    for (const sheet of Array.from(document.styleSheets)) {
      let rules;
      try { rules = sheet.cssRules; } catch { continue; }
      if (!rules) continue;
      for (const r of Array.from(rules)) {
        if (!r.selectorText || !r.style) continue;
        const sel = r.selectorText.replace(/\\s+/g, '');
        const isGlobal = sel === '*' || sel === '*:focus' || sel === 'a:focus' || sel === 'button:focus' || sel === 'input:focus';
        const style = r.style.getPropertyValue('outline');
        const outlineStyle = r.style.getPropertyValue('outline-style');
        if (isGlobal && (style === 'none' || outlineStyle === 'none')) {
          found.push(r.selectorText + ' { outline: none }');
        }
      }
    }
    return found;
  })();

  // 触区尺寸（手机可用性）
  const small = [];
  for (const el of q('button,a[href],input,textarea,select,[role=button]')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;      // 隐藏元素跳过
    if (r.height > 0 && r.height < 40) {
      small.push((el.innerText || el.id || el.tagName).trim().slice(0, 20) + ' h=' + Math.round(r.height));
    }
  }
  out.smallTouchTargets = small.slice(0, 12);
  out.smallTouchCount = small.length;

  // aria-live 区域
  out.liveRegions = q('[aria-live]').map(e => (e.getAttribute('aria-live') || '') + ':' + (e.id || e.className || e.tagName));
  out.roleStatus = q('[role=status],[role=alert]').length;

  // prefers-reduced-motion 是否被样式表覆盖
  out.hasReducedMotionRule = (() => {
    for (const sheet of Array.from(document.styleSheets)) {
      let rules;
      try { rules = sheet.cssRules; } catch { continue; }
      for (const r of Array.from(rules || [])) {
        if (r.conditionText && /prefers-reduced-motion/.test(r.conditionText)) return true;
        if (r.cssRules) {
          for (const inner of Array.from(r.cssRules)) {
            if (inner.conditionText && /prefers-reduced-motion/.test(inner.conditionText)) return true;
          }
        }
      }
    }
    return false;
  })();

  return out;
})()`;

console.log('═'.repeat(66));
console.log('无障碍与结构审计');
console.log('═'.repeat(66));

// 先用桌面宽度验语义，再用 360px 验响应式；两个宽度各跑一轮。
const PASSES = [
  { label: '桌面 1440px', width: 1440, height: 900 },
  { label: '手机 360px', width: 360, height: 780 },
];

const results = [];
const overflowFailures = [];

for (const pass of PASSES) {
  console.log(`\n${'█'.repeat(66)}`);
  console.log(`█ ${pass.label}`);
  console.log('█'.repeat(66));
  setViewport(pass.width, pass.height);

  for (const page of PAGES) {
    console.log(`\n── ${page.name}  ${page.path} ${'─'.repeat(Math.max(0, 36 - page.path.length))}`);

    ab(['open', `${BASE}${page.path}`]);
    sleep(1200);

    const r = evalJs(AUDIT_JS);
    r.page = page;
    r.pass = pass.label;
    r.viewportWidth = pass.width;
    results.push(r);

    const flag = (label, condition, detail) => {
      console.log(`  ${condition ? '✓' : '✗'} ${label}${detail ? `  ${detail}` : ''}`);
      return condition;
    };

    // 视口宽度没生效就说明测量无意义，直接报出来
    if (r.clientWidth !== pass.width) {
      console.log(`  ! 视口未生效：clientWidth=${r.clientWidth}，期望 ${pass.width}`);
    }

    flag('标题存在', !!r.title, r.title);
    flag('lang 为 zh-CN', r.lang === 'zh-CN', r.lang);
    flag('charset 为 UTF-8', /utf-8/i.test(r.charset || ''), r.charset);
    flag('有 viewport meta', !!r.viewportMeta, r.viewportMeta || '');
    const noOverflow = !r.horizontalOverflow;
    flag(`无横向滚动 @${pass.width}px`, noOverflow, `scrollWidth=${r.scrollWidth} clientWidth=${r.clientWidth}`);
    if (!noOverflow) overflowFailures.push(`${pass.label} ${page.name}：scrollWidth=${r.scrollWidth} > clientWidth=${r.clientWidth}`);
    flag('可见范围内只有一个 h1', r.h1Count === 1,
      `可见 h1 ${r.h1Count} 个（可见标题共 ${r.headings.length}，隐藏视图内 ${r.headingsHidden} 个不计）`);
    // 标题层级不该跳级（h1 → h3）
    const levels = r.headings.map((h) => Number(h.slice(1, 2)));
    let skip = null;
    for (let i = 1; i < levels.length; i += 1) {
      if (levels[i] - levels[i - 1] > 1) { skip = `${r.headings[i - 1]} → ${r.headings[i]}`; break; }
    }
    flag('标题层级不跳级', !skip, skip || '');
    flag('有 main 地标', r.landmarks.main >= 1, JSON.stringify(r.landmarks));
    flag('装饰 SVG 已标注', r.svgUnlabelled === 0, `共 ${r.svgTotal} 个 svg，未标注 ${r.svgUnlabelled} 个`);
    flag('图片都有 alt', r.imgNoAlt === 0, `缺 alt ${r.imgNoAlt} 个`);
    flag('按钮都有可读名称', r.buttonsNoName === 0, `无名 ${r.buttonsNoName} 个`);
    flag('链接都有可读名称', r.linksNoName === 0, `无名 ${r.linksNoName} 个`);
    flag('表单控件都有标签', r.inputsUnlabelled.length === 0, r.inputsUnlabelled.join(', ') || '');
    flag('没有全局 outline:none', r.globalOutlineNone.length === 0, r.globalOutlineNone.join('; '));
    flag('有 aria-live 或 role=status', r.liveRegions.length + r.roleStatus > 0,
      `live=${r.liveRegions.length} status=${r.roleStatus}`);
    flag('有 prefers-reduced-motion 规则', r.hasReducedMotionRule);
    console.log(`  · 触区 < 40px 的元素：${r.smallTouchCount} 个${r.smallTouchTargets.length ? '（' + r.smallTouchTargets.join('; ') + '）' : ''}`);

    // 控制台
    let consoleOut = '';
    try { consoleOut = ab(['console']); } catch { /* 忽略 */ }
    const consoleLines = consoleOut.split('\n').filter((l) => l.trim() && !/^✓/.test(l.trim()));
    flag('控制台无输出（无报错）', consoleLines.length === 0, consoleLines.slice(0, 5).join(' | '));
  }
}

console.log(`\n${'═'.repeat(66)}`);
const hardFail = results.filter((r) =>
  r.horizontalOverflow || r.h1Count !== 1 || r.svgUnlabelled > 0 || r.imgNoAlt > 0
  || r.buttonsNoName > 0 || r.linksNoName > 0 || r.inputsUnlabelled.length > 0
  || r.globalOutlineNone.length > 0);

mkdirSync(QA_DIR, { recursive: true });
writeFileSync(join(QA_DIR, 'a11y.json'), JSON.stringify(results, null, 2), 'utf8');
if (overflowFailures.length) {
  console.log(`✗ 横向滚动问题：`);
  for (const f of overflowFailures) console.log(`   ${f}`);
} else {
  console.log('✓ 360px / 1440px 两档均无横向滚动');
}
console.log(`有硬问题的页面：${hardFail.length ? [...new Set(hardFail.map((r) => r.page.name))].join('、') : '无'}`);
console.log(`明细已写入 .qa/a11y.json`);
