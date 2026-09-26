# 开发契约（冻结版）

给三位页面作者看的对接说明。**字段名、类名、出口函数都已冻结，不要自行改名。**
需要新增/修改 `assets/` 或 `scripts/` 里的东西，发消息给 Lead，由 Lead 单点修改。

---

## 0. 项目一句话

初中英语单词记背系统。三个页面 + Node 零依赖服务器，全部在 `D:\agent\happy\word\`。
词库来自只读目录 `D:\agent\happy\词语raw\`，由 `node scripts/build.mjs` 编译。

## 1. 起服务与自测

```powershell
cd D:\agent\happy\word
node scripts/build.mjs        # 重新编译词库（改了解析规则才需要）
node scripts/test-parser.mjs  # 解析器 + 判分规则测试，必须全绿
node scripts/serve.mjs        # 起在 http://127.0.0.1:8787
```

服务器**已经在后台跑着**（端口 8787）。你写完文件直接刷新浏览器即可，
静态文件带 `Cache-Control: no-cache`，不会拿到旧版本。

页面地址：`/`（首页）· `/units.html`（单元索引）· `/study.html`（背记）

## 2. 关键数字（对不上就是出错了，找 Lead）

| 项 | 值 |
|---|---|
| 册次 | 3（七年级上册 / 七年级下册 / 八年级上册） |
| 单元 | **26** |
| 词条 | **1298**（已剔除 62 条专有名词与缩写） |
| 背记卡（义项粒度） | **1451** |
| 一词多义卡 | 299 |
| 词性选项表 | `n.` `v.` `modal v.` `aux v.` `adj.` `adv.` `prep.` `pron.` `conj.` `interj.` `art.` `num.` `短语` `句型`（`num.` 实际没出现，所以 `posOptions` 是 13 个） |

## 3. 数据接口

### 3.1 卡片（`VOCAB.cards[]`）

```jsonc
{
  "id": "7a-u1#L37#2",           // 单元id # 源文件行号 # 义项序号 —— 错题本/星标的 key
  "unitId": "7a-u1",
  "unitLabel": "七年级上册 · Starter Unit 1",   // 可读单元名，导出/分组显示用
  "word": "call",                 // 原始拼写，展示用
  "wordCandidates": ["call"],     // 拼写判分用；`a / an` 是 ["a","an"]
  "pos": "v.",                    // 该义项的源词性写法，展示用（可能是 `v. & n.`）
  "posPrimary": "v.",             // 收敛后的规范选项，用于分组/统计
  "posScopes": ["v.", "n."],      // **词性判分范围**：选其中任意一个都算对
  "posSegments": ["v.", "n."],    // 该词条涉及的全部词性（去重）
  "senseTotal": 2,                // 这个词条一共几张义项卡
  "senseIndex": 1,                // 这是第几张（1-based）→ 打「义项 1/2」角标
  "meaning": "把……叫作；（给……）打电话；呼唤",
  "cn": "把……叫作；（给……）打电话；呼唤",  // 判分依据，与 meaning 相同
  "meaningMissing": false,
  "posInferred": false,           // 只有 Ms/Mr/Miss/Mrs 4 张是 true
  "note": "",                     // 复数提示，如 "(pl. wolves)"
  "rawPos": "v. / n.",            // 源文件原始单元格，供页脚/证据展示
  "rawCn": "...",
  "sourceLine": 37
}
```

> **id 为什么用行号**：`#L37#2` 里的 37 是源文件行号。这样加册或改词库后重跑构建，
> 已有卡片的 id 不会整体漂移，已经存下来的错题本与星标才不会指到别的词上。
> **不要把 id 解析成数字序号用**，它只是个稳定标识；要显示序号用 `senseIndex` / `senseTotal`。

### 3.2 单元（`VOCAB.units[]`）

