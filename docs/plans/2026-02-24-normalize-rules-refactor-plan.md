# P2 重构计划：normalizeAnswerMarkdownArtifacts 规则模块化 + 前后端去重

> 日期：2026-02-24
> 关联文档：`docs/notes/qa-answer-quality-consolidated-2026-02-23.md` 第 7 节

## 1. 目标

将 `frontend/lib/normalize-answer-markdown-artifacts.ts`（1766 行、29 个串行 stage）拆分为独立规则模块，引入声明式阶段策略矩阵，同时清理后端 `postprocess/` 与前端的 8 处重叠逻辑。最终交付物：

- `frontend/lib/normalize-rules/` 目录，每个规则模块独立文件
- `NormalizeRule` 接口 + `PHASE_MATRIX` 策略矩阵
- 后端 `postprocess/` 去除前端已覆盖的重复处理（或反之）
- 每个规则模块配套快照测试
- 原 `normalizeAnswerMarkdownArtifacts` 保留为兼容入口，内部委托新引擎

## 2. 现状概览

### 2.1 前端归一化管线（当前）

```
qa-shell.tsx
  → buildAnswerMarkdown()                    [answer-markdown-pipeline.ts]
    → normalizeAnswerTables()                [lib/normalize-answer-tables.ts]
    → normalizeAnswerMarkdownByPhase()       [render/markdown-normalization-pipeline.ts]
      → normalizeAnswerMarkdownArtifacts()   [lib/normalize-answer-markdown-artifacts.ts] ← 1766 行
        → parseMarkdownBlocks()              [formatting/markdown-block-parser.ts]
        → classifyHeadingCandidate()         [formatting/heading-classifier.ts]
        → 29 个内部 stage 串行执行
    → processAnswerCitations()               [citations/]
    → injectAnswerImagesByPhase()            [render/image-injection-pipeline.ts]
    → injectSourceTables()                   [lib/inject-source-tables.ts]
    → collapseFigureMentions()               [lib/stream-source-utils.ts]
```

### 2.2 后端后处理管线（当前）

```
_finalize_answer_and_sources()  [rag/service.py]
  → postprocess_answer()        [postprocess/answer.py]
    → sanitize_answer()         [postprocess/markdown.py]
    → normalize_markdown_image_syntax()
    → strip_disallowed_markdown_images()
    → normalize_image_reference_markers()  [postprocess/images.py]
    → unescape_dollar_delimiters()         [postprocess/math.py]
    → normalize_citations()                [postprocess/citations.py]
    → normalize_math_delimiters()
    → convert_formulas_to_latex()
```

### 2.3 前后端重叠清单

| # | 处理项 | 前端函数 | 后端函数 | 去重归属 |
|---|--------|---------|---------|---------|
| 1 | `<think>` 标签清理 | 行内 regex (L1605) | `sanitize_answer` | **后端**（前端保留为 streaming 兜底） |
| 2 | 数学 delimiter `\[→$$` | `normalizeMathDelimitersForRenderer` | `normalize_math_delimiters` | **后端主处理**，前端降级为兜底 |
| 3 | 图片 math 解包 | `unwrapMathWrappedImages` | `normalize_markdown_image_syntax` | **后端** |
| 4 | RAG 图片 URL 修复 | `normalizeBrokenRagImageRefs` | `_normalize_rag_image_query_url` | **后端** |
| 5 | 不可渲染图片清理 | `stripUnrenderableImageTokens` | `strip_disallowed_markdown_images` | **后端**（前端保留 streaming 兜底） |
| 6 | h1→h2 降级 | `normalizeMarkdownHeadingHierarchy` | `sanitize_answer` | **后端**（前端只做层级压缩） |
| 7 | 相关概念 body 降级 | `normalizeRelatedConceptsBody` | `_normalize_related_concepts_body` | **后端** |
| 8 | 列表前空行插入 | 行内 regex (L1695) | `_insert_blank_line_before_lists` | **后端** |

