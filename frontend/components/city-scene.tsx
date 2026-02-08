"use client";

import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, Grid, Html, OrthographicCamera, PerspectiveCamera } from "@react-three/drei";
import { useState, useRef, Suspense, useEffect, useCallback, useMemo } from "react";
import { useTheme } from "next-themes";
import type { CityElement } from "@/lib/city-data";
import { mockCityElements, elementTypeNames } from "@/lib/city-data";
import type { HeightCheckSetbackVolume } from "@/lib/height-check-types";
import type { SetbackCheckResult } from "@/lib/setback-check-types";
import type { BuildingResult } from "@/components/height-check-panel-pure";
import type {
  SightCorridorPosition,
  PlanViewBuilding,
  PlanViewPoint,
  SightCorridorResult,
  CorridorCollisionResult,
} from "@/lib/sight-corridor-types";
import type { ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { Rhino3dmLoader } from "three/examples/jsm/loaders/3DMLoader.js";
import { InfiniteGrid } from "./infinite-grid";
import { PersonModel } from "./person-model";
import { HemisphereModel } from "./hemisphere-model";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SceneContext } from "@/components/scene/scene-context";
import { SceneExtensions, SceneOverlays } from "@/components/scene/scene-extensions";

// 视角类型
export type ViewMode = "perspective" | "isometric-ne" | "isometric-nw" | "isometric-se" | "isometric-sw" | "plan";
export type ModelFileType = "gltf" | "glb" | "3dm";

// 视角配置 - zoom 值越大视野越小，显示越近
// 演示模型范围约 280 单位，相机位置需要足够远才能看到全貌
const viewConfigs: Record<ViewMode, { position: [number, number, number]; zoom?: number; label: string }> = {
  "perspective": { position: [200, 150, 200], label: "透视" },
  "isometric-ne": { position: [200, 200, 200], zoom: 0.8, label: "东北" },
  "isometric-nw": { position: [-200, 200, 200], zoom: 0.8, label: "西北" },
  "isometric-se": { position: [200, 200, -200], zoom: 0.8, label: "东南" },
  "isometric-sw": { position: [-200, 200, -200], zoom: 0.8, label: "西南" },
  "plan": { position: [0, 300, 0.01], zoom: 0.8, label: "平面" },
};

const RHINO_LIBRARY_PATH = "/rhino3dm/";
const GRID_PLANE_SIZE = 100000;
const CAMERA_FIT_PADDING = 0.8;
const MIN_ORBIT_DISTANCE = 0.01;
const MAX_ORBIT_DISTANCE = 1e7;
const MIN_ORTHO_ZOOM = 0.01;
const MAX_ORTHO_ZOOM = 1e5;
const RHINO_UP_AXIS: "auto" | "z" | "y" | "x" = "z";
const RHINO_AUTO_FLAT_RATIO = 0.35;
const RHINO_AUTO_RATIO_MARGIN = 0.85;
const RHINO_ALIGN_PLANE_TO_GROUND = true;
const RHINO_PLANE_EIGEN_RATIO = 0.02;
const RHINO_PLANE_SAMPLE_LIMIT = 5000;
const CLIP_NEAR_MARGIN = 1.5;
const CLIP_FAR_MARGIN = 2;
const CLIP_MIN_NEAR = 0.01;
const CLIP_MIN_FAR = GRID_PLANE_SIZE;
const CLIP_MAX_NEAR_RATIO = 0.05;
const PERSON_SCALE_MULTIPLIER = 5;
const BUILDING_LAYER_NAME = "模型_建筑体块";
const SIGHT_CORRIDOR_LAYER_NAME = "限制_视线通廊";
type Axis = "x" | "y" | "z";
type UpAxis = "y" | "z";
const SCENE_UP_AXIS: UpAxis = "z";

const normalizeLayerName = (name?: string | null) => (name ?? "").trim().toLowerCase();
const BUILDING_LAYER_KEY = normalizeLayerName(BUILDING_LAYER_NAME);
const SIGHT_CORRIDOR_LAYER_KEY = normalizeLayerName(SIGHT_CORRIDOR_LAYER_NAME);
const isBuildingLayerName = (name?: string | null) => {
  const normalized = normalizeLayerName(name);
  if (!normalized) return false;
  return normalized === BUILDING_LAYER_KEY || normalized.startsWith(`${BUILDING_LAYER_KEY}::`);
};
const isSightCorridorLayerName = (name?: string | null) => {
  const normalized = normalizeLayerName(name);
  if (!normalized) return false;
  return (
    normalized === SIGHT_CORRIDOR_LAYER_KEY ||
    normalized.startsWith(`${SIGHT_CORRIDOR_LAYER_KEY}::`)
  );
};

const normalizeUserTextKey = (value: string) => value.trim().toLowerCase();
const normalizeNameKey = (value?: string | null) => (value ?? "").trim().toLowerCase();
const normalizeObjectId = (value?: string | null) => (value ?? "").trim().toLowerCase();

const readUserTextValue = (value: unknown) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const readUserTextKeyValueArrays = (source: Record<string, unknown>, key: string) => {
  const keys = source.keys ?? source.Keys ?? source.KEYS;
  const values = source.values ?? source.Values ?? source.VALUES;
  if (!Array.isArray(keys) || !Array.isArray(values)) return null;
  const normalizedKey = normalizeUserTextKey(key);
  for (let i = 0; i < Math.min(keys.length, values.length); i += 1) {
    if (normalizeUserTextKey(String(keys[i])) === normalizedKey) {
      return readUserTextValue(values[i]);
    }
  }
  return null;
};

const readUserTextEntry = (entry: unknown, key: string) => {
  const normalizedKey = normalizeUserTextKey(key);
  if (!normalizedKey) return null;

  if (Array.isArray(entry) && entry.length >= 2) {
    const entryKey = entry[0];
    const entryValue = entry[1];
    if (normalizeUserTextKey(String(entryKey)) === normalizedKey) {
      return readUserTextValue(entryValue);
    }
    return null;
  }

  if (entry && typeof entry === "object") {
    const record = entry as Record<string, unknown>;
    const entryKey =
      record.key ??
      record.Key ??
      record.name ??
      record.Name ??
      record.id ??
      record.Id;
    if (entryKey && normalizeUserTextKey(String(entryKey)) === normalizedKey) {
      const value = record.value ?? record.Value ?? record.val ?? record.Val;
      return readUserTextValue(value);
    }
  }

  return null;
};

const readUserText = (source: unknown, key: string): string | null => {
  if (!source || typeof source !== "object") return null;
  const normalizedKey = normalizeUserTextKey(key);
  if (!normalizedKey) return null;

  if (source instanceof Map) {
    for (const [entryKey, entryValue] of source.entries()) {
      if (normalizeUserTextKey(String(entryKey)) === normalizedKey) {
        const value = readUserTextValue(entryValue);
        if (value) return value;
      }
    }
  }

  const record = source as Record<string, unknown>;
  const direct = record[key];
  const directValue = readUserTextValue(direct);
  if (directValue) return directValue;

  const arrayValue = readUserTextKeyValueArrays(record, key);
  if (arrayValue) return arrayValue;

  for (const [entryKey, entryValue] of Object.entries(record)) {
    if (normalizeUserTextKey(entryKey) === normalizedKey) {
      const value = readUserTextValue(entryValue);
      if (value) return value;
    }
  }

  const nested =
    record.userStrings ??
    record.UserStrings ??
    record.userstrings ??
    record.userText ??
    record.UserText ??
    record.usertext;
  if (nested && nested !== source) {
    const nestedValue = readUserText(nested, key);
    if (nestedValue) return nestedValue;
  }

  if (Array.isArray(source)) {
    for (const entry of source) {
      const value = readUserTextEntry(entry, key);
      if (value) return value;
    }
  }

  return null;
};

const getMeshUserText = (mesh: THREE.Object3D, key: string) => {
  const attributes = mesh.userData?.attributes as Record<string, unknown> | undefined;
  return (
    readUserText(attributes, key) ??
    readUserText(attributes?.geometry as Record<string, unknown> | undefined, key) ??
    readUserText(mesh.userData, key)
  );
};

const readObjectIdValue = (value: unknown) => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (value && typeof value === "object") {
    const record = value as { value?: unknown };
    if (typeof record.value === "string") {
      const trimmed = record.value.trim();
      return trimmed ? trimmed : null;
    }
  }
  return null;
};

const getMeshObjectId = (mesh: THREE.Object3D) => {
  const attributes = mesh.userData?.attributes as Record<string, unknown> | undefined;
  const candidates = [
    attributes?.id,
    attributes?.Id,
    attributes?.objectId,
    attributes?.ObjectId,
    mesh.userData?.objectId,
    mesh.userData?.id,
  ];
  for (const candidate of candidates) {
    const value = readObjectIdValue(candidate);
    if (value) return value;
  }
  return null;
};

if (SCENE_UP_AXIS === "z") {
  THREE.Object3D.DEFAULT_UP.set(0, 0, 1);
}

const AXIS_VECTORS: Record<Axis, THREE.Vector3> = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
};
const AXIS_INDEX: Record<Axis, number> = { x: 0, y: 1, z: 2 };

const toSceneUp = (position: [number, number, number], upAxis: UpAxis) => {
  if (upAxis === "z") {
    return [position[0], -position[2], position[1]] as [number, number, number];
  }
  return position;
};

const getViewConfig = (mode: ViewMode, upAxis: UpAxis) => {
  const config = viewConfigs[mode];
  if (upAxis === "y") {
    return config;
  }
  return {
    ...config,
    position: toSceneUp(config.position, upAxis),
  };
};

const getUpAxisRotation = (sourceAxis: Axis, targetAxis: Axis) => {
  return new THREE.Quaternion().setFromUnitVectors(AXIS_VECTORS[sourceAxis], AXIS_VECTORS[targetAxis]);
};

const getYUpToSceneRotation = (upAxis: UpAxis) => {
  return upAxis === "z" ? ([Math.PI / 2, 0, 0] as const) : ([0, 0, 0] as const);
};

const computeClippingPlanes = (distance: number, radius: number) => {
  const minNear = Math.max(CLIP_MIN_NEAR, radius / 1000);
  const fitNear = Math.max(minNear, distance - radius * CLIP_NEAR_MARGIN);
  const maxNear = Math.max(minNear, distance * CLIP_MAX_NEAR_RATIO);
  const near = Math.min(fitNear, maxNear);
  const far = Math.max(near + 1, distance + radius * CLIP_FAR_MARGIN, CLIP_MIN_FAR);
  return { near, far };
};

interface CityElementMeshProps {
  element: CityElement;
  isSelected: boolean;
  isHovered: boolean;
  onSelect: (element: CityElement) => void;
  onHover: (element: CityElement | null) => void;
}

