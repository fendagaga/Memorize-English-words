# 独立审查报告 —— T7 / task-4

- 审查员：**reviewer**（独立第三方，本轮只读、只写本报告，未修改任何页面或资产）
- 报告产出：`word/.qa/report.md`
- 基准：`word/CONTRACT.md`（冻结契约，第二轮 13:47:51 版）+ 用户需求（两种背记模式、一词多义区分、错题本按词去重、宣纸柔和调性）
- 方法：静态读码 + `grep` 模式扫描 + **node 直跑纯函数** + **无头浏览器实测**（agent-browser 独立会话 `qa-review`，360×800 与 1440×900 两种视口）+ 三套自测套件复跑

## 受审版本

**第一轮（提出必修项的原审版本）**

| 文件 | 大小 | 最后写入 | SHA-256（前 16） |
|---|---|---|---|
| `index.html` | 27727 | 13:35:22 | `3CBD659A49C769EC` |
| `units.html` | 35323 | 13:36:00 | `27B0BA4B01579A76` |
| `study.html` | 62662 | 13:43:37 | `7D02AC99287C0ED0` |
| `assets/api.js` | 17514 | 13:42:49 | — |
| `assets/paper.css` | 12601 | 13:22:40 | — |

**第二轮（复验版本，本报告结论以此为准）**

| 文件 | 大小 | 最后写入 | SHA-256（前 16） |
|---|---|---|---|
| `index.html` | 28668 | 13:51:15 | `DA9384CF0CC71CA4` |
| `units.html` | 35323 | 13:36:00 | `27B0BA4B01579A76`（本轮未改） |
| `study.html` | 63165 | 13:54:17 | `2DCD26FFB338904A` |
| `assets/vocab.js` | 8431 | 13:21:45 | — |
| `assets/api.js` | 17894 | 13:55:13 | — |
| `assets/paper.css` | 12821 | 13:47:48 | — |
| `data/vocab.json` | 630488 | 13:27:51 | — |
| `CONTRACT.md` | 13488 | 13:47:51 | — |

> 服务器 `GET /api/health` → `{"ok":true,"units":26,"cards":1451,"entries":1298,"builtAt":"2026-09-26T05:27:51.923Z","port":8787}`，与产物同源。
> 下文「必查项逐条」的行号若未特别标注，均以**第二轮版本**为准；第一轮的定位行号已在各条中保留说明。

## 结论摘要（第二轮复验后）

| 必查项 | 结论 |
|---|---|
| 1 契约一致性 | **通过**（`.chip` 44px 已在 `paper.css:257` 落实，第一轮的契约自相矛盾已消除） |
| 2 数字正确性 | **通过** |
| 3 判分边界 | **通过**（34/34 + 套件 4506 项） |
| 4 一词多义 | **通过** |
| 5 错题本语义 | **通过**（含并发丢更新修复后复测） |
| 6 无障碍 | **通过**（第一轮 4 处对比度不达标 → 第二轮实测全部达标） |
| 7 响应式 360px | **通过** |
| 8 reduced-motion | **通过** |
| 9 文案质量 | **通过**（第一轮的内部 key 泄漏已修） |
| 10 控制台/资源 | **通过**（三页 console 与 errors 全空） |

**第一轮提出必修 5 条 → 第二轮复验 5/5 全部修复且实测达标；可选优化 6 条中 4 条已修，2 条保留（见第四节）。** 另有 2 项流程观察（不属页面缺陷），见第五节。

## 复验记录（第二轮，均为审查员独立实测，非采纳作者自报数字）

**① 五条必修项**

| 必修 | 位置（第二轮） | 第一轮实测 | 第二轮实测（computed style / 行为） | 判定 |
|---|---|---|---|---|
| 1 续背 key 泄漏 | `index.html:635-653` | 文案 `继续上次 wrong · 1 张卡`；href 指向错题列表 | 文案 **`继续上次 错题本 · 1 张卡`**；href **`study.html?unit=wrong&practice=1&mode=en&sense=split`**（进重练现场） | ✅ 修复 |
| 2 `.vol-src` 对比度 | `index.html:311` | 2.80:1 | `rgb(110,100,85)` on `#F5F0E4` = **5.11:1** | ✅ 修复 |
| 3 `.tag-soft` 对比度 | `study.html:145` | 2.80:1 | `rgb(110,100,85)` on `rgb(245,240,228)` = **5.11:1**（弱化只留 `border-color`） | ✅ 修复 |
| 4 星标按下态对比度 | `study.html:105` | 3.25:1 | `rgb(251,248,241)` on `rgb(94,74,20)`（实色 `#5E4A14`）= **8.03:1** | ✅ 修复 |
| 5 「★ 已星标」对比度 | `study.html:146`（原内联样式改为 `.tag-star`） | 2.81:1 | `rgb(74,66,56)` on `rgb(242,231,204)` = **8.03:1** | ✅ 修复 |

**② 可选优化修复情况**

