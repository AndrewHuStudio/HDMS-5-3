/**
 * 规则：image-math-unwrap, strip-unrenderable-images
 *
 * 图片清理：
 * - image-math-unwrap: 从数学定界符中解包图片（$![...]$ → ![...]）
 * - strip-unrenderable-images: 剥离无法渲染的图片标记（无效 URL、缺少 ref 参数等）
 * 后端渲染已移除，现在由前端统一处理。
 */

import { registerRules } from "../registry";
import type { NormalizeContext } from "../types";
import { bumpCounter, INLINE_OR_FENCED_CODE_RE } from "../utils";
import { normalizeRagImageQueryUrl, RAG_IMAGE_ROUTE_RE } from "./rag-image-fix";

const INLINE_MATH_IMAGE_WRAPPER_RE =
  /(?<!\\)\$\s*(!\[[^\]\n]*\]\([^)\n]+\)|<img\b[^>]*>)\s*\$(?!\$)/gi;
const DISPLAY_MATH_IMAGE_WRAPPER_RE =
  /(?<!\\)\$\$\s*(!\[[^\]\n]*\]\([^)\n]+\)|<img\b[^>]*>)\s*\$\$/gi;
const HTML_IMAGE_SRC_RE = /(<img\b[^>]*\bsrc=)(['"])([^'"]+)\2/gi;

function parseMarkdownImageDestination(raw: string): string {
  let cleaned = String(raw || "").trim();
  if (!cleaned) return "";
  if (cleaned.startsWith("<") && cleaned.endsWith(">")) {
    cleaned = cleaned.slice(1, -1).trim();
  } else {
    const titleMatch = cleaned.match(/^(.*?)(?:\s+["'][^"']*["'])\s*$/);
    if (titleMatch?.[1]) cleaned = titleMatch[1].trim();
  }
  return cleaned.replace(/\\ /g, " ").replace(/\\\\/g, "\\").trim();
}

function isRenderableImageUrl(rawUrl: string): boolean {
  const url = String(rawUrl || "").trim();
  if (!url) return false;

  const normalized = normalizeRagImageQueryUrl(url);
  if (/^(?:https?:\/\/|data:)/i.test(normalized)) return true;
  if (!(normalized.startsWith("/rag/") || normalized.startsWith("/api/rag/"))) return false;

  try {
    const parsed = new URL(normalized, "http://localhost");
    if (!RAG_IMAGE_ROUTE_RE.test(parsed.pathname)) return true;
    return Boolean((parsed.searchParams.get("ref") || "").trim());
  } catch {
    return false;
  }
}

export const imageMathUnwrap = {
  id: "image-math-unwrap",
  order: 500,
  apply(text: string, _ctx: NormalizeContext): string {
    if (!text) return text;
    const segments = text.split(INLINE_OR_FENCED_CODE_RE);
    return segments
      .map((segment, index) => {
        if (index % 2 === 1) return segment;
        return segment
          .replace(DISPLAY_MATH_IMAGE_WRAPPER_RE, "$1")
          .replace(INLINE_MATH_IMAGE_WRAPPER_RE, "$1");
      })
      .join("");
  },
};

export const stripUnrenderableImages = {
  id: "strip-unrenderable-images",
  order: 501,
  apply(text: string, ctx: NormalizeContext): string {
    if (!text) return text;

    const segments = text.split(INLINE_OR_FENCED_CODE_RE);
    let removedCount = 0;
    const out = segments
      .map((segment, index) => {
        if (index % 2 === 1) return segment;

        let next = segment.replace(
          /!\[([^\]\n]*)\]\(([^)\n]+)\)/g,
          (_match, alt: string, rawUrl: string) => {
            const url = parseMarkdownImageDestination(rawUrl);
            if (isRenderableImageUrl(url)) {
              return `![${alt}](${normalizeRagImageQueryUrl(url)})`;
            }
            removedCount += 1;
            return "";
          },
        );

        next = next.replace(HTML_IMAGE_SRC_RE, (_match, prefix: string, quote: string, rawUrl: string) => {
          const url = String(rawUrl || "").trim();
          if (!isRenderableImageUrl(url)) {
            removedCount += 1;
            return "";
          }
          return `${prefix}${quote}${normalizeRagImageQueryUrl(url)}${quote}`;
        });

        return next;
      })
      .join("");

    if (removedCount > 0) {
      bumpCounter(ctx.diagnostics, "strip-unrenderable-image-tokens", removedCount);
    }

    return out;
  },
};

registerRules(imageMathUnwrap, stripUnrenderableImages);