```jsonc
{
  "id": "7a-u1", "volumeId": "7a",
  "grade": "七年级", "term": "上册",
  "name": "Starter Unit 1",   // 展示名，可能是 "Starter Unit 1" 或 "Unit 3"
  "order": 1,                 // 在本册内的序号（编大字用）
  "entryCount": 45,           // 词条数
  "cardCount": 47,            // 义项数
  "posPresent": ["n.","v.","modal v.","aux v.","adj.","adv.","prep.","pron.","conj.","interj.","art."]
}
```

> 各单元的 `entryCount` / `cardCount` **不要写死**，一律从 `VOCAB.units` 读。
> 单位数换算：26 个单元 = 343 + 437 + 518 词条，合计 1298 词条 / 1451 义项。

`posPresent` 已经按固定顺序排好，**背词性模式的词性按钮直接用它**，不要用全局 `posOptions`。

### 3.3 册次（`VOCAB.volumes[]`）

```jsonc
{ "id": "7a", "grade": "七年级", "term": "上册", "label": "七年级上册",
  "source": "七年级上册.md", "units": 10, "entries": 343, "cards": 384 }
```

### 3.4 其它

- `VOCAB.stats` → `{ volumes, units, entries, cards, dropped, multiSense, inferredPos, meaningMissing }`
- `VOCAB.posOptions` → 固定词性选项表（已过滤没出现过的）
- `VOCAB.dropped` → 被剔除的 62 条，`{ word, rawPos, reason, volumeId, sourceLine }`

## 4. 资产出口（直接 `import`，不要复制粘贴实现）

### 4.1 `assets/vocab.js`

```js
import {
  VOCAB,                       // 词库（从 data/vocab.js 内联进来，不需要 fetch）
  // 判分（纯函数）
  normalizeEn, judgeEn,        // 背英文
  normalizeCn, judgeCn, cnKeywords,  // 背词性·释义
  judgePos, answerPosText,     // 背词性·词性
  // 取数
  cardsOfUnit, unitById, volumeById, siblingSenses,
  shuffle, buildQueue, cardSenses,
  mergeSettings, DEFAULT_SETTINGS, overview,
} from './assets/vocab.js';
```

- `judgeEn(input, card)` —— 忽略大小写/首尾空格/全角，`wordCandidates` 任一命中即对。
- `judgeCn(input, card)` —— 关键词命中即对。`救；储蓄；保存` 对「救」「储蓄」「保存」「救人的」都对。
- `judgePos(selected, card)` —— 按 `posScopes` 判，不按 `pos`。
- `buildQueue({ unitId, shuffled, senseSplit, ids })` —— 生成本轮卡序列。
  `senseSplit:false` 时返回的卡带 `senses[]`（整词合并模式），用 `cardSenses(card)` 取。
- `siblingSenses(card)` —— 同词条的其他义项，答错时对比展示用。
- `overview()` —— `{ volumes, units, entries, cards, multiSense }`，首页数字用。

### 4.2 `assets/api.js`

```js
import {
  loadState, patchState, refreshState, getStorageMode, getLastError, hasPendingSync,
  mistakeList, recordMistake, clearMistake, clearAllMistakes,
  starList, isStarred, toggleStar,
  saveProgress, getProgress, lastStudied, saveSettings,
  cardIndex, exportWrongbookUrl, buildWrongbookMarkdown, downloadText, checkHealth,
} from './assets/api.js';
```

- 全部返回 Promise（`await` 用），已内置**离线降级**：拿不到服务器就自动用 localStorage，不抛异常。
  `getStorageMode()` 返回 `'server'` 或 `'local'`，界面右上角请提示当前模式。
- **离线期间的改动会在服务器恢复后自动补同步**（`hasPendingSync()` 为 `true` 表示还有没推上去的）。
  不需要页面做任何事；如果界面上有「已同步 / 待同步」状态位，可以用 `hasPendingSync()` 显示。
