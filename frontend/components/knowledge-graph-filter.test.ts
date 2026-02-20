import { describe, expect, it } from "vitest";

import { filterGraphWithHiddenTypes, type GraphViewData } from "./knowledge-graph-filter";

function makeData(): GraphViewData {
  return {
    nodes: [
      { id: "a", name: "A", label: "地块", degree: 1, val: 6 },
      { id: "h", name: "H", label: "空间要素", degree: 2, val: 6 },
      { id: "b", name: "B", label: "法规", degree: 1, val: 6 },
      { id: "c", name: "C", label: "片区", degree: 1, val: 6 },
    ],
    links: [
      { source: "a", target: "h", type: "LOCATED_IN" },
      { source: "h", target: "b", type: "APPLIES_TO" },
      { source: "a", target: "c", type: "PART_OF" },
    ],
  };
}

describe("filterGraphWithHiddenTypes", () => {
  it("keeps original links when no hidden types", () => {
    const raw = makeData();
    const out = filterGraphWithHiddenTypes(raw, new Set());

    expect(out.nodes).toHaveLength(4);
    expect(out.links).toHaveLength(3);
  });

  it("adds bridge link across hidden nodes to preserve connectivity", () => {
    const raw = makeData();
    const out = filterGraphWithHiddenTypes(raw, new Set(["空间要素"]));

    expect(out.nodes.map((n) => n.id).sort()).toEqual(["a", "b", "c"]);
    expect(out.links.some((l) => l.source === "a" && l.target === "b" && l.type === "HIDDEN_BRIDGE")).toBe(true);
  });

  it("does not duplicate an existing visible-visible edge", () => {
    const raw = makeData();
    raw.links.push({ source: "a", target: "b", type: "REFERENCES" });

    const out = filterGraphWithHiddenTypes(raw, new Set(["空间要素"]));
    const directAB = out.links.filter((l) => (l.source === "a" && l.target === "b") || (l.source === "b" && l.target === "a"));

    expect(directAB).toHaveLength(1);
    expect(directAB[0].type).toBe("REFERENCES");
  });

  it("preserves hidden-bridge connectivity even when links are force-graph mutated", () => {
    const raw = makeData();
    const mutated: GraphViewData = {
      nodes: raw.nodes,
      links: raw.links.map((link) => ({
        source: { id: link.source } as unknown as string,
        target: { id: link.target } as unknown as string,
        type: link.type,
      })),
    };

    const out = filterGraphWithHiddenTypes(mutated, new Set(["空间要素"]));

    expect(out.links).toHaveLength(2);
    expect(out.links.some((l) => l.source === "a" && l.target === "b" && l.type === "HIDDEN_BRIDGE")).toBe(true);
  });

  it("recomputes node degree after hiding types", () => {
    const raw = makeData();
    const out = filterGraphWithHiddenTypes(raw, new Set(["空间要素"]));

    const degreeById = new Map(out.nodes.map((node) => [node.id, node.degree]));
    expect(degreeById.get("a")).toBe(2);
    expect(degreeById.get("b")).toBe(1);
    expect(degreeById.get("c")).toBe(1);
  });
});
