export const runtime = "nodejs";

const APPROVAL_PORTS = [8004, 8024];
const APPROVAL_PROXY_TIMEOUT_MS = (() => {
  const parsed = Number.parseInt(process.env.APPROVAL_PROXY_TIMEOUT_MS || "45000", 10);
  if (Number.isNaN(parsed)) return 45000;
  return Math.min(120000, Math.max(5000, parsed));
})();

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function approvalBaseCandidates(): string[] {
  const candidates: string[] = [];
  const envBase =
    process.env.HDMS_APPROVAL_BASE_URL ||
    process.env.NEXT_PUBLIC_APPROVAL_CHECKLIST_BASE;

  if (envBase) {
    candidates.push(trimTrailingSlash(envBase));
  }

  for (const port of APPROVAL_PORTS) {
    candidates.push(`http://127.0.0.1:${port}`);
    candidates.push(`http://localhost:${port}`);
  }

  return Array.from(new Set(candidates.map(trimTrailingSlash)));
}

async function proxyApprovalRequest(
  req: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  if (!Array.isArray(path) || path.length === 0) {
    return new Response(JSON.stringify({ detail: "missing path" }), {
      status: 400,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const url = new URL(req.url);
  const upstreamPath = path.map(encodeURIComponent).join("/");
  const upstreamQuery = url.search || "";
  const method = req.method.toUpperCase();
  const hasRequestBody = method !== "GET" && method !== "HEAD";
  const requestBody = hasRequestBody ? await req.arrayBuffer() : undefined;
  const errors: string[] = [];

  for (const base of approvalBaseCandidates()) {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), APPROVAL_PROXY_TIMEOUT_MS);
    try {
      const upstream = await fetch(`${base}/${upstreamPath}${upstreamQuery}`, {
        method,
        headers: {
          "Content-Type": req.headers.get("Content-Type") || "application/json; charset=utf-8",
        },
        body: requestBody,
        cache: "no-store",
        signal: controller.signal,
      });

      if (upstream.status === 404) {
        errors.push(`${base}: HTTP 404`);
        continue;
      }

      const responseHeaders = new Headers(upstream.headers);
      responseHeaders.set("Cache-Control", "no-store");
      return new Response(upstream.body, {
        status: upstream.status,
        headers: responseHeaders,
      });
    } catch (error) {
      errors.push(`${base}: ${error instanceof Error ? error.message : "request failed"}`);
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  return new Response(
    JSON.stringify({
      detail: "approval service unavailable",
      errors,
    }),
    {
      status: 502,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    }
  );
}

export async function GET(
  req: Request,
  context: { params: Promise<{ path: string[] }> }
) {
  return proxyApprovalRequest(req, context);
}

export async function POST(
  req: Request,
  context: { params: Promise<{ path: string[] }> }
) {
  return proxyApprovalRequest(req, context);
}
