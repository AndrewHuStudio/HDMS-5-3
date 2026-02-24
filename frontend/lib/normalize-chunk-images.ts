type NormalizeChunkImagesOpts = {
  docId?: string | null;
};

function stripImageRef(ref: string): string {
  let cleaned = (ref || "").trim();
  if (!cleaned) return "";

  // Strip optional title: (path "title") / (path 'title')
  const titleMatch = cleaned.match(/^(.*?)(?:\s+["'][^"']*["'])\s*$/);
  if (titleMatch) cleaned = titleMatch[1];

  cleaned = cleaned.trim().replace(/^<|>$/g, "");
  cleaned = cleaned.split("#", 1)[0];
  cleaned = cleaned.split("?", 1)[0];
  return cleaned.trim();
}

function isRemoteUrl(url: string): boolean {
  return /^https?:\/\//i.test(url) || /^data:/i.test(url);
}

/**
 * Normalize chunk images so they can be served by the QA backend image endpoint.
 *
 * Many OCR markdown chunks include refs like `![...](images/foo.png)`.
 * In the app these are not reachable as static assets, so we rewrite them to:
 *   /rag/documents/{docId}/image?ref=...
 *
 * This function only rewrites local refs; http(s)/data URLs are preserved.
 */
export function normalizeChunkImages(text: string, opts: NormalizeChunkImagesOpts): string {
  if (!text) return text;
  const docId = (opts.docId || "").trim();
  if (!docId) return text;

  // Markdown images: ![alt](ref)
  let processed = text.replace(
    /!\[([^\]]*)\]\((?!https?:\/\/|data:)([^)]+)\)/g,
    (_all, alt, rawRef) => {
      const ref = stripImageRef(String(rawRef || ""));
      if (!ref || isRemoteUrl(ref) || ref.startsWith("/rag/")) {
        return `![${alt}](${ref || rawRef})`;
      }
      const encoded = encodeURIComponent(ref);
      return `![${alt}](/rag/documents/${docId}/image?ref=${encoded})`;
    }
  );

  // Raw HTML images: <img ... src="ref" ...>
  processed = processed.replace(
    /(<img\b[^>]*\bsrc=)(["'])([^"']+)\2/gi,
    (all, prefix, quote, rawRef) => {
      const ref = stripImageRef(String(rawRef || ""));
      if (!ref || isRemoteUrl(ref) || ref.startsWith("/rag/")) return all;
      const encoded = encodeURIComponent(ref);
      return `${prefix}${quote}/rag/documents/${docId}/image?ref=${encoded}${quote}`;
    }
  );

  return processed;
}

