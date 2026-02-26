// `pdfjs-dist` has a Node-only optional dependency on `canvas` that can break
// Turbopack builds when the dependency isn't installed. This shim makes the
// module resolvable without pulling native deps.

export type CanvasLike = unknown;

export function createCanvas(): CanvasLike {
  throw new Error("The 'canvas' package is not available in this environment");
}

export default { createCanvas };

