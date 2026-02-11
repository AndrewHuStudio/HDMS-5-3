"use client";

import { Html } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useSceneSnapshot } from "@/components/scene/scene-context";
import { useModelStore } from "@/lib/stores/model-store";
import { useSkyBridgeStore } from "./store";
import { deriveConnectionReasons } from "./utils";

const reasonLabels: Record<string, string> = {
  plot_missing: "地块缺失",
  missing_corridor: "缺少空中连廊",
  not_connecting: "未跨越两地块",
  not_closed: "连廊未闭合",
  clearance_too_low: "标高不足",
  width_too_small: "净宽不足",
  height_too_small: "净高不足",
};

export function SkyBridgeSceneLayer() {
  const sceneSnapshot = useSceneSnapshot();
  const modelTransform = useModelStore((state) => state.modelTransform);
  const results = useSkyBridgeStore((state) => state.results);
  const showLabels = useSkyBridgeStore((state) => state.showLabels);
  const meshList = sceneSnapshot?.meshList ?? [];
  const originalMaterials = useRef<Map<string, THREE.Material | THREE.Material[]>>(new Map());

  const applyModelTransform = (position: THREE.Vector3) => {
    if (!modelTransform) return position;
    const transformed = position.clone();
    transformed.multiply(
      new THREE.Vector3(modelTransform.scale[0], modelTransform.scale[1], modelTransform.scale[2])
    );
    transformed.applyQuaternion(
      new THREE.Quaternion(
        modelTransform.quaternion[0],
        modelTransform.quaternion[1],
        modelTransform.quaternion[2],
        modelTransform.quaternion[3]
      )
    );
    transformed.add(
      new THREE.Vector3(
        modelTransform.position[0],
        modelTransform.position[1],
        modelTransform.position[2]
      )
    );
    return transformed;
  };

  const labels = useMemo(() => {
    if (!showLabels || results.length === 0) return [];
    return results.map((result) => {
      const position = applyModelTransform(
        new THREE.Vector3(result.label_position[0], result.label_position[1], result.label_position[2])
      );
      const derivedReasons = deriveConnectionReasons(result);
      const reasons =
        derivedReasons.length > 0
          ? derivedReasons.map((reason) => reasonLabels[reason] || reason)
          : [result.status === "pass" ? "通过" : "未通过"];
      return {
        key: `sky-bridge-${result.connection_id}`,
        name: `${result.plot_a} ↔ ${result.plot_b}`,
        status: result.status,
        reasons,
        position: [position.x, position.y, position.z] as [number, number, number],
      };
    });
  }, [results, showLabels, modelTransform]);

  const corridorStatusByObjectId = useMemo(() => {
    const map = new Map<string, "pass" | "fail">();
    results.forEach((result) => {
      result.corridors.forEach((corridor) => {
        if (!corridor.object_id) return;
        const status = corridor.status === "pass" ? "pass" : "fail";
        const existing = map.get(corridor.object_id);
        if (!existing || status === "pass") {
          map.set(corridor.object_id, status);
        }
      });
    });
    return map;
  }, [results]);

  const passMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: 0x22c55e,
        metalness: 0,
        roughness: 0.8,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    []
  );
  const failMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: 0xef4444,
        metalness: 0,
        roughness: 0.8,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    []
  );

  useEffect(() => {
    return () => {
      passMaterial.dispose();
      failMaterial.dispose();
    };
  }, [passMaterial, failMaterial]);

  useEffect(() => {
    originalMaterials.current.forEach((material, meshId) => {
      const meshInfo = meshList.find((mesh) => mesh.id === meshId);
      if (meshInfo?.mesh) {
        meshInfo.mesh.material = material;
        delete (meshInfo.mesh.userData as { persistentHighlight?: boolean }).persistentHighlight;
      }
    });
    originalMaterials.current.clear();

    if (corridorStatusByObjectId.size === 0) return;

    meshList.forEach((meshInfo) => {
      const layerName = (meshInfo.layerName ?? "").trim().toLowerCase();
      const isCorridorLayer =
        layerName === "模型_空中连廊" || layerName.endsWith("::模型_空中连廊");
      if (!isCorridorLayer) return;

      const objectId =
        meshInfo.objectId ?? (meshInfo.mesh.userData?.objectId as string | undefined | null);
      const status = objectId ? corridorStatusByObjectId.get(objectId) : undefined;
      if (!status) return;
      if (!originalMaterials.current.has(meshInfo.id)) {
        originalMaterials.current.set(meshInfo.id, meshInfo.mesh.material);
      }
      (meshInfo.mesh.userData as { persistentHighlight?: boolean }).persistentHighlight = true;
      meshInfo.mesh.material = status === "pass" ? passMaterial : failMaterial;
    });
  }, [meshList, corridorStatusByObjectId, passMaterial, failMaterial]);

  if (results.length === 0) return null;

  return (
    <>
      {showLabels &&
        labels.map((label) => (
          <Html key={label.key} position={label.position} center sprite style={{ pointerEvents: "none" }}>
            <div
              className={`rounded px-2 py-1 text-[10px] shadow-sm border whitespace-nowrap ${
                label.status === "pass"
                  ? "border-green-500 bg-green-50/90 text-green-700"
                  : "border-red-500 bg-red-50/90 text-red-700"
              }`}
            >
              <div className="font-medium">{label.name}</div>
              {label.reasons.map((reason) => (
                <div key={reason} className="text-[9px]">
                  {reason}
                </div>
              ))}
            </div>
          </Html>
        ))}
    </>
  );
}
