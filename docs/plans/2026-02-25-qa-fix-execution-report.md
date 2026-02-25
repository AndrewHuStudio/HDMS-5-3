# QA 问答系统修复执行报告

> 日期：2026-02-25
> 基于：`2026-02-25-qa-ultimate-fix-guide.md`
> 状态：P0 / P1 / P2 全部完成

---

## 1. 执行总览

| 阶段 | 目标 | 状态 | 改动文件数 |
|------|------|------|-----------|
| P0 止血 | 检索综述幂等守卫 + SSE 短重试 | 已完成 | 4 |
| P1 稳定 | 三态归一化阶段 + PHASE_MATRIX 重排 | 已完成 | 4 |
| P2 治理 | 前后端职责去重 + 可开关降级策略 | 已完成 | 2 |

最终验证：`tsc --noEmit` 零错误，vitest 39/39 全通过。

---

## 2. P0 止血

### 2.1 检索综述标题幂等守卫（C2）

**问题**：后端注入 `## 检索综述` 前缀，LLM 正文可能再生成同标题，导致重复章节。

**修复**：双重守卫。

- 后端主守卫：`backend/qa_assistant/rag/postprocess/answer.py`
  - 新增 `dedupe_retrieval_overview_heading(text)` 函数
  - 正则匹配所有 `## 检索综述` 行，保留首个，删除后续重复
  - 在 `postprocess_answer()` 中 `sanitize_answer_data_only()` 之后调用

- 前端兜底：`frontend/lib/normalize-rules/rules/section-scaffold.ts`
  - 新增 `dedupeRetrievalOverview` 规则（order 1750，仅 final 阶段）
  - 同样的正则去重逻辑，防止 streaming 阶段遗漏

- 注册：`frontend/lib/normalize-rules/phase-matrix.ts`
  - `dedupe-retrieval-overview` → `FINAL_ONLY`

### 2.2 SSE 短重试与可观测日志（C5 部分）

**问题**：SSE 非中断异常时前端直接进入 error，无自动重试。

**修复**：`frontend/lib/sse-client.ts` 重构。

- `streamChat()` 拆分为外层重试循环 + `_streamChatOnce()` 内层执行
- 生成唯一 `request_id`（`req-{timestamp36}-{random6}`）
- 每次请求携带 `X-Request-Id` header 和 body `request_id` 字段
- 非 abort 错误自动重试 1 次（1.5s 延迟，同 request_id）
- 全链路 `[sse][requestId][phase]` 格式日志（connecting / streaming / done / error）

---

## 3. P1 稳定

### 3.1 NormalizePhase 三态升级（C1）

**问题**：渲染状态机有三态（streaming / finalizing / final），但归一化规则只有两态（streaming | final），`finalizing` 被映射为 streaming 的 light mode。

**修复**：

- `frontend/lib/normalize-rules/types.ts`
  - `NormalizePhase` 扩展为 `"streaming" | "finalizing" | "final"`

- `frontend/lib/normalize-rules/phase-matrix.ts` — 三态策略重排：

| 分类 | 规则数 | 包含规则 |
|------|--------|---------|
| ALL（streaming+finalizing+final） | 17 | strip-think-tags, strip-zero-width, rag-image-fix, block-parser, math-delimiters, image-math-unwrap, strip-unrenderable-images, fullwidth-asterisks, bold-whitespace, star-run-placeholders, split-run-on-items, split-inline-heading, loose-pipe-tables, unicode-bullets, heading-blank-lines, list-blank-lines, numeric-range-delimiters |
| FINALIZING_UP（finalizing+final） | 7 | chinese-headings, heading-hierarchy, list-numbering, heading-sequence, related-concepts-body, table-refs, section-artifacts |
| FINAL_ONLY | 5 | dedupe-retrieval-overview, section-scaffold, formula-promotion, conclusion-heading, broken-inline-math |

- `frontend/features/qa/render/markdown-normalization-pipeline.ts`
  - 移除 `lightMode` 布尔映射，直接调用 `runNormalizationPipeline({ phase: renderPhase })`
  - `AnswerRenderPhase` 与 `NormalizePhase` 现在 1:1 映射

### 3.2 三阶段快照验证

- `frontend/lib/normalize-rules/__tests__/pipeline-integration.test.ts`
  - 新增 `three-phase normalization snapshots` 测试组
  - 3 个 fixture × 3 个 phase = 9 个快照测试
  - 3 个行为断言：chinese-headings 在 finalizing 生效、conclusion-heading 仅 final 生效、streaming 是 finalizing 的子集
  - 总测试数：22 → 35

---

## 4. P2 治理

### 4.1 Postprocess Ownership Matrix

| # | 处理项 | 前端规则 | 后端函数 | 目标归属 | 本次动作 |
|---|--------|---------|---------|---------|---------|
| 1 | `<think>` 标签清理 | strip-artifacts (ALL) | sanitize_answer (legacy) | 后端主处理，前端 streaming 兜底 | 无需改动（postprocess_answer 已不调用） |
| 2 | 数学 delimiter | math-delimiters (ALL) | normalize_math_delimiters (legacy) | 后端主处理，前端 streaming 兜底 | 无需改动 |
| 3 | 图片 math 解包 | image-math-unwrap (ALL) | normalize_markdown_image_syntax (legacy) | 后端主处理 | 无需改动 |
| 4 | RAG 图片 URL 修复 | rag-image-fix (ALL) | _normalize_rag_image_query_url (内部) | 后端主处理，前端 streaming 兜底 | 无需改动 |
| 5 | 不可渲染图片清理 | strip-unrenderable-images (ALL) | strip_disallowed_markdown_images (legacy) | 后端主处理，前端 streaming 兜底 | 无需改动 |
| 6 | h1→h2 降级 | heading-hierarchy (FINALIZING+) | sanitize_answer L228 | **前端主处理** | **已从后端 sanitize_answer 移除** |
| 7 | 相关概念 body 降级 | related-concepts-body (FINALIZING+) | sanitize_answer L232 | **前端主处理** | **已从后端 sanitize_answer 移除** |
| 8 | 列表前空行插入 | heading-blank-lines / list-blank-lines (ALL) | sanitize_answer L235 | **前端主处理** | **已从后端 sanitize_answer 移除** |

