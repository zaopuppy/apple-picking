import * as THREE from 'three';
import type { IslandMaterials } from './IslandMaterials';

const MATERIAL_KEYS = [
  'wood',
  'woodDark',
  'soil',
  'sandLight',
  'roof',
  'roofLight',
  'foliage',
] as const;

type RegionPropMaterialKey = typeof MATERIAL_KEYS[number];

type BoxPart = {
  material: RegionPropMaterialKey;
  x: number;
  y: number;
  z: number;
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  rotationY?: number;
};

type RegionPropCluster = {
  id: string;
  parts: BoxPart[];
};

export type IslandRegionPropVisual = {
  root: THREE.Group;
  clusters: number;
  propInstances: number;
  instancedMeshes: number;
};

export function createIslandRegionPropVisual(
  materials: IslandMaterials,
): IslandRegionPropVisual {
  const clusters = createRegionPropClusters();
  const parts = clusters.flatMap((cluster) => cluster.parts);
  const root = new THREE.Group();
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const matrix = new THREE.Object3D();
  let instancedMeshes = 0;

  root.name = 'island-p3a-region-story-props';
  root.userData.clusterIds = clusters.map((cluster) => cluster.id);

  for (const materialKey of MATERIAL_KEYS) {
    const materialParts = parts.filter((part) => part.material === materialKey);
    if (materialParts.length === 0) continue;
    const mesh = new THREE.InstancedMesh(
      geometry,
      materials[materialKey],
      materialParts.length,
    );
    materialParts.forEach((part, index) => {
      matrix.position.set(part.x, part.y, part.z);
      matrix.rotation.set(0, part.rotationY ?? 0, 0);
      matrix.scale.set(part.sizeX, part.sizeY, part.sizeZ);
      matrix.updateMatrix();
      mesh.setMatrixAt(index, matrix.matrix);
    });
    mesh.name = `island-region-props-${materialKey}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.needsUpdate = true;
    root.add(mesh);
    instancedMeshes += 1;
  }

  return {
    root,
    clusters: clusters.length,
    propInstances: parts.length,
    instancedMeshes,
  };
}

function createRegionPropClusters(): RegionPropCluster[] {
  return [
    createOrchardTerraceMarket(),
    createHouseServiceCluster(),
    createGardenPlanterCluster(),
    createBeachPicnicCluster(),
    createPlazaOfferingCluster(),
  ];
}

function createOrchardTerraceMarket(): RegionPropCluster {
  const parts: BoxPart[] = [
    box('sandLight', -18.4, 0.67, -21.15, 16.8, 0.06, 2.25),
  ];
  appendMarketTable(parts, -24.2, -21.15, 'roof');
  appendMarketTable(parts, -12.6, -21.05, 'roofLight');
  return { id: 'orchard-terrace-market', parts };
}

function appendMarketTable(
  parts: BoxPart[],
  x: number,
  z: number,
  accent: 'roof' | 'roofLight',
): void {
  parts.push(box('wood', x, 1.27, z, 3.35, 0.18, 1.55));
  for (const offsetX of [-1.35, 1.35]) {
    for (const offsetZ of [-0.55, 0.55]) {
      parts.push(box('woodDark', x + offsetX, 0.96, z + offsetZ, 0.2, 0.62, 0.2));
    }
  }
  parts.push(
    box('woodDark', x - 0.92, 1.51, z, 0.82, 0.3, 1.1),
    box('wood', x + 0.08, 1.48, z, 0.9, 0.24, 1.08),
    box('woodDark', x + 1.08, 1.51, z, 0.78, 0.3, 1.1),
  );
  for (let index = 0; index < 6; index += 1) {
    const column = index % 3;
    const row = Math.floor(index / 3);
    parts.push(box(
      index % 2 === 0 ? accent : 'foliage',
      x - 0.9 + column * 0.9,
      1.74,
      z - 0.3 + row * 0.6,
      0.34,
      0.2,
      0.34,
    ));
  }
}

function createHouseServiceCluster(): RegionPropCluster {
  const parts: BoxPart[] = [];
  appendWindowPlanter(parts, 18.4, -14.35, 'roof');
  appendWindowPlanter(parts, 24.5, -14.35, 'roofLight');
  parts.push(
    box('wood', 25.25, 0.83, -13.98, 1.05, 0.55, 0.92),
    box('woodDark', 25.25, 1.15, -13.98, 1.12, 0.12, 0.98),
    box('roofLight', 25.25, 1.21, -13.98, 0.18, 0.04, 1.02),
    box('woodDark', 24.42, 0.72, -13.9, 0.62, 0.34, 0.58),
    box('sandLight', 24.42, 0.91, -13.9, 0.66, 0.05, 0.62),
  );
  return { id: 'house-service-planters', parts };
}

function appendWindowPlanter(
  parts: BoxPart[],
  x: number,
  z: number,
  accent: 'roof' | 'roofLight',
): void {
  parts.push(
    box('woodDark', x, 0.76, z, 2.05, 0.22, 0.74),
    box('soil', x, 0.9, z, 1.72, 0.12, 0.5),
    box('wood', x - 0.93, 0.91, z, 0.17, 0.5, 0.78),
    box('wood', x + 0.93, 0.91, z, 0.17, 0.5, 0.78),
  );
  for (let index = -2; index <= 2; index += 1) {
    parts.push(box(
      index % 2 === 0 ? accent : 'foliage',
      x + index * 0.37,
      1.09 + Math.abs(index) * 0.025,
      z,
      0.24,
      0.32,
      0.24,
    ));
  }
}

function createGardenPlanterCluster(): RegionPropCluster {
  const parts: BoxPart[] = [];
  appendRaisedBed(parts, 27.4, 5.8, 4.8, 1.55, false);
  appendRaisedBed(parts, 29.1, 9.15, 3.6, 1.45, true);
  return { id: 'garden-raised-beds', parts };
}

function appendRaisedBed(
  parts: BoxPart[],
  x: number,
  z: number,
  length: number,
  width: number,
  rotate: boolean,
): void {
  const sizeX = rotate ? width : length;
  const sizeZ = rotate ? length : width;
  parts.push(
    box('woodDark', x, 0.12, z, sizeX, 0.18, sizeZ),
    box('soil', x, 0.23, z, sizeX - 0.34, 0.08, sizeZ - 0.34),
    box('wood', x - sizeX / 2 + 0.1, 0.31, z, 0.2, 0.34, sizeZ),
    box('wood', x + sizeX / 2 - 0.1, 0.31, z, 0.2, 0.34, sizeZ),
    box('wood', x, 0.31, z - sizeZ / 2 + 0.1, sizeX - 0.4, 0.34, 0.2),
    box('wood', x, 0.31, z + sizeZ / 2 - 0.1, sizeX - 0.4, 0.34, 0.2),
  );
  for (let index = -2; index <= 2; index += 1) {
    const offset = index * (rotate ? 0.7 : 0.82);
    parts.push(box(
      index % 2 === 0 ? 'roofLight' : 'foliage',
      x + (rotate ? 0 : offset),
      0.49,
      z + (rotate ? offset : 0),
      0.28,
      0.36,
      0.28,
    ));
  }
}

function createBeachPicnicCluster(): RegionPropCluster {
  const parts: BoxPart[] = [
    box('sandLight', -29.15, 0.055, 17.55, 3.6, 0.06, 2.35),
    box('roofLight', -29.15, 0.09, 17.15, 3.45, 0.03, 0.35),
    box('roof', -29.15, 0.09, 17.95, 3.45, 0.03, 0.35),
    box('wood', -30.7, 0.38, 19.25, 1.25, 0.68, 0.95),
    box('woodDark', -30.7, 0.75, 19.25, 1.32, 0.12, 1.02),
    box('roofLight', -30.7, 0.82, 19.25, 0.18, 0.04, 1.05),
  ];
  for (let index = -2; index <= 2; index += 1) {
    parts.push(box(
      index % 2 === 0 ? 'wood' : 'woodDark',
      -28.85,
      0.25 + Math.abs(index) * 0.04,
      21.8 + index * 0.48,
      2.7,
      0.3,
      0.32,
    ));
  }
  return { id: 'beach-picnic-and-timber', parts };
}

function createPlazaOfferingCluster(): RegionPropCluster {
  const parts: BoxPart[] = [];
  const offerings = [
    [-0.82, 2.24, 'roof'],
    [0.82, 2.24, 'roofLight'],
    [-0.82, 3.76, 'roofLight'],
    [0.82, 3.76, 'roof'],
  ] as const;
  for (const [x, z, accent] of offerings) {
    parts.push(
      box(accent, x, 0.53, z, 0.58, 0.36, 0.58),
      box('sandLight', x, 0.72, z, 0.62, 0.05, 0.16),
      box('sandLight', x, 0.72, z, 0.16, 0.05, 0.62),
    );
  }
  return { id: 'plaza-totem-offerings', parts };
}

function box(
  material: RegionPropMaterialKey,
  x: number,
  y: number,
  z: number,
  sizeX: number,
  sizeY: number,
  sizeZ: number,
  rotationY?: number,
): BoxPart {
  return { material, x, y, z, sizeX, sizeY, sizeZ, rotationY };
}
