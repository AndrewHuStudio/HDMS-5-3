import type { NextRequest } from "next/server";

const BACKEND_BASE =
  process.env.HDMS_QA_BASE_URL ||
  process.env.NEXT_PUBLIC_HDMS_QA_BASE ||
  process.env.NEXT_PUBLIC_HDMS_QA_API_BASE ||
  "http://localhost:8000";

const normalizeBase = (value: string) => value.replace(/\/$/, "");

export async function POST(request: NextRequest) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return new Response(JSON.stringify({ detail: "Invalid JSON payload." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const backendUrl = `${normalizeBase(BACKEND_BASE)}/qa/chat/stream`;

  try {
    const response = await fetch(backendUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text();
      return new Response(text, {
        status: response.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Pipe the SSE stream through with zero buffering
    return new Response(response.body, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch {
    return new Response(JSON.stringify({ detail: "Backend unavailable." }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
}
