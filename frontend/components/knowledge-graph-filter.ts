export interface GraphViewNode {
  id: string;
  name: string;
  label: string;
  val: number;
  degree: number;
  x?: number;
  y?: number;
}

export interface GraphViewLink {
  source: string;
  target: string;
  type: string;
}

export interface GraphViewData {
  nodes: GraphViewNode[];
  links: GraphViewLink[];
}

const HIDDEN_BRIDGE_TYPE = "HIDDEN_BRIDGE";

function makePairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function readNodeId(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null) {
    const id = (value as { id?: unknown }).id;
    if (typeof id === "string") return id;
  }
  return null;
}

function withComputedDegree(nodes: GraphViewNode[], links: GraphViewLink[]): GraphViewData {
  const degreeById: Record<string, number> = {};

  for (const link of links) {
    degreeById[link.source] = (degreeById[link.source] || 0) + 1;
    degreeById[link.target] = (degreeById[link.target] || 0) + 1;
  }

  const nextNodes = nodes.map((node) => {
    const degree = degreeById[node.id] || 0;
    return {
      ...node,
      degree,
      val: Math.max(4, Math.min(14, degree * 1.5 + 4)),
    };
  });

  return { nodes: nextNodes, links };
}

export function filterGraphWithHiddenTypes(
  rawGraphData: GraphViewData,
  hiddenNodeTypes: Set<string>,
): GraphViewData {
  const normalizedNodes = rawGraphData.nodes.map((node) => ({ ...node }));
  const normalizedLinks: GraphViewLink[] = [];

  for (const link of rawGraphData.links) {
    const source = readNodeId(link.source);
    const target = readNodeId(link.target);
    if (!source || !target) continue;
    normalizedLinks.push({ source, target, type: link.type });
  }

  if (hiddenNodeTypes.size === 0) {
    return withComputedDegree(normalizedNodes, normalizedLinks);
  }

  const visibleNodes = normalizedNodes.filter((node) => !hiddenNodeTypes.has(node.label));
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));

  const visibleLinks = normalizedLinks.filter(
    (link) => visibleNodeIds.has(link.source) && visibleNodeIds.has(link.target),
  );

  const hiddenNodeIds = new Set(
    normalizedNodes
      .filter((node) => hiddenNodeTypes.has(node.label))
      .map((node) => node.id),
  );

  if (hiddenNodeIds.size === 0) {
    return withComputedDegree(visibleNodes, visibleLinks);
  }

  const adjacency = new Map<string, Set<string>>();
  for (const link of normalizedLinks) {
    if (!adjacency.has(link.source)) adjacency.set(link.source, new Set());
    if (!adjacency.has(link.target)) adjacency.set(link.target, new Set());
    adjacency.get(link.source)?.add(link.target);
    adjacency.get(link.target)?.add(link.source);
  }

  const existingVisiblePairs = new Set(visibleLinks.map((l) => makePairKey(l.source, l.target)));
  const visitedHidden = new Set<string>();
  const bridgeLinks: GraphViewLink[] = [];
  const maxBridgeLinks = 3000;

  for (const hiddenId of hiddenNodeIds) {
    if (visitedHidden.has(hiddenId)) continue;

    const queue: string[] = [hiddenId];
    visitedHidden.add(hiddenId);
    const boundaryVisible = new Set<string>();

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) continue;

      for (const next of adjacency.get(current) || []) {
        if (visibleNodeIds.has(next)) {
          boundaryVisible.add(next);
          continue;
        }
        if (!hiddenNodeIds.has(next) || visitedHidden.has(next)) {
          continue;
        }
        visitedHidden.add(next);
        queue.push(next);
      }
    }

    if (boundaryVisible.size < 2) {
      continue;
    }

    const boundary = Array.from(boundaryVisible).sort();
    const anchor = boundary[0];
    for (let i = 1; i < boundary.length; i += 1) {
      const target = boundary[i];
      const pairKey = makePairKey(anchor, target);
      if (existingVisiblePairs.has(pairKey)) {
        continue;
      }
      existingVisiblePairs.add(pairKey);
      bridgeLinks.push({ source: anchor, target, type: HIDDEN_BRIDGE_TYPE });
      if (bridgeLinks.length >= maxBridgeLinks) {
        break;
      }
    }

    if (bridgeLinks.length >= maxBridgeLinks) {
      break;
    }
  }

  return withComputedDegree(visibleNodes, [...visibleLinks, ...bridgeLinks]);
}