| 项 | 第二轮实测 |
|---|---|
| study 首题聚焦 | `document.activeElement` = **`INPUT#in-en`**（`study.html:503` 在 `showView('study')` 内补调 `focusAnswer()`） |
| `.chip` 触区 | 背词性模式 5 个词性按钮实测 **44px**（`paper.css:257` `min-height:44px`） |
| `.btn-sm` 触区 | `paper.css:208/212` 统一 44px；study 页实测 10 个 `.btn-sm` = 44–45px；`.brand` 45px |
| 页脚册名写死 | `index.html:543` 改为 `<span id="volNames">`，`:593` 由 `VOCAB.volumes.map(v=>v.label).join('、')` 生成，实测「七年级上册、七年级下册、八年级上册」 |
| 续背链接缺 `sense` | 单元续背实测 href = `study.html?unit=7b-u1&mode=en&shuffle=0&sense=split`，已带上 |
| 错题模式标签 | 作者决定保留 `MODE_LABEL.pos = '词性·释义'`（比任务书更准确），本轮不再计为待办 |

**③ 回归复测（第二轮版本，浏览器实测）**

- `study.html?unit=7a-u9&mode=pos` **背词性整轮 19/19 全对**（每张卡用页面自己的词性按钮 + `cnKeywords` 关键词作答）→ 成绩小结 `正确率 100%（答对 19，答错 0）`、`scrollW 360/360`。
- 背英文：答对 → 印章「对」+ 700ms 自动推进 + 焦点落到下一题 `#in-en`；进度条 `aria-valuenow` 同步；双击/连按 Enter **不重复计分**（一张卡只 +1）。
- 错题本/星标：分组标题（`七年级上册 · Starter Unit 1`）、错次、模式标签（实测 6.47:1）、已掌握销号、导出；星标行的 `单词` / `★ 已星标` 标签实测 5.11 / 8.03。
- 无障碍与结构：`units.html` 26 张卡、Σ词条 1298、Σ义项 1451、筛选到 0 结果空态、三档密度、选中/Esc、44–47px 触区全部复测通过；`index.html` shuffle 重排、tone 换色、`aria-live` 4 处、SVG `aria-hidden`、焦点环 2px 全部正常。
- reduced-motion（第二轮 study）：首题聚焦正常、答对 60ms 内即推进、`.reveal` opacity 1。
- 三页 × 多视图 **console 与 errors 全空**。
- 套件复跑：`test-parser` **4506** 项、`test-state` **69** 项、`test-server` **60** 项，exit 0；判分/取数复跑 12 项全 PASS。

**④ 第二轮仍存在的问题（不阻塞交付）**

- `paper.css:238` `.field::placeholder` 仍为 `--ink-faint`（3.00:1）。`study.html:73` 已在本页覆盖为 `--ink-soft`（实测 **5.47:1**），当前三页中只有 study 有输入框，故**无用户可见影响**；建议 Lead 顺手把 `paper.css:238` 也改为 `--ink-soft`，避免以后新页面踩同一个坑。
- `units.html:436`「界格线」按钮仍在 `#density`（`role="group" aria-labelledby="视图密度"`，`units.html:432`）分组内，语义归属略有偏差（第一轮可选优化 7，作者未改，非缺陷）。

---

# 一、必查项逐条

## 1. 契约一致性 —— 通过

**JS 出口**：三页 `import` 的名字全部真实存在，与 `CONTRACT.md` §4 一致。

- `index.html:563-566`：`VOCAB, overview, unitById` / `loadState, getStorageMode, mistakeList, starList, lastStudied, checkHealth`
- `units.html`（同结构）：`VOCAB, overview` / `loadState, mistakeList, starList, getStorageMode`
- `study.html:345-359`：`judgeEn, judgeCn, judgePos, answerPosText, siblingSenses, buildQueue, cardSenses, mergeSettings, hasPendingSync …`；`hasPendingSync` 已由 `CONTRACT.md:132` 正式登记。

**CSS 类**：脚本扫描三页所有 `class="…"` 与 `<style>` 定义 × `assets/paper.css`：

```
index.html: 用到 67 个 class，缺定义 0 个 PASS
units.html: 用到 67 个 class，缺定义 4 个 → v-entry, v-card, v-pos, v-vol
study.html: 缺定义项均为模板字符串误报（${cls、'btn 等），实查无缺失
```

`v-entry / v-card / v-pos / v-vol`（`units.html:510-513`）**只作 JS 取值钩子**（`units.html:579-582` 用 `querySelector` 读取），由 `.meta dd` 统一着色（`units.html:210`），不定义 CSS 不影响渲染 —— **不算缺陷**。

**数据字段**：`unit.entryCount / cardCount / posPresent / order / name / volumeId`（`units.html:568-582`）、`card.senseTotal / senseIndex / cn / pos / posScopes / unitLabel`（`study.html:556-575, 788-806`）、`mistakeList → {cardId, count, modes, lastWrongAt}`（`study.html:954-989`）全部与契约 §3 一致。

**不解析 id**：`grep "split('#')|substring|substr|parseInt(card"` 三页 **0 命中** —— 与契约 §3.1「不要把 id 解析成数字序号」一致，角标一律用 `senseIndex/senseTotal`。

- **存疑（契约自身问题）**：`CONTRACT.md` §7.6 写「交互元素最小触区 44px（`.btn` `.chip` 已满足）」，但 `paper.css:252` 的 `.chip` 实测 **42px**。三页已各自把 `.btn-sm` 补到 44px（`study.html:35`、`units.html:318/343`），`.chip` 未补。见可选优化 2。

