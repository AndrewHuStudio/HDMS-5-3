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

  const upstreamUrl = `${qaBaseUrl()}/rag/documents/${encodeURIComponent(docId)}/pdf`;
  const range = req.headers.get("range");

  const upstream = await fetch(upstreamUrl, {
    headers: range ? { range } : undefined,
    cache: "no-store",
  });

  // Pass through PDF bytes and important headers (including 206/Content-Range for PDF.js range loading).
  const headers = new Headers(upstream.headers);
  headers.set("Cache-Control", "no-store");

  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  });
}
