# QA 问答效果代码与架构审查报告（2026-02-24 更新）

> 本次报告基于最新代码改造进行复审，目标是验证“信息流展示”与“内容归一化”进一步解耦后的真实落地状态，并识别新的架构风险。

## 1. 本次改造核对结论（针对 6 项变更）

### 1.1 已删除非流式接口（`POST /qa/chat`）
- 结论：已落地。
- 证据：`backend/qa_assistant/routes/qa.py` 中 `@router.post("/qa/chat")` 相关实现已删除。
- 影响：前端和后端都转为纯流式主路径。

### 1.2 已删除缓存命中相关链路
- 结论：已落地。
- 证据：
  - `backend/qa_assistant/rag/service.py` 已移除 `get_query_cache` 相关读取/写入。
  - `backend/qa_assistant/routes/qa.py` 已删除 `/qa/cache/stats` 与 `/qa/cache/clear`。
- 影响：每次都走实时检索 + 实时推理，结果时效性提升，成本与延迟上升。

### 1.3 已移除 `inject_summary_document_names()` 注入路径
- 结论：已落地。
- 证据：`backend/qa_assistant/rag/service.py` 的 `_finalize_answer_and_sources(...)` 不再调用 `pp_summary.inject_summary_document_names(...)`。
- 影响：正文“检索综述”不再由后处理二次注入，减少“后置改写引发的结构跳变”。

### 1.4 已移除 `retrieval_overview` SSE 事件
- 结论：已落地。
- 证据：
  - 后端不再 `yield ("retrieval_overview", ...)`。
  - 前端 `frontend/lib/sse-client.ts` 已移除 `retrieval_overview` 分支与回调。
- 影响：外部“检索综述卡片”数据源被移除。

### 1.5 已将检索综述改为 answer 前缀注入
- 结论：已落地。
- 证据：`backend/qa_assistant/rag/service.py` 新增 `_build_retrieval_overview_text(...)`，并在 LLM answer 流前先 `yield("answer", {content: prefix})`。
- 影响：检索综述与正文统一为同一 answer 流，展示口径更一致。

### 1.6 前端已清理外部检索综述卡片逻辑
- 结论：已落地。
- 证据：`frontend/components/qa-new/qa-shell.tsx` 中 `QARetrievalOverview` 组件与渲染分支已删除；`retrievalOverview` 类型与状态使用已清理。
- 影响：页面只保留“回答正文内检索综述”，不再双轨展示。

---

## 2. 当前架构状态（更新后）

### 2.1 信息流展示
- 单一路径：仅 SSE 流式问答。
- 单一综述承载：检索综述作为 answer 前缀进入正文流，不再使用外部综述卡片。
- 渲染阶段：`streaming / finalizing / final` 三阶段仍保留，用于降低 stream/final 跳变。

### 2.2 内容归一化
- `buildAnswerMarkdown(...)` 继续按分阶段 pipeline 处理：
  - `normalize`（已通过 `markdown-normalization-pipeline` 分阶段调用）
  - `citation`
  - `image/table`
- `normalizeAnswerMarkdownArtifacts` 仍是核心规则引擎，但已被阶段编排层包裹。

---

## 3. 关键审查发现（本轮）

### P1：可靠性回退能力降低（有意改造，但需明确接受）
- 现象：前端 `qa-view` 移除了 SSE 失败后的非流式 fallback；后端也删除了非流式 `/qa/chat`。
- 风险：当流式链路异常时，用户直接失败，不再自动回退。
- 建议：若业务允许“纯流式强约束”，需在产品层明确；否则应保留最小降级通道。

### P1：缓存全部移除后，成本/延迟波动风险上升
- 现象：无缓存命中路径，所有请求都触发检索与模型推理。
- 风险：高并发下成本与响应抖动增加；热点问题失去复用收益。
- 建议：可考虑后续引入“短时会话级缓存”或“可配置缓存开关”，而非永久移除。

### P2：检索综述与正文统一后，重复问题显著缓解
- 现象：原“外部卡片 vs 正文综述”重复/矛盾问题在架构层已消除。
- 剩余风险：若模型正文再次自行生成第二个“检索综述”标题，仍可能出现正文内重复。
- 建议：在后处理增加轻量去重守卫（仅对 `## 检索综述` 标题做幂等）。

---

## 4. 与 `normalizeAnswerMarkdownArtifacts` 相关的结构评估

### 已改善
- 归一化调用从“单一 streaming 布尔”升级为“按渲染阶段编排调用”，减少收尾阶段大幅重写。

### 仍待治理
- `normalizeAnswerMarkdownArtifacts` 本体仍是超长规则链，顺序耦合与回归风险仍高。
- 当前分层更多是“调用层解耦”，尚未完成“规则层模块化”。

