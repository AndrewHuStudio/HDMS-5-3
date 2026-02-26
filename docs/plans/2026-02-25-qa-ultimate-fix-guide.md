# QA 问答系统终极修复指南

> 日期：2026-02-25
> 整合自：`2026-02-24-normalize-rules-refactor-plan.md`、`hdms-qa-fix-guide-2026-02-25.md`、`qa-image-404-fix-report-2026-02-25.md`
> 用途：在新对话中作为上下文，指导后续修复工作

---

## 0. 当前状态总览

### 已完成（本轮修复，代码已落盘，tsc 通过）

| # | 修复项 | 状态 |
|---|--------|------|
| A1 | 新建 `/api/rag/sources/[chunkId]` 同源代理路由 | 已完成 |
| A2 | 4 处前端 fetch 改用同源代理（qa-sources / resolve-pdf-url / prefetch-source-previews） | 已完成 |
| A3 | 图片 onError 改为占位符（qa-markdown-renderer + qa-sources ChunkMarkdown） | 已完成 |
| A4 | 图片间距增大（`my-2` → `my-4`，globals.css 新增 `.qa-markdown img` 规则） | 已完成 |
| A5 | FIGCAPTION 图注样式优化（`mb-3` → `mb-5`，居中+斜体） | 已完成 |
| A6 | FIGCAPTION 前缀剥离修复（新增 `stripLeadingFigcaptionPrefix()` 处理混合子节点） | 已完成 |

### 已完成（前序重构，代码已落盘）

| # | 修复项 | 状态 |
|---|--------|------|
| B1 | `normalize-answer-markdown-artifacts.ts`（1766 行）拆分为 `normalize-rules/` 模块化规则引擎 | 已完成 |
| B2 | 19 条规则迁移到独立文件，`PHASE_MATRIX` 声明式阶段策略矩阵 | 已完成 |
| B3 | 原入口保留为兼容 shim，内部委托 `runNormalizationPipeline()` | 已完成 |
| B4 | 集成测试 + 快照基线（`pipeline-integration.test.ts`） | 已完成 |

### 未完成（需要后续对话处理）

| # | 待办项 | 优先级 | 详见章节 |
|---|--------|--------|---------|
| C1 | `finalizing` 升级为独立归一化阶段（三态 phase） | P1 | §2 |
| C2 | 检索综述标题幂等守卫 | P0 | §3 |
| C3 | 前后端后处理职责去重 | P2 | §4 |
| C4 | 纯流式链路降级策略 | P2 | §5 |
| C5 | 后端 `postprocess/` 去除前端已覆盖的 3 处重叠逻辑 | P2 | §4 |

---

## 1. 系统架构速查

### 1.1 数据流

```
用户提问
  → POST /qa/chat/stream (SSE)
  → 后端 RAG 检索 (Milvus + Neo4j + MongoDB)
  → 后端 postprocess (answer.py / markdown.py / images.py / citations.py)
  → SSE 事件流: status* → thinking* → thinking_done? → answer* → answer_replaced? → done | error
  → 前端渲染管线: buildAnswerMarkdown()
      → normalizeAnswerTables()
      → normalizeAnswerMarkdownByPhase()  ← normalize-rules 引擎
      → processAnswerCitations()
      → injectAnswerImagesByPhase()
      → injectSourceTables()
      → collapseFigureMentions()
  → QAMarkdownRenderer (react-markdown + rehype-katex)
```

### 1.2 关键文件索引