**去重原则**：后端通过 `answer_replaced` 事件推送后处理结果，前端只需在 streaming 阶段做轻量兜底。

## 3. 目标架构

### 3.1 目录结构

```
frontend/lib/normalize-rules/
├── index.ts                    # 引擎入口：runNormalizationPipeline()
├── types.ts                    # NormalizeRule, NormalizeContext, NormalizePhase
├── utils.ts                    # 共享工具函数（transformUnprotected, transformOutsideCodeAndDollarMath, 核心正则）
├── phase-matrix.ts             # PHASE_MATRIX 声明式策略矩阵
├── registry.ts                 # 规则注册表，收集所有规则并按 order 排序
│
├── rules/
│   ├── strip-artifacts.ts      # think 标签、零宽字符
│   ├── rag-image-fix.ts        # RAG URL 修复（streaming 兜底）
│   ├── block-parser.ts         # 结构化块解析（委托 formatting/markdown-block-parser）
│   ├── math-delimiters.ts      # 数学 delimiter 归一化（streaming 兜底）
│   ├── image-cleanup.ts        # 图片 math 解包 + 不可渲染图片清理（streaming 兜底）
│   ├── text-cleanup.ts         # 全角星号、bold 空格、star-run、unicode bullet
│   ├── list-splitting.ts       # run-on 编号拆分
│   ├── heading-splitting.ts    # 内联标题+正文拆分
│   ├── table-normalization.ts  # loose pipe 表格归一化
│   ├── chinese-headings.ts     # 中文序号→markdown 标题
│   ├── related-concepts.ts     # 相关概念 body 降级（streaming 兜底）
│   ├── heading-hierarchy.ts    # 标题层级压缩 + 伪标题降级
│   ├── heading-blank-lines.ts  # 标题后空行 + 列表前空行（streaming 兜底）
│   ├── list-numbering.ts       # 有序列表编号修复
│   ├── figure-refs.ts          # 图片引用归一化
│   ├── table-refs.ts           # 表格引用归一化
│   ├── section-artifacts.ts    # section number 噪声清理
│   ├── section-scaffold.ts     # 二层 scaffold 注入
│   ├── heading-sequence.ts     # 编号标题序号修复
│   ├── formula-promotion.ts    # 裸公式提升为 display-math
│   ├── conclusion-heading.ts   # 结论标题提升
│   ├── numeric-range.ts        # 数值范围 delimiter 归一化
│   └── broken-math.ts          # 损坏行内公式恢复
│
└── __tests__/
    ├── strip-artifacts.test.ts
    ├── chinese-headings.test.ts
    ├── heading-hierarchy.test.ts
    ├── list-numbering.test.ts
    ├── section-artifacts.test.ts
    ├── pipeline-integration.test.ts   # 全管线集成测试
    └── fixtures/
        ├── chinese-headings-input-01.md
        ├── chinese-headings-expected-01.md
        ├── section-noise-input-01.md
        ├── section-noise-expected-01.md
        └── ...
```

### 3.2 核心接口

```typescript
// types.ts

export type NormalizePhase = "streaming" | "final";

export interface NormalizeContext {
  phase: NormalizePhase;
  diagnostics: NormalizationDiagnostics;
  /** 原始输入（用于 diagnostics diff） */
  originalText: string;
}

export interface NormalizeRule {
  /** 唯一标识，用于 PHASE_MATRIX 查找和 diagnostics 记录 */
  id: string;
  /** 执行顺序权重，越小越先执行 */
  order: number;
  /** 规则执行函数 */
  apply(text: string, ctx: NormalizeContext): string;
}
```

### 3.3 阶段策略矩阵

