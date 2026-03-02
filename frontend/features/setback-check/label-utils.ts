import type * as THREE from "three";
import type { SetbackViolationBuildingResult, SetbackViolationResult } from "./types";

type SceneUpAxis = "y" | "z";

export interface SetbackLabelMeshInfo {
  id: string;
  name: string;
  mesh: THREE.Mesh;
  boundingBox: THREE.Box3;
  layerIndex?: number;
  layerName?: string;
  objectId?: string | null;
}

export interface SetbackLabelEntry {
  key: string;
  buildingIndex: number;
  name: string;
  plotName: string;
  isExceeded: boolean;
  statusText: "合规" | "超限";
  reasonText: string | null;
  position: [number, number, number];
}

const normalizeNameKey = (value?: string | null) => (value ?? "").trim().toLowerCase();
const normalizeObjectId = (value?: string | null) => (value ?? "").trim().toLowerCase();

function getHoverLabelPosition(
  box: THREE.Box3,
  sceneUpAxis: SceneUpAxis
): [number, number, number] {
  const centerX = (box.min.x + box.max.x) / 2;
  const centerY = (box.min.y + box.max.y) / 2;
  const centerZ = (box.min.z + box.max.z) / 2;

  if (sceneUpAxis === "z") {
    return [centerX, centerY, box.max.z + 0.3];
  }
  return [centerX, box.max.y + 0.3, centerZ];
}

function resolveReasonText(building: SetbackViolationBuildingResult): string | null {
  if (!building.is_exceeded) {
    return null;
  }
  if (building.reason === "missing_setback") {
    return "未匹配退线";
  }
  if (building.reason === "invalid_setback") {
    return "退线数据异常";
  }
  return "超出退线";
}

export function buildSetbackLabels(
  result: SetbackViolationResult | null,
  buildingMeshes: SetbackLabelMeshInfo[],
  sceneUpAxis: SceneUpAxis
): SetbackLabelEntry[] {
  if (!result || result.buildings.length === 0 || buildingMeshes.length === 0) {
    return [];
  }

  const byObjectId = new Map<string, SetbackLabelMeshInfo[]>();
  const byName = new Map<string, SetbackLabelMeshInfo[]>();
  const byLayerIndex = new Map<number, SetbackLabelMeshInfo[]>();
  const byLayerName = new Map<string, SetbackLabelMeshInfo[]>();

  buildingMeshes.forEach((meshInfo) => {
    const objectIdKey = normalizeObjectId(
      meshInfo.objectId ?? (meshInfo.mesh.userData?.objectId as string | undefined)
    );
    if (objectIdKey) {
      const list = byObjectId.get(objectIdKey) ?? [];
      list.push(meshInfo);
      byObjectId.set(objectIdKey, list);
    }

    const meshName =
      normalizeNameKey(meshInfo.mesh.userData?.buildingName as string | undefined) ||
      normalizeNameKey(meshInfo.name);
    if (meshName) {
      const list = byName.get(meshName) ?? [];
      list.push(meshInfo);
      byName.set(meshName, list);
    }

    if (typeof meshInfo.layerIndex === "number") {
      const list = byLayerIndex.get(meshInfo.layerIndex) ?? [];
      list.push(meshInfo);
      byLayerIndex.set(meshInfo.layerIndex, list);
    }

    const layerKey = normalizeNameKey(meshInfo.layerName);
    if (layerKey) {
      const list = byLayerName.get(layerKey) ?? [];
      list.push(meshInfo);
      byLayerName.set(layerKey, list);
    }
  });

  const usedMeshIds = new Set<string>();
  const takeUnused = (list?: SetbackLabelMeshInfo[]) =>
    list?.find((meshInfo) => !usedMeshIds.has(meshInfo.id)) ?? null;

  return result.buildings
    .map((building) => {
      let targetMesh: SetbackLabelMeshInfo | null = null;

      const objectIdKey = normalizeObjectId(building.object_id);
      if (objectIdKey) {
        targetMesh = takeUnused(byObjectId.get(objectIdKey));
      }

      const nameKey = normalizeNameKey(building.building_name);
      if (!targetMesh && nameKey) {
        targetMesh = takeUnused(byName.get(nameKey));
      }

      if (!targetMesh && typeof building.layer_index === "number") {
        targetMesh = takeUnused(byLayerIndex.get(building.layer_index));
      }

      if (!targetMesh) {
        const layerKey = normalizeNameKey(building.layer_name);
        if (layerKey) {
          targetMesh = takeUnused(byLayerName.get(layerKey));
        }
      }

      if (!targetMesh && typeof building.building_index === "number") {
        const fallback = buildingMeshes[building.building_index];
        if (fallback && !usedMeshIds.has(fallback.id)) {
          targetMesh = fallback;
        }
      }

      if (!targetMesh) {
        return null;
      }

      usedMeshIds.add(targetMesh.id);
      const labelName =
        building.building_name ||
        (targetMesh.mesh.userData?.buildingName as string | undefined) ||
        targetMesh.name ||
        `建筑 ${building.building_index + 1}`;

      return {
        key: `setback-label-${building.building_index}-${targetMesh.id}`,
        buildingIndex: building.building_index,
        name: labelName,
        plotName: building.plot_name ?? "未匹配地块",
        isExceeded: building.is_exceeded,
        statusText: building.is_exceeded ? "超限" : "合规",
        reasonText: resolveReasonText(building),
        position: getHoverLabelPosition(targetMesh.boundingBox, sceneUpAxis),
      } satisfies SetbackLabelEntry;
    })
    .filter(Boolean) as SetbackLabelEntry[];
}
