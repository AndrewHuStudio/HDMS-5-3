import type { SourceInfo } from "@/features/qa/types";

export type SourcePreviewMeta = {
  section_title?: string;
  page_hint?: number;
  page_end_hint?: number;
  has_image?: boolean;
};

function formatPageLabel(page?: number, pageEnd?: number): string | null {
  if (typeof page !== "number" || page <= 0) return null;
  if (typeof pageEnd === "number" && pageEnd > page) return `第 ${page}-${pageEnd} 页`;
  return `第 ${page} 页`;
}

export function deriveSourceMeta(source: SourceInfo, preview: SourcePreviewMeta | null) {
  const title = (source.section || preview?.section_title || "").trim() || null;
  const page = source.page ?? preview?.page_hint;
  const pageEnd = source.page_end ?? preview?.page_end_hint;
  const pageLabel = formatPageLabel(page, pageEnd);

  const hasImage = Boolean(
    source.image_url ||
      (Array.isArray(source.image_urls) && source.image_urls.length > 0) ||
      preview?.has_image
  );

  return { title, page, pageEnd, pageLabel, hasImage };
}