```typescript
// phase-matrix.ts

import type { NormalizePhase } from "./types";

/**
 * 声明式矩阵：每个规则 ID → 在哪些阶段执行。
 * 一目了然，替代原来散落在函数体内的 if (!streaming) 分支。
 */
export const PHASE_MATRIX: Record<string, Set<NormalizePhase>> = {
  // ── 全阶段执行（streaming + final）──
  "strip-think-tags":           new Set(["streaming", "final"]),
  "strip-zero-width":           new Set(["streaming", "final"]),
  "rag-image-fix":              new Set(["streaming", "final"]),
  "block-parser":               new Set(["streaming", "final"]),
  "math-delimiters":            new Set(["streaming", "final"]),
  "image-math-unwrap":          new Set(["streaming", "final"]),
  "strip-unrenderable-images":  new Set(["streaming", "final"]),
  "fullwidth-asterisks":        new Set(["streaming", "final"]),
  "bold-whitespace":            new Set(["streaming", "final"]),
  "star-run-placeholders":      new Set(["streaming", "final"]),
  "split-run-on-items":         new Set(["streaming", "final"]),
  "split-inline-heading":       new Set(["streaming", "final"]),
  "loose-pipe-tables":          new Set(["streaming", "final"]),
  "chinese-headings":           new Set(["streaming", "final"]),
  "unicode-bullets":            new Set(["streaming", "final"]),
  "heading-blank-lines":        new Set(["streaming", "final"]),
  "list-blank-lines":           new Set(["streaming", "final"]),
  "list-numbering":             new Set(["streaming", "final"]),
  "heading-sequence":           new Set(["streaming", "final"]),
  "numeric-range-delimiters":   new Set(["streaming", "final"]),

  // ── 仅 final 阶段执行 ──
  "related-concepts-body":      new Set(["final"]),
  "heading-hierarchy":          new Set(["final"]),
  "table-refs":                 new Set(["final"]),
  "section-artifacts":          new Set(["final"]),
  "section-scaffold":           new Set(["final"]),
  "formula-promotion":          new Set(["final"]),
  "conclusion-heading":         new Set(["final"]),
  "broken-inline-math":         new Set(["final"]),

  // ── 条件执行 ──
  "figure-refs":                new Set(["streaming", "final"]),  // 受 preserveInlineFigureRefs 控制
};
```

### 3.4 引擎入口

```typescript
// index.ts

import { PHASE_MATRIX } from "./phase-matrix";
import { allRules } from "./registry";
import type { NormalizeContext, NormalizePhase } from "./types";
import { createDiagnostics, bumpIfChanged } from "./utils";

export interface RunPipelineOptions {
  phase: NormalizePhase;
  preserveInlineFigureRefs?: boolean;
  debugDiagnostics?: boolean;
}

export function runNormalizationPipeline(text: string, options: RunPipelineOptions): string {
  if (!text) return text;

  const { phase, preserveInlineFigureRefs = true, debugDiagnostics = false } = options;
  const ctx: NormalizeContext = {
    phase,
    diagnostics: createDiagnostics(debugDiagnostics),
    originalText: text,
  };

  let out = text;
  for (const rule of allRules) {
    const allowedPhases = PHASE_MATRIX[rule.id];
    if (!allowedPhases?.has(phase)) continue;

    // 特殊条件守卫
    if (rule.id === "figure-refs" && preserveInlineFigureRefs) continue;

    const before = out;
    out = rule.apply(out, ctx);
    bumpIfChanged(ctx.diagnostics, rule.id, before, out);
  }

  if (ctx.diagnostics.enabled) {
    console.debug("[normalize-rules]", ctx.diagnostics);
  }

  return out;
}
```

### 3.5 共享工具函数（utils.ts）

从原文件迁移到 `normalize-rules/utils.ts`：

| 函数/类型 | 用途 | 被谁使用 |
|-----------|------|---------|
| `NormalizationDiagnostics` | 诊断类型 | 所有规则 |
| `createDiagnostics()` | 创建诊断对象 | 引擎入口 |
| `bumpCounter()` | 计数器递增 | 多个规则 |
| `bumpIfChanged()` | 变更检测 | 引擎入口 |
| `recordHeadingDecision()` | 标题分类记录 | heading-hierarchy |
| `transformUnprotected()` | 保护区域外变换 | text-cleanup, image-cleanup 等 |
| `transformOutsideCodeAndDollarMath()` | 代码/数学区域外变换 | broken-math, formula-promotion |
| `PROTECTED_REGION_RE` | 保护区域正则 | transformUnprotected |
| `CODE_OR_DOLLAR_MATH_RE` | 代码/数学正则 | transformOutsideCodeAndDollarMath |
| `INLINE_OR_FENCED_CODE_RE` | 代码块正则 | 部分规则 |

