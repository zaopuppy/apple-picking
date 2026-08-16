import {
  cloneOrchardMap,
  type OrchardDeliveryZone,
  type OrchardLandmark,
  type OrchardMap,
  type OrchardTree,
  type TreeVariant,
} from './OrchardMap';
import type { Vec2 } from '../types';

export const SWEET_ORCHARD_ISLAND_ID = 'sweet-orchard-island-p1';

type TreeSeed = readonly [
  x: number,
  z: number,
  variant: TreeVariant,
  scale?: number,
];

const TREE_SEEDS: readonly TreeSeed[] = [
  [-29, -17, 'cherry', 1.02],
  [-25, -17, 'broadleaf', 0.96],
  [-21, -17, 'cherry', 1.08],
  [-17, -17, 'broadleaf', 0.92],
  [-13, -17, 'cherry', 1],
  [-29, -9, 'broadleaf', 0.9],
  [-25, -9, 'cherry', 1.04],
  [-21, -9, 'broadleaf', 0.96],
  [-17, -9, 'cherry', 1.05],
  [-13, -9, 'broadleaf', 0.94],
  [-31, -3, 'pine', 0.92],
  [-30, 5, 'broadleaf', 0.96],
  [-29, 10, 'pine', 0.88],
  [-13, 19, 'cherry', 0.95],
  [-7, 22, 'broadleaf', 0.88],
  [1, 23, 'pine', 0.92],
  [9, 22, 'broadleaf', 0.9],
  [17, 21, 'cherry', 0.92],
  [28, 18, 'broadleaf', 0.94],
  [31, 7, 'pine', 0.9],
  [31, 0, 'broadleaf', 0.92],
  [30, -12, 'cherry', 0.96],
  [29, -13, 'pine', 0.88],
  [9, -18, 'pine', 0.94],
  [3, -18, 'broadleaf', 0.9],
  [-5, -18, 'cherry', 0.92],
  [-10, 13, 'broadleaf', 0.9],
  [-7, 8, 'cherry', 0.94],
  [7, 11, 'broadleaf', 0.92],
  [10, 17, 'cherry', 0.9],
  [31, 16, 'broadleaf', 0.88],
  [9, 6, 'stump', 0.92],
];

export type IslandRouteBlockKind = 'hedge' | 'hill' | 'shrine' | 'woodlot';

export type IslandRouteBlock = {
  id: string;
  kind: IslandRouteBlockKind;
  x: number;
  z: number;
  radiusX: number;
  radiusZ: number;
};

export type IslandWaterSegment = {
  id: string;
  x: number;
  z: number;
  sizeX: number;
  sizeZ: number;
};

export type IslandWaterBlock = {
  id: string;
  x: number;
  z: number;
  radiusX: number;
  radiusZ: number;
};

export type IslandBridge = {
  id: string;
  x: number;
  z: number;
  width: number;
  depth: number;
};

export type IslandAppleGroup = {
  id: string;
  label: string;
  spawns: readonly [Vec2, Vec2];
};

export const ISLAND_ROUTE_BLOCKS: readonly IslandRouteBlock[] = [
  {
    id: 'island-route-orchard-hedge',
    kind: 'hedge',
    x: -8,
    z: -10,
    radiusX: 4.2,
    radiusZ: 2,
  },
  {
    id: 'island-route-north-shrine',
    kind: 'shrine',
    x: 5,
    z: -9,
    radiusX: 3.2,
    radiusZ: 2.3,
  },
  {
    id: 'island-route-west-hill',
    kind: 'hill',
    x: -15.5,
    z: 1,
    radiusX: 4.8,
    radiusZ: 2.2,
  },
  {
    id: 'island-route-east-woodlot',
    kind: 'woodlot',
    x: 16,
    z: 1,
    radiusX: 4.2,
    radiusZ: 2.2,
  },
  {
    id: 'island-route-southwest-grove',
    kind: 'hedge',
    x: -9,
    z: 12,
    radiusX: 3.4,
    radiusZ: 2.4,
  },
  {
    id: 'island-route-south-hill',
    kind: 'hill',
    x: 7,
    z: 17.5,
    radiusX: 3.5,
    radiusZ: 2.2,
  },
  {
    id: 'island-route-plaza-totem',
    kind: 'shrine',
    x: 0,
    z: 3,
    radiusX: 1.35,
    radiusZ: 1.35,
  },
];

export const ISLAND_WATER_SEGMENTS: readonly IslandWaterSegment[] = [
  { id: 'island-water-west', x: -21.5, z: -5.8, sizeX: 27, sizeZ: 3.4 },
  { id: 'island-water-center', x: 0, z: -6.5, sizeX: 16.5, sizeZ: 3.4 },
  { id: 'island-water-east', x: 21.5, z: -7.2, sizeX: 27, sizeZ: 3.4 },
];

