# 问答效果相关问题整理（2026-02-23 合并版）

> 合并来源：
> - `docs/notes/normalize-answer-markdown-artifacts-analysis-2026-02-22.md`
> - `findings.md`
> - `progress.md`
> - `task_plan.md`

## 1) 目标与范围（本轮）
- 目标：修复“文档图片引用污染（如 `见文档3-1中的307b272.jpg`）+ 图片注入不稳定 + 图注样式失稳 + stream/final 跳变”。
- 范围：后端 context/prompt/postprocess、前端注图与渲染守护、`normalize-answer-markdown-artifacts` 的高风险误改点。
- 原则：优先结构性机制（统一锚点协议），避免继续堆砌硬编码规则。

## 2) 现象归并

### A. 文本污染类
1. 回答里出现“（见文档3-1中的307b27...jpg）”等不可读字符串。  
2. 文件名中数字被误拆分，出现类似 `307b2 / 72.jpg` 的断裂文本。

### B. 图像与图注类
1. 同一问题下图片有时插在正文段内、有时落到末尾“相关配图”。  
2. 图注会出现位置错乱或附带残片（如额外 `（图N）`）。  
3. 流式阶段与最终阶段对“是否保留图片/图锚点”的判断不一致，导致最终图像消失或跳变。

### C. 结构渲染类（历史遗留）
- `normalizeAnswerMarkdownArtifacts` 仍存在规则链长、顺序敏感等可维护性风险（标题误升、半规范表格修复覆盖不足、编号语义误杀风险）。
- 本轮对该层做了“高风险补丁收敛”，未完成全部引擎化替换。

## 3) 根因归并（结构性）

1. **缺少统一图像引用协议**  
   - 模型与前端之间没有稳定“图文锚点”，导致自由文本提及（文档号 + 文件名）无法稳定落图。

2. **后端对图片文件名/哈希泄露缺少硬约束**  
   - context 提示与 markdown 清理会把不透明文件名带入答案。

3. **前端注图策略对顺序敏感**  
   - 依赖 citation 行匹配与 fallback 兜底，缺少“可追溯、可定位”的原子锚点消费通道。

4. **stream/final 替换守护标准不一致**  
   - replacement 判定仅看 markdown image，忽略结构化图锚点，导致替换时“图像型信息丢失”。

5. **文本归一化误伤文件名模式**  
   - 列表拆分规则会把 `72.jpg` 误识别为新列表项。

## 4) 已落地改造（合并后状态）

## 4.1 后端（生成与后处理）
- `context_builder`：图片提示改为 `[[IMG:N-M#K]] + 语义描述`，并过滤不透明哈希文件名。  
- `prompting`：明确约束“优先输出 `[[IMG:N-M#K]]`，禁止输出原始图片文件名/哈希串”。  
- `postprocess/images`：新增自由文本图片提及归一化（文档+文件名/哈希 -> `[[IMG:N-M#1]]`）。  
- `postprocess/answer`：将图片锚点归一化纳入统一 postprocess 管线（先于 citation 归一）。  
- `postprocess/markdown`：无效图片 markdown 不再把疑似哈希文件名泄露回正文。

## 4.2 前端（消费与渲染）
- `inject-source-images`：新增结构化锚点消费通道，支持直接解析 `[[IMG:N-M#K]]` 注图。  
- `inject-source-images`：增加防护，跳过 `FIGCAPTION` 行的二次 citation pass，避免图注被追加冗余 `（图N）`。  
- `qa-shell`：若答案含 `[[IMG:...]]`，即使已有 markdown image 仍触发注图（确保锚点被消费）。  
- `qa-view`：replacement 判定加入结构化图锚点计数，前后端语义对齐。  
- `normalize-answer-markdown-artifacts`：修复文件名数字后缀误拆分（如 `307b272.jpg`）。

## 5) 验证证据（执行记录合并）
- Frontend：
  - `npx vitest run lib/inject-source-images.temp.test.ts` 通过（临时测试文件已按约定删除）。
  - `npx tsc --noEmit` 通过。
