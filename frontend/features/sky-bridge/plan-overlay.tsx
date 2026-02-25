"use client";

import { useMemo } from "react";
import * as THREE from "three";
import type { ModelTransformSnapshot } from "@/components/city-scene";
import type { PlotInfo, SkyBridgeConnection } from "./types";

interface PlanOverlayProps {
  plots: PlotInfo[];
  connections: SkyBridgeConnection[];
  selectedPlot: string | null;
  modelTransform?: ModelTransformSnapshot | null;
  onPlotClick?: (name: string) => void;
}

const buildShapePoints = (plot: PlotInfo) => {
  if (plot.polygon.length >= 3) {
    return plot.polygon.map((pt) => [pt[0], pt[1]] as [number, number]);
  }

  const size = 3;
  const [cx, cy] = plot.center;
  return [
    [cx - size, cy - size],
    [cx - size, cy + size],
    [cx + size, cy + size],
    [cx + size, cy - size],
  ];
};

function PlotMesh({
  plot,
  isSelected,
  baseZ,
  onPlotClick,
}: {
  plot: PlotInfo;
  isSelected: boolean;
  baseZ: number;
  onPlotClick?: (name: string) => void;
}) {
  const shapePoints = useMemo(() => buildShapePoints(plot), [plot]);
  const shape = useMemo(() => {
    const next = new THREE.Shape();
    next.moveTo(shapePoints[0][0], shapePoints[0][1]);
    for (let i = 1; i < shapePoints.length; i += 1) {
      next.lineTo(shapePoints[i][0], shapePoints[i][1]);
    }
    next.closePath();
    return next;
  }, [shapePoints]);

  const outlinePoints = useMemo(
    () => shapePoints.map(([x, y]) => new THREE.Vector3(x, y, baseZ + 0.02)),
    [shapePoints, baseZ]
  );

  const outlineGeometry = useMemo(
    () => new THREE.BufferGeometry().setFromPoints(outlinePoints),
    [outlinePoints]
  );

  return (
    <group>
      <mesh
        position={[0, 0, baseZ]}
        onPointerDown={(event) => {
          event.stopPropagation();
          onPlotClick?.(plot.name);
        }}
      >
        <shapeGeometry args={[shape]} />
        <meshBasicMaterial
          color={isSelected ? "#bfdbfe" : "#e2e8f0"}
          transparent
          opacity={isSelected ? 0.45 : 0.25}
          depthWrite={false}
          depthTest={false}
        />
      </mesh>
      <lineLoop geometry={outlineGeometry}>
        <lineBasicMaterial color={isSelected ? "#3b82f6" : "#94a3b8"} depthTest={false} />
      </lineLoop>
    </group>
  );
}

function ConnectionLine({
  start,
  end,
  color,
}: {
  start: [number, number, number];
  end: [number, number, number];
  color: string;
}) {
  const geometry = useMemo(() => {
    const points = [new THREE.Vector3(...start), new THREE.Vector3(...end)];
    return new THREE.BufferGeometry().setFromPoints(points);
  }, [start, end]);

  return (
    <lineSegments geometry={geometry} userData={{ isOverlayLine: true }} renderOrder={3}>
      <lineBasicMaterial color={color} depthTest={false} />
    </lineSegments>
  );
}

export function SkyBridgePlanOverlay({
  plots,
  connections,
  selectedPlot,
  modelTransform,
  onPlotClick,
}: PlanOverlayProps) {
  const plotByName = useMemo(() => {
    const map = new Map<string, PlotInfo>();
    plots.forEach((plot) => map.set(plot.name, plot));
    return map;
  }, [plots]);

  const maxZ = useMemo(() => {
    return plots.reduce((value, plot) => Math.max(value, plot.top_z ?? 0), 0);
  }, [plots]);

  const lineZ = maxZ + 0.08;

  const content = (
    <>
      {connections.map((connection) => {
        const plotA = plotByName.get(connection.from);
        const plotB = plotByName.get(connection.to);
        if (!plotA || !plotB) return null;
        return (
          <ConnectionLine
            key={`${connection.from}-${connection.to}`}
            start={[plotA.center[0], plotA.center[1], lineZ]}
            end={[plotB.center[0], plotB.center[1], lineZ]}
            color="#22c55e"
          />
        );
      })}

      {plots.map((plot) => (
        <PlotMesh
          key={plot.name}
          plot={plot}
          isSelected={selectedPlot === plot.name}
          baseZ={maxZ + 0.02}
          onPlotClick={onPlotClick}
        />
      ))}
    </>
  );

  if (modelTransform) {
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

  return <group>{content}</group>;
}
