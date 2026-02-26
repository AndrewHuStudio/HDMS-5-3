import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_WINDOW = (globalThis as { window?: unknown }).window;
const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_API_BASE = process.env.NEXT_PUBLIC_HDMS_API_BASE;
const ORIGINAL_API_PORTS = process.env.NEXT_PUBLIC_HDMS_API_PORT_CANDIDATES;

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();

  if (ORIGINAL_WINDOW === undefined) {
    delete (globalThis as { window?: unknown }).window;
  } else {
    (globalThis as { window?: unknown }).window = ORIGINAL_WINDOW;
  }

  if (ORIGINAL_FETCH === undefined) {
    delete (globalThis as { fetch?: typeof fetch }).fetch;
  } else {
    globalThis.fetch = ORIGINAL_FETCH;
  }

  if (ORIGINAL_API_BASE === undefined) {
    delete process.env.NEXT_PUBLIC_HDMS_API_BASE;
  } else {
    process.env.NEXT_PUBLIC_HDMS_API_BASE = ORIGINAL_API_BASE;
  }

  if (ORIGINAL_API_PORTS === undefined) {
    delete process.env.NEXT_PUBLIC_HDMS_API_PORT_CANDIDATES;
  } else {
    process.env.NEXT_PUBLIC_HDMS_API_PORT_CANDIDATES = ORIGINAL_API_PORTS;
  }
});

describe("resolveApiBase", () => {
  it("falls back to localhost probe when app is opened via LAN IP", async () => {
    process.env.NEXT_PUBLIC_HDMS_API_BASE = "http://localhost:8003";
    process.env.NEXT_PUBLIC_HDMS_API_PORT_CANDIDATES = "8003";

    (globalThis as { window?: unknown }).window = {
      location: {
        hostname: "192.168.2.7",
        origin: "http://192.168.2.7:3000",
        protocol: "http:",
      },
    };

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "http://localhost:8003/health") {
        return new Response(null, { status: 200 });
      }
      return new Response(null, { status: 503 });
    });

    globalThis.fetch = fetchMock as typeof fetch;

    const { resolveApiBase } = await import("./api-base");

    const resolved = await resolveApiBase({ forceRefresh: true });

    expect(fetchMock).toHaveBeenCalled();
    expect(resolved).toBe("http://localhost:8003");
  });
});
