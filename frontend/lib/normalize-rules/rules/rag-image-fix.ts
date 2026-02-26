/**
 * 规则：rag-image-fix
 *
 * 修复已知的畸形 RAG 图片 URL（如 "?$ref=images$/..."），
 * 使 Markdown 图片节点在服务端最终化后仍可渲染。
 * 后端渲染已移除，现在由前端统一处理。
 */

import { registerRules } from "../registry";
import type { NormalizeContext } from "../types";

const RAG_IMAGE_ROUTE_RE = /^\/(?:api\/)?rag\/documents\/[^/?#]+\/image$/i;

function normalizeRagImageQueryUrl(rawUrl: string): string {
  let url = String(rawUrl || "").trim();
  if (!url) return rawUrl;

  const wrappedInAngles = url.startsWith("<") && url.endsWith(">");
  if (wrappedInAngles) url = url.slice(1, -1).trim();

  const hashIndex = url.indexOf("#");
  const hash = hashIndex >= 0 ? url.slice(hashIndex) : "";
  const withoutHash = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
  const queryIndex = withoutHash.indexOf("?");
  if (queryIndex < 0) return rawUrl;

  const path = withoutHash.slice(0, queryIndex);
  const query = withoutHash.slice(queryIndex + 1);
  if (!RAG_IMAGE_ROUTE_RE.test(path) || !query) return rawUrl;

  let changed = false;
  const normalizedQuery = query
    .split("&")
    .map((part) => {
      if (!part) return part;
      const eqIndex = part.indexOf("=");
      const rawKey = eqIndex >= 0 ? part.slice(0, eqIndex) : part;
      let value = eqIndex >= 0 ? part.slice(eqIndex + 1) : "";
      let key = rawKey;

      if (key === "$ref") {
        key = "ref";
        changed = true;
      }

      if (key === "ref") {
        const cleanedValue = value.replace(/\$/g, "");
        if (cleanedValue !== value) {
          value = cleanedValue;
          changed = true;
        }
      }

      if (eqIndex < 0) return key;
      return `${key}=${value}`;
    })
    .join("&");

  if (!changed) return rawUrl;

  const rebuilt = `${path}?${normalizedQuery}${hash}`;
  return wrappedInAngles ? `<${rebuilt}>` : rebuilt;
}

function normalizeBrokenRagImageRefs(text: string): string {
  if (!text) return text;

  const normalizeUrl = (value: string): string => normalizeRagImageQueryUrl(value);

  let out = text.replace(
    /!\[([^\]\n]*)\]\(([^)\n]+)\)/g,
    (_match, alt: string, rawUrl: string) => `![${alt}](${normalizeUrl(rawUrl)})`,
  );

  out = out.replace(
    /(<img\b[^>]*\bsrc=)(['"])([^'"]+)\2/gi,
    (_match, prefix: string, quote: string, rawUrl: string) =>
      `${prefix}${quote}${normalizeUrl(rawUrl)}${quote}`,
  );

  out = out.replace(
    /\/(?:api\/)?rag\/documents\/[^/?#\s)]+\/image\?[^\s)]+/g,
    (rawUrl) => normalizeUrl(rawUrl),
  );

  return out;
}

export const ragImageFix = {
  id: "rag-image-fix",
  order: 200,
  apply(text: string, _ctx: NormalizeContext): string {
    return normalizeBrokenRagImageRefs(text);
  },
};

// Re-export for use by image-cleanup rule
export { normalizeRagImageQueryUrl, RAG_IMAGE_ROUTE_RE };

registerRules(ragImageFix);
