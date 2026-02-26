/**
 * 规则：numeric-range-delimiters
 *
 * 规范化用作数值范围分隔符的 "~~"（如 "50~~100"）为单个 "~"，
 * 同时保留真正的 Markdown 删除线和代码块。
 */

import { registerRules } from "../registry";
import type { NormalizeContext } from "../types";
import { transformUnprotected } from "../utils";

const RANGE_VALUE_RE = String.raw`(?:[<>]=?|[≥≤])?\s*\d+(?:\.\d+)*(?:[%％])?`;
const BROKEN_NUMERIC_RANGE_RE = new RegExp(
  `(${RANGE_VALUE_RE})\\s*~~\\s*(${RANGE_VALUE_RE})(?:\\s*~~)?`,
  "g",
);

export const numericRangeDelimiters = {
  id: "numeric-range-delimiters",
  order: 2200,
  apply(text: string, _ctx: NormalizeContext): string {
    return transformUnprotected(text, (seg) =>
      seg.replace(BROKEN_NUMERIC_RANGE_RE, "$1~$2"),
    );
  },
};

registerRules(numericRangeDelimiters);