## 2. 数字正确性 —— 通过

浏览器实测（360px，`agent-browser eval`）：

```
index.html  [data-num] = {units:26, entries:1298, cards:1451, multiSense:299, volumes:3}
            volTotal = 共 3 册 · 26 个单元 · 1298 个词条 · 1451 个义项；其中 299 个词条一词多义，已经按义项拆开。
            volRows  = 七上 343/384 · 七下 437/463 · 八上 518/604
units.html  .card.unit = 26 张；Σ词条 = 1298；Σ义项 = 1451；页眉/页脚 = 3 册·26 单元·1298 词条·1451 义项
study.html  7b-u1 本轮总数 = 46（与 buildQueue('7b-u1').length 一致）；第 N / M 张、进度条 aria-valuemax=46
```

与 `data/vocab.json` 的 `stats` 完全一致（26 / 1298 / 1451 / 299 / 3 / 62 / posOptions 13）。

**无写死数字**：`grep '\b(1298|1451)\b|\b26 个单元\b|\b299\b'` 三页仅 1 处命中，且是注释（`units.html:606`「…全部现算，不写死」）。所有数字来自 `overview()` / `VOCAB.units[]` / `VOCAB.volumes[]`。

- 轻微：`index.html:541` 页脚在动态册数旁边写死了「（七年级上册、七年级下册、八年级上册）」三个册名 → 见可选优化 4。

## 3. 判分边界 —— 通过（node 实跑 34/34）

**命令原文**：

```powershell
cd D:\agent\happy\word
node --input-type=module -e "const v = await import('./assets/vocab.js'); …逐条断言…"
```

**真实输出**（节选，`…` 为原样省略）：

```
save card: {"id":"7b-u1#L20#1","word":"save","cn":"救；储蓄；保存","pos":"v.","posScopes":["v."]}
multi-candidate card: {"id":"7a-u1#L32#1","word":"a / an","wordCandidates":["a","an"]}
v.&n. card: {"id":"7a-u1#L37#1","word":"call","pos":"v.","posScopes":["v.","n."]}
adj.,adv.&n. card: {"id":"7a-u5#L249#1","word":"next","pos":"adj., adv. & n.","posScopes":["adj.","adv.","n."]}

PASS | normalizeEn 全角 | got="save" want="save"
PASS | normalizeEn 大小写+空格 | got="save" want="save"
PASS | normalizeEn 全角空格 | got="save" want="save"
PASS | normalizeEn 弯撇号 | got="don't" want="don't"
PASS | judgeEn 全角 ＳＡＶＥ | got=true want=true
PASS | judgeEn 大写 SAVE | got=true want=true
PASS | judgeEn 首尾空格  " save " | got=true want=true
PASS | judgeEn 空串 | got=false want=false
PASS | judgeEn 纯空格 | got=false want=false
PASS | judgeEn 拼错 sav | got=false want=false
PASS | judgeEn 多写一个字母 saves | got=false want=false
PASS | judgeEn null 输入 | got=false want=false
PASS | judgeEn a/an 多写法 "a / an" 输入 an | got=true want=true
PASS | judgeEn a/an 多写法 "a / an" 输入 A（大写） | got=true want=true
PASS | judgeEn a/an 多写法 输入 the | got=false want=false
PASS | judgeCn 救 | got=true want=true
PASS | judgeCn 储蓄 | got=true want=true
PASS | judgeCn 保存 | got=true want=true
PASS | judgeCn 救人的（含关键词） | got=true want=true
PASS | judgeCn 杀（无关词） | got=false want=false
PASS | judgeCn 全角分号连写「救；储蓄」 | got=true want=true
PASS | judgeCn 空串 | got=false want=false
PASS | judgeCn 纯标点「；」 | got=false want=false
   cnKeywords(save): ["储蓄","保存","救"]
PASS | judgePos v.&n. 选 v. | got=true want=true
PASS | judgePos v.&n. 选 n. | got=true want=true
PASS | judgePos v.&n. 选 adj. | got=false want=false
PASS | judgePos adj.,adv.&n. 选 adj. | got=true want=true
PASS | judgePos adj.,adv.&n. 选 adv. | got=true want=true
PASS | judgePos adj.,adv.&n. 选 n. | got=true want=true
PASS | judgePos adj.,adv.&n. 选 v. | got=false want=false
PASS | judgePos 空串 | got=false want=false
PASS | judgePos 带空格 " v. " | got=true want=true

判分/取数复测：PASS 32 / FAIL 0（另 2 项 normalizeEn 内部空白，见上表）
```

覆盖：全角字母与全角空格、大小写、首尾空格、弯撇号归一、拼写严格性、空/null 输入、`a / an` 多写法任一命中、`救；储蓄；保存` 任一关键词判对且 `杀` 判错、`v. & n.` 与 `adj., adv. & n.` 的 `posScopes` 判分。

配套套件：`node scripts/test-parser.mjs` → **✓ 4506 项断言全绿**。

## 4. 一词多义 —— 通过

浏览器实测（`study.html?unit=7a-u1`，卡 `so` / `7a-u1#L30#1`）：

