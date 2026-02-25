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
  { params }: { params: Promise<{ docId: string }> }
) {
  const { docId } = await params;
  if (!docId) {
    return new Response("Missing docId", { status: 400 });
  }

  const url = new URL(req.url);
  const ref = url.searchParams.get("ref");
  if (!ref) {
    return new Response("Missing ref", { status: 400 });
  }

  const upstreamUrl = `${qaBaseUrl()}/rag/documents/${encodeURIComponent(docId)}/image?ref=${encodeURIComponent(ref)}`;

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
