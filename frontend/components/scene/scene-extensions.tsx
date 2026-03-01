"use client";

import { getToolsForActiveView } from "@/lib/registries/tool-registry";

interface SceneExtensionsProps {
  activeViewId: string;
}

export function SceneExtensions({ activeViewId }: SceneExtensionsProps) {
  const tools = getToolsForActiveView(activeViewId);
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

export function SceneOverlays({ activeViewId }: SceneExtensionsProps) {
  const tools = getToolsForActiveView(activeViewId);
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