- Backend：
  - `python -m py_compile`（相关改动文件）通过。
  - `python -` 内联断言通过：自由文本图片提及可归一到 `[[IMG:...]]`；replacement guard 能拦截图像型信息丢失。
- Phase 状态：
  - Phase 1/2/3/4 已全部 completed（见原 `task_plan.md`）。

## 6) 问题状态矩阵（截至 2026-02-23）

| 问题 | 当前状态 | 说明 |
|---|---|---|
| `见文档X-Y中的xxx.jpg` 文本污染 | 已修复（主路径） | 通过后端归一化 + prompt/context 约束，转为结构化 IMG 标记 |
| 图片有时在正文、有时在末尾 | 已显著收敛 | 锚点消费优先级提升；仍保留 fallback 作为兜底 |
| 图注被污染/样式失稳 | 已修复 | 跳过 `FIGCAPTION` 二次扫描，保持图注原子性 |
| stream/final 图像跳变 | 已修复（关键路径） | replacement 判定统一“图像型信息”口径 |
| 文件名数字误拆分 | 已修复 | 列表拆分规则排除文件名/扩展名场景 |
| 标题误升/表格半规范修复不足等 | 待持续治理 | 属于 `normalizeAnswerMarkdownArtifacts` 结构性历史问题，需后续引擎化推进 |

## 7) 剩余风险与下一步建议

1. **保留 fallback 的副作用风险**  
   - 末尾“相关配图”机制仍在，建议后续改为“可配置策略”并记录命中日志。

2. **历史答案兼容路径仍需灰度观察**  
   - 对无结构化锚点的旧数据，仍依赖 heuristic，建议补充在线样本回放与指标观测。

3. **`normalizeAnswerMarkdownArtifacts` 的长期改造**  
   - 建议继续推进“分块解析 + 分类器 + 局部改写”架构，逐步替换长链正则策略，尤其是标题/表格/法规编号语义保留。

---

## 8) 一句话结论
- 本轮已完成“图像引用链路”全链路结构化改造，核心故障（文本污染、图片丢失、图注不稳、stream/final 跳变）已形成统一机制并通过验证；  
- 结构渲染层（标题/表格/编号）仍有历史技术债，建议作为下一阶段独立治理。

---

## 9) 2026-02-23 渐进式重构增量（信息流主线）

围绕 `normalizeAnswerMarkdownArtifacts` 的长期改造，本次增量将“信息流展示”与“内容归一化”进一步解耦：

1. **后端协议增强（SSE `retrieval_stats`）**  
   - 新增 `document_count` 与 `document_names` 字段，前端可直接渲染检索综述，不再依赖正文是否成功注入 `## 检索综述`。

2. **前端渲染层补齐检索综述槽位**  
   - 在 `QARetrievalStats` 之外新增“检索综述”卡片：流式阶段与结束阶段都可稳定显示检索统计与资料清单。
   - 若正文已存在 `## 检索综述`，则自动避免重复展示。

3. **`normalizeAnswerMarkdownArtifacts` 稳定性修复**  
   - 对显式 Markdown 标题（尤其 `## 检索综述/详细解析`）改为“保留语义+仅规范层级”，避免被误降级为普通段落导致板块“消失”。

4. **图片链路渐进优化**  
   - 流式阶段允许保守注图（含结构化 IMG 锚点及图号兜底），减少“结尾才出现图片”的跳变感。
   - 图号识别由“仅见图N”扩展为“图N/见图N”，提升历史答案兼容性与命中率。
   - 后端 `context_builder` 增加 `doc_id` 多来源回退，减少图片 URL 缺失导致的前端无图。

---

## 10) 2026-02-23 第二阶段增量（协议事件 + 渲染解耦）

在第一阶段基础上继续推进“信息流正常体验”：

1. **后端新增独立协议事件 `retrieval_overview`（SSE）**  
   - 由 `service.answer_question_stream` 在缓存命中与实时检索两条路径都发出。  
   - 载荷包含：`summary / candidate_count / fused_count / document_count / document_names / cached`。  
   - 作用：让“检索综述”从正文文案中解耦，成为可稳定消费的结构化协议数据。