// 白膜材质颜色配置
const whiteModeColors: Record<string, string> = {
  building: "#f8fafc",      // 建筑 - 纯白
  land: "#e2e8f0",          // 地块 - 浅灰
  road: "#94a3b8",          // 道路 - 中灰
  sidewalk: "#cbd5e1",      // 人行道 - 浅灰
  greenspace: "#d1fae5",    // 绿地 - 浅绿
  corridor: "#f1f5f9",      // 连廊 - 白色
};

// 边线组件 - 为几何体添加黑色边线
function EdgeLines({ scale, color = "#1e293b" }: { scale: [number, number, number]; color?: string }) {
  const edgesRef = useRef<THREE.LineSegments>(null);
  
  return (
    <lineSegments scale={scale}>
      <edgesGeometry args={[new THREE.BoxGeometry(1, 1, 1)]} />
      <lineBasicMaterial color={color} linewidth={1} />
    </lineSegments>
  );
}

function CityElementMesh({
  element,
  isSelected,
  isHovered,
  onSelect,
  onHover,
}: CityElementMeshProps) {
  const meshRef = useRef<THREE.Mesh>(null);

  // 获取白膜颜色
  const getWhiteModeColor = () => {
    if (isSelected) return "#86efac"; // 选中时绿色
    if (isHovered) return "#bfdbfe";  // 悬停时蓝色
    return whiteModeColors[element.type] || "#f8fafc";
  };

  // 获取边线颜色
  const getEdgeColor = () => {
    if (isSelected) return "#16a34a"; // 选中时深绿
    if (isHovered) return "#3b82f6";  // 悬停时蓝色
    return "#475569";                  // 默认深灰色边线
  };

  const getMaterialProps = () => {
    const color = getWhiteModeColor();
    
    switch (element.type) {
      case "land":
        return { color, transparent: true, opacity: 0.9, metalness: 0, roughness: 1 };
      case "road":
        return { color, metalness: 0, roughness: 1 };
      case "sidewalk":
        return { color, metalness: 0, roughness: 1 };
      case "greenspace":
        return { color, metalness: 0, roughness: 1 };
      case "building":
        return { color, metalness: 0, roughness: 0.9 };
      case "corridor":
        return { color, metalness: 0, roughness: 0.8, transparent: true, opacity: 0.95 };
      default:
        return { color, metalness: 0, roughness: 1 };
    }
  };

  return (
    <group 
      position={element.position}
      rotation={element.rotation ? element.rotation.map(r => r * Math.PI / 180) as [number, number, number] : [0, 0, 0]}
    >
      {/* 主体白膜 */}
      <mesh
        ref={meshRef}
        scale={element.scale}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          onSelect(element);
        }}
        onPointerOver={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          onHover(element);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          onHover(null);
          document.body.style.cursor = "auto";
        }}
        castShadow={element.type === "building"}
        receiveShadow
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial {...getMaterialProps()} />
      </mesh>

      {/* 黑色边线 */}
      <EdgeLines scale={element.scale} color={getEdgeColor()} />

      {/* 悬停状态的标签 - 只在悬停且未选中时显示，使用固定大小 */}
      {isHovered && !isSelected && (
        <Html
          position={[0, element.scale[1] / 2 + 0.3, 0]}
          center
          sprite
          style={{ pointerEvents: 'none' }}
        >
          <div className="bg-white/95 border border-slate-200 rounded px-1.5 py-0.5 shadow-sm whitespace-nowrap">
            <p className="text-[10px] font-medium text-slate-700">{element.name}</p>
          </div>
        </Html>
      )}
    </group>
  );
}

function RoadMarkings() {
  const markings = [];
  
  for (let x = -9; x <= 9; x += 1.5) {
    if (Math.abs(x) > 1.5) {
      markings.push(
        <mesh key={`ew-${x}`} position={[x, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.8, 0.1]} />
          <meshBasicMaterial color="#ffffff" />
        </mesh>
      );
    }
  }
  
  for (let z = -9; z <= 9; z += 1.5) {
    if (Math.abs(z) > 1.5) {
      markings.push(
        <mesh key={`ns-${z}`} position={[0, 0.05, z]} rotation={[-Math.PI / 2, 0, Math.PI / 2]}>
          <planeGeometry args={[0.8, 0.1]} />
          <meshBasicMaterial color="#ffffff" />
        </mesh>
      );
    }
  }
  
  return <group>{markings}</group>;
}

function Tree({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      {/* 树干 - 白膜风格 */}
      <mesh position={[0, 0.3, 0]}>
        <cylinderGeometry args={[0.05, 0.08, 0.6, 8]} />
        <meshStandardMaterial color="#e2e8f0" metalness={0} roughness={1} />
      </mesh>
      {/* 树干边线 */}
      <lineSegments position={[0, 0.3, 0]}>
        <edgesGeometry args={[new THREE.CylinderGeometry(0.05, 0.08, 0.6, 8)]} />
        <lineBasicMaterial color="#64748b" />
      </lineSegments>
      
      {/* 树冠 - 浅绿色白膜 */}
      <mesh position={[0, 0.8, 0]}>
        <sphereGeometry args={[0.3, 8, 8]} />
        <meshStandardMaterial color="#bbf7d0" metalness={0} roughness={1} />
      </mesh>
      {/* 树冠边线 */}
      <lineSegments position={[0, 0.8, 0]}>
        <edgesGeometry args={[new THREE.SphereGeometry(0.3, 8, 8)]} />
        <lineBasicMaterial color="#4ade80" />
      </lineSegments>
    </group>
  );
}

interface ExternalModelProps {
  url: string;
  format: ModelFileType;
  onError: (error: string) => void;
  onMeshSelect?: (mesh: ImportedMeshInfo | null) => void;
  selectedMesh?: ImportedMeshInfo | null;
  onMeshListChange?: (meshList: ImportedMeshInfo[]) => void;
  onBoundsComputed?: (bounds: THREE.Box3) => void;
  onScaleComputed?: (scale: number) => void;
  onTransformComputed?: (transform: ModelTransformSnapshot) => void;
  onBuildingsExtracted?: (buildings: PlanViewBuilding[]) => void;
  transformOverride?: ModelTransformSnapshot;
  sightCorridorResult?: SightCorridorResult | null;
  corridorCollisionResult?: CorridorCollisionResult | null;
  showSightCorridorLayer?: boolean;
  showSightCorridorLabels?: boolean;
  showBlockingLabels?: boolean;
  setbackVolumes?: HeightCheckSetbackVolume[];
  showSetbackVolumes?: boolean;
  heightCheckResults?: BuildingResult[];
  showHeightCheckLabels?: boolean;
  showSetbackLabels?: boolean;
  setbackHighlightResult?: SetbackCheckResult | null;
  setbackHighlightTarget?: { type: "overall" | "plot" | null; plotName?: string | null };
  onSetbackPlotSelect?: (plotName: string) => void;
  sceneUpAxis?: UpAxis;
}

