/**
 * 人形3D模型组件
 * 简单的火柴人造型：圆形头部 + 椭圆形身体
 * 总高度：1.8m
 */

import { useRef } from "react";
import * as THREE from "three";

interface PersonModelProps {
  position: [number, number, number];
  scale?: number | [number, number, number];
}

export function PersonModel({ position, scale = 1 }: PersonModelProps) {
  const groupRef = useRef<THREE.Group>(null);
  const scaleZ = Array.isArray(scale) ? (scale[2] ?? 1) : scale;
  const groundedPosition: [number, number, number] = [
    position[0],
    position[1],
    position[2] - 0.45 * scaleZ,
  ];

  return (
    <group ref={groupRef} position={groundedPosition} scale={scale}>
      {/* 头部 - 圆形 */}
      <mesh position={[0, 0, 1.68]}>
        <sphereGeometry args={[0.12, 16, 16]} />
        <meshBasicMaterial color="#991b1b" />
      </mesh>

      {/* 身体 - 椭圆形 */}
      <mesh position={[0, 0, 0.9]} scale={[1, 1, 3]}>
        <sphereGeometry args={[0.15, 16, 16]} />
        <meshBasicMaterial color="#991b1b" />
      </mesh>
    </group>
  );
}