export const ISLAND_WATER_BLOCKS: readonly IslandWaterBlock[] = [
  { id: 'island-water-block-west-coast', x: -29.75, z: -5.8, radiusX: 5.25, radiusZ: 1.35 },
  { id: 'island-water-block-west-inner', x: -13.75, z: -5.8, radiusX: 5.75, radiusZ: 1.35 },
  { id: 'island-water-block-center', x: 0, z: -6.5, radiusX: 8.25, radiusZ: 1.35 },
  { id: 'island-water-block-east-inner', x: 9.7, z: -7.2, radiusX: 1.7, radiusZ: 1.35 },
  { id: 'island-water-block-east-coast', x: 25.8, z: -7.2, radiusX: 9.2, radiusZ: 1.35 },
];

export const ISLAND_BRIDGES: readonly IslandBridge[] = [
  { id: 'island-bridge-west', x: -22, z: -5.8, width: 5.2, depth: 5.2 },
  { id: 'island-bridge-east', x: 14, z: -7.2, width: 5.2, depth: 5.2 },
];

export const ISLAND_DELIVERY_ZONES: readonly OrchardDeliveryZone[] = [
  { id: 'island-delivery-homestead', x: 19, z: -11 },
  { id: 'island-delivery-orchard-market', x: -29, z: 1 },
  { id: 'island-delivery-beach-dock', x: -24, z: 20 },
  { id: 'island-delivery-garden', x: 15, z: 15 },
];

export const ISLAND_APPLE_GROUPS: readonly IslandAppleGroup[] = [
  {
    id: 'island-apples-orchard',
    label: '北岸果园',
    spawns: [{ x: -27, z: -12.5 }, { x: -15, z: -12.5 }],
  },
  {
    id: 'island-apples-garden',
    label: '东南花园',
    spawns: [{ x: 10, z: 13 }, { x: 28, z: 13 }],
  },
  {
    id: 'island-apples-beach',
    label: '西南海滩',
    spawns: [{ x: -26, z: 15 }, { x: -18, z: 18 }],
  },
];

function createTrees(): OrchardTree[] {
  return TREE_SEEDS.map(([x, z, variant, scale = 1], index) => ({
    id: `island-tree-${index + 1}`,
    x,
    z,
    variant,
    rotationY: (index * 2.399963229728653) % (Math.PI * 2),
    scale,
  }));
}

function createAppleSpawns(): Vec2[] {
  return ISLAND_APPLE_GROUPS.flatMap((group) =>
    group.spawns.map((spawn) => ({ ...spawn })));
}

function createRouteBlockLandmarks(): OrchardLandmark[] {
  return ISLAND_ROUTE_BLOCKS.map((block) => ({
    id: block.id,
    x: block.x,
    z: block.z,
    radiusX: block.radiusX,
    radiusZ: block.radiusZ,
    kind: 'homestead',
    rotationY: 0,
  }));
}

function createWaterBlockLandmarks(): OrchardLandmark[] {
  return ISLAND_WATER_BLOCKS.map((block) => ({
    id: block.id,
    x: block.x,
    z: block.z,
    radiusX: block.radiusX,
    radiusZ: block.radiusZ,
    kind: 'homestead',
    rotationY: 0,
  }));
}