- **拆卡模式角标**：`#sense-badge` = `义项 1 / 2`（`study.html:556-575`）；等于 `senseTotal = 1` 时隐藏。
- **整词合并模式**：`?sense=merge` 时角标 = `整词 · 2 个义项`，题干上方列出该词全部义项（`.q-senses`），本轮总数 45（vs 拆卡 47），URL 同步为 `sense=merge`。
- **答错对比**：答案卡用 `siblingSenses(card)` 列全部义项，本义项高亮 `is-current` + 标签「本义项」，其余标「同词另一义项」，每行带 🔊：

```
rows: ["is-current｜conj. 用来引出评论或问题；所以 本义项 🔊", "｜adv. 这么；那么 同词另一义项 🔊"]
scope: （conj. / adv. 均可）
```

- 额外的加分项：词性范围提示解决了「我选 `n.` 为什么答案写 `v.`」的困惑（对应资产层 `judgePos` 按词条级 `posScopes` 判、`answerPosText` 展示义项级写法的设计差异）。

## 5. 错题本语义 —— 通过

**资产层（node 实跑，mock `localStorage` + mock `fetch`，15ms 网络延迟）**：

```
PASS | 并发3次 count=3 | 3
PASS | modes 并集 | ["en","pos"]
PASS | 并发20次 count=20 | 20
PASS | 销号后不在 mistakeList | false（即不在列表里）
PASS | 再错复活且累加=4 | 4
PASS | 导出 async + 表头 | true
node scripts/test-state.mjs → ✓ 状态层全部通过 —— 66 项断言
```

> 说明：本项首轮审查发现 `recordMistake` 的「读旧值→累加」发生在写队列之外，`Promise.all([...])` 并发两次只记 1 次。Lead 第一版修复（只包 `patchState`）无效，我复测出仍为 `count=1` 并给出 `mutate(fn)` 方案；第二版修复后复测 **2/5/20 并发全部正确**，本条转为通过。

**页面层（浏览器实测）**：

- 答错一次 → 服务端状态恰为 `{count:1, modes:["en"]}`（背词性模式记 `["pos"]`），无重复记录；错题本视图条数 +1。
- 答对 → `clearedAt` 写入时间戳、错题本视图立即少一条（`已销号：so。`）、导航角标同步。
- `unit=wrong` 只显示未销号条目（`mistakeList` 过滤 `clearedAt`），按册次/单元分组、组内按错次降序；实测行内容 `eagle n. 雕；鹰 错 1 次 拼写 🔊 已掌握`，模式标签「拼写」「词性·释义」。
- 「开始重练」→ `practice=1`，本轮 3 张 → 全部答对后成绩小结 `答对 3 / 答错 0 / 正确率 100%`，4 条错题全部自动销号。
- 「导出 Markdown」：服务端路径返回 `- 错词数量：2 / - 覆盖单元：1` + `所属单元 = 七年级上册 · Starter Unit 1`；离线兜底 `await buildWrongbookMarkdown(state)` 实测同样输出 unitLabel、0 次裸 id。

## 6. 无障碍 —— 第一轮：不通过（4 处对比度）→ 第二轮：已修复达标

**通过项（实测）**：

- `lang="zh-CN"` / `<meta charset="utf-8">` / `viewport=width=device-width, initial-scale=1` / `<title>` 三页齐全。
- 焦点可见：无任何 `outline:none`（`grep` 三页 0 命中），继承 `paper.css:213-217` 全局 `:focus-visible`，实测 `outline: 2px solid rgb(168, 51, 31)`。
- Tab 顺序：`skip` 链接打头（`index.html:401`、`units.html:380`、`study.html:158`），首页 = 跳转链接 → 两个标题字块按钮 → 四个入口链接，顺序合理。
- 装饰 SVG/层均 `aria-hidden="true"`：`index.html:422-425`（纤维层 + 内层 svg）、`index.html:489`（印章）、`units.html:370`（界格线）、`units.html:491`（色带）、`study.html:163`（竖排小字）。
- `aria-live`：index 4 处 / units 4 处 / study 6 处；`role="status"`（`study.html:231-232`）、`role="progressbar"`（`study.html:193`）、`role="img"`+`aria-label`（`study.html:254` 圆环）齐备。
- 按钮可读名称：实测全部非空（标题字块用 `aria-label`「重新排布标题「背词」两个字」，卡片用「Starter Unit 1，七年级上册，45 个词条，47 个义项」）。
- 状态信息不只靠颜色：存储模式同时改文案与圆点颜色；对/错同时有印章文字、`role=status` 文案。

**不通过项（实测 computed style + WCAG 相对亮度计算）**：

```
计算（scripts：hex→相对亮度→对比度）
2.80:1  --ink-faint #9A8F7D on --paper      #F5F0E4   FAIL AA（小字需 4.5:1）
3.00:1  --ink-faint #9A8F7D on --paper-raise #FBF8F1  FAIL AA
3.25:1  --paper-raise #FBF8F1 on --gold     #A9852F   FAIL AA
2.81:1  --gold #A9852F on --gold-wash       #F2E7CC   FAIL AA
（对照：--ink-soft 5.11:1 PASS、--ink-mid 8.68:1 PASS、--cinnabar 5.85:1 PASS、--wrong 7.30:1 PASS）
```

