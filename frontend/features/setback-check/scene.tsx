"use client";

import { Html } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useSceneSnapshot } from "@/components/scene/scene-context";
import { SCENE_HTML_Z_INDEX_RANGE } from "@/components/city-scene";
import { useSetbackCheckStore } from "./store";
import { buildSetbackLabels } from "./label-utils";

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

  const buildingMeshes = useMemo(() => {
    const layerKey = normalize(BUILDING_LAYER);
    return meshList.filter((meshInfo) => {
      const layerName = normalize(meshInfo.layerName);
      return layerName === layerKey || layerName.endsWith(`::${layerKey}`);
    });
  }, [meshList]);

  const labels = useMemo(() => {
    if (!showHighlights) return [];
    return buildSetbackLabels(result, buildingMeshes, "z");
  }, [result, buildingMeshes, showHighlights]);

  useEffect(() => {
    return () => {
      highlightMaterial.dispose();
    };
  }, [highlightMaterial]);

  useEffect(() => {
    const restoreHighlights = () => {
      originalMaterials.current.forEach((material, meshId) => {
        const meshInfo = meshList.find((mesh) => mesh.id === meshId);
        if (meshInfo?.mesh) {
          meshInfo.mesh.material = material;
          delete (meshInfo.mesh.userData as { persistentHighlight?: boolean }).persistentHighlight;
        }
      });
      originalMaterials.current.clear();
    };

    restoreHighlights();

    if (!showHighlights || exceededIndex.ids.size === 0 && exceededIndex.names.size === 0) {
      return restoreHighlights;
    }

    buildingMeshes.forEach((meshInfo) => {
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

    return restoreHighlights;
  }, [buildingMeshes, exceededIndex, showHighlights, highlightMaterial]);

  if (!showHighlights || labels.length === 0) {
    return null;
  }

  return (
    <>
      {labels.map((label) => (
        <Html
          key={label.key}
          position={label.position}
          center
          sprite
          zIndexRange={SCENE_HTML_Z_INDEX_RANGE}
          style={{ pointerEvents: "none" }}
        >
          <div
            className={`rounded px-2 py-1 text-[10px] shadow-sm border whitespace-nowrap ${
              label.isExceeded
                ? "border-red-500 bg-red-50/90 text-red-700"
                : "border-green-500 bg-green-50/90 text-green-700"
            }`}
          >
            <div className="font-medium">{label.name}</div>
            <div className="text-[9px]">{label.statusText}</div>
            <div className="text-[9px]">所属地块 {label.plotName}</div>
            {label.reasonText && <div className="text-[9px]">{label.reasonText}</div>}
          </div>
        </Html>
      ))}
    </>
  );
}
