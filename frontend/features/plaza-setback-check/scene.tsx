"use client";

import { Html } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useSceneSnapshot } from "@/components/scene/scene-context";
import { useModelStore } from "@/lib/stores/model-store";
import { buildSetbackAreaSelectionId } from "@/features/setback-area/result-view";
import { usePlazaSetbackStore } from "./store";

const BUILDING_LAYER = "模型_建筑体块";

const normalize = (value?: string | null) => (value ?? "").trim().toLowerCase();
const normalizeText = (value?: string | null) => {
  const text = (value ?? "").trim();
  return text || null;
};

export function PlazaSetbackSceneLayer() {
  const sceneSnapshot = useSceneSnapshot();
  const modelTransform = useModelStore((state) => state.modelTransform);
  const result = usePlazaSetbackStore((state) => state.result);
  const showHighlights = usePlazaSetbackStore((state) => state.showHighlights);
  const selectedAreaId = usePlazaSetbackStore((state) => state.selectedAreaId);
  const setSelectedAreaId = usePlazaSetbackStore((state) => state.setSelectedAreaId);
  const meshList = sceneSnapshot?.meshList ?? [];
  const originalMaterials = useRef<Map<string, THREE.Material | THREE.Material[]>>(new Map());
  const plazaAreas = result?.plaza_areas ?? [];
  const areaResults = result?.area_results ?? [];
  const extrudeHeight = Math.max(result?.parameters?.ignore_height ?? 0, 0);
  const areaShapePlotNameMap = useMemo(() => {
    const map = new Map<string, string>();
    plazaAreas.forEach((area) => {
      const areaName = normalizeText(area.name);
      const plotName = normalizeText(area.plot_name);
      if (!areaName || !plotName || map.has(areaName)) return;
      map.set(areaName, plotName);
    });
    return map;
  }, [plazaAreas]);
  const areaPlotNameMap = useMemo(() => {
    const map = new Map<string, string>();
    (result?.results ?? []).forEach((building) => {
      const areaName = normalizeText(building.plaza_name);
      const plotName = normalizeText(building.plot_name);
      if (!areaName || !plotName || map.has(areaName)) return;
      map.set(areaName, plotName);
    });
    return map;
  }, [result]);

  const areaMetaMap = useMemo(() => {
    const map = new Map<
      string,
      { status: "pass" | "fail"; areaName: string; plotName: string | null }
    >();
    areaResults.forEach((item, index) => {
      const areaName = normalizeText(item.name) ?? `广场${index + 1}`;
      const plotName =
        normalizeText(item.plot_name) ??
        areaShapePlotNameMap.get(areaName) ??
        areaPlotNameMap.get(areaName) ??
        null;
      map.set(
        buildSetbackAreaSelectionId("plaza", index, item.id, item.name),
        { status: item.status, areaName, plotName }
      );
    });
    return map;
  }, [areaResults, areaPlotNameMap, areaShapePlotNameMap]);

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
        const id = buildSetbackAreaSelectionId("plaza", index, area.id, area.name);
        return {
          key: `plaza-area-${index}`,
          id,
          areaName: normalizeText(area.name) ?? `广场${index + 1}`,
          plotName:
            normalizeText(area.plot_name) ??
            areaShapePlotNameMap.get(normalizeText(area.name) ?? `广场${index + 1}`) ??
            areaPlotNameMap.get(normalizeText(area.name) ?? `广场${index + 1}`) ??
            null,
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
          id: string;
          areaName: string;
          plotName: string | null;
          shape: THREE.Shape;
          baseZ: number;
          height: number;
        } => Boolean(item)
      );
  }, [plazaAreas, extrudeHeight, areaPlotNameMap, areaShapePlotNameMap]);

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
        const meta = areaMetaMap.get(mesh.id);
        return {
          key: `${mesh.key}-label`,
          id: mesh.id,
          status: meta?.status ?? "pass",
          areaName: meta?.areaName ?? mesh.areaName,
          plotName: meta?.plotName ?? mesh.plotName,
          position: [centroid.x, centroid.y, mesh.baseZ + mesh.height + 0.8] as [
            number,
            number,
            number,
          ],
        };
      })
      .filter(Boolean) as Array<{
      key: string;
      id: string;
      status: "pass" | "fail";
      areaName: string;
      plotName: string | null;
      position: [number, number, number];
    }>;
  }, [plazaAreaMeshes, areaMetaMap]);

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
            object={selectedAreaId === mesh.id ? selectedPlazaAreaMaterial : plazaAreaMaterial}
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
              setSelectedAreaId(selectedAreaId === label.id ? null : label.id)
            }
            className={`rounded px-2 py-1 text-[10px] shadow-sm border ${
              label.status === "pass"
                ? "border-green-500 bg-green-50/90 text-green-700"
                : "border-orange-500 bg-orange-50/90 text-orange-700"
            } ${selectedAreaId === label.id ? "ring-2 ring-emerald-400" : ""}`}
          >
            <div className="font-medium leading-tight">{label.areaName}</div>
            <div className="text-[9px] leading-tight">{label.status === "pass" ? "通过" : "不通过"}</div>
            <div className="text-[9px] leading-tight">所属地块 {label.plotName ?? "未匹配地块"}</div>
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
