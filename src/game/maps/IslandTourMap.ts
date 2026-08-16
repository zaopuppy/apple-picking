import {
  cloneOrchardMap,
  type OrchardMap,
  type OrchardTree,
  type TreeVariant,
} from './OrchardMap';

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
  [30, -8, 'cherry', 0.96],
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

export const SWEET_ORCHARD_ISLAND_MAP: OrchardMap = {
  version: 4,
  id: SWEET_ORCHARD_ISLAND_ID,
  name: '甜日果园岛 · P1',
  seed: 20260816,
  worldStyle: {
    theme: 'riverside',
    tileShape: 'square',
  },
  trees: createTrees(),
  paths: [
    {
      id: 'island-path-main',
      width: 2.7,
      points: [
        { x: -26, z: 18 },
        { x: -18, z: 13 },
        { x: -9, z: 8 },
        { x: 0, z: 3 },
        { x: 9, z: -1 },
        { x: 19, z: -8 },
      ],
    },
    {
      id: 'island-path-orchard',
      width: 2.25,
      points: [
        { x: -27, z: -13 },
        { x: -20, z: -10 },
        { x: -12, z: -5 },
        { x: 0, z: 3 },
      ],
    },
    {
      id: 'island-path-pond',
      width: 2.2,
      points: [
        { x: 0, z: 3 },
        { x: 9, z: 8 },
        { x: 14, z: 15 },
        { x: 20, z: 18 },
      ],
    },
  ],
  clearings: [
    { id: 'island-clearing-plaza', x: 0, z: 3, radius: 6.2 },
    { id: 'island-clearing-orchard', x: -21, z: -12.5, radius: 4.8 },
    { id: 'island-clearing-beach', x: -23, z: 16, radius: 4.4 },
    { id: 'island-clearing-delivery', x: 19, z: -8, radius: 3.1 },
  ],
  landmarks: [
    {
      id: 'island-boundary-north',
      kind: 'homestead',
      x: 0,
      z: -25,
      rotationY: 0,
      radiusX: 35.2,
      radiusZ: 1.4,
    },
    {
      id: 'island-boundary-south',
      kind: 'homestead',
      x: 0,
      z: 25,
      rotationY: 0,
      radiusX: 35.2,
      radiusZ: 1.4,
    },
    {
      id: 'island-boundary-west',
      kind: 'homestead',
      x: -34.4,
      z: 0,
      rotationY: 0,
      radiusX: 1.1,
      radiusZ: 23.2,
    },
    {
      id: 'island-boundary-east',
      kind: 'homestead',
      x: 34.4,
      z: 0,
      rotationY: 0,
      radiusX: 1.1,
      radiusZ: 23.2,
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
  appleSpawns: [
    { x: -27, z: -12.5 },
    { x: -15, z: -12.5 },
    { x: 10, z: 13 },
    { x: 28, z: 13 },
    { x: -26, z: 15 },
    { x: -18, z: 18 },
  ],
  kidStart: { x: 0, z: 14 },
  guardStarts: [
    { x: -8, z: 1 },
    { x: 9, z: 2 },
  ],
  deliveryZone: { x: 19, z: -8 },
};

export function resolveIslandTourMap(search = window.location.search): OrchardMap | null {
  const world = new URLSearchParams(search).get('world');
  return world === 'island' ? cloneOrchardMap(SWEET_ORCHARD_ISLAND_MAP) : null;
}

export function isIslandTourMap(map: OrchardMap): boolean {
  return map.id === SWEET_ORCHARD_ISLAND_ID;
}
