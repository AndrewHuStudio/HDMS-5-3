"use client";

import { useState } from "react";
import "@/features";
import { Button } from "@/components/ui/button";
import { CityScene, type ImportedMeshInfo, type ViewMode } from "@/components/city-scene";
import { ViewControls } from "@/components/view-controls";
import { ModelUploader } from "@/components/model-uploader";
import { AppShell } from "@/components/app-shell";
import { ThemeToggle } from "@/components/theme-toggle";
import { QAView } from "@/features/qa";
import { useModelLoader } from "@/lib/hooks/use-model-loader";
import type { CityElement } from "@/lib/city-data";
import { AlertCircle } from "lucide-react";

export default function AssistantPage() {
  const [selectedElement, setSelectedElement] = useState<CityElement | null>(null);
  const [selectedImportedMesh, setSelectedImportedMesh] = useState<ImportedMeshInfo | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("perspective");

  const {
    externalModelUrl, externalModelType, externalModelName, modelError,
    setModelError, setModelBounds, setModelScale, setModelTransform, setModelBuildings,
    handleModelLoad, handleClearModel,
  } = useModelLoader();

  return (
    <AppShell>
      {/* 3D 场景主区域 */}
      <main className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
        <header className="h-12 border-b border-border bg-card flex items-center justify-between px-4 flex-shrink-0">
          <h2 className="font-medium">管控问答助手</h2>
          <div className="flex items-center gap-4">
            <ViewControls currentView={viewMode} onViewChange={setViewMode} />
            <div className="w-px h-6 bg-border" />
            <ModelUploader
              onModelLoad={handleModelLoad}
              currentModel={externalModelUrl}
              currentModelName={externalModelName}
              onClearModel={handleClearModel}
            />
            <ThemeToggle />
          </div>
        </header>

        <div className="flex-1 min-h-0 relative isometric-grid overflow-hidden">
          <CityScene
            onSelectElement={(el) => { setSelectedElement(el); if (el) setSelectedImportedMesh(null); }}
            selectedElement={selectedElement}
            externalModelUrl={externalModelUrl}
            externalModelType={externalModelType}
            onModelError={setModelError}
            onImportedMeshSelect={(mesh) => { setSelectedImportedMesh(mesh); if (mesh) setSelectedElement(null); }}
            selectedImportedMesh={selectedImportedMesh}
            viewMode={viewMode}
            onModelBoundsComputed={(bounds) => {
              if (bounds) {
                setModelBounds({ min: [bounds.min.x, bounds.min.y, bounds.min.z], max: [bounds.max.x, bounds.max.y, bounds.max.z] });
              } else {
                setModelBounds(undefined);
              }
            }}
            onModelScaleComputed={(scale) => {
              if (Number.isFinite(scale) && scale > 0) setModelScale(scale);
              else setModelScale(1);
            }}
            onModelTransformComputed={setModelTransform}
            onBuildingsExtracted={setModelBuildings}
          />

          {modelError && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 border border-red-200 rounded-lg shadow-lg">
              <AlertCircle className="h-4 w-4" />
              <span className="text-sm">{modelError}</span>
              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs hover:bg-red-100" onClick={() => setModelError(null)}>关闭</Button>
            </div>
          )}
        </div>
      </main>

      {/* 右侧问答面板 */}
      <aside className="w-[400px] border-l border-border bg-card flex flex-col flex-shrink-0 min-h-0 overflow-hidden">
        <div className="flex-1 min-h-0 overflow-hidden">
          <QAView embedded />
        </div>
      </aside>
    </AppShell>
  );
}