2. **前端消息层接入 `retrieval_overview`**  
   - `sse-client` 新增 `retrieval_overview` 事件分发。  
   - `qa-view` 将该事件写入 `ChatMessage.retrievalOverview`。  
   - `types` 增补 `RetrievalOverview` 类型，避免检索综述依赖 `sources` 推断。

3. **渲染层继续解耦：新增 answer markdown pipeline**  
   - 新增 `features/qa/render/answer-markdown-pipeline.ts`，将以下阶段从 `qa-shell` 中抽离：  
     - 结构归一化（`normalizeAnswerMarkdownArtifacts`）  
     - 引用处理（`processAnswerCitations`）  
     - 媒体注入（图片/表格）  
   - `qa-shell` 改为调用 `buildAnswerMarkdown(...)`，显著降低组件内耦合与分支复杂度。

> 结果：检索综述与正文不再互相“绑死”，为后续完整替换 `normalizeAnswerMarkdownArtifacts` 内部规则链提供了稳定边界。

---

## 11) 2026-02-23 第三阶段增量（前端统一渲染状态机）

本阶段把“检索综述 + 思考过程 + 正文”收口到统一状态机驱动，避免分散条件判断造成的展示抖动：

1. **新增状态机模块**  
   - `frontend/features/qa/render/assistant-render-state-machine.ts`  
   - 状态：`understanding → retrieving → reasoning → answering → finalizing → done`（含 `error`）  
   - 事件：`status / retrieval_overview / thinking / thinking_done / answer / answer_replaced / done / error`

2. **消息模型增加渲染状态字段**  
   - `ChatMessage.renderState` 新增，SSE 回调按事件驱动状态迁移。  
   - `qa-view` 在 `onStatus/onThinking/onAnswer/onDone/onError` 等节点统一推进状态，减少 UI 层对时序猜测。

3. **`qa-shell` 从“散点条件”改为“统一渲染模型”**  
   - 使用 `buildAssistantRenderModel(...)` 统一决定：  
     - 是否显示检索统计  
     - 是否显示检索综述  
     - 是否显示思考过程  
     - 是否显示正文与流式光标

4. **体验约束显式化：保持“先思考后输出”**  
   - 在 `reasoning` 阶段收到早到的 answer token 时，状态机不立即进入 `answering`，等待 `thinking_done` 后再切换。  
   - 目的：保证“思考→输出”顺序稳定，降低流式阶段正文过早闪现。

---

## 12) 2026-02-23 第四阶段增量（信息流边界修复）

在第三阶段统一状态机后，继续补齐三个“体验边界”问题：

1. **无 thinking token 场景下的“空白流式”修复**  
   - 现象：某些模型会直接输出 answer token（不发 `thinking_done`），旧逻辑会把状态卡在 `reasoning`，导致正文直到 `done` 才出现。  
   - 修复：`onAnswer` 事件新增“是否仍需保持思考优先”的判定（仅在确有未完成 thinking 文本时才继续隐藏正文）。
   - 效果：保持“先思考后输出”原则的同时，避免“流式阶段一直空白”。

2. **检索综述在收尾阶段的稳定显示**  
   - 现象：`answer_replaced -> done` 的短窗口中，检索综述可能被临时隐藏（尤其正文已有“检索综述”标题时）。  
   - 修复：渲染模型将 `finalizing` 视作完成态之一，确保检索综述在流式收尾阶段不闪断。

3. **图片返回兜底的意图化增强**  
   - 现象：当答案未显式输出 `(见图N)` 但问题/正文存在明显图像意图时，末尾兜底逻辑可能不触发，导致“有图源但无图展示”。  
   - 修复：`injectSourceImages` 在无显式图号时增加“图像意图 + 相关性评分”兜底（优先高匹配候选；无高匹配时对明显图像语义保守补 1~2 张）。  
   - 约束：流式阶段增加最小成熟度条件，避免过早插入“相关配图”导致抖动。
