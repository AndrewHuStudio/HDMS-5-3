import { describe, expect, it } from "vitest";

import {
  buildRelatedNodes,
  computeLayoutTuning,
  shouldShowNodeLabel,
} from "./knowledge-graph-utils";
import type { GraphViewNode } from "./knowledge-graph-filter";

const NODE_TYPE_LABELS: Record<string, string> = {
  空间要素: "空间要素",
  地块: "地块",
};

const REL_TYPE_LABELS: Record<string, string> = {
  PART_OF: "属于",
};

describe("buildRelatedNodes", () => {
  it("returns neighbors when force-graph mutates link refs to objects", () => {
    const selectedNode: GraphViewNode = {
      id: "tower",
      name: "塔楼",
      label: "空间要素",
      degree: 1,
      val: 6,
    };
    const parcelNode: GraphViewNode = {
      id: "parcel",
      name: "本地块",
      label: "地块",
      degree: 1,
      val: 6,
    };
    const nodeMap = new Map<string, GraphViewNode>([
      [selectedNode.id, selectedNode],
      [parcelNode.id, parcelNode],
    ]);

    const related = buildRelatedNodes({
      selectedNodeId: selectedNode.id,
      selectedNode,
      links: [
        {
          source: { id: selectedNode.id },
          target: { id: parcelNode.id },
          type: "PART_OF",
        },
      ],
      nodeMap,
      nodeTypeLabels: NODE_TYPE_LABELS,
      relTypeLabels: REL_TYPE_LABELS,
    });

    expect(related).toHaveLength(1);
    expect(related[0]?.neighborId).toBe(parcelNode.id);
    expect(related[0]?.type).toBe("属于");
    expect(related[0]?.toName).toBe(parcelNode.name);
  });
});

describe("shouldShowNodeLabel", () => {
  it("keeps labels visible even at tiny zoom", () => {
    expect(
      shouldShowNodeLabel({
        isSelected: false,
        isHovered: false,
        degree: 0,
        globalScale: 0.2,
      }),
    ).toBe(true);
  });
});

describe("computeLayoutTuning", () => {
  it("keeps large graphs more cohesive and small graphs more relaxed", () => {
    const small = computeLayoutTuning({ nodeCount: 120, isDark: false });
    const large = computeLayoutTuning({ nodeCount: 1312, isDark: false });

    expect(small.linkDistance).toBeGreaterThan(large.linkDistance);
    expect(Math.abs(small.chargeStrength)).toBeGreaterThan(Math.abs(large.chargeStrength));
    expect(large.gravityStrength).toBeGreaterThan(small.gravityStrength);
    expect(large.minLinkStrength).toBeGreaterThan(small.minLinkStrength);
  });
});
