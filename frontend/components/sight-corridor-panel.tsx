"use client";

import { useState, useEffect, useRef, useCallback, useMemo, isValidElement, cloneElement } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Slider } from "@/components/ui/slider";
import { AlertCircle, Navigation, Trash2, Eye, CheckCircle2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { API_BASE, normalizeApiBase } from "@/lib/api-base";
import type {
  SightCorridorResult,
  SightCorridorPosition,
  PlanViewBuilding,
  CorridorCollisionResult,
} from "@/lib/sight-corridor-types";

type PlanViewportInjectedProps = {
  onPlanViewClick?: (position: SightCorridorPosition) => void;
  footerContent?: React.ReactNode;
};

interface SightCorridorPanelProps {
  modelFilePath: string | null;
  modelFile?: File | null;
  onModelPathResolved?: (modelPath: string) => void;
  currentPosition?: SightCorridorPosition | null;
  sceneScale?: number;
  hemisphereRadius?: number;
  onHemisphereRadiusChange?: (radius: number) => void;
  onPositionChange?: (position: SightCorridorPosition | null) => void;
  onResultChange?: (result: SightCorridorResult | null) => void;
  sightCorridorResult?: SightCorridorResult | null;
  modelBounds?: { min: [number, number, number]; max: [number, number, number] };
  buildings?: PlanViewBuilding[];
  planViewportComponent?: React.ReactNode | React.ElementType<PlanViewportInjectedProps>;
  corridorCollisionResult?: CorridorCollisionResult | null;
  corridorLayerVisible?: boolean;
  onCorridorCheckRequest?: () => void;
  onCorridorCheckClear?: () => void;
  showSightCorridorLabels?: boolean;
  onShowSightCorridorLabelsChange?: (show: boolean) => void;
  showBlockingLabels?: boolean;
  onShowBlockingLabelsChange?: (show: boolean) => void;
}

const isPlanViewportElementType = (
  value: unknown
): value is React.ElementType<PlanViewportInjectedProps> =>
  typeof value === "function" ||
  (typeof value === "object" &&
    value !== null &&
    "$$typeof" in (value as Record<string, unknown>));

export function SightCorridorPanel({
  modelFilePath,
  modelFile,
  onModelPathResolved,
  currentPosition,
  sceneScale = 1,
  hemisphereRadius,
  onHemisphereRadiusChange,
  onPositionChange,
  onResultChange,
  sightCorridorResult = null,
  modelBounds,
  buildings = [],
  planViewportComponent,
  corridorCollisionResult = null,
  corridorLayerVisible = false,
  onCorridorCheckRequest,
  onCorridorCheckClear,
  showSightCorridorLabels,
  onShowSightCorridorLabelsChange,
  showBlockingLabels,
  onShowBlockingLabelsChange,
}: SightCorridorPanelProps) {
  const apiBase = normalizeApiBase(API_BASE);
  const [isPlacementMode, setIsPlacementMode] = useState(false);
  const [position, setPosition] = useState<SightCorridorPosition | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [corridorError, setCorridorError] = useState<string | null>(null);
  const [localShowLabels, setLocalShowLabels] = useState(true);
  const [localShowBlockingLabels, setLocalShowBlockingLabels] = useState(true);
  const [uploadedModelPath, setUploadedModelPath] = useState<string | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [activeKeys, setActiveKeys] = useState<Set<string>>(() => new Set());
  const [localHemisphereRadius, setLocalHemisphereRadius] = useState(100);
  const buildingLayer = "模型_建筑体块";
  // 移动速度（单位/秒），修改此值即可调整移动速度
  const moveSpeed = 150;
  const isObserverPlaced = position !== null;
  const safeScale = Number.isFinite(sceneScale) && sceneScale > 0 ? sceneScale : 1;
  const showLabels = showSightCorridorLabels ?? localShowLabels;
  const showBlocking = showBlockingLabels ?? localShowBlockingLabels;

  const keysPressed = useRef<Set<string>>(new Set());
  const animationFrameRef = useRef<number | null>(null);
  const lastUpdateTimeRef = useRef<number>(Date.now());
  const positionRef = useRef<SightCorridorPosition | null>(null);
  const buildingsRef = useRef<PlanViewBuilding[]>(buildings);
  const uploadInFlightRef = useRef<Promise<string | null> | null>(null);
  const moveSpeedRef = useRef(moveSpeed);
  const safeScaleRef = useRef(safeScale);
  const modelBoundsRef = useRef(modelBounds);
  const onPositionChangeRef = useRef(onPositionChange);
  const fetchVisibilityRef = useRef<
    (pos: SightCorridorPosition, modelPathOverride?: string | null) => Promise<void> | void
  >(() => {});
  const effectiveHemisphereRadius =
    Number.isFinite(hemisphereRadius) && (hemisphereRadius as number) > 0
      ? (hemisphereRadius as number)
      : localHemisphereRadius;

  const effectiveModelPath =
    modelFilePath || (modelFile?.name === uploadedFileName ? uploadedModelPath : null);

  const getGroundZ = useCallback(
    (fallback = 0) => {
      const buildingList = buildingsRef.current ?? [];
      let buildingMinZ = Number.POSITIVE_INFINITY;
      for (const building of buildingList) {
        const z = building?.min?.[2];
        if (Number.isFinite(z)) {
          buildingMinZ = Math.min(buildingMinZ, z as number);
        }
      }
      if (Number.isFinite(buildingMinZ) && buildingMinZ !== Number.POSITIVE_INFINITY) {
        return Math.max(0, buildingMinZ);
      }

      const bounds = modelBoundsRef.current ?? modelBounds;
      const z = bounds?.min?.[2];
      if (!Number.isFinite(z)) return fallback;
      return Math.max(0, z as number);
    },
    [modelBounds]
  );

  useEffect(() => {
    setUploadedModelPath(null);
    setUploadedFileName(null);
  }, [modelFile]);

  const isSamePosition = (a: SightCorridorPosition | null, b: SightCorridorPosition | null) => {
    if (!a || !b) return false;
    return a.x === b.x && a.y === b.y && a.z === b.z;
  };

  // 同步外部传入的位置（来自平面图点击）
  useEffect(() => {
    if (!currentPosition) {
      if (position) {
        setPosition(null);
      }
      onResultChange?.(null);
      return;
    }
    const grounded = { x: currentPosition.x, y: currentPosition.y, z: getGroundZ(currentPosition.z) };
    if (isSamePosition(position, grounded)) {
      return;
    }
    setPosition(grounded);
    positionRef.current = grounded;
    setIsPlacementMode(false);
    fetchVisibility(grounded);
  }, [currentPosition, getGroundZ]);

  useEffect(() => {
    positionRef.current = position;
  }, [position]);

  useEffect(() => {
    if (!positionRef.current) return;
    const groundedZ = getGroundZ(positionRef.current.z);
    if (positionRef.current.z === groundedZ) return;
    const updated = { ...positionRef.current, z: groundedZ };
    setPosition(updated);
    positionRef.current = updated;
    onPositionChangeRef.current?.(updated);
  }, [getGroundZ]);

  useEffect(() => {
    moveSpeedRef.current = moveSpeed;
    safeScaleRef.current = safeScale;
    modelBoundsRef.current = modelBounds;
    onPositionChangeRef.current = onPositionChange;
  }, [moveSpeed, safeScale, modelBounds, onPositionChange]);

  useEffect(() => {
    buildingsRef.current = buildings;
  }, [buildings]);

  const syncActiveKeys = useCallback(() => {
    setActiveKeys(new Set(keysPressed.current));
  }, []);

  useEffect(() => {
    if (!position) {
      keysPressed.current.clear();
      syncActiveKeys();
    }
  }, [position, syncActiveKeys]);

  const resolveModelPath = useCallback(async () => {
    if (effectiveModelPath) {
      return effectiveModelPath;
    }
    if (!modelFile) {
      setError("请先上传3dm模型文件");
      return null;
    }
    if (uploadInFlightRef.current) {
      return uploadInFlightRef.current;
    }

    uploadInFlightRef.current = (async () => {
      try {
        const formData = new FormData();
        formData.append("file", modelFile);

        const uploadUrl = `${apiBase}/models/import?skip_layers=true`;
        const uploadResponse = await fetch(uploadUrl, {
          method: "POST",
          body: formData,
        });

        if (!uploadResponse.ok) {
          if (uploadResponse.status === 404) {
            throw new Error(`模型上传接口未找到: ${uploadUrl}`);
          }
          const errorData = await uploadResponse.json().catch(() => ({}));
          throw new Error(errorData.detail || "模型上传失败");
        }

        const uploadData = await uploadResponse.json();
        const resolvedPath = uploadData.model_path as string | undefined;
        if (resolvedPath) {
          setUploadedModelPath(resolvedPath);
          setUploadedFileName(modelFile.name);
          onModelPathResolved?.(resolvedPath);
        }

        return resolvedPath ?? null;
      } catch (err) {
        console.error("模型上传失败:", err);
        setError(err instanceof Error ? err.message : "模型上传失败");
        return null;
      } finally {
        uploadInFlightRef.current = null;
      }
    })();

    return uploadInFlightRef.current;
  }, [apiBase, effectiveModelPath, modelFile, onModelPathResolved]);

  const isPointInsideBuilding = (point: SightCorridorPosition, building: PlanViewBuilding) => {
    const [minX, minY] = building.min;
    const [maxX, maxY] = building.max;
    if (![minX, minY, maxX, maxY].every(Number.isFinite)) return false;
    return point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY;
  };

  const getNearestOutsidePoint = (
    point: SightCorridorPosition,
    building: PlanViewBuilding,
    margin = 0.5
  ) => {
    const [minX, minY] = building.min;
    const [maxX, maxY] = building.max;
    const distances = [
      { dir: "left", dist: point.x - minX },
      { dir: "right", dist: maxX - point.x },
      { dir: "bottom", dist: point.y - minY },
      { dir: "top", dist: maxY - point.y },
    ].filter((d) => Number.isFinite(d.dist));

    if (distances.length === 0) return point;
    distances.sort((a, b) => a.dist - b.dist);
    const closest = distances[0];

    switch (closest.dir) {
      case "left":
        return { ...point, x: minX - margin };
      case "right":
        return { ...point, x: maxX + margin };
      case "bottom":
        return { ...point, y: minY - margin };
      case "top":
        return { ...point, y: maxY + margin };
      default:
        return point;
    }
  };

  const resolvePointOutsideBuildings = (point: SightCorridorPosition) => {
    const buildingList = buildingsRef.current ?? [];
    if (buildingList.length === 0) {
      return { point, adjusted: false };
    }

    let adjusted = false;
    let working = { ...point };
    for (let iter = 0; iter < 5; iter += 1) {
      let bestCandidate: SightCorridorPosition | null = null;
      let bestDistance = Number.POSITIVE_INFINITY;
      let insideAny = false;

      for (const building of buildingList) {
        if (!isPointInsideBuilding(working, building)) continue;
        insideAny = true;
        const candidate = getNearestOutsidePoint(working, building);
        const dx = candidate.x - working.x;
        const dy = candidate.y - working.y;
        const dist = dx * dx + dy * dy;
        if (dist < bestDistance) {
          bestDistance = dist;
          bestCandidate = candidate;
        }
      }

      if (!insideAny || !bestCandidate) break;
      working = { ...bestCandidate, z: point.z };
      adjusted = true;
    }

    return { point: working, adjusted };
  };

  const isPointBlocked = (point: SightCorridorPosition) => {
    const buildingList = buildingsRef.current ?? [];
    if (buildingList.length === 0) return false;
    return buildingList.some((building) => isPointInsideBuilding(point, building));
  };

  // 键盘控制：连续移动
  const updatePosition = useCallback(() => {
    const currentPosition = positionRef.current;
    if (!currentPosition) {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      return;
    }

    const now = Date.now();
    const deltaTime = (now - lastUpdateTimeRef.current) / 1000;
    lastUpdateTimeRef.current = now;

    let newX = currentPosition.x;
    let newY = currentPosition.y;
    const moveDistance = moveSpeedRef.current * deltaTime * safeScaleRef.current;

    if (keysPressed.current.has("ArrowUp")) {
      newY += moveDistance;
    }
    if (keysPressed.current.has("ArrowDown")) {
      newY -= moveDistance;
    }
    if (keysPressed.current.has("ArrowLeft")) {
      newX -= moveDistance;
    }
    if (keysPressed.current.has("ArrowRight")) {
      newX += moveDistance;
    }

    // 边界限制
    const bounds = modelBoundsRef.current;
    if (bounds) {
      newX = Math.max(bounds.min[0], Math.min(bounds.max[0], newX));
      newY = Math.max(bounds.min[1], Math.min(bounds.max[1], newY));
    }

    if (newX !== currentPosition.x || newY !== currentPosition.y) {
      const newPosition = { x: newX, y: newY, z: getGroundZ(0) };
      if (isPointBlocked(newPosition)) {
        if (keysPressed.current.size > 0) {
          animationFrameRef.current = requestAnimationFrame(updatePosition);
        } else {
          animationFrameRef.current = null;
        }
        return;
      }
      console.log('[SightCorridorPanel] updatePosition:', newPosition);
      setPosition(newPosition);
      positionRef.current = newPosition;
      onPositionChangeRef.current?.(newPosition);
      fetchVisibilityRef.current?.(newPosition);
    }

    if (keysPressed.current.size > 0) {
      animationFrameRef.current = requestAnimationFrame(updatePosition);
    } else {
      animationFrameRef.current = null;
    }
  }, []);

  const startMove = useCallback((direction: string) => {
    if (!positionRef.current) return;
    keysPressed.current.add(direction);
    syncActiveKeys();
    if (!animationFrameRef.current) {
      lastUpdateTimeRef.current = Date.now();
      animationFrameRef.current = requestAnimationFrame(updatePosition);
    }
  }, [syncActiveKeys, updatePosition]);

  const stopMove = useCallback((direction: string) => {
    keysPressed.current.delete(direction);
    syncActiveKeys();
    if (keysPressed.current.size === 0 && animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  }, [syncActiveKeys]);

  // 键盘事件监听
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
        if (!positionRef.current) {
          console.log('[SightCorridorPanel] keydown ignored: no position');
          return;
        }
        console.log('[SightCorridorPanel] keydown:', e.key);
        e.preventDefault();
        keysPressed.current.add(e.key);
        syncActiveKeys();

        if (!animationFrameRef.current) {
          lastUpdateTimeRef.current = Date.now();
          animationFrameRef.current = requestAnimationFrame(updatePosition);
          console.log('[SightCorridorPanel] animation started');
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
        console.log('[SightCorridorPanel] keyup:', e.key);
        keysPressed.current.delete(e.key);
        syncActiveKeys();

        if (keysPressed.current.size === 0 && animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
          animationFrameRef.current = null;
          console.log('[SightCorridorPanel] animation stopped');
        }
      }
    };

    const handleBlur = () => {
      if (keysPressed.current.size === 0) return;
      keysPressed.current.clear();
      syncActiveKeys();
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
        console.log('[SightCorridorPanel] animation stopped (blur)');
      }
    };

    console.log('[SightCorridorPanel] keyboard listeners attached');
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [syncActiveKeys, updatePosition]);

  // 获取可见性数据
  const fetchVisibility = async (pos: SightCorridorPosition, modelPathOverride?: string | null) => {
    const resolvedPath = modelPathOverride ?? effectiveModelPath;
    if (!resolvedPath) return;

    try {
      const observerPosition = {
        x: pos.x / safeScale,
        y: pos.y / safeScale,
        z: pos.z / safeScale,
      };
      const checkUrl = `${apiBase}/sight-corridor/check`;
      const response = await fetch(checkUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model_path: resolvedPath,
          building_layer: buildingLayer,
          observer_position: observerPosition,
          hemisphere_radius: effectiveHemisphereRadius,
        }),
      });

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(`检测接口未找到: ${checkUrl}`);
        }
        throw new Error("检测失败");
      }

      const data = await response.json();
      onResultChange?.(data);
      setError(null);
    } catch (err) {
      console.error("可见性检测失败:", err);
    }
  };

  useEffect(() => {
    fetchVisibilityRef.current = fetchVisibility;
  }, [fetchVisibility]);

  useEffect(() => {
    if (!positionRef.current) return;
    resolveModelPath().then((resolvedPath) => {
      if (!resolvedPath) return;
      fetchVisibility(positionRef.current as SightCorridorPosition, resolvedPath);
    });
  }, [effectiveHemisphereRadius, resolveModelPath]);

  // 放入检测点
  const handlePlaceObserver = () => {
    setIsPlacementMode(true);
    setError(null);
  };

  // 删除检测点
  const handleRemoveObserver = () => {
    setIsPlacementMode(false);
    setPosition(null);
    onResultChange?.(null);
    keysPressed.current.clear();
    syncActiveKeys();
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (onPositionChange) {
      onPositionChange(null);
    }
  };

  const handleCorridorCheck = () => {
    if (!modelFilePath && !modelFile) {
      setCorridorError("请先上传3dm模型文件");
      return;
    }
    setCorridorError(null);
    onCorridorCheckRequest?.();
  };

  const handleCorridorClear = () => {
    setCorridorError(null);
    onCorridorCheckClear?.();
  };

  // 从平面图点击设置位置
  const handlePositionClick = (pos: SightCorridorPosition) => {
    console.log('[SightCorridorPanel] handlePositionClick:', pos);
    const grounded = { x: pos.x, y: pos.y, z: getGroundZ(0) };
    const resolved = resolvePointOutsideBuildings(grounded);
    setPosition(resolved.point);
    setIsPlacementMode(false);
    if (onPositionChange) {
      onPositionChange(resolved.point);
    }
    resolveModelPath().then((resolvedPath) => {
      fetchVisibility(resolved.point, resolvedPath);
    });
  };

  const movementControls = position ? (
    <div className="flex items-center justify-center gap-1.5">
      <Button
        size="sm"
        variant={activeKeys.has("ArrowUp") ? "default" : "outline"}
        className="h-7 w-7 p-0"
        onPointerDown={() => startMove("ArrowUp")}
        onPointerUp={() => stopMove("ArrowUp")}
        onPointerLeave={() => stopMove("ArrowUp")}
        onPointerCancel={() => stopMove("ArrowUp")}
        onMouseDown={() => startMove("ArrowUp")}
        onMouseUp={() => stopMove("ArrowUp")}
        onMouseLeave={() => stopMove("ArrowUp")}
        onTouchStart={() => startMove("ArrowUp")}
        onTouchEnd={() => stopMove("ArrowUp")}
      >
        ↑
      </Button>
      <Button
        size="sm"
        variant={activeKeys.has("ArrowDown") ? "default" : "outline"}
        className="h-7 w-7 p-0"
        onPointerDown={() => startMove("ArrowDown")}
        onPointerUp={() => stopMove("ArrowDown")}
        onPointerLeave={() => stopMove("ArrowDown")}
        onPointerCancel={() => stopMove("ArrowDown")}
        onMouseDown={() => startMove("ArrowDown")}
        onMouseUp={() => stopMove("ArrowDown")}
        onMouseLeave={() => stopMove("ArrowDown")}
        onTouchStart={() => startMove("ArrowDown")}
        onTouchEnd={() => stopMove("ArrowDown")}
      >
        ↓
      </Button>
      <Button
        size="sm"
        variant={activeKeys.has("ArrowLeft") ? "default" : "outline"}
        className="h-7 w-7 p-0"
        onPointerDown={() => startMove("ArrowLeft")}
        onPointerUp={() => stopMove("ArrowLeft")}
        onPointerLeave={() => stopMove("ArrowLeft")}
        onPointerCancel={() => stopMove("ArrowLeft")}
        onMouseDown={() => startMove("ArrowLeft")}
        onMouseUp={() => stopMove("ArrowLeft")}
        onMouseLeave={() => stopMove("ArrowLeft")}
        onTouchStart={() => startMove("ArrowLeft")}
        onTouchEnd={() => stopMove("ArrowLeft")}
      >
        ←
      </Button>
      <Button
        size="sm"
        variant={activeKeys.has("ArrowRight") ? "default" : "outline"}
        className="h-7 w-7 p-0"
        onPointerDown={() => startMove("ArrowRight")}
        onPointerUp={() => stopMove("ArrowRight")}
        onPointerLeave={() => stopMove("ArrowRight")}
        onPointerCancel={() => stopMove("ArrowRight")}
        onMouseDown={() => startMove("ArrowRight")}
        onMouseUp={() => stopMove("ArrowRight")}
        onMouseLeave={() => stopMove("ArrowRight")}
        onTouchStart={() => startMove("ArrowRight")}
        onTouchEnd={() => stopMove("ArrowRight")}
      >
        →
      </Button>
    </div>
  ) : null;

  const resolvedPlanViewport = useMemo(() => {
    if (!planViewportComponent) return null;
    if (isValidElement(planViewportComponent)) {
      return cloneElement(
        planViewportComponent as React.ReactElement<PlanViewportInjectedProps>,
        {
          onPlanViewClick: handlePositionClick,
          footerContent: movementControls,
        }
      );
    }

    if (isPlanViewportElementType(planViewportComponent)) {
      const Component = planViewportComponent;
      return (
        <Component
          onPlanViewClick={handlePositionClick}
          footerContent={movementControls}
        />
      );
    }

    if (typeof planViewportComponent === "string" || typeof planViewportComponent === "number") {
      return planViewportComponent;
    }

    return null;
  }, [planViewportComponent, handlePositionClick, movementControls]);

  const corridorBlockedBuildings = corridorCollisionResult?.blocked_buildings ?? [];
  const corridorStatus = corridorCollisionResult?.status ?? null;
  const hasCorridorBlocks = corridorBlockedBuildings.length > 0;
  const visibleBuildings = sightCorridorResult?.visible_buildings ?? [];
  const invisibleBuildings = sightCorridorResult?.invisible_buildings ?? [];
  const totalVisibilityCount = visibleBuildings.length + invisibleBuildings.length;
  const visibilityItems = useMemo(
    () => [
      ...invisibleBuildings.map((item) => ({ ...item, is_visible: false })),
      ...visibleBuildings.map((item) => ({ ...item, is_visible: true })),
    ],
    [invisibleBuildings, visibleBuildings]
  );

  return (
    <div className="space-y-2">
      {/* 视线通廊检测 */}
      <Card className="gap-0">
        <CardHeader className="px-3 py-0">
          <CardTitle className="text-sm">视线通廊检测</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 px-3 pb-3 pt-2">
          <div className="flex gap-2">
            <Button
              size="sm"
              className="flex-1"
              onClick={handleCorridorCheck}
              disabled={!modelFilePath && !modelFile}
            >
              检测
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="flex-1"
              onClick={handleCorridorClear}
              disabled={!corridorCollisionResult && !corridorLayerVisible}
            >
              清除检测结果
            </Button>
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>显示阻挡建筑标记</span>
            <Switch
              checked={showBlocking}
              disabled={!corridorCollisionResult || !hasCorridorBlocks}
              onCheckedChange={(checked) => {
                if (onShowBlockingLabelsChange) {
                  onShowBlockingLabelsChange(checked);
                } else {
                  setLocalShowBlockingLabels(checked);
                }
              }}
            />
          </div>

          {corridorError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-sm">{corridorError}</AlertDescription>
            </Alert>
          )}

          {corridorStatus === "missing_corridor" && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-sm">
                未找到图层：限制_视线通廊
              </AlertDescription>
            </Alert>
          )}

          {corridorStatus === "missing_buildings" && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-sm">
                未找到建筑体块图层（模型_建筑体块）
              </AlertDescription>
            </Alert>
          )}

          
        </CardContent>
      </Card>

      {(corridorStatus === "clear" || corridorStatus === "blocked") && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">通廊检测结果</CardTitle>
              <div className="flex items-center gap-2">
                {corridorStatus === "clear" ? (
                  <div className="text-xs px-2.5 py-1 rounded-full font-medium bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">
                    未遮挡
                  </div>
                ) : (
                  <div className="text-xs px-2.5 py-1 rounded-full font-medium bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300">
                    {corridorBlockedBuildings.length} 遮挡
                  </div>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-2.5 max-h-[240px] overflow-y-auto pt-2">
            {corridorStatus === "clear" ? (
              <div className="border rounded-lg p-3 transition-all hover:shadow-sm border-green-200 bg-green-50/50 dark:border-green-800 dark:bg-green-950/30">
                <div className="flex items-center gap-1.5 text-green-700 dark:text-green-400">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span className="text-xs font-medium">视线通廊未发现遮挡</span>
                </div>
              </div>
            ) : (
              corridorBlockedBuildings.map((building, index) => (
                <div
                  key={`${building.mesh_id ?? building.building_name}-${index}`}
                  className="border rounded-lg p-3 transition-all hover:shadow-sm border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-950/30"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-sm">{building.building_name}</span>
                    <div className="flex items-center gap-1.5 text-red-700 dark:text-red-400">
                      <AlertCircle className="h-3.5 w-3.5" />
                      <span className="text-xs font-medium">通廊遮挡</span>
                    </div>
                  </div>
                  {(building.layer_name || building.layer_index !== undefined) && (
                    <div className="space-y-1 text-xs">
                      {building.layer_name && (
                        <div className="flex justify-between items-center py-0.5">
                          <span className="text-muted-foreground">图层:</span>
                          <span className="font-medium">{building.layer_name}</span>
                        </div>
                      )}
                      {building.layer_index !== undefined && (
                        <div className="flex justify-between items-center py-0.5">
                          <span className="text-muted-foreground">图层编号:</span>
                          <span className="font-medium">{building.layer_index}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      )}

      {/* 错误提示 */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="text-sm">{error}</AlertDescription>
        </Alert>
      )}

      {/* 视野检测 */}
      <Card className="gap-0">
        <CardHeader className="px-3 py-0">
          <CardTitle className="text-sm">视野检测</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 px-3 pb-3 pt-2">
          <div className="flex items-center justify-between p-2 rounded-lg border bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950 dark:to-indigo-950">
            <div className="flex items-center gap-3">
              <div className="p-1.5 rounded-lg bg-white dark:bg-gray-800 shadow-sm">
                <Eye className="h-4 w-4 text-blue-600" />
              </div>
              <div>
                <Label className="text-xs font-medium cursor-pointer">显示视线通廊标记</Label>
                <p className="text-[11px] text-muted-foreground">
                  {sightCorridorResult ? "已生成检测结果" : "暂无检测结果"}
                </p>
              </div>
            </div>
            <Switch
              checked={showLabels}
              disabled={!sightCorridorResult}
              onCheckedChange={(checked) => {
                if (onShowSightCorridorLabelsChange) {
                  onShowSightCorridorLabelsChange(checked);
                } else {
                  setLocalShowLabels(checked);
                }
              }}
            />
          </div>
          {resolvedPlanViewport}
          <div className="space-y-2 border-t pt-2">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>视野半径</span>
                <span>{Math.round(effectiveHemisphereRadius)}m</span>
              </div>
              <Slider
                value={[effectiveHemisphereRadius]}
                min={50}
                max={300}
                step={1}
                onValueChange={(value) => {
                  const next = value?.[0];
                  if (!Number.isFinite(next)) return;
                  if (onHemisphereRadiusChange) {
                    onHemisphereRadiusChange(next);
                  } else {
                    setLocalHemisphereRadius(next);
                  }
                }}
              />
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                className={`flex-1 transition-colors ${
                  isPlacementMode
                    ? "bg-green-600 hover:bg-green-700 text-white"
                    : isObserverPlaced
                      ? "bg-yellow-400 hover:bg-yellow-500 text-black disabled:opacity-100"
                      : ""
                }`}
                onClick={handlePlaceObserver}
                disabled={(!modelFilePath && !modelFile) || isObserverPlaced}
              >
                <Navigation className="h-4 w-4 mr-2" />
                {isPlacementMode ? "点击平面图放置" : isObserverPlaced ? "检测点已放置" : "放入检测点"}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                className="flex-1"
                onClick={handleRemoveObserver}
                disabled={!position && !isPlacementMode}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                删除检测点
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {totalVisibilityCount > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">视野检测结果</CardTitle>
              <div className="flex items-center gap-2">
                <div className="text-xs px-2.5 py-1 rounded-full font-medium bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">
                  {visibleBuildings.length}/{totalVisibilityCount} 可见
                </div>
                {invisibleBuildings.length > 0 && (
                  <div className="text-xs px-2.5 py-1 rounded-full font-medium bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300">
                    {invisibleBuildings.length} 不可见
                  </div>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-2.5 max-h-[320px] overflow-y-auto pt-2">
            {visibilityItems.map((building, index) => (
              <div
                key={`${building.building_name}-${index}`}
                className={`border rounded-lg p-3 transition-all hover:shadow-sm ${
                  building.is_visible
                    ? "border-green-200 bg-green-50/50 dark:border-green-800 dark:bg-green-950/30"
                    : "border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-950/30"
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-sm">
                    {building.building_name || `建筑 ${index + 1}`}
                  </span>
                  {building.is_visible ? (
                    <div className="flex items-center gap-1.5 text-green-700 dark:text-green-400">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span className="text-xs font-medium">可见</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-red-700 dark:text-red-400">
                      <AlertCircle className="h-3.5 w-3.5" />
                      <span className="text-xs font-medium">不可见</span>
                    </div>
                  )}
                </div>

                <div className="space-y-1 text-xs">
                  <div className="flex justify-between items-center py-0.5">
                    <span className="text-muted-foreground">距离:</span>
                    <span
                      className={`font-medium ${
                        building.is_visible
                          ? "text-green-700 dark:text-green-400"
                          : "text-red-700 dark:text-red-400"
                      }`}
                    >
                      {Number.isFinite(building.distance) ? `${building.distance.toFixed(2)} m` : "-"}
                    </span>
                  </div>
                  {building.layer_name && (
                    <div className="flex justify-between items-center py-0.5">
                      <span className="text-muted-foreground">图层:</span>
                      <span className="font-medium">{building.layer_name}</span>
                    </div>
                  )}
                  {!building.is_visible && building.reason && (
                    <div className="flex justify-between items-center pt-1.5 mt-1.5 border-t border-border">
                      <span className="text-red-600 dark:text-red-400 font-medium">原因:</span>
                      <span className="text-red-700 dark:text-red-300 font-bold">
                        {building.reason}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* 使用提示 */}
      {isPlacementMode && !position && (
        <Alert className="border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950">
          <Eye className="h-4 w-4 text-green-600" />
          <AlertDescription className="text-xs text-green-600 dark:text-green-400">
            请在上方平面图视口中点击放置检测点
          </AlertDescription>
        </Alert>
      )}

    </div>
  );
}
