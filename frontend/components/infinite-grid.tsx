"use client";

import { useRef, useMemo } from "react";
import * as THREE from "three";

interface InfiniteGridProps {
  planeSize?: number;
  cellSize?: number;
  sectionSize?: number;
  cellColor?: string;
  sectionColor?: string;
  cellThickness?: number;
  sectionThickness?: number;
  opacity?: number;
  upAxis?: "y" | "z";
}

export function InfiniteGrid({
  planeSize = 100000,
  cellSize = 50,
  sectionSize = 200,
  cellColor = "#F5F5F5",
  sectionColor = "#DCDCDC",
  cellThickness = 0.5,
  sectionThickness = 1,
  opacity = 0.1,
  upAxis = "z",
}: InfiniteGridProps) {
  const gridRef = useRef<THREE.Mesh>(null);
  const gridRotation = upAxis === "z"
    ? ([0, 0, 0] as const)
    : ([-Math.PI / 2, 0, 0] as const);

  const shader = useMemo(() => {
    return {
      vertexShader: `
        varying vec2 gridPosition;
        void main() {
          gridPosition = position.xy;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float cellSize;
        uniform float sectionSize;
        uniform vec3 cellColor;
        uniform vec3 sectionColor;
        uniform float cellThickness;
        uniform float sectionThickness;
        uniform float opacity;
        varying vec2 gridPosition;

        float getGrid(float size, float thickness) {
          vec2 coord = gridPosition / size;
          vec2 grid = abs(fract(coord - 0.5) - 0.5) / fwidth(coord);
          float line = min(grid.x, grid.y);
          return 1.0 - min(line / thickness, 1.0);
        }

        void main() {
          float cellGrid = getGrid(cellSize, cellThickness);
          float sectionGrid = getGrid(sectionSize, sectionThickness);

          vec3 color = mix(cellColor, sectionColor, sectionGrid);
          float alpha = max(cellGrid, sectionGrid);

          if (alpha < 0.01) discard;

          gl_FragColor = vec4(color, alpha * opacity);
        }
      `,
      uniforms: {
        cellSize: { value: cellSize },
        sectionSize: { value: sectionSize },
        cellColor: { value: new THREE.Color(cellColor) },
        sectionColor: { value: new THREE.Color(sectionColor) },
        cellThickness: { value: cellThickness },
        sectionThickness: { value: sectionThickness },
        opacity: { value: opacity },
      },
    };
  }, [cellSize, sectionSize, cellColor, sectionColor, cellThickness, sectionThickness, opacity]);

  return (
    <mesh ref={gridRef} rotation={gridRotation} position={[0, 0, 0]}>
      <planeGeometry args={[planeSize, planeSize]} />
      <shaderMaterial
        vertexShader={shader.vertexShader}
        fragmentShader={shader.fragmentShader}
        uniforms={shader.uniforms}
        transparent={true}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  );
}
