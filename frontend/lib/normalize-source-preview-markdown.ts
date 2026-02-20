import { normalizeAnswerTables } from "./normalize-answer-tables";
import { normalizeChunkImages } from "./normalize-chunk-images";
import { normalizeChunkMarkdown } from "./normalize-chunk-markdown";

export type NormalizeSourcePreviewOptions = {
  docId?: string;
  qaApiBase?: string;
};

/**
 * Normalize backend chunk previews into deterministic markdown:
 * - Rewrite relative image refs to our image endpoint (docId-aware)
 * - Convert HTML <table> blocks to GFM markdown tables
 * - Strip leftover table fragments (to avoid hydration/DOM parser oddities)
 * - Normalize OCR heading hierarchy (PPT-like docs included)
 */
export function normalizeSourcePreviewMarkdown(
  text: string,
  options: NormalizeSourcePreviewOptions = {}
): string {
  if (!text) return text;

  const { docId, qaApiBase } = options;

  let processed = text;

  // Ensure /rag/* URLs are absolute when a base is provided (QA backend).
  if (qaApiBase) {
    processed = processed.replace(
      /!\[([^\]]*)\]\((\/rag\/[^)]+)\)/g,
      (_, alt, path) => `![${alt}](${qaApiBase}${path})`
    );
    processed = processed.replace(
      /(<img\b[^>]*\bsrc=)(["'])(\/rag\/[^"']+)\2/gi,
      (_all, prefix, quote, path) => `${prefix}${quote}${qaApiBase}${path}${quote}`
    );
  }

  // Rewrite local refs like `images/foo.png` to the backend image endpoint.
  processed = normalizeChunkImages(processed, { docId });

  // Convert well-formed HTML tables to markdown tables so rendering is stable.
  processed = normalizeAnswerTables(processed);

  // Drop HTML table fragments (broken OCR snippets) that can cause DOM parser reparenting.
  processed = processed.replace(
    /<\/?(table|thead|tbody|tfoot|tr|th|td|caption|colgroup|col)(\s[^>]*)?>/gi,
    ""
  );

  processed = normalizeChunkMarkdown(processed);

  return processed;
}