function ExternalModel({
  url,
  format,
  onError,
  onMeshSelect,
  selectedMesh,
  onMeshListChange,
  onBoundsComputed,
  onScaleComputed,
  onTransformComputed,
  onBuildingsExtracted,
  transformOverride,
  sightCorridorResult = null,
  corridorCollisionResult = null,
  showSightCorridorLayer = false,
  showSightCorridorLabels = false,
  showBlockingLabels = false,
  setbackVolumes = [],
  showSetbackVolumes = false,
  heightCheckResults = [],
  showHeightCheckLabels = true,
  showSetbackLabels = true,
  setbackHighlightResult = null,
  setbackHighlightTarget = { type: null },
  onSetbackPlotSelect,
  sceneUpAxis = SCENE_UP_AXIS,
}: ExternalModelProps) {
  const [model, setModel] = useState<THREE.Group | null>(null);
  const [meshList, setMeshList] = useState<ImportedMeshInfo[]>([]);
  const [hoveredMesh, setHoveredMesh] = useState<string | null>(null);
  const originalMaterials = useRef<Map<string, THREE.Material | THREE.Material[]>>(new Map());
  const [modelTransform, setModelTransform] = useState<{
    position: THREE.Vector3;
    quaternion: THREE.Quaternion;
    scale: THREE.Vector3;
  } | null>(null);

  useEffect(() => {
    onMeshListChange?.(meshList);
  }, [meshList, onMeshListChange]);

  useEffect(() => {
    const targetUpAxis: Axis = sceneUpAxis;
    const maxFootprintSamples = 2000;

    const computeConvexHull = (points: PlanViewPoint[]) => {
      if (points.length < 3) {
        return [];
      }

      const sorted = [...points].sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
      const cross = (o: PlanViewPoint, a: PlanViewPoint, b: PlanViewPoint) =>
        (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

      const lower: PlanViewPoint[] = [];
      for (const p of sorted) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
          lower.pop();
        }
        lower.push(p);
      }

      const upper: PlanViewPoint[] = [];
      for (let i = sorted.length - 1; i >= 0; i -= 1) {
        const p = sorted[i];
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
          upper.pop();
        }
        upper.push(p);
      }

      lower.pop();
      upper.pop();
      return lower.concat(upper);
    };

    const computeFootprint = (mesh: THREE.Mesh) => {
      const position = mesh.geometry.getAttribute("position");
      if (!position || position.count < 3) {
        return null;
      }

      const step = Math.max(1, Math.floor(position.count / maxFootprintSamples));
      const points: PlanViewPoint[] = [];
      const vertex = new THREE.Vector3();

      for (let i = 0; i < position.count; i += step) {
        vertex.fromBufferAttribute(position, i);
        vertex.applyMatrix4(mesh.matrixWorld);
        points.push({ x: vertex.x, y: vertex.y });
      }

      const hull = computeConvexHull(points);
      return hull.length >= 3 ? hull : null;
    };

    const getRhinoUpRotation = (scene: THREE.Object3D) => {
      const rotations: Record<Axis, THREE.Quaternion> = {
        x: getUpAxisRotation("x", targetUpAxis),
        y: getUpAxisRotation("y", targetUpAxis),
        z: getUpAxisRotation("z", targetUpAxis),
      };

      if (RHINO_UP_AXIS !== "auto") {
        return rotations[RHINO_UP_AXIS];
      }

      const originalQuaternion = scene.quaternion.clone();
      const originalPosition = scene.position.clone();
      const originalScale = scene.scale.clone();
      const size = new THREE.Vector3();
      const box = new THREE.Box3();

      const upIndex = AXIS_INDEX[targetUpAxis];
      const horizontalIndices = [0, 1, 2].filter((index) => index !== upIndex);

      const candidates = (["z", "y", "x"] as const).map((axis) => {
        scene.quaternion.copy(rotations[axis]);
        scene.updateMatrixWorld(true);
        box.setFromObject(scene);
        box.getSize(size);
        const maxHorizontal = Math.max(
          size.getComponent(horizontalIndices[0]),
          size.getComponent(horizontalIndices[1])
        );
        const ratio = maxHorizontal > 0 ? size.getComponent(upIndex) / maxHorizontal : Number.POSITIVE_INFINITY;

        return { axis, rotation: rotations[axis], ratio };
      });

      scene.quaternion.copy(originalQuaternion);
      scene.position.copy(originalPosition);
      scene.scale.copy(originalScale);
      scene.updateMatrixWorld(true);

      candidates.sort((a, b) => a.ratio - b.ratio);
      const best = candidates[0];
      const second = candidates[1];
      const shouldAutoPick =
        best.ratio < RHINO_AUTO_FLAT_RATIO &&
        (!second || best.ratio < second.ratio * RHINO_AUTO_RATIO_MARGIN);

      return shouldAutoPick ? best.rotation : rotations.z;
    };

    const alignPlanarModelToGround = (scene: THREE.Object3D) => {
      if (!RHINO_ALIGN_PLANE_TO_GROUND) {
        return;
      }

      const mean = new THREE.Vector3();
      const samplePoints: THREE.Vector3[] = [];
      let count = 0;
      const cov = [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ];

      const addSample = (point: THREE.Vector3) => {
        count += 1;
        const dx = point.x - mean.x;
        const dy = point.y - mean.y;
        const dz = point.z - mean.z;
        mean.x += dx / count;
        mean.y += dy / count;
        mean.z += dz / count;
        const dx2 = point.x - mean.x;
        const dy2 = point.y - mean.y;
        const dz2 = point.z - mean.z;
        cov[0][0] += dx * dx2;
        cov[0][1] += dx * dy2;
        cov[0][2] += dx * dz2;
        cov[1][1] += dy * dy2;
        cov[1][2] += dy * dz2;
        cov[2][2] += dz * dz2;
      };

      scene.updateMatrixWorld(true);
      scene.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) {
          return;
        }

        const geometry = child.geometry;
        const position = geometry.getAttribute("position");
        if (!position) {
          return;
        }

        const step = Math.max(1, Math.floor(position.count / RHINO_PLANE_SAMPLE_LIMIT));
        const vertex = new THREE.Vector3();

        for (let i = 0; i < position.count; i += step) {
          vertex.fromBufferAttribute(position, i);
          vertex.applyMatrix4(child.matrixWorld);
          addSample(vertex);
          samplePoints.push(vertex.clone());
        }
      });

      if (count < 3) {
        return;
      }

      cov[1][0] = cov[0][1];
      cov[2][0] = cov[0][2];
      cov[2][1] = cov[1][2];

      const jacobiEigenDecomposition = (matrix: number[][]) => {
        const eigenVectors = [
          [1, 0, 0],
          [0, 1, 0],
          [0, 0, 1],
        ];

        for (let iter = 0; iter < 20; iter += 1) {
          let p = 0;
          let q = 1;
          let max = Math.abs(matrix[p][q]);

          for (let i = 0; i < 3; i += 1) {
            for (let j = i + 1; j < 3; j += 1) {
              const value = Math.abs(matrix[i][j]);
              if (value > max) {
                max = value;
                p = i;
                q = j;
              }
            }
          }

          if (max < 1e-10) {
            break;
          }

          const app = matrix[p][p];
          const aqq = matrix[q][q];
          const apq = matrix[p][q];
          const phi = 0.5 * Math.atan2(2 * apq, aqq - app);
          const c = Math.cos(phi);
          const s = Math.sin(phi);

          matrix[p][p] = c * c * app - 2 * s * c * apq + s * s * aqq;
          matrix[q][q] = s * s * app + 2 * s * c * apq + c * c * aqq;
          matrix[p][q] = 0;
          matrix[q][p] = 0;

          for (let i = 0; i < 3; i += 1) {
            if (i === p || i === q) {
              continue;
            }
            const aip = matrix[i][p];
            const aiq = matrix[i][q];
            matrix[i][p] = c * aip - s * aiq;
            matrix[p][i] = matrix[i][p];
            matrix[i][q] = s * aip + c * aiq;
            matrix[q][i] = matrix[i][q];
          }

          for (let i = 0; i < 3; i += 1) {
            const vip = eigenVectors[i][p];
            const viq = eigenVectors[i][q];
            eigenVectors[i][p] = c * vip - s * viq;
            eigenVectors[i][q] = s * vip + c * viq;
          }
        }

        return {
          values: [matrix[0][0], matrix[1][1], matrix[2][2]],
          vectors: eigenVectors,
        };
      };

      const { values, vectors } = jacobiEigenDecomposition(cov);
      const maxValue = Math.max(...values);
      const minValue = Math.min(...values);

      if (maxValue <= 0 || minValue / maxValue > RHINO_PLANE_EIGEN_RATIO) {
        return;
      }

      const minIndex = values.indexOf(minValue);
      const normal = new THREE.Vector3(
        vectors[0][minIndex],
        vectors[1][minIndex],
        vectors[2][minIndex]
      ).normalize();

      const up = AXIS_VECTORS[targetUpAxis];
      let bulkScore = 0;
      const offset = new THREE.Vector3();
      for (const point of samplePoints) {
        offset.subVectors(point, mean);
        bulkScore += offset.dot(normal);
      }
      if (bulkScore < 0) {
        normal.multiplyScalar(-1);
      } else if (Math.abs(bulkScore) < 1e-6 && normal.dot(up) < 0) {
        normal.multiplyScalar(-1);
      }

      const rotation = new THREE.Quaternion().setFromUnitVectors(normal, up);
      scene.applyQuaternion(rotation);
    };

    const applyTransform = (scene: THREE.Object3D) => {
      scene.matrixAutoUpdate = true;
      if (transformOverride) {
        scene.position.set(
          transformOverride.position[0],
          transformOverride.position[1],
          transformOverride.position[2]
        );
        scene.quaternion.set(
          transformOverride.quaternion[0],
          transformOverride.quaternion[1],
          transformOverride.quaternion[2],
          transformOverride.quaternion[3]
        );
        scene.scale.set(
          transformOverride.scale[0],
          transformOverride.scale[1],
          transformOverride.scale[2]
        );
        scene.updateMatrixWorld(true);
        return new THREE.Box3().setFromObject(scene);
      }
      if (format === "3dm") {
        // Align the Rhino up axis to the viewer up axis.
        scene.applyQuaternion(getRhinoUpRotation(scene));
      } else if (sceneUpAxis !== "y") {
        // GLTF/GLB are Y-up; rotate to match the viewer up axis when needed.
        scene.applyQuaternion(getUpAxisRotation("y", targetUpAxis));
      }

      scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(scene);
      const center = box.getCenter(new THREE.Vector3());
      const upIndex = AXIS_INDEX[targetUpAxis];

      scene.position.set(-center.x, -center.y, -center.z);
      scene.position.setComponent(upIndex, -box.min.getComponent(upIndex));

      scene.updateMatrixWorld(true);
      return new THREE.Box3().setFromObject(scene);
    };

    const collectMeshes = (scene: THREE.Object3D, fallbackBounds: THREE.Box3) => {
      const meshes: ImportedMeshInfo[] = [];
      const buildingMeshes: PlanViewBuilding[] = [];
      const fallbackBuildings: PlanViewBuilding[] = [];
      const layers = (scene.userData?.layers ?? []) as Array<{ name?: string }>;
      let hasLayerInfo = false;
      const meshBounds = new THREE.Box3();
      meshBounds.makeEmpty();
      let meshIndex = 0;

        scene.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.castShadow = true;
            child.receiveShadow = true;

            const meshId = `imported-mesh-${meshIndex}`;
            const userTextName = getMeshUserText(child, "建筑名称");
            const objectId = getMeshObjectId(child);
            const meshName = userTextName || child.name || `对象 ${meshIndex + 1}`;
            child.userData.meshId = meshId;
            if (userTextName) {
              child.userData.buildingName = userTextName;
            }
            if (objectId) {
              child.userData.objectId = objectId;
            }
            originalMaterials.current.set(meshId, child.material);

          const whiteMaterial = new THREE.MeshStandardMaterial({
            color: 0xf8fafc,
            metalness: 0,
            roughness: 0.9,
            polygonOffset: true,
            polygonOffsetFactor: 1,
            polygonOffsetUnits: 1,
          });
          child.material = whiteMaterial;

          const edges = new THREE.EdgesGeometry(child.geometry);
          const edgesMaterial = new THREE.LineBasicMaterial({ color: 0x475569, depthWrite: false });
          const edgeLines = new THREE.LineSegments(edges, edgesMaterial);
          edgeLines.userData.isEdgeLine = true;
          edgeLines.renderOrder = 1;
          child.add(edgeLines);

          const meshBox = new THREE.Box3().setFromObject(child);
          meshBounds.union(meshBox);

          const layerIndex = (child.userData as { attributes?: { layerIndex?: number } })?.attributes?.layerIndex;
          const layerName = typeof layerIndex === "number" ? layers[layerIndex]?.name : undefined;
          if (typeof layerIndex === "number") {
            child.userData.layerIndex = layerIndex;
          }
          if (layerName) {
            child.userData.layerName = layerName;
            hasLayerInfo = true;
          }
          if (isSightCorridorLayerName(layerName)) {
            child.userData.isSightCorridorLayer = true;
          }

            meshes.push({
              id: meshId,
              name: meshName,
              mesh: child,
              boundingBox: meshBox,
              layerIndex,
              layerName,
              objectId,
            });

          const buildingEntry = {
            min: [
              meshBox.min.x,
              meshBox.min.y,
              meshBox.min.z,
            ] as [number, number, number],
            max: [
              meshBox.max.x,
              meshBox.max.y,
              meshBox.max.z,
            ] as [number, number, number],
            name: meshName,
            footprint: computeFootprint(child) ?? undefined,
            layerIndex,
            layerName,
          };

          if (isBuildingLayerName(layerName)) {
            buildingMeshes.push(buildingEntry);
          }
          fallbackBuildings.push(buildingEntry);

          meshIndex += 1;
        } else if (child instanceof THREE.Line || child instanceof THREE.LineSegments) {
          // 处理线条对象 - 保持原始颜色
          if (child.material instanceof THREE.LineBasicMaterial || child.material instanceof THREE.LineDashedMaterial) {
            // 线条保持原本颜色，不做修改
            child.renderOrder = 2; // 确保线条在最上层渲染
          }
        } else if (child instanceof THREE.Points) {
          // 处理点对象 - 保持原始颜色
          if (child.material instanceof THREE.PointsMaterial) {
            // 点保持原本颜色，不做修改
            child.renderOrder = 2;
          }
        }
      });

      setMeshList(meshes);
      setModel(scene as THREE.Group);
      if (hasLayerInfo) {
        onBuildingsExtracted?.(buildingMeshes);
      } else {
        onBuildingsExtracted?.(fallbackBuildings);
      }

      // 保存模型的变换信息，用于渲染红色体块
      setModelTransform({
        position: scene.position.clone(),
        quaternion: scene.quaternion.clone(),
        scale: scene.scale.clone(),
      });
      onTransformComputed?.({
        position: [scene.position.x, scene.position.y, scene.position.z],
        quaternion: [scene.quaternion.x, scene.quaternion.y, scene.quaternion.z, scene.quaternion.w],
        scale: [scene.scale.x, scene.scale.y, scene.scale.z],
      });
      onScaleComputed?.(scene.scale.x);

      console.log(`[v0] 模型加载完成，共识别 ${meshes.length} 个子对象`);

      return meshBounds.isEmpty() ? fallbackBounds : meshBounds;
    };

    if (format === "3dm") {
      const loader = new Rhino3dmLoader();
      loader.setLibraryPath(RHINO_LIBRARY_PATH);
      loader.load(
        url,
        (object) => {
          const scene = object.clone(true);
          const bounds = applyTransform(scene);
          const meshBounds = collectMeshes(scene, bounds);
          onBoundsComputed?.(meshBounds);
        },
        undefined,
        (error) => {
          console.error("模型加载失败:", error);
          onError(".3dm 模型加载失败，请检查文件格式是否正确");
        }
      );
    } else {
      const loader = new GLTFLoader();
      loader.load(
        url,
        (gltf) => {
          const scene = gltf.scene.clone(true);
          const bounds = applyTransform(scene);
          const meshBounds = collectMeshes(scene, bounds);
          onBoundsComputed?.(meshBounds);
        },
        undefined,
        (error) => {
          console.error("模型加载失败:", error);
          onError("模型加载失败，请检查文件格式是否正确");
        }
      );
    }

    return () => {
      if (model) {
        model.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry?.dispose();
            if (Array.isArray(child.material)) {
              child.material.forEach(m => m.dispose());
            } else {
              child.material?.dispose();
            }
          }
        });
      }
      originalMaterials.current.clear();
    };
    }, [url, format, sceneUpAxis, transformOverride]);

  const corridorMeshes = useMemo(
    () => meshList.filter((meshInfo) => isSightCorridorLayerName(meshInfo.layerName)),
    [meshList]
  );

  const corridorMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: 0x86efac,
        metalness: 0,
        roughness: 0.8,
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    []
  );

  const corridorCollisionIndex = useMemo(() => {
    const ids = new Set<string>();
    const names = new Set<string>();

    if (corridorCollisionResult) {
      corridorCollisionResult.blocked_buildings.forEach((entry) => {
        if (entry.mesh_id) ids.add(entry.mesh_id);
        const nameKey = normalizeLayerName(entry.building_name);
        if (nameKey) names.add(nameKey);
      });
    }

    return { ids, names };
  }, [corridorCollisionResult]);

  const isCorridorBlockedMesh = useCallback(
    (meshInfo: ImportedMeshInfo) => {
      if (isSightCorridorLayerName(meshInfo.layerName)) return false;
      const nameKey = normalizeLayerName(meshInfo.name);
      return (
        corridorCollisionIndex.ids.has(meshInfo.id) ||
        (nameKey ? corridorCollisionIndex.names.has(nameKey) : false)
      );
    },
    [corridorCollisionIndex]
  );

  useEffect(() => {
    if (!corridorMeshes.length) return;
    corridorMeshes.forEach((meshInfo) => {
      const mesh = meshInfo.mesh;
      mesh.material = corridorMaterial;
      mesh.children.forEach((child) => {
        if (child instanceof THREE.LineSegments && child.userData.isEdgeLine) {
          (child.material as THREE.LineBasicMaterial).color.setHex(0x16a34a);
        }
      });
    });
  }, [corridorMeshes, corridorMaterial]);

  useEffect(() => {
    if (!corridorMeshes.length) return;
    corridorMeshes.forEach((meshInfo) => {
      meshInfo.mesh.visible = showSightCorridorLayer;
    });
  }, [corridorMeshes, showSightCorridorLayer]);

  const sightCorridorVisibility = useMemo(() => {
    const byLayerIndex = new Map<number, "visible" | "blocked" | "out">();
    const byLayerName = new Map<string, "visible" | "blocked" | "out">();
    const byName = new Map<string, "visible" | "blocked" | "out">();

    const normalizeKey = (value?: string | null) => normalizeLayerName(value);

    const addEntry = (
      entry: { building_name: string; layer_index?: number; layer_name?: string },
      status: "visible" | "blocked" | "out"
    ) => {
      if (typeof entry.layer_index === "number") {
        byLayerIndex.set(entry.layer_index, status);
      }
      const layerKey = normalizeKey(entry.layer_name);
      if (layerKey) {
        byLayerName.set(layerKey, status);
      }
      const nameKey = normalizeKey(entry.building_name);
      if (nameKey) {
        byName.set(nameKey, status);
      }
    };

    if (sightCorridorResult) {
      sightCorridorResult.visible_buildings.forEach((entry) => addEntry(entry, "visible"));
      sightCorridorResult.invisible_buildings.forEach((entry) => {
        const status = entry.reason === "被遮挡" ? "blocked" : "out";
        addEntry(entry, status);
      });
    }

    return { byLayerIndex, byLayerName, byName };
  }, [sightCorridorResult]);

  const resolveVisibilityStatus = useCallback((meshInfo: ImportedMeshInfo) => {
    const inBuildingLayer = meshInfo.layerName ? isBuildingLayerName(meshInfo.layerName) : true;
    if (!inBuildingLayer) return null;

    const nameKey = normalizeLayerName(meshInfo.name);
    if (nameKey) {
      const status = sightCorridorVisibility.byName.get(nameKey);
      if (status) return status;
    }

    const hasNameEntries = sightCorridorVisibility.byName.size > 0;
    if (!hasNameEntries) {
      if (typeof meshInfo.layerIndex === "number") {
        const status = sightCorridorVisibility.byLayerIndex.get(meshInfo.layerIndex);
        if (status) return status;
      }
      const layerKey = normalizeLayerName(meshInfo.layerName);
      if (layerKey) {
        const status = sightCorridorVisibility.byLayerName.get(layerKey);
        if (status) return status;
      }
    }

    return null;
  }, [sightCorridorVisibility]);

  const visibilityColors = useMemo(() => ({
    visible: { fill: 0xd1fae5, edge: 0x22c55e, opacity: 1 },
    blocked: { fill: 0xfef3c7, edge: 0xf59e0b, opacity: 1 },
    out: { fill: 0xfee2e2, edge: 0xef4444, opacity: 1 },
  } as const), []);
  const corridorHighlightColors = useMemo(() => ({
    fill: 0xfee2e2,
    edge: 0xf87171,
    opacity: 1,
  } as const), []);

  // 处理高亮效果 + 视线通廊结果着色
  useEffect(() => {

    meshList.forEach((meshInfo) => {
      if (isSightCorridorLayerName(meshInfo.layerName)) {
        return;
      }
      const mesh = meshInfo.mesh;
      const isSelected = selectedMesh?.id === meshInfo.id;
      const isHovered = hoveredMesh === meshInfo.id;
      const isCorridorBlocked = isCorridorBlockedMesh(meshInfo);
      const visibilityStatus = resolveVisibilityStatus(meshInfo);

      if (isSelected || isHovered) {
        // 创建高亮材质 - 保持白膜风格
        const highlightMaterial = new THREE.MeshStandardMaterial({
          color: isSelected ? 0x86efac : 0xbfdbfe, // 绿色或蓝色
          metalness: 0,
          roughness: 0.9,
          polygonOffset: true,
          polygonOffsetFactor: 1,
          polygonOffsetUnits: 1,
        });
        mesh.material = highlightMaterial;

        // 更新边线颜色
        mesh.children.forEach((child) => {
          if (child instanceof THREE.LineSegments && child.userData.isEdgeLine) {
            (child.material as THREE.LineBasicMaterial).color.setHex(
              isSelected ? 0x16a34a : 0x3b82f6
            );
          }
        });
        return;
      }

      if (isCorridorBlocked) {
        const colors = corridorHighlightColors;
        const statusMaterial = new THREE.MeshStandardMaterial({
          color: colors.fill,
          metalness: 0,
          roughness: 0.9,
          transparent: false,
          opacity: colors.opacity,
          depthWrite: true,
          polygonOffset: true,
          polygonOffsetFactor: 1,
          polygonOffsetUnits: 1,
        });
        mesh.material = statusMaterial;

        mesh.children.forEach((child) => {
          if (child instanceof THREE.LineSegments && child.userData.isEdgeLine) {
            (child.material as THREE.LineBasicMaterial).color.setHex(colors.edge);
          }
        });
        return;
      }

      if (!corridorCollisionResult && visibilityStatus) {
        const colors = visibilityColors[visibilityStatus];
        const statusMaterial = new THREE.MeshStandardMaterial({
          color: colors.fill,
          metalness: 0,
          roughness: 0.9,
          transparent: false,
          opacity: colors.opacity,
          depthWrite: true,
          polygonOffset: true,
          polygonOffsetFactor: 1,
          polygonOffsetUnits: 1,
        });
        mesh.material = statusMaterial;

        mesh.children.forEach((child) => {
          if (child instanceof THREE.LineSegments && child.userData.isEdgeLine) {
            (child.material as THREE.LineBasicMaterial).color.setHex(colors.edge);
          }
        });
        return;
      }

      // 恢复白膜材质
      const whiteMaterial = new THREE.MeshStandardMaterial({
        color: 0xf8fafc,
        metalness: 0,
        roughness: 0.9,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      });
      mesh.material = whiteMaterial;

      // 恢复边线颜色
      mesh.children.forEach((child) => {
        if (child instanceof THREE.LineSegments && child.userData.isEdgeLine) {
          (child.material as THREE.LineBasicMaterial).color.setHex(0x475569);
        }
      });
    });
  }, [
    selectedMesh,
    hoveredMesh,
    meshList,
    resolveVisibilityStatus,
    visibilityColors,
    corridorHighlightColors,
    isCorridorBlockedMesh,
    corridorCollisionResult,
  ]);

  const setbackMeshes = useMemo(() => {
    console.log('[ExternalModel] setbackMeshes计算:', {
      showSetbackVolumes,
      setbackVolumesCount: setbackVolumes.length,
      modelTransform: modelTransform ? 'exists' : 'null',
    });

    if (!showSetbackVolumes) {
      console.log('[ExternalModel] showSetbackVolumes=false，不渲染');
      return [];
    }

    const filtered = setbackVolumes.filter((volume) => volume.is_exceeded && volume.points.length >= 3);
    console.log('[ExternalModel] 过滤后的超限地块数量:', filtered.length);

    return filtered
      .map((volume, index) => {
        const points = volume.points;
        const cleanedPoints = points.filter((point, index) => {
          if (index === 0) return true;
          const prev = points[index - 1];
          return !(point[0] === prev[0] && point[1] === prev[1] && point[2] === prev[2]);
        });

        if (cleanedPoints.length < 3) {
          console.log(`[ExternalModel] 地块 ${volume.plot_name} 清理后点数不足3个`);
          return null;
        }

        const first = cleanedPoints[0];
        const last = cleanedPoints[cleanedPoints.length - 1];
        const isClosed = first[0] === last[0] && first[1] === last[1] && first[2] === last[2];
        const polygonPoints = isClosed ? cleanedPoints.slice(0, -1) : cleanedPoints;

        if (polygonPoints.length < 3) {
          console.log(`[ExternalModel] 地块 ${volume.plot_name} 多边形点数不足3个`);
          return null;
        }

        const shape = new THREE.Shape(
          polygonPoints.map((point) => new THREE.Vector2(point[0], point[1]))
        );
        const baseZ = Math.min(...polygonPoints.map((point) => point[2]));

        console.log(`[ExternalModel] 创建红色体块: ${volume.plot_name}`, {
          pointsCount: polygonPoints.length,
          baseZ,
          height: volume.height_limit,
          samplePoints: polygonPoints.slice(0, 3),
        });

        return {
          key: `setback-${volume.plot_name}-${index}`,
          shape,
          baseZ,
          height: volume.height_limit,
        };
      })
      .filter(Boolean) as Array<{
        key: string;
        shape: THREE.Shape;
        baseZ: number;
        height: number;
      }>;
  }, [setbackVolumes, showSetbackVolumes, modelTransform]);

  const buildLineGeometry = useCallback((segments: [number, number, number][][]) => {
    if (!segments.length) return null;
    const positions: number[] = [];
    segments.forEach((segment) => {
      if (segment.length < 2) return;
      const [start, end] = segment;
      positions.push(start[0], start[1], start[2], end[0], end[1], end[2]);
    });
    if (positions.length === 0) return null;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    return geometry;
  }, []);

  const baseHighlightGeometry = useMemo(() => {
    if (!setbackHighlightResult || !setbackHighlightResult.plots?.length) {
      return null;
    }
    const baseSegments: [number, number, number][][] = [];
    setbackHighlightResult.plots.forEach((plot) => {
      const segments = plot.highlight_segments ?? [];
      if (segments.length) {
        baseSegments.push(...segments);
      }
    });
    return buildLineGeometry(baseSegments);
  }, [setbackHighlightResult, buildLineGeometry]);

  const activeHighlightGeometry = useMemo(() => {
    if (!setbackHighlightResult || !setbackHighlightResult.plots?.length) {
      return null;
    }
    const targetType = setbackHighlightTarget?.type ?? null;
    const targetPlot = setbackHighlightTarget?.plotName ?? null;
    if (!targetType) return null;

    const activeSegments: [number, number, number][][] = [];
    setbackHighlightResult.plots.forEach((plot) => {
      const segments = plot.highlight_segments ?? [];
      if (!segments.length) return;
      if (targetType === "overall" || (targetType === "plot" && plot.plot_name === targetPlot)) {
        activeSegments.push(...segments);
      }
    });
    return buildLineGeometry(activeSegments);
  }, [setbackHighlightResult, setbackHighlightTarget, buildLineGeometry]);

  useEffect(() => {
    return () => {
      baseHighlightGeometry?.dispose();
    };
  }, [baseHighlightGeometry]);

  useEffect(() => {
    return () => {
      activeHighlightGeometry?.dispose();
    };
  }, [activeHighlightGeometry]);

  const setbackPlotOverlays = useMemo(() => {
    if (!setbackHighlightResult || !setbackHighlightResult.plots?.length) {
      return [];
    }

    return setbackHighlightResult.plots
      .map((plot, index) => {
        const points = plot.outline_points ?? [];
        if (points.length < 3) return null;

        const cleanedPoints = points.filter((point, idx) => {
          if (idx === 0) return true;
          const prev = points[idx - 1];
          return !(point[0] === prev[0] && point[1] === prev[1] && point[2] === prev[2]);
        });

        if (cleanedPoints.length < 3) return null;

        const first = cleanedPoints[0];
        const last = cleanedPoints[cleanedPoints.length - 1];
        const isClosed = first[0] === last[0] && first[1] === last[1] && first[2] === last[2];
        const polygonPoints = isClosed ? cleanedPoints.slice(0, -1) : cleanedPoints;
        if (polygonPoints.length < 3) return null;

        const shape = new THREE.Shape(polygonPoints.map((point) => new THREE.Vector2(point[0], point[1])));
        const baseZ = Math.min(...polygonPoints.map((point) => point[2]));
        const labelPosition = plot.label_position ?? [0, 0, baseZ + 0.2];

        return {
          key: `setback-plot-${plot.plot_name}-${index}`,
          plotName: plot.plot_name,
          shape,
          baseZ,
          labelPosition: labelPosition as [number, number, number],
          frontageRate: plot.frontage_rate,
          isCompliant: plot.is_compliant ?? null,
        };
      })
      .filter(Boolean) as Array<{
        key: string;
        plotName: string;
        shape: THREE.Shape;
        baseZ: number;
        labelPosition: [number, number, number];
        frontageRate: number;
        isCompliant: boolean | null;
      }>;
  }, [setbackHighlightResult]);

  const getHoverLabelPosition = (box: THREE.Box3) => {
    const centerX = (box.min.x + box.max.x) / 2;
    const centerY = (box.min.y + box.max.y) / 2;
    const centerZ = (box.min.z + box.max.z) / 2;

    if (sceneUpAxis === "z") {
      return [centerX, centerY, box.max.z + 0.3] as [number, number, number];
    }

    return [centerX, box.max.y + 0.3, centerZ] as [number, number, number];
  };

  const visibilityLabelStyles: Record<"visible" | "blocked" | "out", string> = {
    visible: "border-green-500 bg-green-50/90 text-green-700",
    blocked: "border-orange-500 bg-orange-50/90 text-orange-700",
    out: "border-red-500 bg-red-50/90 text-red-700",
  };

  const visibilityLabelText: Record<"visible" | "blocked" | "out", string> = {
    visible: "可见",
    blocked: "被遮挡",
    out: "视野外",
  };

  const sightCorridorLabels = useMemo(() => {
    if (!sightCorridorResult || !showSightCorridorLabels) return [];

    return meshList
      .map((meshInfo) => {
        if (selectedMesh?.id === meshInfo.id || hoveredMesh === meshInfo.id) {
          return null;
        }
        const status = resolveVisibilityStatus(meshInfo);
        if (!status) return null;
        return {
          key: `sight-label-${meshInfo.id}`,
          name: meshInfo.name,
          status,
      position: getHoverLabelPosition(meshInfo.boundingBox),
    };
  })
  .filter(Boolean) as Array<{
      key: string;
      name: string;
      status: "visible" | "blocked" | "out";
      position: [number, number, number];
    }>;
  }, [meshList, selectedMesh, hoveredMesh, resolveVisibilityStatus, sightCorridorResult, showSightCorridorLabels]);

  const corridorBlockingLabels = useMemo(() => {
    if (!corridorCollisionResult || !showBlockingLabels) return [];

    return meshList
      .map((meshInfo) => {
        if (selectedMesh?.id === meshInfo.id || hoveredMesh === meshInfo.id) {
          return null;
        }
        if (!isCorridorBlockedMesh(meshInfo)) return null;
        return {
          key: `corridor-block-${meshInfo.id}`,
          name: meshInfo.name,
          position: getHoverLabelPosition(meshInfo.boundingBox),
        };
      })
      .filter(Boolean) as Array<{
      key: string;
      name: string;
      position: [number, number, number];
    }>;
  }, [meshList, selectedMesh, hoveredMesh, corridorCollisionResult, showBlockingLabels, isCorridorBlockedMesh]);

  const buildingMeshes = useMemo(() => {
    const hasBuildingLayer = meshList.some((meshInfo) => isBuildingLayerName(meshInfo.layerName));
    if (hasBuildingLayer) {
      return meshList.filter((meshInfo) => isBuildingLayerName(meshInfo.layerName));
    }
    return meshList.filter((meshInfo) => !isSightCorridorLayerName(meshInfo.layerName));
  }, [meshList]);

  const heightCheckLabels = useMemo(() => {
    if (!showHeightCheckLabels || heightCheckResults.length === 0) return [];
    const byObjectId = new Map<string, ImportedMeshInfo[]>();
    const byName = new Map<string, ImportedMeshInfo[]>();
    const byLayerIndex = new Map<number, ImportedMeshInfo[]>();
    const byLayerName = new Map<string, ImportedMeshInfo[]>();

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
        normalizeNameKey(meshInfo.mesh.userData?.buildingName) ||
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
    const takeUnused = (list?: ImportedMeshInfo[]) =>
      list?.find((meshInfo) => !usedMeshIds.has(meshInfo.id)) ?? null;

    const labels = heightCheckResults
      .map((result) => {
        let targetMesh: ImportedMeshInfo | null = null;

        const objectIdKey = normalizeObjectId(result.object_id);
        if (objectIdKey) {
          targetMesh = takeUnused(byObjectId.get(objectIdKey));
        }

        const nameKey = normalizeNameKey(result.building_name);
        if (!targetMesh && nameKey) {
          targetMesh = takeUnused(byName.get(nameKey));
        }

        if (!targetMesh && typeof result.layer_index === "number") {
          targetMesh = takeUnused(byLayerIndex.get(result.layer_index));
        }

        if (!targetMesh) {
          const layerKey = normalizeNameKey(result.layer_name);
          if (layerKey) {
            targetMesh = takeUnused(byLayerName.get(layerKey));
          }
        }

        if (!targetMesh && typeof result.building_index === "number") {
          const fallback = buildingMeshes[result.building_index];
          if (fallback && !usedMeshIds.has(fallback.id)) {
            targetMesh = fallback;
          }
        }

        if (!targetMesh) return null;
        usedMeshIds.add(targetMesh.id);

        const labelName =
          result.building_name ||
          targetMesh.mesh.userData?.buildingName ||
          targetMesh.name ||
          `建筑 ${result.building_index + 1}`;

        return {
          key: `height-label-${result.building_index}`,
          name: labelName,
          position: getHoverLabelPosition(targetMesh.boundingBox),
          heightLimit: result.height_limit,
          actualHeight: result.actual_height,
          isExceeded: result.is_exceeded,
          exceedAmount: result.exceed_amount,
        };
      })
      .filter(Boolean) as Array<{
      key: string;
      name: string;
      position: [number, number, number];
      heightLimit: number;
      actualHeight: number;
      isExceeded: boolean;
      exceedAmount: number;
    }>;

    return labels;
  }, [buildingMeshes, heightCheckResults, showHeightCheckLabels]);

  if (!model) {
    return null;
  }

  return (
    <group>
      <primitive
        object={model}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          // 查找点击的 mesh
          const clickedMesh = meshList.find(m => m.mesh === e.object || m.mesh.uuid === e.object.uuid);
          if (clickedMesh && onMeshSelect) {
            onMeshSelect(clickedMesh);
          }
        }}
        onPointerOver={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          const meshId = (e.object as THREE.Mesh).userData?.meshId;
          if (meshId) {
            setHoveredMesh(meshId);
            document.body.style.cursor = "pointer";
          }
        }}
        onPointerOut={() => {
          setHoveredMesh(null);
          document.body.style.cursor = "auto";
        }}
      />

      {/* 红色超限体块 - 独立渲染，应用与模型相同的变换 */}
      {modelTransform && setbackMeshes.length > 0 && (
        <>
          {console.log('[ExternalModel] 渲染红色体块:', {
            meshCount: setbackMeshes.length,
            modelTransform: {
              position: [modelTransform.position.x, modelTransform.position.y, modelTransform.position.z],
              scale: [modelTransform.scale.x, modelTransform.scale.y, modelTransform.scale.z],
            },
          })}
          {setbackMeshes.map((mesh) => (
            <group
              key={mesh.key}
              position={modelTransform.position}
              quaternion={modelTransform.quaternion}
              scale={modelTransform.scale}
            >
              <mesh position={[0, 0, mesh.baseZ]}>
                <extrudeGeometry
                  args={[mesh.shape, { depth: mesh.height, bevelEnabled: false }]}
                />
                <meshStandardMaterial
                  color={0xff0000}
                  transparent
                  opacity={0.5}
                  side={THREE.DoubleSide}
                  depthWrite={false}
                />
              </mesh>
            </group>
          ))}
        </>
      )}

      {/* 贴线率高亮线 - 蓝色为常规与强调 */}
      {modelTransform && baseHighlightGeometry && (
        <group
          position={modelTransform.position}
          quaternion={modelTransform.quaternion}
          scale={modelTransform.scale}
        >
          <lineSegments geometry={baseHighlightGeometry}>
            <lineBasicMaterial
              color={0x3b82f6}
              transparent
              opacity={0.9}
              linewidth={2}
              depthTest={false}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
            />
          </lineSegments>
        </group>
      )}
      {modelTransform && activeHighlightGeometry && (
        <group
          position={modelTransform.position}
          quaternion={modelTransform.quaternion}
          scale={modelTransform.scale}
        >
          <lineSegments geometry={activeHighlightGeometry}>
            <lineBasicMaterial
              color={0x3b82f6}
              transparent
              opacity={1}
              linewidth={3}
              depthTest={false}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
            />
          </lineSegments>
        </group>
      )}

      {/* 贴线率地块标签与点击区域 */}
      {modelTransform && setbackPlotOverlays.length > 0 && (
        <>
          {setbackPlotOverlays.map((plot) => (
            <group
              key={plot.key}
              position={modelTransform.position}
              quaternion={modelTransform.quaternion}
              scale={modelTransform.scale}
            >
              <mesh
                position={[0, 0, plot.baseZ]}
                onClick={(e: ThreeEvent<MouseEvent>) => {
                  e.stopPropagation();
                  onSetbackPlotSelect?.(plot.plotName);
                }}
              >
                <shapeGeometry args={[plot.shape]} />
                <meshBasicMaterial transparent opacity={0} depthWrite={false} />
              </mesh>
              {showSetbackLabels && (
                <Html position={plot.labelPosition} center sprite style={{ pointerEvents: "none" }}>
                  <div
                    className={`rounded px-2 py-1 text-[11px] shadow-sm border min-w-[70px] text-center ${
                      plot.isCompliant === true
                        ? "border-green-500 bg-green-50/90 text-green-700"
                        : plot.isCompliant === false
                          ? "border-orange-500 bg-orange-50/90 text-orange-700"
                          : "border-slate-200 bg-white/90 text-slate-700"
                    }`}
                  >
                    <div className="font-medium">{plot.plotName}</div>
                    <div className={plot.isCompliant === true ? "text-green-800" : plot.isCompliant === false ? "text-orange-800" : "text-slate-500"}>
                      {(plot.frontageRate * 100).toFixed(1)}%
                    </div>
                  </div>
                </Html>
              )}
            </group>
          ))}
        </>
      )}

      {heightCheckLabels.map((label) => (
        <Html key={label.key} position={label.position} center sprite style={{ pointerEvents: "none" }}>
          <div
            className={`rounded px-2 py-1 text-[10px] shadow-sm border whitespace-nowrap ${
              label.isExceeded
                ? "border-red-500 bg-red-50/90 text-red-700"
                : "border-green-500 bg-green-50/90 text-green-700"
            }`}
          >
            <div className="font-medium">{label.name}</div>
            <div className="text-[9px]">{label.isExceeded ? "超限" : "合规"}</div>
            <div className="text-[9px]">限高 {label.heightLimit.toFixed(2)} m</div>
            <div className="text-[9px]">实际 {label.actualHeight.toFixed(2)} m</div>
            {label.isExceeded && (
              <div className="text-[9px]">超出 +{label.exceedAmount.toFixed(2)} m</div>
            )}
          </div>
        </Html>
      ))}

      {sightCorridorLabels.map((label) => (
        <Html key={label.key} position={label.position} center sprite style={{ pointerEvents: "none" }}>
          <div
            className={`rounded px-2 py-1 text-[10px] shadow-sm border whitespace-nowrap ${visibilityLabelStyles[label.status]}`}
          >
            <div className="font-medium">{label.name}</div>
            <div className="text-[9px]">{visibilityLabelText[label.status]}</div>
          </div>
        </Html>
      ))}

      {corridorBlockingLabels.map((label) => (
        <Html key={label.key} position={label.position} center sprite style={{ pointerEvents: "none" }}>
          <div className="rounded px-2 py-1 text-[10px] shadow-sm border whitespace-nowrap border-red-300 bg-red-50/80 text-red-700">
            <div className="font-medium">{label.name}</div>
          </div>
        </Html>
      ))}

      {/* 显示悬停对象的信息 - 只在悬停且未选中时显示，使用固定大小 */}
      {hoveredMesh && !selectedMesh && (
        (() => {
          const hovered = meshList.find(m => m.id === hoveredMesh);
          if (!hovered) return null;
          return (
            <Html
              position={getHoverLabelPosition(hovered.boundingBox)}
              center
              sprite
              style={{ pointerEvents: 'none' }}
            >
              <div className="bg-white/95 border border-slate-200 rounded px-1.5 py-0.5 shadow-sm whitespace-nowrap">
                <p className="text-[10px] font-medium text-slate-700">{hovered.name}</p>
              </div>
            </Html>
          );
        })()
      )}
    </group>
  );
}

