# 初中英语单词记背系统

宣纸底色的背单词工具。按「年级 → 册次 → 单元」选单元，用两种模式背记，错词自动进错题本。

```
首页 index.html  ──►  单元索引 units.html  ──►  背记 study.html
（仿 pages/02）       （仿 pages/14）            （仿 pages/07 的调性）
```

---

## 快速开始

```powershell
cd D:\agent\happy\word

node scripts/build.mjs        # 1. 编译词库（把项目内「词语raw」解析成 data/vocab.json）
node scripts/serve.mjs        # 2. 起服务器
```

然后打开 **http://127.0.0.1:8787/**

换端口：`node scripts/serve.mjs --port 9000`

---

## 页面

| 地址 | 做什么 |
|---|---|
| `/` | 首页。统计数字、四个入口（单元索引 / 继续上次 / 错题本 / 星标生词本） |
| `/units.html` | 单元索引。按年级与册次筛选，三种视图密度，选中卡片后底部档案栏给出「开始背记」 |
| `/study.html?unit=7a-u1&mode=en` | 背英文：出示词性与中文，输入拼写 |
| `/study.html?unit=7a-u1&mode=pos` | 背词性：出示单词，选词性 + 输入中文释义 |
| `/study.html?unit=wrong` | 错题本。重练错题、导出 Markdown、逐条销号 |
| `/study.html?unit=star` | 星标生词本 |

URL 参数：`unit`（单元 id，或 `wrong` / `star`）、`mode`（`en` / `pos`）、
`shuffle`（`0` / `1` 乱序）、`sense`（`split` 按义项拆卡 / `merge` 整词合并）。

---

## 两种背记模式

**背英文**：页面给出「词性 + 中文意思」，你输入英文拼写。
判分忽略大小写、首尾空格与全角字符，其余严格。
`a / an` 这类词条两个写法都算对。

**背释义**：页面给出英文单词，你从平铺的词性按钮里选一个，再输入中文意思。
两项都对才算对。词性按**判分范围**判 —— `v. & n.` 选 `v.` 或 `n.` 都对；
`adj., adv. & n.` 选任意一个都对。中文按**关键词命中**判 ——
`救；储蓄；保存` 答「救」「储蓄」「保存」「救人的」都算对。

答对自动进下一词；答错**停下来**给你看正确答案，点「下一词」才继续。
一个单元背完自动进成绩小结。

### 一词多义怎么处理

源数据里 `call | v. / n. | 把……叫作；（给……）打电话；呼唤 / 打电话；大声呼叫`
会被拆成**两张义项卡**，背的时候标「义项 1/2」；答错时把同词的其他义项一并列出来对照。

想整词一起背，在 `study.html` 的设置里切「整词合并」，或加 URL 参数 `sense=merge`。

---

## 错题本

- 存储：服务端 `userData/<uid>.json`（按浏览器分配一个 uid，换设备不串数据）
- 去重：**按卡片 id 去重**，也就是按单词义项去重。同一个词错多次只累加 `count`，
  错误模式（`拼写` / `词性` / `释义`）取并集
- 销号：重练时答对自动销号，也可以手动点「已掌握」
- 导出：Markdown 表格，四列「单词 / 词性 / 中文释义 / 错误次数 / 错误模式 / 所属单元」

服务器连不上时会自动降级成浏览器本地存储，功能照常，页面会标「本地模式」。

---

## 词库

原始词表是**项目内的只读输入**，放在 **`词语raw/`**（项目根下，随项目一起分发，
构建不再引用任何项目外路径）：

```
七年级上册.md   10 单元
七年级下册.md    8 单元
八年级上册.md    8 单元
```

格式（markdown 表格，`##` 起单元）：

```markdown
## Unit 1
| 英文 | 词性 | 中文释义 |
|---|---|---|
| ancient | adj. | 古代的；古老的 |
| call | v. / n. | 把……叫作；（给……）打电话；呼唤 / 打电话；大声呼叫 |
```

