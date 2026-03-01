"use client";

import { Html } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useSceneSnapshot } from "@/components/scene/scene-context";
import { useModelStore } from "@/lib/stores/model-store";
import { usePlazaSetbackStore } from "./store";

const BUILDING_LAYER = "模型_建筑体块";

const normalize = (value?: string | null) => (value ?? "").trim().toLowerCase();

export function PlazaSetbackSceneLayer() {
  const sceneSnapshot = useSceneSnapshot();
  const modelTransform = useModelStore((state) => state.modelTransform);
  const result = usePlazaSetbackStore((state) => state.result);
  const showHighlights = usePlazaSetbackStore((state) => state.showHighlights);
  const selectedAreaName = usePlazaSetbackStore((state) => state.selectedAreaName);
  const setSelectedAreaName = usePlazaSetbackStore((state) => state.setSelectedAreaName);
  const meshList = sceneSnapshot?.meshList ?? [];
  const originalMaterials = useRef<Map<string, THREE.Material | THREE.Material[]>>(new Map());
  const plazaAreas = result?.plaza_areas ?? [];
  const areaResults = result?.area_results ?? [];
  const extrudeHeight = Math.max(result?.parameters?.ignore_height ?? 0, 0);

  const areaStatusMap = useMemo(() => {
    const map = new Map<string, "pass" | "fail">();
    areaResults.forEach((item) => map.set(item.name, item.status));
    return map;
  }, [areaResults]);

  const violationIndex = useMemo(() => {
    const ids = new Set<string>();
    const names = new Set<string>();
    if (result?.results) {
      result.results.forEach((building) => {
        if (!building.is_violation) return;
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

  const plazaAreaMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: 0x22c55e,
        transparent: true,
        opacity: 0.25,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    []
  );

  useEffect(() => {
    return () => {
      plazaAreaMaterial.dispose();
    };
  }, [plazaAreaMaterial]);

  const selectedPlazaAreaMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: 0x16a34a,
        transparent: true,
        opacity: 0.5,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    []
  );

  useEffect(() => {
    return () => {
      selectedPlazaAreaMaterial.dispose();
    };
  }, [selectedPlazaAreaMaterial]);

  const plazaAreaMeshes = useMemo(() => {
    if (!plazaAreas.length || extrudeHeight <= 0) return [];
    return plazaAreas
      .map((area, index) => {
        const outer = area.outer ?? [];
        if (outer.length < 3) return null;
        const shape = new THREE.Shape();
        shape.moveTo(outer[0][0], outer[0][1]);
        for (let i = 1; i < outer.length; i += 1) {
          shape.lineTo(outer[i][0], outer[i][1]);
        }
        shape.closePath();

        (area.holes ?? []).forEach((hole) => {
          if (!hole || hole.length < 3) return;
          const path = new THREE.Path();
          path.moveTo(hole[0][0], hole[0][1]);
          for (let i = 1; i < hole.length; i += 1) {
            path.lineTo(hole[i][0], hole[i][1]);
          }
          path.closePath();
          shape.holes.push(path);
        });

        const baseZ = area.base_z ?? outer[0][2] ?? 0;
        return {
          key: `plaza-area-${index}`,
          name: area.name ?? `广场${index + 1}`,
          shape,
          baseZ,
          height: extrudeHeight,
        };
      })
      .filter(
        (
          item
        ): item is {
          key: string;
          name: string;
          shape: THREE.Shape;
          baseZ: number;
          height: number;
        } => Boolean(item)
      );
  }, [plazaAreas, extrudeHeight]);

  const plazaAreaLabels = useMemo(() => {
    if (!plazaAreaMeshes.length) return [];
    return plazaAreaMeshes
      .map((mesh) => {
        const points = mesh.shape.getPoints();
        if (points.length === 0) return null;
        const centroid = points.reduce(
          (acc, pt) => {
            acc.x += pt.x;
            acc.y += pt.y;
            return acc;
          },
          { x: 0, y: 0 }
        );
        centroid.x /= points.length;
        centroid.y /= points.length;
        const status = areaStatusMap.get(mesh.name) ?? "pass";
        return {
          key: `${mesh.key}-label`,
          name: mesh.name,
          status,
          position: [centroid.x, centroid.y, mesh.baseZ + mesh.height + 0.8] as [
            number,
            number,
            number,
          ],
        };
      })
      .filter(Boolean) as Array<{
      key: string;
      name: string;
      status: "pass" | "fail";
      position: [number, number, number];
    }>;
  }, [plazaAreaMeshes, areaStatusMap]);

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

    if (!showHighlights || (violationIndex.ids.size === 0 && violationIndex.names.size === 0)) {
      return restoreHighlights;
    }

    meshList.forEach((meshInfo) => {
      const layerName = normalize(meshInfo.layerName);
      const isBuildingLayer =
        layerName === normalize(BUILDING_LAYER) || layerName.endsWith(`::${normalize(BUILDING_LAYER)}`);
      if (!isBuildingLayer) return;

      const objectId =
        meshInfo.objectId ?? (meshInfo.mesh.userData?.objectId as string | undefined | null);
      const nameKey = normalize(meshInfo.mesh.userData?.buildingName) || normalize(meshInfo.name);
      const isViolation =
        (objectId ? violationIndex.ids.has(String(objectId)) : false) ||
        (nameKey ? violationIndex.names.has(nameKey) : false);
      if (!isViolation) return;

      if (!originalMaterials.current.has(meshInfo.id)) {
        originalMaterials.current.set(meshInfo.id, meshInfo.mesh.material);
      }
      (meshInfo.mesh.userData as { persistentHighlight?: boolean }).persistentHighlight = true;
      meshInfo.mesh.material = highlightMaterial;
    });

    return restoreHighlights;
  }, [meshList, violationIndex, showHighlights, highlightMaterial]);

  const plazaAreaContent = (
    <>
      {plazaAreaMeshes.map((mesh) => (
        <mesh key={mesh.key} position={[0, 0, mesh.baseZ]}>
          <extrudeGeometry
            args={[
              mesh.shape,
              {
                depth: mesh.height,
                bevelEnabled: false,
                steps: 1,
              },
            ]}
          />
          <primitive
            object={selectedAreaName === mesh.name ? selectedPlazaAreaMaterial : plazaAreaMaterial}
            attach="material"
          />
        </mesh>
      ))}
      {plazaAreaLabels.map((label) => (
        <Html
          key={label.key}
          position={label.position}
          center
          sprite
          style={{ pointerEvents: "auto" }}
        >
          <button
            type="button"
            onClick={() =>
              setSelectedAreaName(selectedAreaName === label.name ? null : label.name)
            }
            className={`rounded px-2 py-1 text-[10px] shadow-sm border whitespace-nowrap ${
              label.status === "pass"
                ? "border-green-500 bg-green-50/90 text-green-700"
                : "border-red-500 bg-red-50/90 text-red-700"
            } ${selectedAreaName === label.name ? "ring-2 ring-emerald-400" : ""}`}
          >
            {label.status === "pass" ? "通过" : "不通过"}
          </button>
        </Html>
      ))}
    </>
  );

  return (
    <>
      {showHighlights && plazaAreaMeshes.length > 0 && (
        modelTransform ? (
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
            {plazaAreaContent}
          </group>
        ) : (
          <group>{plazaAreaContent}</group>
        )
      )}
    </>
  );
}