function Trees() {
  const treePositions: [number, number, number][] = [
    [-4.5, 0.1, -4.5], [-3.5, 0.1, -4], [-4, 0.1, -3.5],
    [5, 0.1, -4.5], [6, 0.1, -4], [5.5, 0.1, -3.5], [5, 0.1, -3],
    [-5, 0.1, 4], [-4, 0.1, 5], [-3, 0.1, 4.5],
    [3.5, 0.1, 4.5], [4.5, 0.1, 3.5],
  ];
  
  return (
    <group>
      {treePositions.map((pos, i) => (
        <Tree key={`tree-${i}`} position={pos} />
      ))}
    </group>
  );
}

// 导入模型的子对象（代表 Rhino 图层/对象）
export interface ImportedMeshInfo {
  id: string;
  name: string;
  mesh: THREE.Mesh;
  boundingBox: THREE.Box3;
  layerIndex?: number;
  layerName?: string;
  objectId?: string | null;
}

export interface ModelTransformSnapshot {
  position: [number, number, number];
  quaternion: [number, number, number, number];
  scale: [number, number, number];
}

// 平面视口组件 - 用于右侧面板
interface PlanViewportProps {
  modelBounds: THREE.Box3 | null;
  externalModelUrl?: string | null;
  externalModelType?: ModelFileType | null;
  sightCorridorPosition?: SightCorridorPosition | null;
  sightCorridorScale?: number;
  sightCorridorRadius?: number;
  sightCorridorResult?: SightCorridorResult | null;
  corridorCollisionResult?: CorridorCollisionResult | null;
  showSightCorridorLayer?: boolean;
  showSightCorridorLabels?: boolean;
  showBlockingLabels?: boolean;
  modelTransform?: ModelTransformSnapshot | null;
  onPlanViewClick?: (position: SightCorridorPosition) => void;
  onModelError?: (error: string) => void;
  footerContent?: React.ReactNode;
  title?: string;
  withCard?: boolean;
  sceneUpAxis: UpAxis;
}

