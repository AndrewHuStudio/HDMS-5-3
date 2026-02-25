/**
 * Rule: numeric-range-delimiters
 *
 * Normalize "~~" used as a numeric range delimiter (e.g. "50~~100")
 * to single "~" while preserving real markdown strikethrough and code.
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
