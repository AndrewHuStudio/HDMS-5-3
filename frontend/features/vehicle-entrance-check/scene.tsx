"use client";

import { Html } from "@react-three/drei";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useModelStore } from "@/lib/stores/model-store";
import { useVehicleEntranceStore } from "./store";

const PASS_COLOR = 0x22c55e;
const FAIL_COLOR = 0xef4444;
const PASS_SELECTED_COLOR = 0x16a34a;
const FAIL_SELECTED_COLOR = 0xdc2626;

export function VehicleEntranceSceneLayer() {
  const modelTransform = useModelStore((state) => state.modelTransform);
  const result = useVehicleEntranceStore((state) => state.result);
  const showHighlights = useVehicleEntranceStore((state) => state.showHighlights);
  const selectedEntranceId = useVehicleEntranceStore((state) => state.selectedEntranceId);
  const setSelectedEntranceId = useVehicleEntranceStore((state) => state.setSelectedEntranceId);

  const points = result?.results ?? [];

  const passMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: PASS_COLOR,
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
      }),
    []
  );

  const failMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: FAIL_COLOR,
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
      }),
    []
  );

  const passSelectedMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: PASS_SELECTED_COLOR,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
      }),
    []
  );

  const failSelectedMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: FAIL_SELECTED_COLOR,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
      }),
    []
  );

  useEffect(() => {
    return () => {
      passMaterial.dispose();
      failMaterial.dispose();
      passSelectedMaterial.dispose();
      failSelectedMaterial.dispose();
    };
  }, [passMaterial, failMaterial, passSelectedMaterial, failSelectedMaterial]);

  const getEntranceId = (item: { object_id?: string | null; index: number }) =>
    item.object_id ? String(item.object_id) : `idx-${item.index}`;

  const markers = useMemo(() => {
    if (!showHighlights || points.length === 0) return [];
    return points.map((item) => {
      const id = getEntranceId(item);
      const isSelected = selectedEntranceId === id;
      const isFail = item.status === "fail";
      return {
        key: id,
        position: item.point,
        material: isFail
          ? isSelected
            ? failSelectedMaterial
            : failMaterial
          : isSelected
            ? passSelectedMaterial
            : passMaterial,
        scale: isSelected ? 1.6 : 1.0,
        status: item.status,
      };
    });
  }, [points, showHighlights, selectedEntranceId, passMaterial, failMaterial, passSelectedMaterial, failSelectedMaterial]);

  if (markers.length === 0) return null;

  const content = (
    <>
      {markers.map((marker) => (
        <mesh
          key={marker.key}
          position={[marker.position[0], marker.position[1], marker.position[2]]}
          scale={marker.scale}
        >
          <sphereGeometry args={[0.6, 16, 16]} />
          <primitive object={marker.material} attach="material" />
        </mesh>
      ))}
      {markers.map((marker) => (
        <Html
          key={`${marker.key}-label`}
          position={[
            marker.position[0],
            marker.position[1],
            marker.position[2] + 1.2,
          ]}
          center
          sprite
          style={{ pointerEvents: "auto" }}
        >
          <button
            type="button"
            onClick={() =>
              setSelectedEntranceId(selectedEntranceId === marker.key ? null : marker.key)
            }
            className={`rounded px-2 py-1 text-[10px] shadow-sm border whitespace-nowrap ${
              marker.status === "pass"
                ? "border-green-500 bg-green-50/90 text-green-700"
                : "border-red-500 bg-red-50/90 text-red-700"
            }`}
          >
            {marker.status === "pass" ? "通过" : "不通过"}
          </button>
        </Html>
      ))}
    </>
  );

  if (!modelTransform) return <group>{content}</group>;

  return (
    <group
      position={new THREE.Vector3(
        modelTransform.position[0],
        modelTransform.position[1],
        modelTransform.position[2]
      )}
      quaternion={new THREE.Quaternion(
        modelTransform.quaternion[0],
        modelTransform.quaternion[1],
        modelTransform.quaternion[2],
        modelTransform.quaternion[3]
      )}
      scale={new THREE.Vector3(
        modelTransform.scale[0],
        modelTransform.scale[1],
        modelTransform.scale[2]
      )}
    >
      {content}
    </group>
  );
}