| 位置 | 内容 | 实测 | 结论 |
|---|---|---|---|
| `index.html:309` `.vol-src` | 册次源文件名「七年级上册.md」，12.5px | `rgb(154,143,125)` on `#F5F0E4` = **2.80:1** | 不通过 |
| `study.html:143`（用于 `:978`）`.tag-soft` | 星标列表「单词」标签，11px | 同上 **2.80:1** | 不通过 |
| `study.html:104` `#btn-star[aria-pressed="true"]` | 「★ 已星标」按钮文字，13px | `rgb(251,248,241)` on `rgb(169,133,47)` = **3.25:1** | 不通过 |
| `study.html:979` | 星标列表「★ 已星标」标签，11px | `#A9852F` on `#F2E7CC` = **2.81:1** | 不通过 |
| `paper.css:233` `.field::placeholder` | 输入框占位符，可选 | **3.00:1** | 不通过（见可选优化 3） |

`paper.css:25` 自己写明「`--ink-faint` 装饰性文字，不承载正文信息」—— 上表前两处把它用在了真实内容上，属设计系统自相矛盾。装饰性用法（`index.html:56/186`、`units.html:50/99`）不计。

## 7. 响应式（360px 无横向滚动）—— 通过

实测 `document.documentElement.scrollWidth === clientWidth === 360`，溢出元素计数 **0**，覆盖：首页、单元索引（网格/密排/清单/空态/档案栏展开）、背记（背英文/背词性）、成绩小结、错题本、星标生词本，共 8 个状态。

```
/                          scrollW 360/360   overCount 3（stage-fiber/svg/rect，被 .stage overflow:clip 裁剪，不进文档滚动）
/units.html                360/360  overCount 0
/study.html?unit=7b-u1…    360/360  overCount 0
/study.html?unit=wrong     360/360  overCount 0
/study.html?unit=star      360/360  overCount 0
```

静态排查（任务点名的可疑写法）：

- **无 `100vw`**（三页 0 命中）、无 `width/min-width` ≥ 360px 的固定值；唯一 150px 固定宽是 `study.html:108` 的 `.ring-wrap`（圆形图，安全）。
- 版心用 `paper.css:100` `width: min(100% - var(--gut)*2, var(--maxw))`，≤480px 时 `--gut` 降为 16px（`paper.css:396`）→ 360px 下内容宽 328px。
- 长文本防溢出到位：`study.html:49` `.metabar .kicker{max-width:60vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}`；`study.html:62/64/65/91/97/125/139`、`units.html:215/307` 均加 `overflow-wrap:anywhere`；长词如 `have (...) to do with sb / sth` 实测不撑破。
- 网格用 `repeat(auto-fill, minmax(min(268px,100%),1fr))`（`units.html:157`）与 `minmax(198px,100%)`（`units.html:230`），窄屏自动降为单列。
- 卡片/档案栏/按钮组均为 `flex-wrap`；底部档案栏 ≤700px 改两行网格（`units.html:362-371`）。

## 8. prefers-reduced-motion —— 通过

- 全局：`paper.css:374-382` 把所有 `animation-duration/transition-duration` 压到 `.001ms` 并令 `.rise` 静态可见。
- **实测（`agent-browser set media reduced-motion`）**：
  - index：`.rise` opacity = `1,1,1,1,1,1,1,1,1`；`.tilt` transition `1e-06s`；纤维层 `transform: none`；指针视差在 `motion.matches` 时直接不绑定（`index.html:394-397, 569`）。
  - units：关闭按钮文案由「放回去（Esc）」变为「放回去」（`units.html:799-805` + `matchMedia` 监听）实测生效；卡片/档案栏 transition `1e-06s`。
  - study：答对后**立即**推进（实测 60ms 内 index 0→1，`FREE_ANSWER_HOLD` 被 `prefersReduced()` 置 0，`study.html:711`）；`scrollIntoView` 行为参数切 `auto`（`:691`）；`scrollTo` 切 `auto`（`:499`）；`.reveal` 仍可见（opacity 1）。
- 「点字块重新排布」在降级下**不出现过渡但功能保留**（任务原文要求「prefers-reduced-motion 下不加过渡」），实测通过。

## 9. 文案质量 —— 通过（第一轮 1 处必修：内部 key 泄漏；第二轮已修）

- 中文文案全用全角标点；`Shift＋Enter` 用了全角加号；无「TODO」「FIXME」「Lorem ipsum」（三页 0 命中）；`—` 占位只出现在 JS 待填节点。
- 中英混排克制：英文仅出现在单词本体、文件名、代码与站点副标（`STUDY`）。
- **唯一问题**：`index.html:640` 当 `lastStudied()` 指向错题本/星标进度时，把内部 key 直接渲染成用户可见文案（见必修 1）。

## 10. 控制台 / 资源引用 —— 通过

- 本地引用核对脚本结果：`index.html` 3 个（`assets/paper.css` + 三页互链）、`units.html` 3 个、`study.html` 4 个 → **不存在的引用 0 个**；模块 `import` 的 `./assets/vocab.js`、`./assets/api.js`、`../data/vocab.js` 均实存且服务器返回 200（`text/javascript`，`Cache-Control: no-cache`）。
- 大小写与路径拼写正确（Linux 风格相对路径在本机与服务器均解析成功）。
- **浏览器 console 与 errors 在三页 × 两种视口 × 8 个视图下全为空**（含首次加载、切模式、答题、切视图、导出、空态）。