- `recordMistake(cardId, mode)` —— `mode` 取 `'en'` / `'pos'`（背词性模式答错统一记 `'pos'`）。
  错次累加 + 模式并集，**按卡片 id 去重**（也就是按单词义项去重）。
  内部是「读-改-写」原子操作，连按回车两次会正确累加到 2。
- `clearMistake(cardId)` —— 销号（「已掌握」）。
- `mistakeList(state)` —— 未销号的错题，按错次降序，元素 `{ cardId, count, modes, lastWrongAt }`。
- `starList(state)` / `isStarred(state, cardId)` / `toggleStar(cardId, unitId)`。
- `saveProgress(unitId, { index, mode, shuffled, total })` / `getProgress(state, unitId)` / `lastStudied(state)`。
- `saveSettings({ senseSplit, ttsAccent })`。
- 导出：优先让浏览器去 `/api/export/wrongbook.md`（服务端生成，最全）；
  服务端不可用时用下面这行兜底 —— **注意 `await`**，它现在是异步的：

  ```js
  const md = await buildWrongbookMarkdown(state);        // 不传 lookup 会自动加载卡片索引
  downloadText('wrongbook.md', md);
  ```

  也可以传自定义查表：`await buildWrongbookMarkdown(state, (id) => index.get(id))`。
  `cardIndex()` 返回 `Map<cardId, card>`，需要自己查卡片时用它。

## 5. 状态结构（服务端 `userData/<uid>.json`）

```jsonc
{
  "version": 1,
  "mistakes": { "<cardId>": { "count": 2, "modes": ["en","pos"], "lastWrongAt": "ISO", "clearedAt": null } },
  "stars":    { "<cardId>": { "at": "ISO", "unitId": "7a-u1", "removedAt": null } },
  "progress": { "<unitId>": { "index": 12, "mode": "en", "shuffled": false, "total": 48, "updatedAt": "ISO" } },
  "settings": { "senseSplit": true, "ttsAccent": "en-GB" },
  "updatedAt": "ISO"
}
```

## 6. 样式系统（`assets/paper.css`）

**宣纸基调 + 07 号页的柔和留白。不要引入粗野主义的粗描边与硬阴影。**
页面统一 `<link rel="stylesheet" href="assets/paper.css">`。

### 可用类

| 类 | 用途 |
|---|---|
| `.wrap` | 版心，已经处理好左右留白与最大宽度 |
| `.label` | 拉字距的小标签（眉批感） |
| `.kicker` | 细框小标签（首页与页眉用） |
| `.rule` `.rule-soft` `.rule-double` | 1px 分割线 / 更淡的线 / 双细线 |
| `.btn` `.btn-primary` `.btn-ghost` `.btn-sm` | 按钮；选中态用 `aria-pressed="true"` |
| `.field` `.field-en` | 输入框；`.field-en` 居中等宽大字，背英文用 |
| `.chip` | 平铺选项按钮；选中态 `aria-pressed="true"`（词性按钮用它） |
| `.card` | 卡片（纸边压痕已经做好） |
| `.is-right` `.is-wrong` | 对/错配色（只改颜色与边框） |
| `.flash-right` `.flash-wrong` | 对/错的闪动动画 |
| `.seal` | 印章式方框（正确 / 错误标记） |
| `.rise` + `style="--delay:.1s"` | 错落入场动画；`prefers-reduced-motion` 下自动变静态 |
| `.vert` | 竖排小字（首页用） |
| `.en` `.mono` | 等宽英文字体 |
| `.visually-hidden` `.skip` | 无障碍 |
| `.tnum` | 等宽数字 |

### CSS 变量

底色 `--paper` `--paper-deep` `--paper-raise` `--paper-sink`；
墨色 `--ink` `--ink-mid` `--ink-soft` `--ink-faint`；
强调 `--cinnabar` `--cinnabar-lit` `--cinnabar-wash` `--indigo` `--indigo-wash` `--gold` `--gold-wash`；
错色 `--wrong` `--wrong-wash`；
细线 `--line` `--line-soft` `--line-strong`；
字体 `--serif-cn` `--sans-cn` `--mono-en`；
尺度 `--gut` `--maxw` `--radius` `--shadow-soft` `--shadow-card` `--ease` `--dur`。