```
前端渲染管线:
  frontend/features/qa/render/answer-markdown-pipeline.ts     ← 总编排
  frontend/features/qa/render/markdown-normalization-pipeline.ts ← 阶段分发
  frontend/features/qa/render/assistant-render-state-machine.ts ← 状态机
  frontend/features/qa/render/image-injection-pipeline.ts     ← 图片注入阶段控制

归一化规则引擎:
  frontend/lib/normalize-rules/index.ts          ← runNormalizationPipeline()
  frontend/lib/normalize-rules/types.ts          ← NormalizePhase, NormalizeRule, NormalizeContext
  frontend/lib/normalize-rules/phase-matrix.ts   ← PHASE_MATRIX 策略矩阵
  frontend/lib/normalize-rules/registry.ts       ← 规则注册表
  frontend/lib/normalize-rules/rules/*.ts        ← 19 条独立规则

图片注入:
  frontend/lib/inject-source-images.ts           ← injectSourceImages() 核心引擎

引用处理:
  frontend/features/qa/citations/                ← 引用管线（sanitize/normalize/convert/strip）

Markdown 渲染:
  frontend/components/qa-new/qa-markdown-renderer.tsx  ← react-markdown 组件覆写
  frontend/components/qa-new/qa-shell.tsx              ← 主面板编排
  frontend/components/qa-new/qa-citation-source-panel.tsx ← 引用状态管理

来源预览:
  frontend/components/qa-sources.tsx             ← 来源卡片 + 预览 fetch
  frontend/lib/resolve-pdf-url.ts                ← PDF URL 解析
  frontend/lib/prefetch-source-previews.ts       ← 批量预取

同源代理路由:
  frontend/app/api/rag/sources/[chunkId]/route.ts   ← /rag/sources 代理（本轮新增）
  frontend/app/api/rag/documents/[docId]/pdf/route.ts ← /rag/documents PDF 代理

后端后处理:
  backend/qa_assistant/rag/service.py            ← _finalize_answer_and_sources()
  backend/qa_assistant/rag/postprocess/answer.py ← postprocess_answer()
  backend/qa_assistant/rag/postprocess/markdown.py ← sanitize_answer()
  backend/qa_assistant/rag/postprocess/images.py
  backend/qa_assistant/rag/postprocess/citations.py
  backend/qa_assistant/rag/postprocess/math.py
```

### 1.3 环境变量

```bash
# QA 后端连接（前端 .env / .env.local）
NEXT_PUBLIC_HDMS_QA_BASE=http://localhost:8002
HDMS_QA_BASE_URL=http://localhost:8002          # 仅 server-side（Next.js API Route 用）

# Review 后端连接
NEXT_PUBLIC_HDMS_API_BASE=http://localhost:8003

# 端口探测候选（逗号分隔）
NEXT_PUBLIC_HDMS_QA_PORT_CANDIDATES=8000,8022
NEXT_PUBLIC_HDMS_API_PORT_CANDIDATES=8003,8023
```

---

## 2. C1：`finalizing` 升级为独立归一化阶段

### 现状

渲染状态机有三态（`streaming / finalizing / final`），但归一化规则只有两态（`streaming | final`）。`finalizing` 被映射为 `streaming` 的 light mode，导致 `answer_replaced → done` 期间策略不够细化。

### 涉及文件

- `frontend/lib/normalize-rules/types.ts` — `NormalizePhase` 类型
- `frontend/lib/normalize-rules/phase-matrix.ts` — `PHASE_MATRIX`
- `frontend/features/qa/render/markdown-normalization-pipeline.ts` — 阶段映射
- `frontend/features/qa/render/assistant-render-state-machine.ts` — 状态机

### 修复方案

1. `NormalizePhase` 扩展为 `"streaming" | "finalizing" | "final"`
2. `PHASE_MATRIX` 为每条规则显式声明三阶段可见性：
   - streaming：轻量兜底规则（strip-artifacts, rag-image-fix, math-delimiters 等）
   - finalizing：中等重排规则（heading-hierarchy, list-numbering, chinese-headings 等）
   - final：最强规则（section-scaffold, formula-promotion, conclusion-heading 等）
3. `normalizeAnswerMarkdownByPhase()` 直接传递真实 phase，不再用 `lightMode` 布尔映射

### 验收标准

`answer_replaced` 后的版式变化显著减少，`finalizing → final` 仅有轻微补齐。

---

## 3. C2：检索综述标题幂等守卫

### 现状

后端注入 `## 检索综述` 前缀；若模型正文再生成同标题，出现重复章节。

### 涉及文件

- `backend/qa_assistant/rag/service.py` — `_build_retrieval_overview_text` 与前缀注入
- `frontend/lib/normalize-rules/rules/section-scaffold.ts`
- `frontend/lib/normalize-rules/rules/heading-hierarchy.ts`

### 修复方案

1. 后端 `postprocess_answer` 前后增加 `dedupe_retrieval_overview_heading()`（保留首个）
2. Prompt 增加约束："若已有'检索综述'，正文不要重复该标题"
3. 前端增设 final 阶段兜底规则：仅保留首个 `## 检索综述`

### 验收标准

任意回答中 `## 检索综述` 最多出现一次。

---

## 4. C3 + C5：前后端后处理职责去重

### 现状重叠清单

