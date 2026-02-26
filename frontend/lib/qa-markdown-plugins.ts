/**
 * QA Markdown 插件配置
 *
 * 共享的 remark 插件列表，用于 QA 答案渲染：
 * - remarkGfm: GitHub Flavored Markdown（禁用 singleTilde 避免数值范围被误识别为删除线）
 * - remarkMath: 数学公式支持
 */
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { PluggableList } from "unified";

/**
 * Shared markdown plugin config for QA rendering.
 *
 * IMPORTANT:
 * `remark-gfm` defaults `singleTilde: true`, which turns `3.3~5.2` into
 * strikethrough in many cases. We disable that so numeric ranges render
 * predictably without accidental <del> spans.
 */
export const QA_REMARK_PLUGINS: PluggableList = [
  [remarkGfm, { singleTilde: false }],
  remarkMath,
];