### 下一步建议（维持主线不变）
1. 拆分 normalize 内部 stage（heading/list/table/math/image/ref）并建立最小回归用例。
2. 建立“阶段策略矩阵”常量，避免策略散落在多个调用点。
3. 对“检索综述标题幂等”增加专项守卫，防止模型自发重复标题。

---

## 5. 回归验证建议（本轮之后）
- 场景 A：流式正常链路，检索综述应只出现一次（正文前缀）。
- 场景 B：SSE 异常链路，确认产品期望是“直接失败”还是“可降级”。
- 场景 C：`answer_replaced` 前后含表格/图片/引用，观察 finalizing 到 done 的稳定性。
- 场景 D：模型自行输出“检索综述”标题时，是否出现正文内部重复。

---

## 6. 一句话结论
本次改造已实质解决"检索综述双轨冲突"，并强化了解耦主线；新的主要问题不再是重复展示，而是"纯流式+无缓存"带来的可靠性与成本边界，需要产品与架构共同确认。

---

## 7. 问答展示效果深度诊断与优化方案（2026-02-24）

> 基于实际截图复现的渲染问题，对前端归一化管线 + CSS 渲染层 + 后端 prompt/后处理进行全链路诊断。

### 7.1 截图复现的具体问题

| # | 现象 | 根因定位 | 涉及代码 |
|---|------|---------|---------|
| A | 标题与正文黏着，无呼吸感 | CSS `margin-bottom` 不足 + `prose-sm` 默认间距偏紧 | `globals.css` `.qa-heading-1/2/3`、`qa-markdown-renderer.tsx` 的 `<p>` 组件 |
| B | 残留 `(5.3节)` 类噪声 | `stripSectionNumberArtifacts` 正则将"节"列为可选后缀，匹配后被 `LEGAL_CONTEXT_RE` 的"条款/条/节"误判为法规上下文而保留 | `normalize-answer-markdown-artifacts.ts:1416-1440` |
| C | 列表编号重复/错乱 | `normalizeMarkdownLists` 只修复连续 `1. 1. 1.` 模式；LLM 输出的嵌套列表或跨段落列表未被覆盖 | `normalize-answer-markdown-artifacts.ts:1699` |
| D | 标题层级跳跃 | `normalizeChineseHeadings` 和 `normalizeMarkdownHeadingHierarchy` 各自独立运行，前者生成 `##/###`，后者再做层级压缩，但两者之间无协调 | `normalize-answer-markdown-artifacts.ts:1032-1088, 644-735` |
| E | streaming → final 视觉跳变 | streaming 阶段跳过 ~12 个 non-streaming 规则（scaffold/hierarchy/section-strip/conclusion 等），final 阶段一次性全量应用导致内容大幅重排 | `normalize-answer-markdown-artifacts.ts:1671-1756` |

### 7.2 根因分析：为什么修单个规则治不了病

当前 `normalizeAnswerMarkdownArtifacts` 是一个 **1764 行的顺序规则链**，28 个 stage 串行执行。核心问题：

1. **顺序耦合**：stage N 的输出是 stage N+1 的输入，任何一个 stage 的行为变化都可能导致下游 stage 的正则匹配失败或误匹配。例如 `normalizeChineseHeadings`（stage 13）生成的 `## 一、xxx` 会被 `normalizeMarkdownHeadingHierarchy`（stage 15）再次改写。
2. **streaming/final 二态策略散落**：哪些 stage 在 streaming 跳过、哪些不跳过，由函数体内的 `if (!streaming)` 分支控制，没有集中的策略矩阵。
3. **无回归测试**：没有针对每个 stage 的输入/输出快照测试，改一个正则无法确认是否破坏其他 stage。
4. **前后端双重后处理**：后端 `postprocess/answer.py` 做了一轮 sanitize（去 section noise、demote h1、插空行），前端又做一轮几乎重叠的处理（stripSectionNumberArtifacts、normalizeMarkdownHeadingHierarchy、heading blank line insertion）。两层规则的交叉覆盖导致某些 artifact 被处理两次（过度清理）或零次（两边都以为对方会处理）。

### 7.3 优化方案：三层治理

#### 第一层：CSS 渲染层修复（立即可做，不动归一化逻辑）

目标：即使 markdown 归一化不完美，渲染层也能保证基本可读性。

**7.3.1 标题间距增大**

当前 `globals.css` 中 `.qa-heading-1` 的 `margin-bottom: 0.625rem` 偏小。建议：

