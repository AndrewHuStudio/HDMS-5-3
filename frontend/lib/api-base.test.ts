import { describe, expect, it } from "vitest";

import {
  buildLocalProbeCandidates,
  computePreferredApiBase,
  normalizeApiBase,
} from "./api-base";

describe("computePreferredApiBase", () => {
  it("falls back to current origin when public host receives localhost config", () => {
    const resolved = computePreferredApiBase({
      configuredBase: "http://localhost:8003/",
      runtime: {
        isBrowser: true,
        hostname: "hdmsurban.com",
        origin: "https://hdmsurban.com",
      },
      fallbackPort: 8003,
    });

    expect(resolved).toBe("https://hdmsurban.com");
  });

  it("keeps configured public base on public host", () => {
    const resolved = computePreferredApiBase({
      configuredBase: "https://api.example.com/",
      runtime: {
        isBrowser: true,
        hostname: "hdmsurban.com",
        origin: "https://hdmsurban.com",
      },
      fallbackPort: 8003,
    });

    expect(resolved).toBe("https://api.example.com");
  });
});

describe("buildLocalProbeCandidates", () => {
  it("builds de-duplicated localhost probe list", () => {
    const candidates = buildLocalProbeCandidates({
      configuredBase: "http://localhost:8003",
      runtime: {
        isBrowser: true,
        hostname: "localhost",
        origin: "http://localhost:3000",
      },
      ports: [8003, 8023],
    });

    expect(candidates).toEqual([
      "http://localhost:8003",
      "http://localhost:3000",
      "http://localhost:8023",
      "http://127.0.0.1:8003",
      "http://127.0.0.1:8023",
    ]);
  });

  it("normalizes trailing slash", () => {
    expect(normalizeApiBase("http://localhost:8003/")).toBe("http://localhost:8003");
  });
});
