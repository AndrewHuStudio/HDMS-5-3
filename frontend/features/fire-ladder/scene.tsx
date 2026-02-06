"use client";

import { Html } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useSceneSnapshot } from "@/components/scene/scene-context";
import { useModelStore } from "@/lib/stores/model-store";
import { useFireLadderStore } from "./store";

const reasonLabels: Record<string, string> = {
  no_buildings: "无建筑无需检测",
  missing_ladder: "缺少消防登高面",
  outside_redline: "登高面超出红线",
  width_too_small: "登高面宽度不足",
  length_sum_too_short: "登高面长度总和不足",
  distance_out_of_range: "登高面距建筑不在5-10m",
};

export function FireLadderSceneLayer() {
  const sceneSnapshot = useSceneSnapshot();
  const modelTransform = useModelStore((state) => state.modelTransform);
  const results = useFireLadderStore((state) => state.results);
  const showLabels = useFireLadderStore((state) => state.showLabels);

  const meshList = sceneSnapshot?.meshList ?? [];
  const hiddenMeshState = useRef<Map<string, boolean>>(new Map());
  const hiddenLineState = useRef<Map<THREE.Object3D, boolean>>(new Map());
  const { scene } = useThree();

  useEffect(() => {
    if (!meshList.length) return;

    const normalize = (value?: string | null) => (value ?? "").trim().toLowerCase();
    const hiddenLayers = ["模型_消防登高面"].map(normalize);

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
    const hiddenLayers = ["模型_消防登高面"].map(normalize);
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
      new THREE.Vector3(
        modelTransform.scale[0],
        modelTransform.scale[1],
        modelTransform.scale[2]
      )
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
        new THREE.Vector3(
          result.label_position[0],
          result.label_position[1],
          result.label_position[2]
        )
      );
      const reasons =
        result.reasons.length > 0
          ? result.reasons.map((reason) => reasonLabels[reason] || reason)
          : ["通过"];
      return {
        key: `fire-ladder-${result.redline_index}`,
        name: result.redline_name,
        status: result.status,
        reasons,
        position: [position.x, position.y, position.z] as [number, number, number],
      };
    });
  }, [results, showLabels, modelTransform]);

  const ladderFaces = useMemo(() => {
    if (results.length === 0) return [];
    const faces: {
      key: string;
      shape: THREE.Shape;
      baseZ: number;
      color: number;
    }[] = [];
    results.forEach((result) => {
      const color = result.status === "pass" ? 0x22c55e : 0xef4444;
      result.ladders.forEach((ladder) => {
        const points = ladder.outline_points ?? [];
        if (points.length < 3) return;
        const shape = new THREE.Shape();
        shape.moveTo(points[0][0], points[0][1]);
        for (let i = 1; i < points.length; i += 1) {
          shape.lineTo(points[i][0], points[i][1]);
        }
        shape.closePath();
        const avgZ = points.reduce((sum, pt) => sum + pt[2], 0) / points.length;
        faces.push({
          key: `fire-ladder-face-${result.redline_index}-${ladder.index}`,
          shape,
          baseZ: avgZ,
          color,
        });
      });
    });
    return faces;
  }, [results]);

  if (results.length === 0) return null;

  return (
    <>
      {modelTransform &&
        ladderFaces.map((face) => (
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
            scale={new THREE.Vector3(
              modelTransform.scale[0],
              modelTransform.scale[1],
              modelTransform.scale[2]
            )}
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
