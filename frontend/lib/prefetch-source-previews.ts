type SourceLike = {
  chunk_id?: string;
  chunk_ids?: string[];
};

function getCacheKey(source: SourceLike): string | null {
  const chunkIds = source.chunk_ids?.filter(Boolean) ?? [];
  if (chunkIds.length > 0) return [...chunkIds].sort().join("|");
  if (source.chunk_id) return source.chunk_id;
  return null;
}

type PrefetchSourcePreviewsArgs = {
  sources: SourceLike[];
  query?: string;
  limit?: number;
  /** @deprecated No longer used — requests go through same-origin proxy. Kept for API compat. */
  qaApiBase?: string;
  fetchFn?: typeof fetch;
  onPreview: (cacheKey: string, preview: unknown) => void;
};

export async function prefetchSourcePreviews(args: PrefetchSourcePreviewsArgs): Promise<void> {
  const {
    sources,
    query,
    limit = 12,
    fetchFn = fetch,
    onPreview,
  } = args;

  const qParam = query ? `?q=${encodeURIComponent(query)}` : "";
  const targets = sources
    .map((source) => {
      const cacheKey = getCacheKey(source);
      const chunkId = source.chunk_ids?.[0] ?? source.chunk_id;
      if (!cacheKey || !chunkId) return null;
      return { chunkId, cacheKey };
    })
    .filter((item): item is { chunkId: string; cacheKey: string } => Boolean(item))
    .slice(0, limit);

  await Promise.all(
    targets.map(async ({ chunkId, cacheKey }) => {
      try {
        const res = await fetchFn(`/api/rag/sources/${encodeURIComponent(chunkId)}${qParam}`);
        if (!res.ok) return;
        const preview = await res.json();
        onPreview(cacheKey, preview);
      } catch {
        // Background prefetch should stay silent on network/API failures.
      }
    })
  );
}