function PlanViewportCameraController({
  cameraRef,
  controlsRef,
  fitBounds,
  sceneUpAxis,
}: {
  cameraRef: React.RefObject<THREE.OrthographicCamera | null>;
  controlsRef?: React.RefObject<any | null>;
  fitBounds: THREE.Box3 | null;
  sceneUpAxis: UpAxis;
}) {
  const { size } = useThree();

  useEffect(() => {
    const camera = cameraRef.current;
    if (!camera || !fitBounds) return;

    const boundsSize = new THREE.Vector3();
    fitBounds.getSize(boundsSize);
    const center = fitBounds.getCenter(new THREE.Vector3());
    const horizontalWidth = boundsSize.x;
    const horizontalHeight = sceneUpAxis === "z" ? boundsSize.y : boundsSize.z;

    const width = Math.max(horizontalWidth, 0.001);
    const height = Math.max(horizontalHeight, 0.001);
    const fitWidth = size.width / width;
    const fitHeight = size.height / height;
    const targetZoom = Math.min(fitWidth, fitHeight) / CAMERA_FIT_PADDING;

    camera.up.copy(AXIS_VECTORS[sceneUpAxis]);
    camera.zoom = Math.max(MIN_ORTHO_ZOOM, Math.min(MAX_ORTHO_ZOOM, targetZoom));
    const upIndex = AXIS_INDEX[sceneUpAxis];
    const nextPosition = center.clone();
    nextPosition.setComponent(upIndex, camera.position.getComponent(upIndex));
    camera.position.copy(nextPosition);
    camera.lookAt(center);
    camera.updateProjectionMatrix();

    if (controlsRef?.current) {
      controlsRef.current.target.copy(center);
      controlsRef.current.update();
    }
  }, [cameraRef, controlsRef, size.width, size.height, fitBounds, sceneUpAxis]);

  return null;
}