### 加一册（例如九年级上册）

1. 把 `九年级上册.md` 按同样格式放进项目根的 `词语raw\`
2. 打开 `scripts/build.mjs`，确认 `VOLUMES` 里有对应配置行（已经预留了 8b / 9a / 9b）
3. 重跑 `node scripts/build.mjs`
4. **重启服务器**（`Ctrl+C` 后重新 `node scripts/serve.mjs`）—— 服务器只在启动时读一次词库

页面会自动多出该册，**不需要改任何页面代码**。

### 卡片 id 与稳定性

卡片 id 形如 `7a-u1#L37#1`（单元 id # 源文件行号 # 义项序号）。

行号锚定的意义：以后加册或增删词条重跑构建，**已有卡片的 id 不会整体漂移**，
已经存下来的错题本与星标才不会指到别的词上。所以请不要把 id 当成数字序号来解析。

### 数据统计（当前）

| 项 | 数量 |
|---|---|
| 册次 | 3 |
| 单元 | 26 |
| 词条 | 1298 |
| 背记卡（义项粒度） | 1451 |
| 一词多义卡 | 299 |
| 剔除（专有名词 / 缩写） | 62 |

---

## 解析规则

`scripts/parse-vocab.mjs` 是唯一真相来源，所有策略集中在文件顶部的常量区。

1. `##` 起单元；`Starter Unit N` 与 `Unit N` 都保留。
2. 词性列与释义列**按 `/` 顺序一一对应**。半角 `/` 与全角 `／` 都算分隔符
   （八年级上册大量使用全角）。
3. 词性列里**整段是括号注释**的（`Ms`、`Mr`、`to` 这类）剥掉；
   剥掉后要留一个占位段保住对应关系，否则后面的义项会整体错位。
4. `n. (pl. wolves)` → 基线词性 `n.`，复数提示存进 `note`。
5. 词性组合写法（`adj., adv. & n.`）收敛成规范选项，
   同时保留 `posScopes` 作为判分范围。
6. 词性含「专有名词」「缩写」的整行剔除（62 条）。
7. 「短语」「句型」是真实词性标签，会被保留并作为选项出现。

改规则后**必须**重跑：

```powershell
node scripts/test-parser.mjs   # 4500+ 条断言，含判分边界
```

---

## 测试

四套测试，全部零依赖（`test-server` 需要服务器已启动，`audit-a11y` 需要 `agent-browser`）。

| 命令 | 覆盖 | 当前 |
|---|---|---|
| `node scripts/test-parser.mjs` | 解析规则、单元/词条/卡片计数守恒、判分边界（英文/中文/词性） | ✓ 4506 项 |
| `node scripts/test-state.mjs` | api.js 状态层：并发写不丢更新、错题本去重/销号/复活、星标、进度、离线降级、离线→上线跨会话补同步、孤儿 id、导出格式 | ✓ 69 项 |
| `node scripts/test-server.mjs` | HTTP API：健康检查、状态往返、20 路并发 PATCH、uid 校验、导出（含孤儿 id）、静态资源、路径穿越防护 | ✓ 60 项 |
| `node scripts/audit-a11y.mjs` | 真实浏览器 7 个页面/视图 × 360px/1440px：横向滚动、标题层级、地标、ARIA、标签、触区、控制台报错 | ✓ 全绿，`.qa/a11y.json` |
| `node scripts/audit-contrast.mjs` | 逐层回溯真实背景算 WCAG 对比度（正文 4.5:1 / 大字 3:1） | ✓ 全绿，`.qa/contrast.json` |
| `node scripts/e2e.mjs` | 浏览器里走完整流程：首页 → 索引筛选选卡 → 背英文答错看解析 → 走完整轮 → 成绩小结 → 背词性 → 错题本 → 导出 → 星标 | ✓ 43 项，`.qa/e2e-result.json` |

