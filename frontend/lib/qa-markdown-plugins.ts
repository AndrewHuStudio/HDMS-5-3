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
