import { NextResponse } from "next/server";
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
    return NextResponse.json({ detail: "Invalid JSON payload." }, { status: 400 });
  }

  const backendUrl = `${normalizeBase(BACKEND_BASE)}/qa/chat`;

  try {
    const response = await fetch(backendUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const bodyText = await response.text();
    const contentType = response.headers.get("content-type") || "application/json";
    return new NextResponse(bodyText, {
      status: response.status,
      headers: {
        "Content-Type": contentType,
      },
    });
  } catch {
    return NextResponse.json({ detail: "Backend unavailable." }, { status: 502 });
  }
}