export const SWEET_ORCHARD_ISLAND_MAP: OrchardMap = {
  version: 4,
  id: SWEET_ORCHARD_ISLAND_ID,
  name: '甜日果园岛 · P3b',
  seed: 20260816,
  worldStyle: {
    theme: 'riverside',
    tileShape: 'square',
  },
  trees: createTrees(),
  paths: [
    {
      id: 'island-path-west-loop',
      width: 2.35,
      points: [
        { x: -24, z: 20 },
        { x: -26, z: 16 },
        { x: -23, z: 12 },
        { x: -23, z: 6 },
        { x: -13, z: 6 },
        { x: -7, z: 4.5 },
        { x: -3.5, z: 3 },
      ],
    },
    {
      id: 'island-path-orchard',
      width: 2.2,
      points: [
        { x: -27, z: -12.5 },
        { x: -22, z: -6 },
        { x: -22, z: -2 },
        { x: -15, z: -2.7 },
        { x: -9, z: -2.7 },
        { x: -4, z: 0 },
        { x: -3.5, z: 3 },
      ],
    },
    {
      id: 'island-path-orchard-market',
      width: 2.2,
      points: [
        { x: -22, z: -2 },
        { x: -27, z: -1 },
        { x: -29, z: 1 },
      ],
    },
    {
      id: 'island-path-delivery',
      width: 2.25,
      points: [
        { x: 3.5, z: 3 },
        { x: 8, z: 4.5 },
        { x: 9.5, z: -3.5 },
        { x: 14, z: -4.5 },
        { x: 14, z: -10 },
        { x: 19, z: -11 },
      ],
    },
    {
      id: 'island-path-garden',
      width: 2.1,
      points: [
        { x: 3, z: 5.5 },
        { x: 3, z: 10.5 },
        { x: 6, z: 13 },
        { x: 10, z: 13 },
        { x: 15, z: 15 },
      ],
    },
    {
      id: 'island-path-south-loop',
      width: 2.1,
      points: [
        { x: -18, z: 18 },
        { x: -15, z: 16 },
        { x: -14, z: 11 },
        { x: -4, z: 9 },
        { x: 0, z: 6.5 },
      ],
    },
  ],
  clearings: [
    { id: 'island-clearing-plaza', x: 0, z: 3, radius: 4.2 },
    { id: 'island-clearing-orchard', x: -21, z: -12.5, radius: 3.5 },
    { id: 'island-clearing-orchard-market', x: -29, z: 1, radius: 2.4 },
    { id: 'island-clearing-beach', x: -24, z: 19, radius: 4 },
    { id: 'island-clearing-garden-delivery', x: 15, z: 15, radius: 2.6 },
    { id: 'island-clearing-delivery', x: 19, z: -11, radius: 2.5 },
  ],
  landmarks: [
    {
      id: 'island-boundary-north',
      kind: 'homestead',
      x: 0,
      z: -26,
      rotationY: 0,
      radiusX: 35.2,
      radiusZ: 0.4,
    },
    {
      id: 'island-boundary-south',
      kind: 'homestead',
      x: 0,
      z: 26,
      rotationY: 0,
      radiusX: 35.2,
      radiusZ: 0.4,
    },
    {
      id: 'island-boundary-west',
      kind: 'homestead',
      x: -35.2,
      z: 0,
      rotationY: 0,
      radiusX: 0.4,
      radiusZ: 25,
    },
    {
      id: 'island-boundary-east',
      kind: 'homestead',
      x: 35.2,
      z: 0,
      rotationY: 0,
      radiusX: 0.4,
      radiusZ: 25,
    },
    {
      id: 'island-north-terrace',
      kind: 'homestead',
      x: -16,
      z: -21.2,
      rotationY: 0,
      radiusX: 14,
      radiusZ: 2,
    },
    {
      id: 'island-main-house',
      kind: 'homestead',
      asset: 'house',
      x: 21.5,
      z: -17.4,
      rotationY: Math.PI,
      radiusX: 5.2,
      radiusZ: 3.7,
    },
    {
      id: 'island-pond',
      kind: 'pond',
      x: 20,
      z: 10.5,
      rotationY: -0.18,
      radiusX: 4.6,
      radiusZ: 3.6,
    },
    ...createRouteBlockLandmarks(),
    ...createWaterBlockLandmarks(),
  ],
  terrainZones: [
    {
      id: 'island-zone-orchard',
      kind: 'orchard',
      x: -21,
      z: -13,
      rotationY: 0,
      radiusX: 11.5,
      radiusZ: 6.3,
    },
    {
      id: 'island-zone-beach',
      kind: 'meadow',
      x: -23,
      z: 16,
      rotationY: 0.22,
      radiusX: 9.5,
      radiusZ: 6,
    },
    {
      id: 'island-zone-garden',
      kind: 'wildflowers',
      x: 17,
      z: 13,
      rotationY: -0.12,
      radiusX: 12,
      radiusZ: 7.4,
    },
  ],
  appleSpawns: createAppleSpawns(),
  kidStart: { x: 0, z: 14 },
  guardStarts: [
    { x: -8, z: 1 },
    { x: 9, z: 2 },
  ],
  deliveryZone: { x: ISLAND_DELIVERY_ZONES[0].x, z: ISLAND_DELIVERY_ZONES[0].z },
  deliveryZones: ISLAND_DELIVERY_ZONES.map((zone) => ({ ...zone })),
};

export function resolveIslandTourMap(search = window.location.search): OrchardMap | null {
  const world = new URLSearchParams(search).get('world');
  return world === 'island' ? cloneOrchardMap(SWEET_ORCHARD_ISLAND_MAP) : null;
}

export function isIslandTourMap(map: OrchardMap): boolean {
  return map.id === SWEET_ORCHARD_ISLAND_ID;
}
