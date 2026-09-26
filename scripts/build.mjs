/**
 * 构建脚本 —— 把项目内「词语raw」里的册次文件编译成词库。
 *
 *   node scripts/build.mjs            # 正常构建
 *   node scripts/build.mjs --verbose  # 额外打印每单元统计
 *
 * 产出：
 *   data/vocab.json  服务端 API 与测试用
 *   data/vocab.js    `export const VOCAB = {...}`，浏览器端离线降级用
 *
 * 加册方法：把 `九年级上册.md` 之类的文件按同样格式丢进项目根的「词语raw」，
 * 在下面 VOLUMES 里补一行配置，重跑本脚本即可。页面无需改动。
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildVocab } from './parse-vocab.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
/** 项目根目录 —— 本脚本与项目同处一个仓库，不依赖任何项目外路径。 */
const WORD_DIR = resolve(__dirname, '..');
const OUT_DIR = join(WORD_DIR, 'data');
/** 原始词表目录：项目根下的「词语raw」，只读输入，随项目一起分发。 */
const RAW_DIR = join(WORD_DIR, '词语raw');

/** 册次配置 —— 按显示顺序排列；文件不存在自动跳过并在报告里标 missing。 */
const VOLUMES = [
  { volumeId: '7a', grade: '七年级', term: '上册', file: '七年级上册.md' },
  { volumeId: '7b', grade: '七年级', term: '下册', file: '七年级下册.md' },
  { volumeId: '8a', grade: '八年级', term: '上册', file: '八年级上册.md' },
  { volumeId: '8b', grade: '八年级', term: '下册', file: '八年级下册.md' },
  { volumeId: '9a', grade: '九年级', term: '上册', file: '九年级上册.md' },
  { volumeId: '9b', grade: '九年级', term: '下册', file: '九年级下册.md' },
];

function main() {
  const verbose = process.argv.includes('--verbose');

  if (!existsSync(RAW_DIR)) {
    console.error(`[build] 找不到原始词表目录：${RAW_DIR}`);
    process.exit(1);
  }

  const sources = [];
  const missing = [];

  for (const spec of VOLUMES) {
    const path = join(RAW_DIR, spec.file);
    if (!existsSync(path)) {
      missing.push(spec.file);
      continue;
    }
    // 显式按 UTF-8 解码，避免 BOM / 系统默认编码干扰。
    const text = readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
    sources.push({
      text,
      meta: {
        volumeId: spec.volumeId,
        grade: spec.grade,
        term: spec.term,
        source: spec.file,
      },
    });
  }

  if (!sources.length) {
    console.error(`[build] ${RAW_DIR} 下没有找到任何可用的册次文件。`);
    process.exit(1);
  }

  const vocab = buildVocab(sources);

  mkdirSync(OUT_DIR, { recursive: true });

  const json = JSON.stringify(vocab);
  writeFileSync(join(OUT_DIR, 'vocab.json'), json, 'utf8');
  writeFileSync(
    join(OUT_DIR, 'vocab.js'),
    `/* 自动生成，请勿手改 —— 由 scripts/build.mjs 产出，builtAt: ${vocab.builtAt} */\n`
    + `export const VOCAB = ${json};\n`
    + 'export default VOCAB;\n',
    'utf8',
  );

  const { stats } = vocab;
  console.log('─'.repeat(62));
  console.log('[build] 词库构建完成');
  console.log(`  册次      ${stats.volumes}`);
  console.log(`  单元      ${stats.units}`);
  console.log(`  词条      ${stats.entries}`);
  console.log(`  背记卡    ${stats.cards}   （按义项拆分后）`);
  console.log(`  一词多义卡 ${stats.multiSense}`);
  console.log(`  词性推断  ${stats.inferredPos}`);
  console.log(`  缺释义卡  ${stats.meaningMissing}`);
  console.log(`  已剔除    ${stats.dropped}   （专有名词 / 缩写）`);
  console.log('─'.repeat(62));

  for (const vol of vocab.volumes) {
    console.log(`  ${vol.label.padEnd(8, ' ')} ${String(vol.units).padStart(2)} 单元 · ${String(vol.entries).padStart(4)} 词条 · ${String(vol.cards).padStart(4)} 义项`);
  }

  if (verbose) {
    console.log('─'.repeat(62));
    for (const unit of vocab.units) {
      console.log(`  ${unit.volumeId} ${unit.name.padEnd(15, ' ')} ${String(unit.entryCount).padStart(3)} 词 · ${String(unit.cardCount).padStart(3)} 义项 · ${unit.posPresent.join(' ')}`);
    }
  }

  if (missing.length) {
    console.log('─'.repeat(62));
    console.log(`[build] 未提供的册次（已跳过）：${missing.join('、')}`);
  }

  console.log(`[build] 写出：${join(OUT_DIR, 'vocab.json')}`);
  console.log(`[build] 写出：${join(OUT_DIR, 'vocab.js')}`);
}

main();
