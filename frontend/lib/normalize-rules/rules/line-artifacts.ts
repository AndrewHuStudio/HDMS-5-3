/**
 * Rules: strip-horizontal-rules, strip-strikethrough-markers
 *
 * Remove user-visible markdown artifacts that frequently leak from LLM output:
 * - standalone horizontal rules (`---`, `***`, `___`)
 * - accidental strikethrough wrappers (`~~text~~`)
 *
 * Keep protected regions (code/math/links/images) untouched.
 */

import { registerRules } from "../registry";
import type { NormalizeContext } from "../types";
import { transformUnprotected } from "../utils";

const HORIZONTAL_RULE_LINE_RE =
  /^[ \t]{0,3}(?:-{3,}|\*{3,}|_{3,}|(?:-\s+){2,}-?|(?:\*\s+){2,}\*?|(?:_\s+){2,}_?)\s*$/gm;
const STRIKETHROUGH_WRAPPER_RE = /~~([^~\n]{1,240})~~/g;

export const stripHorizontalRules = {
  id: "strip-horizontal-rules",
  order: 603,
  apply(text: string, _ctx: NormalizeContext): string {
    return transformUnprotected(text, (seg) =>
      seg
        .replace(HORIZONTAL_RULE_LINE_RE, "")
        .replace(/\n{3,}/g, "\n\n"),
    );
  },
};

export const stripStrikethroughMarkers = {
  id: "strip-strikethrough-markers",
  order: 604,
  apply(text: string, _ctx: NormalizeContext): string {
    return transformUnprotected(text, (seg) =>
      seg.replace(STRIKETHROUGH_WRAPPER_RE, "$1"),
    );
  },
};

registerRules(stripHorizontalRules, stripStrikethroughMarkers);
