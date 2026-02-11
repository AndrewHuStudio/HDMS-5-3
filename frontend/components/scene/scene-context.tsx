"use client";

import { createContext, useContext } from "react";
import type { CityElement } from "@/lib/city-data";
import type * as THREE from "three";

export type SceneViewMode = "perspective" | "isometric-ne" | "isometric-nw" | "isometric-se" | "isometric-sw" | "plan";
export type SceneModelFileType = "gltf" | "glb" | "3dm";

export interface SceneImportedMeshInfo {
  id: string;
  name: string;
  mesh: THREE.Mesh;
  boundingBox: THREE.Box3;
  layerIndex?: number;
  layerName?: string;
  objectId?: string | null;
}

export interface SceneModelTransformSnapshot {
  position: [number, number, number];
  quaternion: [number, number, number, number];
  scale: [number, number, number];
}

export interface SceneSnapshot {
  selectedElement: CityElement | null;
  selectedImportedMesh: SceneImportedMeshInfo | null;
  externalModelUrl?: string | null;
  externalModelType?: SceneModelFileType | null;
  viewMode?: SceneViewMode;
  modelBounds?: THREE.Box3 | null;
  modelScale?: number;
  modelTransform?: SceneModelTransformSnapshot | null;
  meshList: SceneImportedMeshInfo[];
}

export const SceneContext = createContext<SceneSnapshot | null>(null);

export const useSceneSnapshot = () => useContext(SceneContext);