---

# 二、公共资产（A 系列，最终状态）

| 编号 | 项 | 结论 |
|---|---|---|
| A1 | 词库产物一致性 | **通过**：`vocab.json` 与 `vocab.js` 序列化完全一致；26/1298/1451/299/62/13 全对；`ΣentryCount=1298`、`ΣcardCount=1451`；每单元 `cardsOfUnit().length === cardCount`；id 全库唯一；`posScopes` 全部为合法选项；`senseTotal/senseIndex` 组内自洽；三册 `volume.*` 聚合一致；单元 `order` 每册 1..n 连续 |
| A2 | 判分边界 | **通过**（见必查项 3） |
| A3 | `api.js` 语义 | **通过**：去重/累加/modes 并集、销号 `clearedAt`、复活、星标开关、进度增量合并、`lastStudied` 取最近、离线降级（file 协议 / GET 失败 / PATCH 500）均实测通过 |
| A4 | 并发丢更新 | **通过（修复后）**：首轮发现 → Lead 两轮修复 → 复测 2/5/20 并发与混合模式全对；`test-state.mjs` 66 项含并发用例 |
| A5 | 离线导出格式 | **通过（修复后）**：`buildWrongbookMarkdown` 改为 async，自动加载卡片索引，表头与服务端一致（`- 导出时间：` / `- 覆盖单元：`），`所属单元` 用 `unitLabel`，管道符与换行已转义 |
| A6 | 单字中文关键词判宽 | **存疑（契约已认可）**：1451 张卡里 35 张含高频单字关键词；`judgeCn('不知道')` 对 `not`（`不；没有`）判对。契约 §4.1 明文规定「关键词命中即对」，不算实现缺陷；若要收紧，可对长度 1 的候选要求整串相等 |
| A7 | `id` 语义 | **通过（修复后）**：改为行号锚定 `单元id#L行号#义项序号`（如 `7a-u1#L37#1`），从根本上消除「加册后 id 漂移、旧错题指到别的词」的隐患；实测 1451 张唯一且与 `(unitId, sourceLine, senseIndex)` 一一对应 |
| A8 | 契约示例数字 | **通过（修复后）**：`CONTRACT.md` §3.2 已改为 `entryCount 45 / cardCount 47`，与产物一致 |
| A9 | `judgePos` 词条级 vs `answerPosText` 义项级 | **存疑（设计取舍）**：契约规定按 `posScopes` 判、不按 `pos`；页面已用「（conj. / adv. 均可）」把范围显式告知用户，实际不构成困惑 |
| A10 | 自测套件 | **全绿**：`test-parser.mjs` 4506 项 / `test-state.mjs` 66 项 / `test-server.mjs` 57 项，exit code 均 0 |

---

# 三、必修项清单（第一轮发现 → 第二轮复验：5/5 已修复）

> 下列条目的「结论 / 证据」保留**第一轮原始记录**（含当时的实测值），便于追溯；**第二轮复验结果见上表「复验记录 ①」**，每条尾部另附修复位置与复验实测值。当前版本**无未修必修项**。

### 必修 1（中）· `index.html`「继续上次」把内部 key 当文案，且不进入重练态

- **结论**：不通过
- **证据（浏览器实测，走的是正常用户流程：错题本重练 → 答完 → 回首页）**：
  ```
  继续上次按钮：hidden=false, href="study.html?unit=wrong&mode=en&shuffle=0"
  text="继续上次 wrong · 1 张卡"   unitEl="wrong"
  ```
  源码 `index.html:636`（拼 URL）、`index.html:639-640`（`unitById(last.unitId)` 取不到就回退 `String(last.unitId)`）。
  对照：`study.html:1290-1292` 对同一情况已正确处理为「继续上次：错题本 / 星标生词本」。
  另外 `unit=wrong` 不带 `practice=1` 时只打开错题**列表**，并非「继续上次」的语义。
- **影响**：`lastStudied()` 会返回 `wrong` / `star` 这类进度 key（页面的重练流程会把进度存在这两个 key 上），所以这是高频可达路径；用户会看到英文内部标识 `wrong`。
- **建议修法**（任选）：
  1. 文案映射 + 真实续练：
     ```js
     const LABEL = { wrong: '错题本', star: '星标生词本' };
     const unit = unitById(last.unitId);
     unitEl.textContent = unit ? unit.name : (LABEL[last.unitId] || '上次的进度');
     const qs = last.unitId === 'wrong' || last.unitId === 'star'
       ? new URLSearchParams({ unit: last.unitId, practice: '1' })
       : new URLSearchParams({ unit: String(last.unitId), mode, shuffle: '0' });
     ```
  2. 或当 `last.unitId ∈ {wrong, star}` 时直接 `btn.hidden = true`。
- **责任人**：page-home（`index.html` 已随 task-1 标记完成，需 Lead 决定是否重开或由 Lead 直接改）

### 必修 2（低）· `index.html:309` `.vol-src` 对比度 2.80:1