### 3.6 兼容入口（过渡期）

```typescript
// 原 normalize-answer-markdown-artifacts.ts 改为：

import { runNormalizationPipeline } from "./normalize-rules";

export { normalizeMarkdownLists } from "./normalize-rules/rules/list-numbering";

export function normalizeAnswerMarkdownArtifacts(
  text: string,
  options: NormalizeAnswerMarkdownArtifactsOptions = {}
): string {
  const phase = options.streaming ? "streaming" : "final";
  return runNormalizationPipeline(text, {
    phase,
    preserveInlineFigureRefs: options.preserveInlineFigureRefs,
    debugDiagnostics: options.debugDiagnostics,
  });
}
```

## 4. 实施步骤

### Step 1：写集成测试锁住基线

在动任何代码之前，先用当前 `normalizeAnswerMarkdownArtifacts()` 的真实输入/输出创建回归基线测试。

1. 创建 `frontend/lib/normalize-rules/__tests__/pipeline-integration.test.ts`
2. 从历史问答中提取 3-5 个真实 LLM 输出样本（含中文标题、公式、引用、表格）
3. 分别记录 `streaming: true` 和 `streaming: false` 的输出作为 expected
4. 测试直接调用当前 `normalizeAnswerMarkdownArtifacts()`，确认 pass

**验证**：`npm test` 通过，基线锁定。

### Step 2：创建骨架 + 类型定义 + 共享工具

创建 `normalize-rules/` 目录，写入：

1. `types.ts` — `NormalizePhase`、`NormalizeContext`、`NormalizeRule`、`NormalizationDiagnostics`
2. `utils.ts` — `createDiagnostics`、`bumpCounter`、`bumpIfChanged`、`recordHeadingDecision`、`transformUnprotected`、`transformOutsideCodeAndDollarMath`、核心正则
3. `phase-matrix.ts` — `PHASE_MATRIX`
4. `registry.ts` — `allRules`（空数组）
5. `index.ts` — `runNormalizationPipeline()`（此时无规则，直接返回原文）

**验证**：`npm run build` 通过，现有行为不变，集成测试仍 pass。

### Step 3：分批迁移规则

#### 第 1 批：简单无依赖规则（验证引擎骨架）

| order | 规则 ID | 源函数 | 目标文件 |
|-------|---------|--------|---------|
| 100 | strip-think-tags | 行内 regex | rules/strip-artifacts.ts |
| 101 | strip-zero-width | 行内 regex | rules/strip-artifacts.ts |
| 600 | fullwidth-asterisks | transformUnprotected + regex | rules/text-cleanup.ts |
| 601 | bold-whitespace | transformUnprotected + regex | rules/text-cleanup.ts |
| 602 | star-run-placeholders | normalizeStarRunPlaceholders | rules/text-cleanup.ts |
| 1300 | unicode-bullets | 行内 regex | rules/text-cleanup.ts |
| 1400 | heading-blank-lines | 行内 regex | rules/heading-blank-lines.ts |
| 1401 | list-blank-lines | 行内 regex | rules/heading-blank-lines.ts |
| 2200 | numeric-range-delimiters | normalizeNumericRangeDelimiters | rules/numeric-range.ts |

迁移步骤（每个规则）：
1. 提取函数到 `rules/{name}.ts`，包装为 `NormalizeRule`
2. 在 `registry.ts` 中注册
3. 从原文件中删除对应代码，改为调用新引擎
4. 写 2+ 个单元测试
5. 跑 build + 集成测试

**验证**：build 通过，集成测试无回归。此批完成后引擎骨架经过实战验证。

