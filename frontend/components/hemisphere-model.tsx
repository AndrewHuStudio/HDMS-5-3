/**
 * 半球体可视范围模型
 * 球心贴地，径向渐变效果（球心深色，边缘浅色）
 */

import { useRef, useMemo } from "react";
import * as THREE from "three";

interface HemisphereModelProps {
  position: [number, number, number];
  radius: number;
  upAxis?: "y" | "z";
}

export function HemisphereModel({ position, radius, upAxis = "z" }: HemisphereModelProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const upDir = useMemo(() => (upAxis === "z" ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0)), [upAxis]);
  const rotation = upAxis === "z" ? ([Math.PI / 2, 0, 0] as const) : ([0, 0, 0] as const);

  // 创建径向渐变材质（浅白到透明绿色）
  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      uniforms: {
        radius: { value: radius },
        centerColor: { value: new THREE.Color(0xf8fafc) }, // 浅白色
        edgeColor: { value: new THREE.Color(0x22c55e) },   // 绿色
        centerOpacity: { value: 0.32 },
        edgeOpacity: { value: 0.03 },
        upDir: { value: upDir },
      },
      vertexShader: `
        varying vec3 vPosition;
        varying float vDist;
        uniform float radius;
        uniform vec3 upDir;

        void main() {
          vPosition = position;
          vec3 worldCenter = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          vec3 worldPos = (modelMatrix * vec4(position, 1.0)).xyz;
          vec3 rel = worldPos - worldCenter;
          float height = dot(rel, upDir);
          vec3 planar = rel - height * upDir;
          vDist = length(planar) / radius;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 centerColor;
        uniform vec3 edgeColor;
        uniform float centerOpacity;
        uniform float edgeOpacity;
        varying float vDist;

        void main() {
          float t = clamp(pow(vDist, 1.3), 0.0, 1.0);
          float opacity = mix(centerOpacity, edgeOpacity, t);
          vec3 color = mix(centerColor, edgeColor, t);
          gl_FragColor = vec4(color, opacity);
        }
      `,
    });
  }, [radius, upDir]);

  return (
    <mesh ref={meshRef} position={position} material={material} rotation={rotation}>
      {/* 半球几何体：从0到π/2（上半球） */}
      <sphereGeometry args={[radius, 32, 32, 0, Math.PI * 2, 0, Math.PI / 2]} />
    </mesh>
  );
}