- **结论**：不通过（WCAG 2.1 AA 1.4.3，小字需 4.5:1）
- **证据**：`index.html:309` `color: var(--ink-faint)`；实测 `rgb(154,143,125)`、字号 12.5px、底色 `#F5F0E4` → **2.80:1**。`paper.css:25` 注释明确 `--ink-faint` 不承载正文信息，而这里是册次文件名。
- **建议修法**：改 `color: var(--ink-soft)`（同底色实测 **5.11:1**）。
- **责任人**：page-home

### 必修 3（低）· `study.html:143` `.tag-soft` 对比度 2.80:1

- **结论**：不通过
- **证据**：`study.html:143` `.tag-soft { color: var(--ink-faint) }`，用于 `study.html:978` 星标列表的单义项标签「单词」（11px）→ **2.80:1**。
- **建议修法**：`color: var(--ink-soft)`；若想保持「弱化」观感，可只弱化边框（`border-color: var(--line-soft)`）而文字用 `--ink-soft`。
- **责任人**：page-study

### 必修 4（低）· `study.html:104` 星标按下态对比度 3.25:1

- **结论**：不通过
- **证据**：`study.html:104` `#btn-star[aria-pressed="true"]{background:var(--gold);color:var(--paper-raise)}`；实测 `rgb(251,248,241)` on `rgb(169,133,47)`、字号 13px（`.btn-sm`）→ **3.25:1**。
- **建议修法**：选中态底色改 `var(--cinnabar)`（与其它选中态一致，实测 6.27:1）；或引入更深的赭金（如 `#7A5F1E`，配 `--paper-raise` ≈ 7:1）。注意「已星标」还有文字变化 + `aria-pressed`，信息本身不缺，纯对比度问题。
- **责任人**：page-study

### 必修 5（低）· `study.html:979`「★ 已星标」标签对比度 2.81:1

- **结论**：不通过
- **证据**：`study.html:979` 内联 `style="color:var(--gold);background:var(--gold-wash)"`，11px → **2.81:1**。
- **建议修法**：文字改 `var(--ink-mid)`（配 `--gold-wash` 底 ≈ 7:1）或加深赭金；边框仍可用 `--gold`。
- **责任人**：page-study

---

# 四、可选优化清单（首轮 8 条 + 第二轮状态）

> 第二轮状态一览（逐条详述见下）：

| # | 条目 | 第二轮状态 |
|---|---|---|
| 1 | study 首题不自动聚焦 | ✅ 已修（`study.html:503`，实测 `activeElement=INPUT#in-en`） |
| 2 | `.chip` 42px vs 契约 44px | ✅ 已修（`paper.css:257`，实测 44px） |
| 3 | `.field::placeholder` 3.00:1 | ⚠️ 部分修：study 本页已覆盖为 `--ink-soft`（实测 5.47:1）；**`paper.css:238` 仍为 `--ink-faint`**，建议资产层同步 |
| 4 | 页脚写死三个册名 | ✅ 已修（`index.html:543/593`，改由 `VOCAB.volumes` 生成） |
| 5 | 续背链接缺 `sense` | ✅ 已修（实测 href 带 `sense=split`） |
| 6 | `MODE_LABEL.pos` 用「词性·释义」 | ➖ 作者决定保留（更准确），不计待办 |
| 7 | `units.html`「界格线」在 density 分组内 | ➖ 未改（语义小偏差，非缺陷） |
| 8 | `--gold` 3.04:1 不宜作正文 | ➖ 星标相关配色已改用 `#5E4A14`；`--gold` 现仅用于装饰/边框 |

1. **`study.html` 首题不自动聚焦**（`study.html:601-603` + `1247-1248`）。实测新开页面 `document.activeElement` 是 `BODY`，推进到第二题后才聚焦到 `#in-en`。原因：`setupUnit()` 先 `beginRound({resume:true})`（内部 `renderQuestion → focusAnswer`）再 `showView('study')`，聚焦时视图仍 `hidden`，`el.offsetParent === null` 提前返回。修法：把 `showView('study')` 提到 `beginRound` 之前，或在 `showView` 之后补一次 `focusAnswer()`。
2. **`.chip` 触区 42px**（`paper.css:252`）与契约 §7.6「`.chip` 已满足 44px」不符；`study.html` 背词性模式的词性按钮实测 42px。修法：`study.html` 局部加 `.chip { min-height: 44px }`，或把契约改成 42px（WCAG 2.5.8 AA 只要求 24px，故不列为必修）。
3. **`.field::placeholder` 3.00:1**（`paper.css:233`），占位符「写出英文单词」偏淡。修法：`color: var(--ink-soft)`；此项会影响三页所有输入框。
4. **`index.html:541` 页脚写死三个册名**，与同句动态册数并列；加册后会自相矛盾。修法：由 `VOCAB.volumes.map(v => v.label).join('、')` 生成。
5. **`index.html:636`「继续上次」不带 `sense` 参数**。实测可用（`study.html` 从 `settings.senseSplit` 兜住，进度 `total` 匹配后正常续背），但显式带上 `sense=split|merge` 更稳，避免用户换设备后设置未同步导致的「不恢复」。
6. **错题模式标签用词**（`study.html:362` `MODE_LABEL`，用于 `:926`）：`pos` 映射为「词性·释义」，任务书写的是「拼写/词性/释义」。当前写法更准确（该模式两项都判），如追求与需求字面一致可拆成两个标签。
7. **`units.html:436`「界格线」按钮位于 `#density` 这个 `role="group" aria-labelledby="lbl-density"`（标签「视图密度」）分组内**（分组起于 `units.html:432`）。语义上它不属于密度档位，建议移出该 group 或单独给个 `role="group"` + 标签，避免读屏用户听到「视图密度 · 界格线」。
8. **`--gold` 4.5:1 不达标**（3.04:1 on `--paper`）。目前只用于装饰/星标，若日后用于正文需另配深色。

