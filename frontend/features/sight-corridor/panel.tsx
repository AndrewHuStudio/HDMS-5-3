"use client";

import * as THREE from "three";
import { PlanViewport } from "@/components/city-scene";
import { SightCorridorPanel } from "@/components/sight-corridor-panel";
import { useModelStore } from "@/lib/stores/model-store";
import { API_BASE, normalizeApiBase } from "@/lib/api-base";
import { useSightCorridorStore } from "./store";

export function SightCorridorPanelAdapter() {
  const apiBase = normalizeApiBase(API_BASE);

  const modelFilePath = useModelStore((state) => state.modelFilePath);
  const modelFile = useModelStore((state) => state.externalModelFile);
  const setModelFilePath = useModelStore((state) => state.setModelFilePath);
  const externalModelUrl = useModelStore((state) => state.externalModelUrl);
  const externalModelType = useModelStore((state) => state.externalModelType);
  const modelBounds = useModelStore((state) => state.modelBounds);
  const modelScale = useModelStore((state) => state.modelScale);
  const modelTransform = useModelStore((state) => state.modelTransform);
  const modelBuildings = useModelStore((state) => state.modelBuildings);
  const setModelError = useModelStore((state) => state.setModelError);

  const position = useSightCorridorStore((state) => state.position);
  const radius = useSightCorridorStore((state) => state.radius);
  const result = useSightCorridorStore((state) => state.result);
  const collisionResult = useSightCorridorStore((state) => state.collisionResult);
  const showCorridorLayer = useSightCorridorStore((state) => state.showCorridorLayer);
  const showLabels = useSightCorridorStore((state) => state.showLabels);
  const showBlockingLabels = useSightCorridorStore((state) => state.showBlockingLabels);
  const setPosition = useSightCorridorStore((state) => state.setPosition);
  const setRadius = useSightCorridorStore((state) => state.setRadius);
  const setResult = useSightCorridorStore((state) => state.setResult);
  const setCollisionResult = useSightCorridorStore((state) => state.setCollisionResult);
  const setShowCorridorLayer = useSightCorridorStore((state) => state.setShowCorridorLayer);
  const setShowLabels = useSightCorridorStore((state) => state.setShowLabels);
  const setShowBlockingLabels = useSightCorridorStore((state) => state.setShowBlockingLabels);

  const handleCorridorCheckRequest = async () => {
    if (!modelFilePath) return;
    setCollisionResult(null);
    setShowCorridorLayer(true);
    try {
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
      sightCorridorPosition={position}
      sightCorridorScale={modelScale}
      sightCorridorRadius={radius}
      sightCorridorResult={position ? result : null}
      corridorCollisionResult={collisionResult}
      showSightCorridorLayer={showCorridorLayer}
      showSightCorridorLabels={showLabels}
      showBlockingLabels={showBlockingLabels}
      modelTransform={modelTransform}
      onPlanViewClick={setPosition}
      onModelError={setModelError}
      withCard={false}
      sceneUpAxis="z"
    />
  );

  return (
    <SightCorridorPanel
      modelFilePath={modelFilePath}
      modelFile={modelFile}
      onModelPathResolved={setModelFilePath}
      sceneScale={modelScale}
      hemisphereRadius={radius}
      onHemisphereRadiusChange={setRadius}
      currentPosition={position}
      onPositionChange={setPosition}
      onResultChange={setResult}
      sightCorridorResult={result}
      modelBounds={modelBounds}
      buildings={modelBuildings}
      corridorCollisionResult={collisionResult}
      corridorLayerVisible={showCorridorLayer}
      onCorridorCheckRequest={handleCorridorCheckRequest}
      onCorridorCheckClear={handleCorridorCheckClear}
      showSightCorridorLabels={showLabels}
      onShowSightCorridorLabelsChange={setShowLabels}
      showBlockingLabels={showBlockingLabels}
      onShowBlockingLabelsChange={setShowBlockingLabels}
      planViewportComponent={planViewport}
    />
  );
}
