export const runtime = "nodejs";

const normalizeBase = (value: string) => value.replace(/\/$/, "");

function qaBaseUrl(): string {
  return normalizeBase(
    process.env.HDMS_QA_BASE_URL ||
      process.env.NEXT_PUBLIC_HDMS_QA_BASE ||
      process.env.NEXT_PUBLIC_HDMS_QA_API_BASE ||
      "http://localhost:8002"
  );
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ chunkId: string }> }
) {
  const { chunkId } = await params;
  if (!chunkId) {
    return new Response("Missing chunkId", { status: 400 });
  }

  const url = new URL(req.url);
  const upstreamParams = new URLSearchParams();
  const query = url.searchParams.get("q");
  const resolvePage = url.searchParams.get("resolve_page");
  if (query) upstreamParams.set("q", query);
  if (resolvePage) upstreamParams.set("resolve_page", resolvePage);
  const qParam = upstreamParams.toString() ? `?${upstreamParams.toString()}` : "";
  const upstreamUrl = `${qaBaseUrl()}/rag/sources/${encodeURIComponent(chunkId)}${qParam}`;

  try {
    const upstream = await fetch(upstreamUrl, { cache: "no-store" });
    const headers = new Headers(upstream.headers);
    headers.set("Cache-Control", "no-store");

    return new Response(upstream.body, {
      status: upstream.status,
      headers,
    });
  } catch {
    return new Response(JSON.stringify({ error: "upstream unreachable" }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
}
