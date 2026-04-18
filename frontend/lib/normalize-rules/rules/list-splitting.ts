/**
 * 规则：split-run-on-items, split-inline-heading
 *
 * split-run-on-items: 拆分连写的列表项（"1.xxx2.yyy3.zzz" → 独立行）
 * split-inline-heading: 拆分标题与正文混排的行（"### 标题|正文内容" → 独立的标题行和正文行）
 */

import {
  splitInlineHeadingAndBody,
} from "@/features/qa/formatting";
import { registerRules } from "../registry";
import type { NormalizeContext } from "../types";
import { bumpCounter, transformUnprotected } from "../utils";

function splitRunOnNumberedItems(text: string): string {
  return transformUnprotected(text, (seg) => {
    const lines = seg.split("\n");

    return lines
      .map((line) => {
        if (line.includes("|")) {
          return line.replace(/^([ \t]*\d{1,2}[.\uFF0E])(?=[^\s\d])/, "$1 ");
        }

        const normalized = line.replace(/^([ \t]*\d{1,2}[.\uFF0E])(?=[^\s\d])/, "$1 ");
        const markerRe = /\d{1,2}[.\uFF0E](?=\s*[^\s\d])/g;
        const matches = Array.from(normalized.matchAll(markerRe)).filter((m) => {
          const pos = m.index ?? 0;
          const marker = m[0] || "";
          const prevChar = pos > 0 ? normalized[pos - 1] : "";
          const tail = normalized.slice(pos + marker.length).trimStart();

          if (prevChar && /[A-Za-z0-9_./-]/.test(prevChar)) return false;
          if (/^(?:jpe?g|png|webp|gif|bmp|svg)\b/i.test(tail)) return false;

          return true;
        });
        if (matches.length <= 1) return normalized;

        let out = "";
        let last = 0;

        matches.forEach((m, idx) => {
          const pos = m.index ?? 0;
          const marker = m[0];

          out += normalized.slice(last, pos);
          if (idx > 0 && !out.endsWith("\n")) out += "\n";
          out += marker;
          if ((normalized[pos + marker.length] ?? "").trim()) out += " ";
          last = pos + marker.length;
        });

        out += normalized.slice(last);
        return out;
      })
      .join("\n");
  });
}

function splitHeadingAndInlineNumberedSubitem(text: string, ctx: NormalizeContext): string {
  return transformUnprotected(text, (seg) => {
    const lines = seg.split("\n");
    return lines
      .map((line) => {
        const nextLine = splitInlineHeadingAndBody(line);
        if (ctx.diagnostics.enabled && nextLine !== line) {
          bumpCounter(ctx.diagnostics, "split-inline-heading-body");
        }
        return nextLine;
      })
      .join("\n");
  });
}

export const splitRunOnItems = {
  id: "split-run-on-items",
  order: 700,
  apply(text: string, _ctx: NormalizeContext): string {
    return splitRunOnNumberedItems(text);
  },
};

export const splitInlineHeading = {
  id: "split-inline-heading",
  order: 800,
  apply(text: string, ctx: NormalizeContext): string {
    return splitHeadingAndInlineNumberedSubitem(text, ctx);
  },
};

registerRules(splitRunOnItems, splitInlineHeading);