```powershell
# 纯 Node，零依赖，不需要 npm install
node scripts/test-parser.mjs      # 不需要服务器
node scripts/test-state.mjs       # 不需要服务器
node scripts/test-server.mjs      # 需要先起服务器
node scripts/audit-a11y.mjs       # 需要先起服务器 + agent-browser
node scripts/audit-contrast.mjs   # 需要先起服务器 + agent-browser
node scripts/e2e.mjs              # 需要先起服务器 + agent-browser
```

**合计 4635 项断言全绿**（解析 4506 + 状态 69 + API 60）。

### 离线也能背

断网（或直接双击 HTML）时自动切「本地模式」，错题、星标、进度写进浏览器本地存储。
**服务器恢复后会自动把本地改动补推上去**，不需要用户做任何事；
这个「待同步」标记本身也是持久化的，所以离线背到一半切页面、刷新、关掉浏览器都不会丢。
另外，离线期间写入的错题以本地为准（不会被服务端的旧状态覆盖）。

---

## 文件结构

```
word/
├── index.html              首页
├── units.html              单元索引
├── study.html              背记 / 错题本 / 星标生词本 / 成绩小结
├── CONTRACT.md             开发契约（数据接口、类名、硬性要求）
├── README.md               本文件
├── assets/
│   ├── paper.css           宣纸设计系统
│   ├── api.js              状态访问 + 离线降级
│   └── vocab.js            判分规则 + 卡片工具（纯函数）
├── 词语raw/                原始词表（只读输入，构建的唯一数据来源）
│   ├── 七年级上册.md
│   ├── 七年级下册.md
│   └── 八年级上册.md
├── scripts/
│   ├── parse-vocab.mjs     词条解析器
│   ├── build.mjs           词库编译
│   ├── serve.mjs           零依赖服务器
│   └── test-parser.mjs     解析器与判分测试
├── data/
│   ├── vocab.json          构建产物（API 与测试用）
│   └── vocab.js            构建产物（浏览器内联降级用）
├── userData/               服务端状态（每个浏览器一个 json，交付时为空，首次使用自动生成）
└── .qa/                    验收报告（report.md）与审计脚本产物（a11y.json / contrast.json / e2e-result.json / 截图）
```

> `userData/` 里的每个 `<uid>.json` 都是某个浏览器的错题本、星标与进度。
> 交付时该目录是空的（只留 `.gitkeep`），你打开页面后会按浏览器自动生成一份。
> 想从头开始，直接删掉 `userData/` 下对应的 json 即可（或在浏览器里清 localStorage 里的 `dsh_word_uid`）。
>
> `.qa/` 是「验收报告 + 审计产物」共用目录：`report.md` 是独立审查员的报告，
> 其余 `a11y.json` / `contrast.json` / `e2e-result.json` / `*.png` 由上面几个审计脚本生成。

---

## API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | `{ok, units, cards, entries, builtAt, port}` |
| GET | `/api/vocab` | 完整词库 |
| GET | `/api/state` | 当前 uid 的状态（错题本 / 星标 / 进度 / 设置） |
| PATCH | `/api/state` | 按字段合并更新 |
| GET | `/api/export/wrongbook.md` | 下载 Markdown 错题本 |

uid 由页面生成并存在 `localStorage.dsh_word_uid`，通过 `X-Word-Uid` 请求头传递。

---

## 无障碍与适配

- 键盘可完成「筛选 → 选卡 → 背记 → 提交 → 下一词」全流程，`:focus-visible` 有可见焦点环
- 动态数字与答题反馈带 `aria-live` / `role="status"`
- `prefers-reduced-motion: reduce` 下动效降级为静态
- 移动优先：360px 宽无横向滚动，触区 ≥ 44px，输入框字号 ≥ 16px（避免 iOS 缩放）
- 字体离线可用：Google Fonts 加载失败时回退到系统中文字体，版式不塌
