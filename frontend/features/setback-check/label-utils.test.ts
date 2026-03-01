import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import type { SetbackViolationResult } from "./types";
import { buildSetbackLabels } from "./label-utils";

type MeshInfoLike = Parameters<typeof buildSetbackLabels>[1][number];

function createMeshInfo(input: {
  id: string;
  name: string;
  min: [number, number, number];
  max: [number, number, number];
  objectId?: string;
  buildingName?: string;
}): MeshInfoLike {
  const mesh = new THREE.Mesh();
  mesh.userData = {
    objectId: input.objectId,
    buildingName: input.buildingName,
  };
  return {
    id: input.id,
    name: input.name,
    mesh,
    boundingBox: new THREE.Box3(
      new THREE.Vector3(...input.min),
      new THREE.Vector3(...input.max)
    ),
    objectId: input.objectId ?? null,
  };
}

test("buildSetbackLabels matches by object id and building name with status fields", () => {
  const result: SetbackViolationResult = {
    status: "ok",
    summary: {
      total_buildings: 2,
      exceeded_count: 1,
      compliant_count: 1,
      unmatched_buildings: 0,
    },
    buildings: [
      {
        building_index: 0,
        building_name: "A栋",
        plot_name: "N-01",
        is_exceeded: false,
        object_id: "obj-a",
      },
      {
        building_index: 1,
        building_name: "B栋",
        plot_name: "N-02",
        is_exceeded: true,
        reason: "missing_setback",
      },
    ],
  };
  const meshes: MeshInfoLike[] = [
    createMeshInfo({
      id: "mesh-a",
      name: "A栋",
      min: [0, 0, 0],
      max: [2, 2, 6],
      objectId: "obj-a",
    }),
    createMeshInfo({
      id: "mesh-b",
      name: "B栋",
      min: [10, 10, 0],
      max: [12, 14, 8],
    }),
  ];

  const labels = buildSetbackLabels(result, meshes, "z");

  assert.equal(labels.length, 2);
  assert.equal(labels[0]?.name, "A栋");
  assert.equal(labels[0]?.isExceeded, false);
  assert.equal(labels[0]?.plotName, "N-01");
  assert.equal(labels[0]?.statusText, "合规");

  assert.equal(labels[1]?.name, "B栋");
  assert.equal(labels[1]?.isExceeded, true);
  assert.equal(labels[1]?.reasonText, "未匹配退线");
  assert.equal(labels[1]?.statusText, "超限");
  assert.deepEqual(labels[1]?.position, [11, 12, 8.3]);
});

test("buildSetbackLabels falls back to building index when identifiers are missing", () => {
  const result: SetbackViolationResult = {
    status: "ok",
    summary: {
      total_buildings: 1,
      exceeded_count: 1,
      compliant_count: 0,
      unmatched_buildings: 0,
    },
    buildings: [
      {
        building_index: 1,
        building_name: "",
        plot_name: null,
        is_exceeded: true,
      },
    ],
  };
  const meshes: MeshInfoLike[] = [
    createMeshInfo({
      id: "mesh-0",
      name: "0号楼",
      min: [0, 0, 0],
      max: [2, 2, 2],
    }),
    createMeshInfo({
      id: "mesh-1",
      name: "1号楼",
      min: [4, 4, 0],
      max: [8, 8, 4],
    }),
  ];

  const labels = buildSetbackLabels(result, meshes, "z");

  assert.equal(labels.length, 1);
  assert.equal(labels[0]?.name, "1号楼");
  assert.deepEqual(labels[0]?.position, [6, 6, 4.3]);
});
