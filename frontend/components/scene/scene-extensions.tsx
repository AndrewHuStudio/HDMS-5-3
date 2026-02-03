"use client";

import { toolRegistry } from "@/lib/registries/tool-registry";

export function SceneExtensions() {
  const tools = toolRegistry.getAll();
  return (
    <>
      {tools.map((tool) => {
        const Layer = tool.SceneLayer;
        if (!Layer) return null;
        return <Layer key={tool.id} />;
      })}
    </>
  );
}

export function SceneOverlays() {
  const tools = toolRegistry.getAll();
  return (
    <>
      {tools.map((tool) => {
        const Overlay = tool.Overlay;
        if (!Overlay) return null;
        return <Overlay key={tool.id} />;
      })}
    </>
  );
}
