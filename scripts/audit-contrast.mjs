/**
 * 对比度审计 —— 在真实浏览器里量每个文本节点的实际前景/背景色并算 WCAG 对比度。
 *
 *   node scripts/audit-contrast.mjs
 *
 * 为什么不靠肉眼看色板：文字可能压在渐变、半透明层或父级背景上，
 * 只有 computed style + 逐层回溯背景才能算出真实比值。
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
  { name: '成绩小结', path: '/study.html?unit=7a-u1&mode=en&practice=1' },
];

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

/** 页面内：遍历所有含直接文本的元素，回溯实际背景，算 WCAG 对比度。 */
const CONTRAST_JS = `(() => {
  const parseColor = (s) => {
    const m = String(s).match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const p = m[1].split(',').map(x => parseFloat(x));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const ratio = (a, b) => {
    const l1 = lum(a), l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  });
  // 逐层向上找第一个不透明的背景；半透明的按顺序叠加
  const bgOf = (el) => {
    let stack = [];
    let node = el;
    while (node && node.nodeType === 1) {
      const c = parseColor(getComputedStyle(node).backgroundColor);
      if (c && c.a > 0) {
        stack.push(c);
        if (c.a === 1) break;
      }
      node = node.parentElement;
    }
    let base = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = stack.length - 1; i >= 0; i -= 1) base = over(stack[i], base);
    return base;
  };
  const isVisible = (el) => {
    let n = el;
    while (n && n.nodeType === 1) {
      if (n.hasAttribute('hidden')) return false;
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return false;
      n = n.parentElement;
    }
    return true;
  };

  const out = [];
  for (const el of document.querySelectorAll('*')) {
    // 取「完整可读文本」而不是只看直接子文本节点 ——
    // 否则像 <li><span>词条</span><span>45</span></li> 这种会被整段漏掉。
    const text = (el.textContent || '').replace(/\\s+/g, ' ').trim();
    if (!text) continue;
    if (!isVisible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;

    // 跳过「子元素也有文字」的容器：只审最内层承载文字的元素，
    // 否则同一段文字会被祖先重复计算、噪声淹没真问题。
    const hasTextChild = Array.from(el.children).some(
      (c) => (c.textContent || '').replace(/\\s+/g, ' ').trim().length > 0,
    );
    if (hasTextChild) continue;
    // 纯装饰的点号/分隔符不承载信息，跳过
    if (text.length <= 1 && !/[\\u4e00-\\u9fffA-Za-z0-9]/.test(text)) continue;

    const cs = getComputedStyle(el);
    const fg0 = parseColor(cs.color);
    if (!fg0) continue;
    const bg = bgOf(el);
    const fg = fg0.a < 1 ? over(fg0, bg) : fg0;

    const cr = ratio(fg, bg);
    const px = parseFloat(cs.fontSize);
    const bold = parseInt(cs.fontWeight, 10) >= 700;
    // WCAG: 大字（>=24px，或 >=18.66px 加粗）阈值 3:1，其余 4.5:1
    const large = px >= 24 || (bold && px >= 18.66);
    const need = large ? 3 : 4.5;

    out.push({
      text: text.slice(0, 28),
      cls: (typeof el.className === 'string' ? el.className : '').slice(0, 40),
      tag: el.tagName,
      px: Math.round(px * 10) / 10,
      weight: cs.fontWeight,
      color: cs.color,
      bg: 'rgb(' + Math.round(bg.r) + ', ' + Math.round(bg.g) + ', ' + Math.round(bg.b) + ')',
      ratio: Math.round(cr * 100) / 100,
      need,
      pass: cr >= need,
      large,
      // 大字用 text-stroke 描边、内部透明的「空心字」：颜色对比度算法不适用，
      // 按设计意图单独标记，不计入失败。
      hollow: parseColor(cs.color) && parseColor(cs.color).a === 0
        && (cs.webkitTextStrokeWidth !== '0px' || cs.webkitTextStrokeColor !== cs.color),
    });
  }
  return out;
})()`;

console.log('═'.repeat(70));
console.log('对比度审计（WCAG AA：正文 4.5:1，大字 3:1）');
console.log('═'.repeat(70));

ab(['set', 'viewport', '1440', '900']);
const report = [];

for (const page of PAGES) {
  ab(['open', `${BASE}${page.path}`]);
  sleep(1500);
  const rows = evalJs(CONTRAST_JS);
  if (!Array.isArray(rows)) {
    console.log(`\n── ${page.name}：审计脚本返回异常 ${String(rows).slice(0, 120)}`);
    continue;
  }
  const fails = rows.filter((r) => !r.pass && !r.hollow);
  const hollows = rows.filter((r) => r.hollow);
  report.push({ page, total: rows.length, fails, hollows });

  console.log(`\n── ${page.name}  ${page.path}`);
  console.log(`   检查 ${rows.length} 处文本，不达标 ${fails.length} 处${hollows.length ? `（另有 ${hollows.length} 处空心描边字，不计入）` : ''}`);
  const seen = new Set();
  for (const f of fails) {
    const key = f.cls + '|' + f.color + '|' + f.bg;
    if (seen.has(key)) continue;
    seen.add(key);
    console.log(`   ✗ ${f.ratio}:1 (需 ${f.need}:1)  ${f.px}px/${f.weight}  "${f.text}"`);
    console.log(`      color ${f.color} on ${f.bg}   [${f.tag}.${f.cls}]`);
  }
}

console.log(`\n${'═'.repeat(70)}`);
const totalFails = report.reduce((n, r) => n + r.fails.length, 0);
mkdirSync(QA_DIR, { recursive: true });
writeFileSync(join(QA_DIR, 'contrast.json'), JSON.stringify(report, null, 2), 'utf8');
console.log(totalFails === 0
  ? '✓ 所有文本对比度均达 WCAG AA'
  : `✗ 共 ${totalFails} 处不达标（明细见 .qa/contrast.json）`);