export function PlanViewport({
  modelBounds,
  externalModelUrl,
  externalModelType,
  sightCorridorPosition = null,
  sightCorridorScale = 1,
  sightCorridorRadius = 100,
  sightCorridorResult = null,
  corridorCollisionResult = null,
  showSightCorridorLayer = false,
  showSightCorridorLabels = false,
  showBlockingLabels = false,
  modelTransform = null,
  onPlanViewClick,
  onModelError,
  footerContent,
  title = "平面图",
  withCard = true,
  sceneUpAxis,
}: PlanViewportProps) {
  const personScale = 2 * sightCorridorScale * PERSON_SCALE_MULTIPLIER;
  const hemisphereRadius = Math.max(0, sightCorridorRadius) * sightCorridorScale;
  const cameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const controlsRef = useRef<any | null>(null);
  const [planModelBounds, setPlanModelBounds] = useState<THREE.Box3 | null>(null);
  const fitBounds = planModelBounds ?? modelBounds;
  const { resolvedTheme } = useTheme();
  const isDarkTheme = resolvedTheme === "dark";
  const planBackground = isDarkTheme ? "#0b0f1a" : "#f8fafc";
  const planGridColors = isDarkTheme
    ? { cellColor: "#ffffff", sectionColor: "#ffffff", opacity: 0.2 }
    : { cellColor: "#e0e0e0", sectionColor: "#c0c0c0", opacity: 0.1 };

  useEffect(() => {
    setPlanModelBounds(null);
  }, [externalModelUrl, externalModelType, sceneUpAxis, modelTransform]);

  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!onPlanViewClick) return;

    const camera = cameraRef.current;
    if (!camera) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    const raycaster = new THREE.Raycaster();
    camera.updateMatrixWorld();
    raycaster.setFromCamera(new THREE.Vector2(x, y), camera);

    const groundNormal = AXIS_VECTORS[sceneUpAxis];
    const groundPlane = new THREE.Plane(groundNormal, 0);
    const intersectPoint = new THREE.Vector3();
    const hit = raycaster.ray.intersectPlane(groundPlane, intersectPoint);

    if (hit) {
      if (sceneUpAxis === "z") {
        onPlanViewClick({ x: intersectPoint.x, y: intersectPoint.y, z: 0 });
      } else {
        onPlanViewClick({ x: intersectPoint.x, y: 0, z: intersectPoint.z });
      }
    }
  }, [onPlanViewClick, sceneUpAxis]);

  const viewportContent = (
    <>
      <div className="w-full aspect-square" onClick={handleCanvasClick}>
        <Canvas
          shadows
          style={{ background: planBackground, width: "100%", height: "100%" }}
          gl={{ antialias: true }}
        >
          <OrthographicCamera
            makeDefault
            ref={cameraRef}
            position={[0, 0, 300]}
            near={0.01}
            far={1000}
          />
          <PlanViewportCameraController
            cameraRef={cameraRef}
            controlsRef={controlsRef}
            fitBounds={fitBounds}
            sceneUpAxis={sceneUpAxis}
          />
          <Suspense fallback={null}>
            <ambientLight intensity={0.8} />
            <directionalLight position={[0, 0, 10]} intensity={1.5} />

            <InfiniteGrid
              planeSize={GRID_PLANE_SIZE}
              cellSize={50}
              sectionSize={200}
              cellColor={planGridColors.cellColor}
              sectionColor={planGridColors.sectionColor}
              cellThickness={0.5}
              sectionThickness={1}
              opacity={planGridColors.opacity}
              upAxis={sceneUpAxis}
            />

            {externalModelUrl && externalModelType && (
              <ExternalModel
                url={externalModelUrl}
                format={externalModelType}
                onError={onModelError || (() => {})}
                onMeshSelect={() => {}}
                onBoundsComputed={(bounds) => {
                  setPlanModelBounds(bounds.clone());
                }}
                transformOverride={modelTransform ?? undefined}
                sightCorridorResult={sightCorridorResult}
                corridorCollisionResult={corridorCollisionResult}
                showSightCorridorLayer={showSightCorridorLayer}
                showSightCorridorLabels={showSightCorridorLabels}
                showBlockingLabels={showBlockingLabels}
                sceneUpAxis={sceneUpAxis}
                />
            )}

            {sightCorridorPosition && (
              <>
                <PersonModel
                  position={[sightCorridorPosition.x, sightCorridorPosition.y, sightCorridorPosition.z]}
                  scale={personScale}
                />
                <HemisphereModel
                  position={[sightCorridorPosition.x, sightCorridorPosition.y, sightCorridorPosition.z]}
                  radius={hemisphereRadius}
                  upAxis={sceneUpAxis}
                />
              </>
            )}

            <OrbitControls
              ref={controlsRef}
              enablePan={true}
              enableZoom={true}
              enableRotate={false}
              enableDamping={true}
              dampingFactor={0.1}
              screenSpacePanning={true}
              mouseButtons={{
                LEFT: THREE.MOUSE.PAN,
                MIDDLE: THREE.MOUSE.DOLLY,
                RIGHT: THREE.MOUSE.PAN,
              }}
            />
          </Suspense>
        </Canvas>
      </div>
      {footerContent && (
        <div className="border-t px-2 pb-1 pt-4 mt-4">
          {footerContent}
        </div>
      )}
    </>
  );

  if (!withCard) {
    return <div className="space-y-2">{viewportContent}</div>;
  }

  return (
    <Card className="gap-0">
      <CardHeader className="px-3 py-0">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">{viewportContent}</CardContent>
    </Card>
  );
}