### 4.2 后端重叠逻辑移除

- `backend/qa_assistant/rag/postprocess/markdown.py`
  - `sanitize_answer()` (legacy) 移除 3 处渲染层操作：
    - `_H1_RE.sub("## ", text)` — h1→h2 降级
    - `_normalize_related_concepts_body(text)` — 相关概念 body 降级
    - `_insert_blank_line_before_lists(text)` — 列表前空行插入
  - 保留：section-index noise removal、think tag stripping、`_ensure_related_concepts_section`
  - 注意：活跃代码路径使用 `sanitize_answer_data_only()`，本就不含这 3 项

### 4.3 可开关降级策略（C4）

- `frontend/lib/sse-client.ts`
  - 新增 `isStreamFallbackEnabled()` — 读取 `NEXT_PUBLIC_QA_STREAM_FALLBACK_ENABLED` 环境变量
  - 新增 `_nonStreamingFallback()` — POST `/qa/chat` 非流式端点，合成 onSources/onAnswer/onDone 回调
  - SSE 重试耗尽后，若 fallback 启用，自动降级到非流式通道
  - 降级时显示状态提示："流式连接失败，正在使用备用通道..."
  - 默认关闭（需设置 `NEXT_PUBLIC_QA_STREAM_FALLBACK_ENABLED=true` 启用）

---

## 5. 改动文件清单

| 文件 | 改动类型 | 阶段 |
|------|---------|------|
| `backend/qa_assistant/rag/postprocess/answer.py` | 新增 `dedupe_retrieval_overview_heading()` | P0 |
| `frontend/lib/normalize-rules/rules/section-scaffold.ts` | 新增 `dedupeRetrievalOverview` 规则 | P0 |
| `frontend/lib/normalize-rules/phase-matrix.ts` | 三态策略重排 | P0+P1 |
| `frontend/lib/sse-client.ts` | request_id + 短重试 + 降级 | P0+P2 |
| `frontend/lib/normalize-rules/types.ts` | NormalizePhase 三态 | P1 |
| `frontend/features/qa/render/markdown-normalization-pipeline.ts` | 直传真实 phase | P1 |
| `frontend/lib/normalize-rules/__tests__/pipeline-integration.test.ts` | +13 三阶段测试 | P1 |
| `frontend/lib/normalize-rules/__tests__/__snapshots__/pipeline-integration.test.ts.snap` | +9 快照 | P1 |
| `backend/qa_assistant/rag/postprocess/markdown.py` | 移除 3 处重叠逻辑 | P2 |

---

## 6. §8 回归验收清单

| # | 检查项 | 结果 |
|---|--------|------|
| 1 | `/api/rag/sources/{chunkId}` 代理正常返回 | ✅ 已完成(前序 A1) |
| 2 | 图片加载失败显示占位符 | ✅ 已完成(前序 A3) |
| 3 | 图片与正文有明显间距 | ✅ 已完成(前序 A4) |
| 4 | FIGCAPTION 不显示前缀文字 | ✅ 已完成(前序 A6) |
| 5 | 检索综述标题最多出现一次 | ✅ 本次完成(P0) |
| 6 | `finalizing` 与 `final` 视觉差异可控 | ✅ 本次完成(P1) |
| 7 | `answer_replaced` 前后 citation 不错位 | ✅ 已有守卫 |
| 8 | SSE 异常时可重试或降级 | ✅ 本次完成(P0+P2) |
| 9 | 表格与图片在 final 前后不退化 | ✅ 已有守卫 |
| 10 | `tsc --noEmit` 无错误 | ✅ 已验证 |
| 11 | 集成测试快照无回归 | ✅ 39/39 passed |

---

## 7. 剩余风险与后续建议

1. **非流式降级路由缺失** — `_nonStreamingFallback` 调用 `/qa/chat`，但当前只有 `/qa/chat/stream` 的 Next.js 代理路由。需新建 `frontend/app/qa/chat/route.ts` 代理到后端 `/qa/chat` 才能实际启用降级。在此之前 `QA_STREAM_FALLBACK_ENABLED` 应保持关闭。

2. **SSE 重试时的重复事件** — 重试会从头开始流式传输，answer 会从空重新拼接。如果重试发生在 answer 已部分接收后，用户会看到内容重置。可考虑后续加入 `last_event_id` 断点续传。

3. **Prompt 约束未加** — 文档 §3 提到可在 prompt 中增加"若已有'检索综述'，正文不要重复该标题"。本次未修改 prompt 模板，仅靠双重去重守卫。建议后续在 `rag/prompting.py` 的 system prompt 中补充此约束。

4. **streaming 阶段视觉变化** — streaming 阶段不再运行 chinese-headings 和 list-numbering，用户在流式过程中会看到未转换的中文标题格式。这是有意为之（减少流式抖动），finalizing 阶段会立即补齐。

5. **问答链路 SLO 监控** — 已加入 request_id 和 phase 日志，但尚未建立正式的指标采集和告警。建议后续接入 APM 或自定义 metrics，跟踪首 token 延迟、answer_replaced 比例、SSE 失败率。