#### 第 2 批：图片/数学相关规则

| order | 规则 ID | 源函数 | 目标文件 |
|-------|---------|--------|---------|
| 200 | rag-image-fix | normalizeBrokenRagImageRefs | rules/rag-image-fix.ts |
| 400 | math-delimiters | normalizeMathDelimitersForRenderer | rules/math-delimiters.ts |
| 500 | image-math-unwrap | unwrapMathWrappedImages | rules/image-cleanup.ts |
| 501 | strip-unrenderable-images | stripUnrenderableImageTokens | rules/image-cleanup.ts |
| 2000 | formula-promotion | promoteBareFormulaParagraphs | rules/formula-promotion.ts |
| 2300 | broken-inline-math | normalizeBrokenInlineMath | rules/broken-math.ts |

**验证**：同上。

#### 第 3 批：列表/表格/引用规则

| order | 规则 ID | 源函数 | 目标文件 |
|-------|---------|--------|---------|
| 300 | block-parser | runBlockParserStage | rules/block-parser.ts |
| 700 | split-run-on-items | splitRunOnNumberedItems | rules/list-splitting.ts |
| 900 | loose-pipe-tables | normalizeLoosePipeTables | rules/table-normalization.ts |
| 1500 | list-numbering | normalizeMarkdownLists | rules/list-numbering.ts |
| 1600 | figure-refs | normalizeFigureReferences | rules/figure-refs.ts |
| 1700 | table-refs | normalizeTableReferences | rules/table-refs.ts |
| 1701 | section-artifacts | stripSectionNumberArtifacts | rules/section-artifacts.ts |

注意：`list-numbering.ts` 需要额外 export `normalizeMarkdownLists`（被 block parser 直接使用）。

**验证**：同上。

#### 第 4 批：标题/结构规则（最复杂，依赖 heading-classifier）

| order | 规则 ID | 源函数 | 目标文件 |
|-------|---------|--------|---------|
| 800 | split-inline-heading | splitHeadingAndInlineNumberedSubitem | rules/heading-splitting.ts |
| 1000 | chinese-headings | normalizeChineseHeadings | rules/chinese-headings.ts |
| 1100 | related-concepts-body | normalizeRelatedConceptsBody | rules/related-concepts.ts |
| 1200 | heading-hierarchy | normalizeMarkdownHeadingHierarchy | rules/heading-hierarchy.ts |
| 1800 | section-scaffold | normalizeSectionScaffold | rules/section-scaffold.ts |
| 1900 | heading-sequence | normalizeNumberedHeadingSequence | rules/heading-sequence.ts |
| 2100 | conclusion-heading | normalizeConclusionHeading | rules/conclusion-heading.ts |

**验证**：同上。全部 29 个规则迁移完成。

### Step 4：替换原入口

1. 将 `normalize-answer-markdown-artifacts.ts` 改为兼容入口（见 3.6 节），委托 `runNormalizationPipeline`
2. 从 `normalize-rules/rules/list-numbering.ts` re-export `normalizeMarkdownLists`
3. 删除原文件中已迁移的所有内部函数（仅保留兼容入口 + 类型导出）

**验证**：build 通过，集成测试通过。

### Step 5：更新调用方

1. 更新 `markdown-normalization-pipeline.ts` 直接调用 `runNormalizationPipeline`（可选，兼容入口已工作）
2. 检查所有 import 路径，确保无断裂

**验证**：build 通过。

### Step 6：后端去重（最后执行）

前端规则全部迁移并验证通过后，再处理后端重叠逻辑：

