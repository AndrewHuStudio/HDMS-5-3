import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/features/data-upload/graph-store", () => ({
  useGraphStore: (selector?: (state: any) => any) => {
    const state = {
      buildResult: null,
      setBuildResult: vi.fn(),
      statistics: null,
      setStatistics: vi.fn(),
      status: "idle",
      setStatus: vi.fn(),
      error: null,
      setError: vi.fn(),
      startTime: null,
      setStartTime: vi.fn(),
      showGraphDialog: true,
      setShowGraphDialog: vi.fn(),
      reset: vi.fn(),
    };
    return selector ? selector(state) : state;
  },
}));

vi.mock("@/components/knowledge-graph", () => ({
  KnowledgeGraph: ({ height }: { height?: number }) => (
    <div data-knowledge-graph="true" data-height={height == null ? "auto" : String(height)} />
  ),
}));

import { GraphUploadPanel } from "@/features/data-upload/graph-upload-panel";

describe("GraphUploadPanel graph dialog", () => {
  it("renders knowledge graph without a fixed height prop", () => {
    const html = renderToStaticMarkup(<GraphUploadPanel />);

    expect(html).toContain("data-knowledge-graph=\"true\"");
    expect(html).toContain("data-height=\"auto\"");
  });
});