字体：**主标题用 `--serif-cn`（宋体），正文用 `--sans-cn`，英文单词用 `--mono-en`。**
Google Fonts 在各自 `<head>` 里引，写法：

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;600;700&amp;family=Noto+Sans+SC:wght@300;400;500;700&amp;family=IBM+Plex+Mono:wght@400;500;600&amp;display=swap" rel="stylesheet">
```

## 7. 硬性要求（三个页面都要满足，验收会逐条查）

1. `<html lang="zh-CN">`、`<meta charset="utf-8">`、`<meta name="viewport" content="width=device-width, initial-scale=1">`、`<title>`。
2. **零控制台报错**。不要引用不存在的文件。
3. **360px 宽无横向滚动**（`document.documentElement.scrollWidth <= 360`），文字不被裁切。
4. 键盘 Tab 一圈焦点可见（继承 `:focus-visible`，不要写 `outline:none`），顺序合理。
5. `prefers-reduced-motion: reduce` 下动效退化（`.rise` 已经自动处理）。
6. 交互元素最小触区 44px（`.btn`、`.chip`、`.btn-sm` 在 paper.css 里已统一保证）。
7. 装饰性 SVG / 图标加 `aria-hidden="true"`；有含义的用 `role="img"` + `aria-label`。
8. 动态数字区加 `aria-live="polite"`。
9. 正文与说明文字对比度 ≥ 4.5:1（`--ink-faint` **不要**用于承载信息的文字，它只有 2.8:1，只配做装饰）。
10. 中文文案用全角标点「，。：；？！」，不写「TODO」「Lorem ipsum」。
11. 页面自己只写**一个 HTML 文件**里的 CSS/JS，不要新建额外文件。

## 8. 分词边界（`assets/vocab.js` 已实现，页面别自己写一套）

- 英文：全角转半角、撇号统一、压缩空白、去首尾空格、小写；其余**严格**（拼错一个字母算错）。
- 中文：切出义项关键词（切 `；，、/／`，丢掉「某人/某事/用于/表示」等虚词，剥掉括号注释），
  用户输入**包含任一关键词**即算对。
- 词性：按 `posScopes` 判。`v. & n.` 选 `v.` 或 `n.` 都对；
  `adj., adv. & n.` 选 `adj.` / `adv.` / `n.` 任意一个都对。

## 9. 页面分工

| 文件 | 内容 | 负责 |
|---|---|---|
| `index.html` | 首页：仿 `pages/02-neon-poster.html` 的标题手法 | teammate-1 |
| `units.html` | 单元索引：仿 `pages/14-grid-brut.html` 的交互逻辑 | teammate-2 |
| `study.html` | 背记 + 错题本 + 星标生词本 + 成绩小结 | teammate-3 |

参考文件在 `D:\agent\happy\pages\`，截图在 `D:\agent\happy\shots\`（**只读，不要改**）：
- `pages/02-neon-poster.html` + `shots/02-neon-poster.png` —— 标题手法：错落叠加的巨型字块、
  描边空心字、细框 kicker、竖排小字、贴纸块、条形码，入场按 `--delay` 错落。
- `pages/14-grid-brut.html` + `shots/14-grid-brut.png` —— 交互逻辑：分组筛选按钮（`aria-pressed` 互斥）
  → 卡片网格按 `data-*` 属性过滤 → 三种视图密度 → 点卡片「调进」底部档案栏 → Esc 放回。
- `shots/07-fine-cuisine.png` —— **视觉调性的来源**：暖米底、大留白、细线、宋体标题、
  克制的朱砂一点红。质感往它靠。
