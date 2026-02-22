# normalizeAnswerMarkdownArtifacts 问题总结（方案B导向）

## 结论（先说重点）
- `normalizeAnswerMarkdownArtifacts` 当前是“单文件 + 多轮正则硬规则串行”的结构，规则多、顺序敏感、维护成本高。
- 你提到的“标题和正文粘合”问题，当前代码确实有触发路径，核心在标题识别/降级与分行修复策略不够智能。
- 建议走方案B（效果优先，直接切新引擎）

---

## 当前代码的主要问题

### 1) 规则过多且强顺序耦合（可维护性低）
- 证据：主流程在 `frontend/lib/normalize-answer-markdown-artifacts.ts:962-1033` 连续叠加十余步转换，且大量 `if (!streaming)` 分支。
- 问题本质：每条规则可能改变下一条规则输入，出现“修一处、坏一处”的连锁效应。

### 2) 标题识别“偏保留”，导致正文被误判为标题
- 证据：`normalizeMarkdownHeadingHierarchy` 中对结构化标题的保留逻辑：
  - `frontend/lib/normalize-answer-markdown-artifacts.ts:262-276`
  - `frontend/lib/normalize-answer-markdown-artifacts.ts:279-280`
- 问题本质：像“一、……|……|……”这类长句，只要命中结构化前缀，容易被继续当标题而非正文。

### 3) “标题+正文同一行”修复覆盖面不足
- 证据：
  - 仅对“标题后紧接编号子项”做拆分：`frontend/lib/normalize-answer-markdown-artifacts.ts:164-184`
  - 仅补“标题后空行”：`frontend/lib/normalize-answer-markdown-artifacts.ts:985-987`
- 问题本质：当模型输出是“结构化标题外观 + 连续正文（非标准编号）”时，不会被可靠拆开。

### 4) 标题提升规则较硬，可能把列表/正文抬成标题
- 证据：`normalizeChineseHeadings` 自动把“一、/（一）/1.”提升为 H2/H3：
  - `frontend/lib/normalize-answer-markdown-artifacts.ts:531-543`
  - `frontend/lib/normalize-answer-markdown-artifacts.ts:546-570`
- 问题本质：上下文判断依赖启发式，长文本或异常标点时容易误升。

### 5) 语义重写较激进，可能丢失原始表达
- 证据：
  - 表格引用统一改写为 `(见表N)`：`frontend/lib/normalize-answer-markdown-artifacts.ts:748-768`
  - 区段编号清理直接删除：`frontend/lib/normalize-answer-markdown-artifacts.ts:775-786`
- 问题本质：可读性提升的同时，可能丢失“原编号语义”和可追溯性。

### 6) 列表重编号存在误改业务编号风险
- 证据：`normalizeMarkdownLists` 会把有序列表重排：`frontend/lib/normalize-answer-markdown-artifacts.ts:601-643`
- 问题本质：在法规/条文语境中，数字可能是“条款号”而不是“列表序号”。

### 7) 流式与最终态处理路径不一致，可能出现"渲染跳变"
- 证据：多处只在 `!streaming` 执行（如 `:968-970`, `:975-980`, `:1006-1010`, `:1013-1015`, `:1021-1023`, `:1029-1033`）。
- 问题本质：用户在流式阶段看到的结构，收流后会突变，体验不稳定。

### 8) 表格渲染修复逻辑条件过于苛刻，大量不规范表格被跳过（Codex 报告未覆盖）
- 证据：`normalizeLoosePipeTables`（`frontend/lib/normalize-answer-markdown-artifacts.ts:189-231`）要求：
  - 行内 `|` 分割后至少产生 6 个 token（第 201 行 `if (tokens.length < 6) return line`）
  - 分隔符行必须精确出现在 header 之后、且数量与列数完全匹配（第 207-209 行）
  - 行必须不以 `|` 开头和结尾才会进入修复分支（第 195 行跳过已规范的行）
- 问题本质：LLM 输出的表格经常是"半规范"的——比如缺少分隔行、列数不一致、只有 3-4 列等。这些情况全部被 `return line` 跳过，表格原样输出后 ReactMarkdown 无法解析，用户看到的就是一堆竖线文本。
- 影响：这是"表格无法正确渲染"的直接原因之一。

### 9) 图片 Markdown 语法未被保护，可能被其他规则误伤（Codex 报告未覆盖）
- 证据：`transformUnprotected` 的保护区域正则 `PROTECTED_REGION_RE`（第 27 行）只覆盖了：
  - LaTeX 块：`$$...$$`、`$...$`
  - 代码块：`` ```...``` ``、`` `...` ``
  - 未包含图片语法 `![alt](url)` 和链接语法 `[text](url)`
- 问题本质：图片 URL 中如果包含特殊字符（如 `*`、`~`、数字序列、括号等），会被后续的 `normalizeStarRunPlaceholders`、`normalizeNumericRangeDelimiters`、`stripSectionNumberArtifacts` 等规则误匹配并改写，导致图片链接损坏或图片从输出中消失。
- 影响：这是"图片不伴随相关输出信息一同输出"的可能原因。