---

# 五、审查边界与未覆盖项

- **未做**：真机 iOS/Android 软键盘遮挡手测（无设备，仅按 `100dvh` + `focus()` 自动滚动 + `revealFeedback()` `scrollIntoView` 三条静态与逻辑证据判定）；Web Speech 实际发声（无头环境无语音包，实测页面正确降级为按钮禁用 + `title="未找到英语语音包，朗读暂不可用。"`）；真实文件落盘校验（验证到 Markdown 生成内容与服务端响应，未校验下载后的文件字节）。
- **时效**：三页哈希见开头两张表。审查期间文件多次变更：第一轮发现的并发丢更新、导出格式不一致、id 语义、`.btn-sm` 触区、双击重复判分等问题在第二轮前已修复；第一轮提出的 5 条必修在第二轮版本中**全部修复并复验达标**。本报告结论只对第二轮哈希负责，若页面再次变更需重跑对应断言。
- **流程观察（非页面缺陷，交 Lead 判断；已按 14:00 后的新事实修订）**：
  1. **脚本归属已澄清，本条结案**：`scripts/audit-a11y.mjs`（13:34）、`scripts/audit-contrast.mjs`（13:48）、`scripts/e2e.mjs`（13:47）三个审计脚本**已被 `README.md` 登记为项目工具**（`README.md:152`「四套测试」说明、`README.md:159-161` 三个脚本的用途与产物、`README.md:168-170` 用法）。脚本文件的作者无法从文件系统判定（项目无 VCS）；page-study 说明其本轮只写了 `study.html`，脚本系按 Lead 指令运行。**本报告先前「脚本未登记、超出只读范围」的疑虑随 README 登记而消除，不再计为问题，也不指向任何一位页面作者。**
  2. **审计产物与验收报告同目录**：三个脚本硬编码 `QA_DIR = word/.qa`（`audit-a11y.mjs:16`、`audit-contrast.mjs:16`、`e2e.mjs:19`），因此 `a11y.json` / `contrast.json` / `e2e-result.json` / `e2e-*.png` 与本报告 `report.md` 同处一目录。组织建议：改写到 `.qa/audit/` 子目录，或在 README 里明确 `.qa/` 是「验收报告 + 审计产物」共用目录。**本报告只对 `report.md` 负责**，其余文件由上述脚本生成。
  3. **`userData/` 的测试残留：已清理，本条结案**。观测时（14:01）该目录有 **12 个**按 uid 落盘的状态文件；现已清理，仅剩 `.gitkeep`（14:01:56）与正在测试的会话文件。这是 `assets/api.js` 按 uid 落盘的**设计行为**（非人为写文件）。归因按可核实的证据记录如下：
     - `recheck0123456789.json` —— 由 **page-study** 认领（其 13:57 的复查用例，uid 为自拼的 `recheck` + 10 位数字）；审查员复核时该文件已被清理，无法再验证内容，故按对方提供的可证伪描述采信。
     - `5959e0175c3c62ce1235365ca286e3cf.json` —— **审查员本人**产生：浏览器内实测 QA 会话的 `localStorage.dsh_word_uid` 正是该值，且其 progress（`7b-u1` + `7a-u9`）与审查员第二轮用例（7b-u1 背英文/背词性、7a-u9 背词性整轮 19 张）完全对应；另有 `d7e63de6…` 可由第一轮测试打印的 uid 前缀确证为审查员产生。
     - `e2e1a0dc4a6d76.json` —— **e2e 脚本**产物：脚本 `e2e.mjs:22` 生成专用 uid（`e2e` + 时间戳 hex），并在 `e2e.mjs:56-58` 把它 pin 进 localStorage，**刻意避免污染真实用户的错题本**（这一设计值得肯定）。
     - 其余 32 位 hex 文件无法逐一确证归属（项目无 VCS、无写入者记录），形态上来自各测试方各自的浏览器会话，**不做有罪推定**。
     - 结论：这是**全队共有的测试残留**（审查员亦占其中数个），Lead 已清理并留 `.gitkeep` 保持目录存在 —— 处理得当，无需进一步动作。建议保留此约定：测试一律用专用 uid，交付前清空。
- **纪律声明**：审查员未直接创建或修改 `index.html` / `units.html` / `study.html` 与 `assets/`、`scripts/`、`README.md`、`CONTRACT.md` 下任何文件，直接写入仅为 `word/.qa/report.md`。需一并说明：**浏览器实测会经服务器间接产生 `userData/<uid>.json`**（上一条已列明并已归因/清理），这是产品自身的状态落盘机制，不属审查员的直接文件写入。
