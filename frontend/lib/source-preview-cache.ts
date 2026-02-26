type SourcePreviewCacheKeyInput = {
  chunk_id?: string;
  chunk_ids?: string[];
};

export function getSourcePreviewCacheKey(source: SourcePreviewCacheKeyInput): string | null {
  const chunkIds = source.chunk_ids?.filter(Boolean) ?? [];
  if (chunkIds.length > 0) {
    return [...chunkIds].sort().join("|");
  }
  if (source.chunk_id) return source.chunk_id;
  return null;
}