// 相机控制器 - 处理视角位置和 zoom 切换动画
function CameraController({
  viewMode,
  controlsRef,
  isOrthographic,
  fitBounds,
  upAxis,
}: {
  viewMode: ViewMode;
  controlsRef: React.RefObject<any>;
  isOrthographic: boolean;
  fitBounds?: THREE.Box3 | null;
  upAxis: UpAxis;
}) {
  const { camera, size } = useThree();

  // 切换视角时移动相机位置和 zoom
  useEffect(() => {
    const config = getViewConfig(viewMode, upAxis);
    camera.up.copy(AXIS_VECTORS[upAxis]);
    if (controlsRef.current) {
      controlsRef.current.object.up.copy(AXIS_VECTORS[upAxis]);
      controlsRef.current.update();
    }
    const baseDirection = new THREE.Vector3(...config.position).normalize();
    const startPosition = camera.position.clone();
    const duration = 500;
    const startTime = Date.now();

    const isOrthoCamera = camera instanceof THREE.OrthographicCamera;
    const startZoom = isOrthoCamera ? camera.zoom : 1;
    let targetZoom = config.zoom || 15;
    let targetLookAt = new THREE.Vector3(0, 0, 0);
    let targetPosition = new THREE.Vector3(...config.position);

    if (fitBounds) {
      const bounds = fitBounds.clone();
      const center = bounds.getCenter(new THREE.Vector3());
      const sphere = bounds.getBoundingSphere(new THREE.Sphere());
      const radius = Math.max(sphere.radius, 0.001);

      targetLookAt = center;

      if (isOrthoCamera && isOrthographic) {
        const fitHeight = size.height / (2 * radius);
        const fitWidth = size.width / (2 * radius);
        targetZoom = Math.min(fitHeight, fitWidth) / CAMERA_FIT_PADDING;
        targetZoom = Math.max(MIN_ORTHO_ZOOM, Math.min(MAX_ORTHO_ZOOM, targetZoom));
        targetPosition = center.clone().add(baseDirection.multiplyScalar(radius * 2));
        const distance = targetPosition.distanceTo(center);
        const { near, far } = computeClippingPlanes(distance, radius);
        (camera as THREE.OrthographicCamera).near = near;
        (camera as THREE.OrthographicCamera).far = far;
        camera.updateProjectionMatrix();
      } else if (camera instanceof THREE.PerspectiveCamera) {
        const vFov = THREE.MathUtils.degToRad(camera.fov);
        const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
        const fitFov = Math.min(vFov, hFov);
        const distance = (radius / Math.sin(fitFov / 2)) * CAMERA_FIT_PADDING;

        targetPosition = center.clone().add(baseDirection.multiplyScalar(distance));
        const { near, far } = computeClippingPlanes(distance, radius);
        camera.near = near;
        camera.far = far;
        camera.updateProjectionMatrix();
      }
    }

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);

      camera.position.lerpVectors(startPosition, targetPosition, eased);
      camera.lookAt(targetLookAt);

      if (isOrthoCamera && isOrthographic) {
        (camera as THREE.OrthographicCamera).zoom = startZoom + (targetZoom - startZoom) * eased;
        camera.updateProjectionMatrix();
      }

      if (controlsRef.current) {
        controlsRef.current.target.copy(targetLookAt);
        controlsRef.current.update();
      }

      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };

    animate();
  }, [viewMode, camera, controlsRef, isOrthographic, fitBounds, size.height, size.width, upAxis]);

  return null;
}

export interface CitySceneProps {
  onSelectElement: (element: CityElement | null) => void;
  selectedElement: CityElement | null;
  externalModelUrl?: string | null;
  externalModelType?: ModelFileType | null;
  showDemoModel?: boolean;
  onModelError?: (error: string) => void;
  onImportedMeshSelect?: (mesh: ImportedMeshInfo | null) => void;
  selectedImportedMesh?: ImportedMeshInfo | null;
  viewMode?: ViewMode;
  selectionMode?: "building" | "setback" | null;
  onGeometrySelect?: (geometry: any, type: "building" | "setback") => void;
  setbackVolumes?: HeightCheckSetbackVolume[];
  showSetbackVolumes?: boolean;
  heightCheckResults?: BuildingResult[];
  showHeightCheckLabels?: boolean;
  showSetbackLabels?: boolean;
  setbackHighlightResult?: SetbackCheckResult | null;
  setbackHighlightTarget?: { type: "overall" | "plot" | null; plotName?: string | null };
  onSetbackPlotSelect?: (plotName: string) => void;
  sightCorridorPosition?: SightCorridorPosition | null;
  sightCorridorScale?: number;
  sightCorridorRadius?: number;
  sightCorridorResult?: SightCorridorResult | null;
  corridorCollisionResult?: CorridorCollisionResult | null;
  showSightCorridorLayer?: boolean;
  showSightCorridorLabels?: boolean;
  showBlockingLabels?: boolean;
  onModelBoundsComputed?: (bounds: THREE.Box3 | null) => void;
  onModelScaleComputed?: (scale: number) => void;
  onModelTransformComputed?: (transform: ModelTransformSnapshot | null) => void;
  onBuildingsExtracted?: (buildings: PlanViewBuilding[]) => void;
}