```css
/* globals.css 修改 */
.qa-markdown h2.qa-heading-1 {
  margin-top: 1.75rem;    /* 原 1.5rem */
  margin-bottom: 0.875rem; /* 原 0.625rem */
}

.qa-markdown h3.qa-heading-2 {
  margin-top: 1.5rem;     /* 原 1.25rem */
  margin-bottom: 0.625rem; /* 原 0.5rem */
}

.qa-markdown h4.qa-heading-3 {
  margin-top: 1.125rem;   /* 原 0.875rem */
  margin-bottom: 0.5rem;  /* 原 0.375rem */
}
```

**7.3.2 段落与列表间距**

`qa-markdown-renderer.tsx` 中 `<p>` 的 `mb-2` (0.5rem) 在中文长段落下偏紧：

```tsx
// p 组件：mb-2 → mb-2.5 或 mb-3
<p className="mb-2.5 last:mb-0">{children}</p>

// li 组件：mb-1 → mb-1.5
<li className="mb-1.5 last:mb-0">{content}</li>
```

**7.3.3 标题与前一段落的分隔线（可选）**

对 `h2` 增加上边框或分隔线，视觉上明确"新章节"：

```css
.qa-markdown h2.qa-heading-1:not(:first-child) {
  border-top: 1px solid color-mix(in oklab, var(--border) 60%, transparent);
  padding-top: 1.25rem;
}
```

#### 第二层：归一化规则修复（针对截图中的具体 bug）

**7.3.4 修复 `stripSectionNumberArtifacts` 的"节"误保留**

问题：正则 `SECTION_ARTIFACT_RE` 匹配 `(5.3节)` 后，`LEGAL_CONTEXT_RE` 中的"条款"子串匹配了"节"字的上下文，导致保留。

修复方向：`LEGAL_CONTEXT_RE` 应要求更强的法规上下文信号（如必须同时出现标准编号 `GB/T` 或"规范/标准"关键词），而非仅凭"条/节/项"单字就保留。

```typescript
// 修改前
const LEGAL_CONTEXT_RE =
  /(GB\/T|GB\s*\/\s*T|CJJ|JGJ|规范|标准|条文|条款|第\s*\d+\s*[条款节项]|见第\s*\d+\s*[条款节项])/i;

// 修改后：移除单独的"条款"，只保留"第N条/节/项"这种明确法规引用
const LEGAL_CONTEXT_RE =
  /(GB\/T|GB\s*\/\s*T|CJJ|JGJ|规范|标准|条文|第\s*\d+\s*[条款节项]|见第\s*\d+\s*[条款节项])/i;
```

同时，`SECTION_ARTIFACT_RE` 中的可选后缀"节"应被移除或收紧：

```typescript
// 修改前：后缀包含"条|节|项"
/[（(]\s*\d+(?:\.\d+){1,4}(?:\s*(?:说明|详见|详述|条款|条|节|项|第\s*\d+\s*[条款节项]))?\s*[)）]/g

// 修改后：仅保留"说明|详见|详述"作为可选后缀，"条/节/项"由 LEGAL_CONTEXT_RE 守护
/[（(]\s*\d+(?:\.\d+){1,4}(?:\s*(?:说明|详见|详述))?\s*[)）]/g
```

**7.3.5 修复列表编号重复**

`normalizeMarkdownLists` 当前只处理连续的 `1. 1. 1.` 模式。需要增加对"跨空行列表"的处理：

```typescript
// 当前：只修复紧邻的重复编号
// 需要增加：检测同一逻辑列表块内的编号，即使中间有空行
```

**7.3.6 标题层级协调**

`normalizeChineseHeadings` 和 `normalizeMarkdownHeadingHierarchy` 应合并为单次 pass，或者建立明确的"先转换后压缩"契约：

- `normalizeChineseHeadings`：只负责"中文序号 → markdown heading 语法"
- `normalizeMarkdownHeadingHierarchy`：只负责"层级压缩 + 伪标题降级"
- 两者之间不应有交叉改写

#### 第三层：架构重构（中期，解决根本问题）

**7.3.7 规则模块化拆分**

将 `normalizeAnswerMarkdownArtifacts` 拆分为独立模块：

```
frontend/lib/normalize-rules/
├── index.ts                    # 编排入口
├── types.ts                    # NormalizeContext, NormalizeRule 接口
├── strip-artifacts.ts          # think 标签、零宽字符、RAG URL
├── math-normalization.ts       # 数学公式相关（delimiter、unwrap、promote）
├── image-normalization.ts      # 图片相关（unwrap math、strip unrenderable）
├── heading-normalization.ts    # 标题相关（chinese→md、hierarchy、scaffold、conclusion）
├── list-normalization.ts       # 列表相关（split run-on、numbering、blank lines）
├── table-normalization.ts      # 表格相关（loose pipe、table refs）
├── reference-normalization.ts  # 引用相关（figure refs、section artifacts）
└── text-normalization.ts       # 文本相关（bold whitespace、star runs、unicode bullets）
```

每个模块导出一个 `NormalizeRule` 接口：

