"use client";

import { Html } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useSceneSnapshot } from "@/components/scene/scene-context";
import { shouldRenderFeatureVisuals } from "@/lib/scene-visibility";
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
  const shouldRenderVisuals = shouldRenderFeatureVisuals(showLabels, results.length);

  const meshList = sceneSnapshot?.meshList ?? [];
  const hiddenMeshState = useRef<Map<string, boolean>>(new Map());
  const hiddenLineState = useRef<Map<THREE.Object3D, boolean>>(new Map());
  const { scene } = useThree();

  useEffect(() => {
    if (!meshList.length) return;

    const normalize = (value?: string | null) => (value ?? "").trim().toLowerCase();
    const hiddenLayers = ["模型_空中连廊"].map(normalize);

    meshList.forEach((meshInfo) => {
      const layerName = normalize(meshInfo.layerName);
      if (!layerName) return;
      const isHiddenLayer = hiddenLayers.some(
        (layer) => layerName === layer || layerName.endsWith(`::${layer}`)
      );
      if (!isHiddenLayer) return;
      if (!hiddenMeshState.current.has(meshInfo.id)) {
        hiddenMeshState.current.set(meshInfo.id, meshInfo.mesh.visible);
      }
      meshInfo.mesh.visible = false;
    });

    return () => {
      hiddenMeshState.current.forEach((wasVisible, meshId) => {
        const meshInfo = meshList.find((mesh) => mesh.id === meshId);
        if (meshInfo?.mesh) {
          meshInfo.mesh.visible = wasVisible;
        }
      });
      hiddenMeshState.current.clear();
    };
  }, [meshList]);

  useEffect(() => {
    if (!scene) return;
    const normalize = (value?: string | null) => (value ?? "").trim().toLowerCase();
    const hiddenLayers = ["模型_空中连廊"].map(normalize);
    const layers = (scene.userData?.layers ?? []) as Array<{ name?: string }>;

    scene.traverse((child) => {
      if (!(child instanceof THREE.Line || child instanceof THREE.LineSegments)) return;
      const attributes = child.userData?.attributes as { layerIndex?: number } | undefined;
      if (typeof attributes?.layerIndex !== "number") return;
      const layerName = normalize(layers[attributes.layerIndex]?.name);
      if (!layerName) return;
      const isHiddenLayer = hiddenLayers.some(
        (layer) => layerName === layer || layerName.endsWith(`::${layer}`)
      );
      if (!isHiddenLayer) return;
      if (!hiddenLineState.current.has(child)) {
        hiddenLineState.current.set(child, child.visible);
      }
      child.visible = false;
    });

    return () => {
      hiddenLineState.current.forEach((wasVisible, obj) => {
        obj.visible = wasVisible;
      });
      hiddenLineState.current.clear();
    };
  }, [scene]);

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
    if (!shouldRenderVisuals) return [];
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
  }, [results, shouldRenderVisuals, modelTransform]);

  const corridorFaces = useMemo(() => {
    if (!shouldRenderVisuals) return [];
    const faces: {
      key: string;
      shape: THREE.Shape;
      baseZ: number;
      color: number;
    }[] = [];

    results.forEach((result) => {
      result.corridors.forEach((corridor) => {
        const points = corridor.outline_points ?? [];
        let shapePoints = points;
        if (shapePoints.length < 3) {
          const bbox = corridor.bbox;
          shapePoints = [
            [bbox.min[0], bbox.min[1], bbox.min[2]],
            [bbox.min[0], bbox.max[1], bbox.min[2]],
            [bbox.max[0], bbox.max[1], bbox.min[2]],
            [bbox.max[0], bbox.min[1], bbox.min[2]],
          ];
        }

        if (shapePoints.length < 3) return;

        const shape = new THREE.Shape();
        shape.moveTo(shapePoints[0][0], shapePoints[0][1]);
        for (let i = 1; i < shapePoints.length; i += 1) {
          shape.lineTo(shapePoints[i][0], shapePoints[i][1]);
        }
        shape.closePath();

        const avgZ = shapePoints.reduce((sum, pt) => sum + pt[2], 0) / shapePoints.length;
        const color = corridor.status === "pass" ? 0x22c55e : 0xef4444;

        faces.push({
          key: `sky-bridge-face-${result.connection_id}-${corridor.index}`,
          shape,
          baseZ: avgZ,
          color,
        });
      });
    });

    return faces;
  }, [results, shouldRenderVisuals]);

  if (!shouldRenderVisuals) return null;

  return (
    <>
      {modelTransform &&
        corridorFaces.map((face) => (
          <group
            key={face.key}
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
            scale={new THREE.Vector3(modelTransform.scale[0], modelTransform.scale[1], modelTransform.scale[2])}
          >
            <mesh position={[0, 0, face.baseZ]}>
              <shapeGeometry args={[face.shape]} />
              <meshBasicMaterial
                color={face.color}
                transparent
                opacity={0.45}
                depthWrite={false}
                side={THREE.DoubleSide}
              />
            </mesh>
          </group>
        ))}
      {labels.map((label) => (
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
