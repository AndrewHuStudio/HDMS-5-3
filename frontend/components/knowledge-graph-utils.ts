import type { GraphViewNode } from "./knowledge-graph-filter";

export interface GraphLinkLike {
  source: unknown;
  target: unknown;
  type?: string;
}

export interface RelatedNodeItem {
  id: string;
  neighborId: string;
  type: string;
  name: string;
  neighborType: string;
  label: string;
  fromName: string;
  fromLabel: string;
  toName: string;
  toLabel: string;
}

interface BuildRelatedNodesArgs {
  selectedNodeId: string | null;
  selectedNode: GraphViewNode | null;
  links: GraphLinkLike[];
  nodeMap: Map<string, GraphViewNode>;
  relTypeLabels: Record<string, string>;
  nodeTypeLabels: Record<string, string>;
}

interface NodeLabelVisibilityArgs {
  isSelected: boolean;
  isHovered: boolean;
  degree: number;
  globalScale: number;
}

interface LayoutTuningArgs {
  nodeCount: number;
  isDark: boolean;
}

interface LayoutTuningResult {
  chargeStrength: number;
  linkDistance: number;
  collidePadding: number;
  gravityStrength: number;
  minLinkStrength: number;
  linkStrengthScale: number;
  inactiveLinkColor: string;
  activeLinkColor: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function computeLayoutTuning({
  nodeCount,
  isDark,
}: LayoutTuningArgs): LayoutTuningResult {
  const safeCount = Math.max(1, nodeCount);
  const normalized = clamp((safeCount - 120) / (1312 - 120), 0, 1);
  const eased = Math.pow(normalized, 0.65);

  return {
    // Small graphs spread out a bit more; large graphs stay more cohesive.
    chargeStrength: -1 * (340 - 190 * eased),
    linkDistance: 132 - 62 * eased,
    collidePadding: 6 - 3.2 * eased,
    gravityStrength: 0.018 + 0.032 * eased,
    minLinkStrength: 0.045 + 0.06 * eased,
    linkStrengthScale: 1.05 - 0.18 * eased,
    inactiveLinkColor: isDark ? "rgba(148,163,184,0.12)" : "rgba(100,116,139,0.10)",
    activeLinkColor: isDark ? "rgba(148,163,184,0.50)" : "rgba(71,85,105,0.40)",
  };
}

export function getLinkNodeId(nodeRef: unknown): string | null {
  if (typeof nodeRef === "string") return nodeRef;
  if (nodeRef && typeof nodeRef === "object" && "id" in nodeRef) {
    const id = (nodeRef as { id?: unknown }).id;
    return typeof id === "string" ? id : null;
  }
  return null;
}

export function buildRelatedNodes({
  selectedNodeId,
  selectedNode,
  links,
  nodeMap,
  relTypeLabels,
  nodeTypeLabels,
}: BuildRelatedNodesArgs): RelatedNodeItem[] {
  if (!selectedNodeId || links.length === 0) return [];

  const currentNodeName = selectedNode?.name || selectedNodeId;
  const currentNodeLabel = nodeTypeLabels[selectedNode?.label || ""] || selectedNode?.label || "未知";

  const related: RelatedNodeItem[] = [];
  for (const edge of links) {
    const sourceId = getLinkNodeId(edge.source);
    const targetId = getLinkNodeId(edge.target);
    if (!sourceId || !targetId) continue;
    if (sourceId !== selectedNodeId && targetId !== selectedNodeId) continue;

    const isOutgoing = sourceId === selectedNodeId;
    const neighborId = isOutgoing ? targetId : sourceId;
    const neighbor = nodeMap.get(neighborId);
    const neighborName = neighbor?.name || neighborId;
    const neighborLabel = nodeTypeLabels[neighbor?.label || ""] || neighbor?.label || "未知";
    const typeText = relTypeLabels[edge.type || ""] || edge.type || "-";

    related.push({
      id: `${sourceId}-${targetId}-${edge.type || "-"}`,
      neighborId,
      type: typeText,
      name: neighborName,
      neighborType: neighbor?.label || "",
      label: neighborLabel,
      fromName: isOutgoing ? currentNodeName : neighborName,
      fromLabel: isOutgoing ? currentNodeLabel : neighborLabel,
      toName: isOutgoing ? neighborName : currentNodeName,
      toLabel: isOutgoing ? neighborLabel : currentNodeLabel,
    });
  }

  return related;
}

export function shouldShowNodeLabel(_args: NodeLabelVisibilityArgs): boolean {
  return true;
}