```typescript
interface NormalizeRule {
  id: string;
  /** 该规则在哪些阶段执行 */
  phases: Set<'streaming' | 'finalizing' | 'final'>;
  /** 执行顺序权重（越小越先执行） */
  order: number;
  /** 规则执行函数 */
  apply(text: string, ctx: NormalizeContext): string;
}
```

**7.3.8 阶段策略矩阵**

将当前散落在函数体内的 `if (!streaming)` 收敛为一个声明式矩阵：

```typescript
const PHASE_MATRIX: Record<string, Set<AnswerRenderPhase>> = {
  'strip-artifacts':        new Set(['streaming', 'finalizing', 'final']),
  'math-delimiters':        new Set(['streaming', 'finalizing', 'final']),
  'chinese-headings':       new Set(['streaming', 'finalizing', 'final']),
  'heading-hierarchy':      new Set(['final']),
  'section-scaffold':       new Set(['final']),
  'section-artifacts':      new Set(['final']),
  'conclusion-heading':     new Set(['final']),
  'broken-inline-math':     new Set(['final']),
  // ...
};
```

这样可以一目了然地看到每个阶段执行了哪些规则，也便于调试"streaming 和 final 之间的跳变"。

**7.3.9 前后端后处理去重**

当前后端 `postprocess/answer.py` 和前端 `normalizeAnswerMarkdownArtifacts` 存在重叠：

| 处理项 | 后端 | 前端 | 建议归属 |
|--------|------|------|---------|
| 去 section noise `(3.2.6)` | sanitize_answer | stripSectionNumberArtifacts | 后端（一次性处理） |
| demote h1 → h2 | sanitize_answer | normalizeMarkdownHeadingHierarchy | 后端 |
| 列表前插空行 | sanitize_answer | heading/list blank line regex | 后端 |
| 中文序号→标题 | 无 | normalizeChineseHeadings | 前端（streaming 需要） |
| 标题层级压缩 | 无 | normalizeMarkdownHeadingHierarchy | 前端（streaming 需要） |
| 数学公式归一化 | normalize_math_delimiters | normalizeMathDelimitersForRenderer | 后端做主处理，前端做兜底 |

原则：**后端能做的在后端做一次**（因为 `answer_replaced` 事件会把后处理结果推给前端），前端只做"streaming 阶段必须的轻量处理"和"后端遗漏的兜底"。

**7.3.10 回归测试框架**

为每个规则模块建立快照测试：

```
frontend/lib/normalize-rules/__tests__/
├── heading-normalization.test.ts
├── list-normalization.test.ts
├── reference-normalization.test.ts
└── fixtures/
    ├── heading-input-01.md
    ├── heading-expected-01.md
    ├── section-noise-input-01.md
    └── section-noise-expected-01.md
```

每个 fixture 是一对"输入 markdown → 期望输出 markdown"，用 `vitest` 的 snapshot 或 inline snapshot 验证。这样改任何一个规则都能立即发现回归。

### 7.4 实施优先级

| 优先级 | 改动 | 风险 | 预期效果 |
|--------|------|------|---------|
| P0 | CSS 间距调整（7.3.1-7.3.3） | 极低，纯样式 | 标题/正文黏着问题立即缓解 |
| P0 | 修复 `stripSectionNumberArtifacts`（7.3.4） | 低，单个正则 | `(5.3节)` 类噪声消除 |
| P1 | 修复列表编号（7.3.5） | 中，需覆盖更多 pattern | 编号错乱问题缓解 |
| P1 | 标题层级协调（7.3.6） | 中，两个函数需协调 | 标题层级跳跃问题缓解 |
| P2 | 规则模块化拆分（7.3.7-7.3.8） | 中高，大重构 | 根治顺序耦合，降低回归风险 |
| P2 | 前后端去重（7.3.9） | 中，需前后端协调 | 消除双重处理的不确定性 |
| P3 | 回归测试框架（7.3.10） | 低，纯新增 | 为后续所有改动提供安全网 |

### 7.5 关于 streaming → final 跳变的专项建议

当前 streaming 阶段跳过了 12 个规则，final 阶段一次性全量应用。这导致用户在流式阅读时看到的格式和最终格式差异很大。

建议引入 **"渐进式归一化"** 策略：

1. **streaming 阶段**：只做"不会引起视觉跳变"的规则（数学 delimiter、零宽字符、bold whitespace）
2. **新增 `stabilizing` 阶段**：在 `thinking_done` 之后、answer 流开始时，执行"标题转换 + 列表修复"等中等权重规则
3. **final 阶段**：执行"scaffold 注入 + 结论提升 + section artifact 清理"等重量级规则

这样跳变被分散到两个过渡点，每次变化幅度更小，用户感知更平滑。