| # | 处理项 | 前端规则 | 后端函数 | 建议归属 |
|---|--------|---------|---------|---------|
| 1 | `<think>` 标签清理 | `strip-artifacts` | `sanitize_answer` | 后端主处理，前端 streaming 兜底 |
| 2 | 数学 delimiter `\[→$$` | `math-delimiters` | `normalize_math_delimiters` | 后端主处理，前端 streaming 兜底 |
| 3 | 图片 math 解包 | `image-math-unwrap` | `normalize_markdown_image_syntax` | 后端主处理 |
| 4 | RAG 图片 URL 修复 | `rag-image-fix` | `_normalize_rag_image_query_url` | 后端主处理 |
| 5 | 不可渲染图片清理 | `strip-unrenderable-images` | `strip_disallowed_markdown_images` | 后端主处理，前端 streaming 兜底 |
| 6 | h1→h2 降级 | `heading-hierarchy` | `sanitize_answer` | 前端主处理（从后端移除） |
| 7 | 相关概念 body 降级 | `related-concepts` | `_normalize_related_concepts_body` | 前端主处理（从后端移除） |
| 8 | 列表前空行插入 | `heading-blank-lines` | `_insert_blank_line_before_lists` | 前端主处理（从后端移除） |

### 修复方案

**原则**：后端只做数据语义归一化（引用 remap、图片标记、结构注入）；前端只做显示归一化（标题层级、列表可读性、表格渲染）。

1. 后端 `sanitize_answer` 中移除 #6、#7、#8 三处逻辑
2. 前端规则 #1-#5 加注释标明"后端主处理，此处为 streaming 兜底"
3. 建立 `Postprocess Ownership Matrix` 文档，逐条规则标注唯一 owner

### 目标架构

| 层级 | 核心职责 | 禁止事项 |
|------|---------|---------|
| 后端（RAG + Postprocess） | 检索融合、引用映射、结构化标记、数据级清理 | 面向 UI 的样式修复 |
| 前端（Render Pipeline） | 分阶段可读性归一化、引用渲染、图表注入、交互状态 | 修改引用语义、重排数据事实 |
| 协议层（SSE Contract） | 事件顺序、字段 schema、错误码语义 | 隐式字段、随意新增事件 |

---

## 5. C4：纯流式链路降级策略

### 现状

只有 `/qa/chat/stream` 主路径；SSE 非中断异常时前端直接进入 error，无自动降级。

### 涉及文件

- `backend/qa_assistant/routes/qa.py`
- `frontend/lib/sse-client.ts`
- `frontend/features/qa/qa-view.tsx`
- `frontend/app/qa/chat/stream/route.ts`

### 修复方案

1. 轻量重试：同请求 ID 限定 1 次短重连
2. 可控降级开关：`QA_STREAM_FALLBACK_ENABLED`
3. 降级方案二选一：
   - A. 恢复最小 `/qa/chat` 非流式兜底
   - B. 后端内部转"聚合后一次性返回"（伪流式降级）
4. 前端错误文案区分：网络抖动 / 服务不可用 / 后端处理中断

---

## 6. 已完成修复的技术细节（供新对话参考）

### 6.1 同源代理路由

**文件**：`frontend/app/api/rag/sources/[chunkId]/route.ts`

```typescript
// GET /api/rag/sources/{chunkId}?q=...
// → 转发到 ${qaBaseUrl()}/rag/sources/{chunkId}?q=...
// 环境变量优先级：HDMS_QA_BASE_URL > NEXT_PUBLIC_HDMS_QA_BASE > NEXT_PUBLIC_HDMS_QA_API_BASE > http://localhost:8002
```

已有同类路由参考：`frontend/app/api/rag/documents/[docId]/pdf/route.ts`

### 6.2 前端 fetch 调用变更

所有 `/rag/sources/` 请求从直连后端改为同源代理：

```typescript
// 旧：fetch(`${normalizeApiBase(QA_API_BASE)}/rag/sources/${chunkId}${qParam}`)
// 新：fetch(`/api/rag/sources/${encodeURIComponent(chunkId)}${qParam}`)
```

涉及 4 处：
- `components/qa-sources.tsx` — prefetch（L154）+ SourceCard fetch（L299）
- `lib/resolve-pdf-url.ts` — fetchSourceDetails（L54）
- `lib/prefetch-source-previews.ts` — 批量预取（L46）

### 6.3 图片错误处理

```typescript
// 旧：img.style.display = "none"
// 新：显示虚线边框占位符 + "图片暂不可用" alt 文字
onError={(e) => {
  const img = e.target as HTMLImageElement;
  img.removeAttribute("src");
  img.alt = "图片暂不可用";
  img.title = "参考图片暂不可用";
  img.style.cursor = "default";
  img.className = "my-4 flex h-20 w-full items-center justify-center rounded border border-dashed border-border bg-muted/40 text-xs text-muted-foreground";
}}
```

