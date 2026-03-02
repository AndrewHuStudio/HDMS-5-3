"use client";

import * as THREE from "three";
import { PlanViewport } from "@/components/city-scene";
import { SightCorridorPanel } from "@/components/sight-corridor-panel";
import { useModelStore } from "@/lib/stores/model-store";
import { resolveApiBase } from "@/lib/api-base";
import { useSightCorridorStore } from "./store";
import { SIGHT_CORRIDOR_DISPLAY_ELEVATION } from "./constants";

export function SightCorridorPanelAdapter() {
  const modelFilePath = useModelStore((state) => state.modelFilePath);
  const modelFile = useModelStore((state) => state.externalModelFile);
  const externalModelUrl = useModelStore((state) => state.externalModelUrl);
  const externalModelType = useModelStore((state) => state.externalModelType);
  const modelBounds = useModelStore((state) => state.modelBounds);
  const modelTransform = useModelStore((state) => state.modelTransform);
  const setModelError = useModelStore((state) => state.setModelError);

  const collisionResult = useSightCorridorStore((state) => state.collisionResult);
  const showCorridorLayer = useSightCorridorStore((state) => state.showCorridorLayer);
  const showBlockingLabels = useSightCorridorStore((state) => state.showBlockingLabels);
  const selectedBlockedBuildingName = useSightCorridorStore(
    (state) => state.selectedBlockedBuildingName
  );
  const setCollisionResult = useSightCorridorStore((state) => state.setCollisionResult);
  const setShowCorridorLayer = useSightCorridorStore((state) => state.setShowCorridorLayer);
  const setShowBlockingLabels = useSightCorridorStore((state) => state.setShowBlockingLabels);
  const setSelectedBlockedBuildingName = useSightCorridorStore(
    (state) => state.setSelectedBlockedBuildingName
  );

  const handleCorridorCheckRequest = async () => {
    if (!modelFilePath) return;
    setCollisionResult(null);
    setShowCorridorLayer(true);
    try {
      const apiBase = await resolveApiBase();
      const checkUrl = `${apiBase}/sight-corridor/collision`;
      const response = await fetch(checkUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model_path: modelFilePath,
          corridor_layer: "限制_视线通廊",
          building_layer: "模型_建筑体块",
        }),
      });

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(`检测接口未找到: ${checkUrl}`);
        }
        throw new Error("视线通廊碰撞检测失败");
      }

      const data = await response.json();
      setCollisionResult(data);
    } catch (error) {
      console.error("[sight-corridor] collision check failed:", error);
    }
  };

  const handleCorridorCheckClear = () => {
    setCollisionResult(null);
    setShowCorridorLayer(false);
  };

  const viewportBounds = modelBounds
    ? new THREE.Box3(
        new THREE.Vector3(modelBounds.min[0], modelBounds.min[1], modelBounds.min[2]),
        new THREE.Vector3(modelBounds.max[0], modelBounds.max[1], modelBounds.max[2])
      )
    : null;

  const planViewport = (
    <PlanViewport
      modelBounds={viewportBounds}
      externalModelUrl={externalModelUrl}
      externalModelType={externalModelType}
      corridorCollisionResult={collisionResult}
      showSightCorridorLayer={showCorridorLayer}
      showBlockingLabels={showBlockingLabels}
      sightCorridorDisplayElevation={SIGHT_CORRIDOR_DISPLAY_ELEVATION}
      modelTransform={modelTransform}
      onModelError={setModelError}
      withCard={false}
      sceneUpAxis="z"
    />
  );

  return (
    <SightCorridorPanel
      modelFilePath={modelFilePath}
      modelFile={modelFile}
      corridorCollisionResult={collisionResult}
      corridorLayerVisible={showCorridorLayer}
      onCorridorCheckRequest={handleCorridorCheckRequest}
      onCorridorCheckClear={handleCorridorCheckClear}
      showBlockingLabels={showBlockingLabels}
      onShowBlockingLabelsChange={setShowBlockingLabels}
      selectedBlockedBuildingName={selectedBlockedBuildingName}
      onSelectedBlockedBuildingNameChange={setSelectedBlockedBuildingName}
      planViewportComponent={planViewport}
    />
  );
}
