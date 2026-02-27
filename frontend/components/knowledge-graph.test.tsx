import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { KnowledgeGraph } from "@/components/knowledge-graph";

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));

describe("KnowledgeGraph sizing", () => {
  it("fills parent height when no explicit height is provided", () => {
    const html = renderToStaticMarkup(<KnowledgeGraph subgraph={null} />);

    expect(html).toContain("height:100%");
    expect(html).not.toContain("height:300px");
  });
});