export function CityScene({
  onSelectElement,
  selectedElement,
  externalModelUrl,
  externalModelType,
  showDemoModel = true,
  onModelError,
  onImportedMeshSelect,
  selectedImportedMesh,
  viewMode = "perspective",
  selectionMode = null,
  onGeometrySelect,
  setbackVolumes = [],
  showSetbackVolumes = false,
  heightCheckResults = [],
  showHeightCheckLabels = true,
  showSetbackLabels = true,
  setbackHighlightResult = null,
  setbackHighlightTarget = { type: null },
  onSetbackPlotSelect,
  sightCorridorPosition = null,
  sightCorridorScale = 1,
  sightCorridorRadius = 100,
  sightCorridorResult = null,
  corridorCollisionResult = null,
  showSightCorridorLayer = false,
  showSightCorridorLabels = true,
  showBlockingLabels = false,
  onModelBoundsComputed,
  onModelScaleComputed,
  onModelTransformComputed,
  onBuildingsExtracted,
}: CitySceneProps) {
  const [hoveredElement, setHoveredElement] = useState<CityElement | null>(null);
  const [sceneMeshList, setSceneMeshList] = useState<ImportedMeshInfo[]>([]);
  const controlsRef = useRef<any>(null);
  const isOrthographic = viewMode !== "perspective";
  const sceneUpAxis = SCENE_UP_AXIS;
  const demoRotation = getYUpToSceneRotation(sceneUpAxis);
  const mainLightPosition = toSceneUp([15, 25, 15], sceneUpAxis);
  const fillLightPosition = toSceneUp([-10, 15, -10], sceneUpAxis);
  const hemiLightPosition: [number, number, number] = sceneUpAxis === "z" ? [0, 0, 1] : [0, 1, 0];
  const orthoCameraPosition = toSceneUp([50, 50, 50], sceneUpAxis);
  const perspectiveCameraPosition = toSceneUp([30, 24, 30], sceneUpAxis);
  const personScale = 2 * sightCorridorScale * PERSON_SCALE_MULTIPLIER;
  const hemisphereRadius = Math.max(0, sightCorridorRadius) * sightCorridorScale;
  const [modelBounds, setModelBounds] = useState<THREE.Box3 | null>(null);
  const { resolvedTheme } = useTheme();
  const isDarkTheme = resolvedTheme === "dark";
  const sceneBackground = isDarkTheme ? "#0b0f1a" : "#ffffff";
  const gridColors = isDarkTheme
    ? { cellColor: "#ffffff", sectionColor: "#ffffff", opacity: 0.2 }
    : { cellColor: "#e0e0e0", sectionColor: "#c0c0c0", opacity: 0.1 };

  const updateCameraClipping = useCallback(() => {
    const controls = controlsRef.current;
    if (!controls) return;

    const camera = controls.object as THREE.Camera;

    if (!modelBounds) {
      // 没有模型时，重置为默认剪裁平面，避免之前大模型的剪裁值影响演示场景并保持网格可见
      if (camera instanceof THREE.PerspectiveCamera || camera instanceof THREE.OrthographicCamera) {
        camera.near = 0.01;
        camera.far = CLIP_MIN_FAR;
        camera.updateProjectionMatrix();
      }
      return;
    }

    const sphere = modelBounds.getBoundingSphere(new THREE.Sphere());
    const radius = Math.max(sphere.radius, 0.001);
    const distance = camera.position.distanceTo(controls.target);
    const { near, far } = computeClippingPlanes(distance, radius);

    if (camera instanceof THREE.PerspectiveCamera || camera instanceof THREE.OrthographicCamera) {
      camera.near = near;
      camera.far = far;
      camera.updateProjectionMatrix();
    }
  }, [modelBounds]);

  useEffect(() => {
    setModelBounds(null);
    setSceneMeshList([]);
    onModelBoundsComputed?.(null);
    onModelTransformComputed?.(null);
  }, [externalModelUrl, externalModelType]);

  useEffect(() => {
    updateCameraClipping();
  }, [modelBounds, updateCameraClipping]);

  const sceneSnapshot = useMemo(
    () => ({
      selectedElement,
      selectedImportedMesh: selectedImportedMesh ?? null,
      externalModelUrl,
      externalModelType,
      showDemoModel,
      viewMode,
      modelBounds,
      meshList: sceneMeshList,
    }),
    [
      selectedElement,
      selectedImportedMesh,
      externalModelUrl,
      externalModelType,
      showDemoModel,
      viewMode,
      modelBounds,
      sceneMeshList,
    ]
  );

  return (
    <SceneContext.Provider value={sceneSnapshot}>
      <div
        className="w-full h-full relative"
        onContextMenu={(e) => e.preventDefault()}
        style={{ touchAction: 'none' }}
      >
        <Canvas
          shadows
          style={{ background: sceneBackground }}
          onPointerMissed={() => {
            onSelectElement(null);
            onImportedMeshSelect?.(null);
          }}
          gl={{ antialias: true, preserveDrawingBuffer: true }}
        >
          {/* 正交相机 - 用于轴测图和平面图，不设置固定 position/zoom 以支持动画 */}
          {isOrthographic && (
            <OrthographicCamera
              makeDefault
              position={orthoCameraPosition}
              zoom={25}
              near={0.01}
              far={100000}
            />
          )}

          {/* 透视相机 - 用于透视图 */}
          {!isOrthographic && (
            <PerspectiveCamera
              makeDefault
              position={perspectiveCameraPosition}
              fov={45}
              near={0.01}
              far={100000}
            />
          )}
          
          <Suspense fallback={null}>
            <CameraController
              viewMode={viewMode}
              controlsRef={controlsRef}
              isOrthographic={isOrthographic}
              fitBounds={modelBounds}
              upAxis={sceneUpAxis}
            />
            <ambientLight intensity={0.8} />
            <directionalLight
              position={mainLightPosition}
              intensity={1.5}
              castShadow
              shadow-mapSize={[2048, 2048]}
              shadow-camera-far={50}
              shadow-camera-left={-20}
              shadow-camera-right={20}
              shadow-camera-top={20}
              shadow-camera-bottom={-20}
            />
            <directionalLight position={fillLightPosition} intensity={0.4} />
            <hemisphereLight position={hemiLightPosition} color="#ffffff" groundColor="#e2e8f0" intensity={0.6} />

            {/* 无限网格 - 50m间距，淡灰色，真正无限延伸 */}
            <InfiniteGrid
              planeSize={GRID_PLANE_SIZE}
              cellSize={50}
              sectionSize={200}
              cellColor={gridColors.cellColor}
              sectionColor={gridColors.sectionColor}
              cellThickness={0.5}
              sectionThickness={1}
              opacity={gridColors.opacity}
              upAxis={sceneUpAxis}
            />

          <group rotation={demoRotation}>
            <RoadMarkings />
            {showDemoModel && mockCityElements.map((element) => (
              <CityElementMesh
                key={element.id}
                element={element}
                isSelected={selectedElement?.id === element.id}
                isHovered={hoveredElement?.id === element.id}
                onSelect={onSelectElement}
                onHover={setHoveredElement}
              />
            ))}
          </group>

          {externalModelUrl && externalModelType && (
            <ExternalModel
              url={externalModelUrl}
              format={externalModelType}
              onError={onModelError || (() => {})}
              onMeshSelect={(mesh) => {
                if (selectionMode && onGeometrySelect) {
                  onGeometrySelect(mesh, selectionMode);
                } else if (onImportedMeshSelect) {
                  onImportedMeshSelect(mesh);
                }
              }}
              selectedMesh={selectedImportedMesh}
              onMeshListChange={setSceneMeshList}
              onBoundsComputed={(bounds) => {
                const clonedBounds = bounds.clone();
                setModelBounds(clonedBounds);
                onModelBoundsComputed?.(clonedBounds);
              }}
              onScaleComputed={(scale) => {
                onModelScaleComputed?.(scale);
              }}
              onTransformComputed={(transform) => {
                onModelTransformComputed?.(transform);
              }}
              onBuildingsExtracted={onBuildingsExtracted}
              sightCorridorResult={sightCorridorResult}
              corridorCollisionResult={corridorCollisionResult}
              showSightCorridorLayer={showSightCorridorLayer}
              showSightCorridorLabels={showSightCorridorLabels}
              showBlockingLabels={showBlockingLabels}
              setbackVolumes={setbackVolumes}
              showSetbackVolumes={showSetbackVolumes}
              heightCheckResults={heightCheckResults}
              showHeightCheckLabels={showHeightCheckLabels}
              showSetbackLabels={showSetbackLabels}
              setbackHighlightResult={setbackHighlightResult}
              setbackHighlightTarget={setbackHighlightTarget}
              onSetbackPlotSelect={onSetbackPlotSelect}
              sceneUpAxis={sceneUpAxis}
            />
          )}

          {/* 视线通廊检测 - 人形模型和半球体 */}
          {sightCorridorPosition && (
            <>
              {/* 小人模型：位置在监测点，高度1.8m */}
              <PersonModel
                position={[sightCorridorPosition.x, sightCorridorPosition.y, sightCorridorPosition.z]}
                scale={personScale}
              />
              {/* 半球体：球心贴地（z=0），向上延伸 */}
              <HemisphereModel
                position={[sightCorridorPosition.x, sightCorridorPosition.y, sightCorridorPosition.z]}
                radius={hemisphereRadius}
                upAxis={sceneUpAxis}
              />
            </>
          )}

          <SceneExtensions />

          <OrbitControls
            ref={controlsRef}
            makeDefault
            enablePan={true}
            enableZoom={true}
            enableRotate={!isOrthographic}
            enableDamping={true}
            dampingFactor={0.1}
            screenSpacePanning={true}
            onChange={updateCameraClipping}
            mouseButtons={{
              LEFT: isOrthographic ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE,
              MIDDLE: THREE.MOUSE.DOLLY,
              RIGHT: THREE.MOUSE.PAN
            }}
            touches={{
              ONE: isOrthographic ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE,
              TWO: THREE.TOUCH.DOLLY_PAN
            }}
            maxPolarAngle={Math.PI / 2.2}
            minDistance={MIN_ORBIT_DISTANCE}
            maxDistance={MAX_ORBIT_DISTANCE}
            minZoom={MIN_ORTHO_ZOOM}
            maxZoom={MAX_ORTHO_ZOOM}
            zoomSpeed={1.2}
            panSpeed={0.8}
            rotateSpeed={0.5}
          />
        </Suspense>
      </Canvas>
      <SceneOverlays />
    </div>
    </SceneContext.Provider>
  );
}