### 10) `stripSectionNumberArtifacts` 误杀风险高于报告所述（Codex 报告未充分说明）
- 证据：`frontend/lib/normalize-answer-markdown-artifacts.ts:775-786`，正则 `/[（(]\s*\d+(?:\.\d+){1,4}...[)）]/g` 会删除所有形如 `(3.2.6)`、`（4.4说明）` 的括号内容。
- 问题本质：在城市设计管控、法规引用密集的场景下，这类编号恰恰是条款的精确定位符（如"GB/T 51328-2019 第 3.2.6 条"），删除后用户无法追溯原始法规出处。与第 5 点"语义重写激进"属于同类问题，但该函数的匹配范围更广、误杀面更大。

---

## 可能对输出结果造成的问题
- 标题正文粘合：整段正文被渲染成大号蓝色标题（截图中的症状）。
- 结构失真：本应是列表/段落的内容被提升为 H2/H3/H4，层级错乱。
- 语义损失：引用编号、条款编号被清洗或重写后，追溯性下降。
- 视觉跳变：流式阶段与最终阶段排版不一致，用户感知"答案变形"。
- 回归难排查：规则链过长，定位某次误判来源成本高。
- 表格渲染失败：LLM 输出的半规范表格（缺分隔行、列数少、格式不标准）无法被 `normalizeLoosePipeTables` 修复，ReactMarkdown 直接将其渲染为纯文本竖线。
- 图片/链接损坏：图片和链接的 URL 未被 `PROTECTED_REGION_RE` 保护，其中的特殊字符可能被后续正则规则误改，导致图片消失或链接失效。
- 法规条款编号丢失：`stripSectionNumberArtifacts` 对 `(3.2.6)` 格式的无差别删除，在管控法规场景下会丢失条款定位信息。

---

## 修复办法（方案B：效果优先，直接切新引擎）

### 目标
- 不再依赖“整篇文本反复正则替换”，改为“分块解析 + 结构判定 + 小步重写”。
- 在不改调用方的前提下提升效果：保留 `normalizeAnswerMarkdownArtifacts(...)` 外部接口，内部替换实现。

### 建议架构（直切）
1. **Block Parser（分块器）**
   - 先把文本拆成：代码块、数学块、表格块、标题候选块、列表块、普通段落块。
2. **Heading Classifier（标题分类器）**
   - 对候选行打分（长度、标点密度、分隔符密度、上下文关系、后续行模式）。
   - 仅高置信度提升为标题；中低置信度降为段落。
3. **Normalizer Passes（局部归一）**
   - 仅在块内做改写，避免跨块副作用。
4. **Serializer（回写）**
   - 输出稳定 Markdown；尽量保留原语义 tokens（引用、条款号）。
5. **Diagnostics（诊断信息）**
   - 输出每条变换命中次数（开发模式），便于回归定位。

### 关键策略（针对你当前痛点）
- 对"一、xxx + 大段正文同一行"优先做"标题-正文拆分判断"，而不是先提升标题。
- 对包含高密度分隔符（`|`、`||`）或长句标点的候选标题，默认降级为段落。
- 对法规类编号（如"3.2.6"）默认保留，不做无条件删除。
- 流式与最终共用同一套解析器，只降级部分重写能力，减少"收流跳变"。

### 补充策略（针对 Codex 报告未覆盖的问题）
- 表格修复需降低门槛：当前 `normalizeLoosePipeTables` 要求 token >= 6 且分隔符精确匹配，应增加对 3-5 列小表格的支持，并能为缺少分隔行的表格自动补全 `| --- | --- |` 行。
- 图片/链接语法需加入保护区域：在 `PROTECTED_REGION_RE` 中增加对 `![...](...)` 和 `[...](...)` 的匹配，防止 URL 被后续规则误改。
- `stripSectionNumberArtifacts` 需增加上下文判断：当括号编号前后存在"第"、"条"、"款"、"GB"等法规关键词时，应保留而非删除。

---

## 与当前渲染链的关系
- 当前调用链（`qa-shell`）是：
  - `normalizeAnswerTables` → `normalizeAnswerMarkdownArtifacts` → citation处理 → `ReactMarkdown`
  - 位置：`frontend/components/qa-new/qa-shell.tsx:599-607`
- 因此你这个问题的主责任确实在 `normalizeAnswerMarkdownArtifacts`，不是 citation 模块。

---

## 落地建议（执行顺序）
1. 先实现新引擎文件（可放 `features/qa/formatting`），并用原接口代理到新实现。
2. 先覆盖"标题正文粘合"与"误升标题"两类高频问题。
3. 再逐步迁移次要规则（表格引用、section artifact、列表重编号）。
4. 最后清理旧规则链。

---

## 执行进度（当前）
- 已完成（Step 1）：引入分块解析入口（`markdown-block-parser`）并接入 `normalizeAnswerMarkdownArtifacts` 主流程。
- 已完成（Step 2）：标题分类器主导标题判定，标题/列表归一化由块类型约束，减少误判连锁。
- 进行中（Step 3）：流式与收流一致性修复。
  - 已落地：后端图片 URL 数学污染修复（`$ref` -> `ref`、去除图片外层数学包裹）。
  - 已落地：前端脏 URL 纠正（兼容历史回答）。
  - 待继续：表格/编号在收流后的一致性收口。