| # | 处理项 | 操作 |
|---|--------|------|
| 1 | think 标签 | 前端 `strip-think-tags` 规则注释说明"后端主处理，此处为 streaming 兜底" |
| 2 | 数学 delimiter | 前端 `math-delimiters` 规则注释说明"后端主处理，此处为 streaming 兜底" |
| 3 | 图片 math 解包 | 前端 `image-math-unwrap` 同上 |
| 4 | RAG URL 修复 | 前端 `rag-image-fix` 同上 |
| 5 | 不可渲染图片 | 前端 `strip-unrenderable-images` 同上 |
| 6 | h1→h2 | 从后端 `sanitize_answer` 中移除 h1 demote 逻辑（前端 `heading-hierarchy` 已覆盖） |
| 7 | 相关概念 body | 从后端 `sanitize_answer` 中移除 `_normalize_related_concepts_body`（前端已覆盖） |
| 8 | 列表前空行 | 从后端 `sanitize_answer` 中移除 `_insert_blank_line_before_lists`（前端已覆盖） |

**注意**：后端的 `_ensure_related_concepts_section()`（确保"相关概念"section 存在）保留，前端没有对应逻辑。

**验证**：后端启动正常，实际问答效果无回归（人工验证）。

### Step 7：清理 + 文档

- 确认原文件只剩兼容入口
- 更新本计划文档，标记完成
- 更新 CLAUDE.md（如有必要）

## 5. 共享依赖（不迁移，保持原位）

以下模块被规则引用但不属于规则本身，保持原位不动：

| 模块 | 位置 | 被谁使用 |
|------|------|---------|
| `parseMarkdownBlocks` | `features/qa/formatting/markdown-block-parser.ts` | block-parser, loose-pipe-tables, list-numbering |
| `classifyHeadingCandidate` | `features/qa/formatting/heading-classifier.ts` | chinese-headings, heading-hierarchy |
| `splitInlineHeadingAndBody` | `features/qa/formatting/heading-classifier.ts` | heading-splitting |

以下工具函数从原文件迁移到 `normalize-rules/utils.ts`：

| 函数/类型 | 被谁使用 |
|-----------|---------|
| `transformUnprotected` + `PROTECTED_REGION_RE` | text-cleanup, image-cleanup 等 |
| `transformOutsideCodeAndDollarMath` + `CODE_OR_DOLLAR_MATH_RE` | broken-math, formula-promotion |
| `INLINE_OR_FENCED_CODE_RE` | 部分规则 |
| `NormalizationDiagnostics` 相关类型和函数 | 所有规则 |

## 6. 风险与缓解

| 风险 | 缓解措施 |
|------|---------|
| 迁移过程中引入回归 | Step 1 先锁基线测试；每批迁移后跑 build + 集成测试 |
| 引擎骨架设计有缺陷 | 第 1 批先迁移最简单的规则，尽早暴露问题 |
| 规则执行顺序变化导致输出不同 | order 值严格对应原管线顺序；集成测试用真实样本验证 |
| 后端去重后 streaming 阶段缺少处理 | 前端规则标记为"streaming 兜底"，不删除，只加注释 |
| `answer_replaced` 未触发时前端缺少后处理 | 前端规则在所有阶段都执行兜底逻辑（重叠项不删除，只降低优先级） |
| 原文件被其他模块直接 import 内部函数 | 兼容入口保留所有公开导出；检查所有 import 路径 |
| 后端去重后回滚困难 | 后端去重放在最后一步（Step 6），前端全部验证通过后再动 |

## 7. 验收标准

- [ ] 集成测试基线锁定（Step 1）
- [ ] `frontend/lib/normalize-rules/` 目录包含所有 29 个规则
- [ ] `PHASE_MATRIX` 覆盖所有规则 ID（两阶段：streaming / final）
- [ ] 原 `normalizeAnswerMarkdownArtifacts` 作为兼容入口，内部委托新引擎
- [ ] `normalizeMarkdownLists` 从新位置 re-export，外部 import 不断裂
- [ ] `npm run build` 通过
- [ ] 每个规则模块至少 2 个单元测试用例
- [ ] 集成测试覆盖 streaming + final 两个阶段，无回归
- [ ] 后端 `sanitize_answer` 中移除 3 处重叠逻辑（h1 demote、related concepts body、list blank lines）
- [ ] 后端 build/启动正常
- [ ] 实际问答效果无回归（人工验证）