两处：`qa-markdown-renderer.tsx`（主回答）和 `qa-sources.tsx` ChunkMarkdown（来源预览）。

### 6.4 图文间距

- 图片 className：`my-2` → `my-4`
- FIGCAPTION：`mt-1 mb-3 text-left` → `mt-1 mb-5 text-center italic`
- globals.css 新增：

```css
.qa-markdown img {
  display: block;
  margin-top: 1rem;
  margin-bottom: 0.5rem;
}
.qa-markdown img + p,
.qa-markdown img + div {
  margin-top: 0.25rem;
}
```

### 6.5 FIGCAPTION 前缀剥离

新增 `stripLeadingFigcaptionPrefix()` 函数，处理混合子节点（文本 + 引用锚点 ReactElement）：

```typescript
// 遍历 children 数组，找到第一个 string 子节点，剥离 "FIGCAPTION " 前缀
// 解决了 isPlainTextOnly=false 时 FIGCAPTION 作为可见文字泄露到 UI 的问题
```

### 6.6 normalize-rules 引擎架构

```
normalize-rules/
├── index.ts          ← runNormalizationPipeline(text, { phase, preserveInlineFigureRefs })
├── types.ts          ← NormalizePhase = "streaming" | "final"
├── phase-matrix.ts   ← PHASE_MATRIX: Record<ruleId, Set<NormalizePhase>>
├── registry.ts       ← registerRules() + getRegisteredRules()
├── utils.ts          ← bumpCounter, transformUnprotected, INLINE_OR_FENCED_CODE_RE 等
└── rules/
    ├── strip-artifacts.ts      (order 100)  全阶段
    ├── rag-image-fix.ts        (order 200)  全阶段
    ├── block-parser.ts         (order 300)  全阶段
    ├── math-delimiters.ts      (order 400)  全阶段
    ├── image-cleanup.ts        (order 500,501) 全阶段
    ├── text-cleanup.ts         (order 600-603) 全阶段
    ├── list-splitting.ts       (order 700)  全阶段
    ├── table-normalization.ts  (order 900)  全阶段
    ├── chinese-headings.ts     (order 1000) 全阶段
    ├── related-concepts.ts     (order 1100) 仅 final
    ├── heading-hierarchy.ts    (order 1200) 仅 final
    ├── heading-blank-lines.ts  (order 1400,1401) 全阶段
    ├── list-numbering.ts       (order 1500) 全阶段
    ├── figure-refs.ts          (order 1600) 条件执行
    ├── numeric-range.ts        (order 2200) 全阶段
    ├── formula-promotion.ts    (order 2000) 仅 final
    ├── section-scaffold.ts     (order 1800) 仅 final
    ├── conclusion-heading.ts   (order 2100) 仅 final
    └── broken-math.ts          (order 2300) 仅 final
```

兼容入口：`frontend/lib/normalize-answer-markdown-artifacts.ts` 委托 `runNormalizationPipeline()`。

---

## 7. 分阶段实施建议

### P0（止血，1-2 天）

1. ~~图片 404 / 渲染 / 间距修复~~ → 已完成（§6）
2. 检索综述标题幂等守卫（§3）
3. `qa-view` 加一次短重试 + 可观测日志字段（request_id、phase）

### P1（稳定，3-5 天）

1. `finalizing` 升级为独立归一化阶段（§2）
2. 重排 `PHASE_MATRIX`，中等代价规则迁入 `finalizing`
3. 补充 phase 对照测试（streaming / finalizing / final 三份快照）

### P2（治理，1-2 周）

1. 前后端规则 owner 矩阵 + CI 检查（§4）
2. 后端移除 3 处重叠逻辑（§4）
3. 正式降级策略上线（§5）
4. 建立问答链路 SLO：首 token、answer_replaced 比例、SSE 失败率

---

## 8. 回归验收清单

- [ ] `/api/rag/sources/{chunkId}` 代理正常返回（无 404）
- [ ] 图片加载失败显示占位符（非空白）
- [ ] 图片与正文有明显间距（非黏着）
- [ ] FIGCAPTION 不显示 "FIGCAPTION" 前缀文字
- [ ] 检索综述标题最多出现一次
- [ ] `finalizing` 与 `final` 视觉差异可控
- [ ] `answer_replaced` 前后 citation 不错位
- [ ] SSE 异常时可重试或降级
- [ ] 表格与图片在 final 前后不退化
- [ ] `tsc --noEmit` 无错误
- [ ] 集成测试快照无回归
