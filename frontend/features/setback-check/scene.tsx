"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useSceneSnapshot } from "@/components/scene/scene-context";
import { useSetbackCheckStore } from "./store";

const BUILDING_LAYER = "模型_建筑体块";

const normalize = (value?: string | null) => (value ?? "").trim().toLowerCase();

export function SetbackSceneLayer() {
  const sceneSnapshot = useSceneSnapshot();
  const result = useSetbackCheckStore((state) => state.result);
  const showHighlights = useSetbackCheckStore((state) => state.showHighlights);
  const meshList = sceneSnapshot?.meshList ?? [];
  const originalMaterials = useRef<Map<string, THREE.Material | THREE.Material[]>>(new Map());

  const exceededIndex = useMemo(() => {
    const ids = new Set<string>();
    const names = new Set<string>();
    if (result?.buildings) {
      result.buildings.forEach((building) => {
        if (!building.is_exceeded) return;
        if (building.object_id) {
          ids.add(String(building.object_id));
        } else if (building.building_name) {
          names.add(normalize(building.building_name));
        }
      });
    }
    return { ids, names };
  }, [result]);

  const highlightMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: 0xef4444,
        metalness: 0,
        roughness: 0.85,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    []
  );

  useEffect(() => {
    return () => {
      highlightMaterial.dispose();
    };
  }, [highlightMaterial]);

  useEffect(() => {
    originalMaterials.current.forEach((material, meshId) => {
      const meshInfo = meshList.find((mesh) => mesh.id === meshId);
      if (meshInfo?.mesh) {
        meshInfo.mesh.material = material;
        delete (meshInfo.mesh.userData as { persistentHighlight?: boolean }).persistentHighlight;
      }
    });
    originalMaterials.current.clear();

    if (!showHighlights || exceededIndex.ids.size === 0 && exceededIndex.names.size === 0) {
      return;
    }

    meshList.forEach((meshInfo) => {
      const layerName = normalize(meshInfo.layerName);
      const isBuildingLayer =
        layerName === normalize(BUILDING_LAYER) || layerName.endsWith(`::${normalize(BUILDING_LAYER)}`);
      if (!isBuildingLayer) return;

      const objectId =
        meshInfo.objectId ?? (meshInfo.mesh.userData?.objectId as string | undefined | null);
      const nameKey =
        normalize(meshInfo.mesh.userData?.buildingName) || normalize(meshInfo.name);
      const isExceeded =
        (objectId ? exceededIndex.ids.has(String(objectId)) : false) ||
        (nameKey ? exceededIndex.names.has(nameKey) : false);
      if (!isExceeded) return;

      if (!originalMaterials.current.has(meshInfo.id)) {
        originalMaterials.current.set(meshInfo.id, meshInfo.mesh.material);
      }
      (meshInfo.mesh.userData as { persistentHighlight?: boolean }).persistentHighlight = true;
      meshInfo.mesh.material = highlightMaterial;
    });
  }, [meshList, exceededIndex, showHighlights, highlightMaterial]);

  return null;
}
