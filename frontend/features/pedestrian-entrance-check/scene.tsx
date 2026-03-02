"use client";

import { Html } from "@react-three/drei";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useModelStore } from "@/lib/stores/model-store";
import { usePedestrianEntranceStore } from "./store";

const PASS_COLOR = 0x22c55e;
const FAIL_COLOR = 0xef4444;

export function PedestrianEntranceSceneLayer() {
  const modelTransform = useModelStore((state) => state.modelTransform);
  const result = usePedestrianEntranceStore((state) => state.result);
  const showHighlights = usePedestrianEntranceStore((state) => state.showHighlights);
  const selectedRedlineKey = usePedestrianEntranceStore((state) => state.selectedRedlineKey);
  const setSelectedRedlineKey = usePedestrianEntranceStore((state) => state.setSelectedRedlineKey);

  const redlines = result?.redlines ?? [];

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

  useEffect(() => {
    return () => {
      passMaterial.dispose();
      failMaterial.dispose();
    };
  }, [passMaterial, failMaterial]);

  const markers = useMemo(() => {
    if (!showHighlights || redlines.length === 0) return [];
    return redlines.map((item, idx) => {
      return {
        key: `${item.layer}-${item.index ?? idx}`,
        position: item.point,
        label: item.plot_name || `红线 ${(item.index ?? idx) + 1}`,
        status: item.status,
      };
    });
  }, [redlines, showHighlights]);

  if (markers.length === 0) return null;

  const content = (
    <>
      {markers.map((marker) => {
        const isPass = marker.status === "pass";
        const labelText = isPass ? "通过" : "不通过";
        const material = isPass ? passMaterial : failMaterial;
        return (
          <mesh key={marker.key} position={marker.position}>
            <sphereGeometry args={[0.7, 16, 16]} />
            <primitive object={material} attach="material" />
          </mesh>
        );
      })}
      {markers.map((marker) => {
        const isPass = marker.status === "pass";
        const labelText = isPass ? "通过" : "不通过";
        return (
          <Html
            key={`${marker.key}-label`}
            position={[marker.position[0], marker.position[1], marker.position[2] + 1.4]}
            center
            sprite
            style={{ pointerEvents: "auto" }}
          >
            <button
              type="button"
              onClick={() =>
                setSelectedRedlineKey(selectedRedlineKey === marker.key ? null : marker.key)
              }
              className={`rounded px-2 py-1 text-[10px] shadow-sm border whitespace-nowrap ${
                isPass
                  ? "border-green-500 bg-green-50/90 text-green-700"
                  : "border-red-500 bg-red-50/90 text-red-700"
              }`}
            >
              <div className="font-medium">{marker.label}</div>
              <div className="text-[9px]">{labelText}</div>
            </button>
          </Html>
        );
      })}
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
