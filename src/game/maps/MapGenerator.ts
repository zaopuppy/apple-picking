import { createSeededRandom } from '../../utils/random';
import { ARENA_SCALE, GAME_CONFIG } from '../config';
import type { Vec2 } from '../types';
import {
  alignToQuarterTurn,
  cloneOrchardMap,
  insideArena,
  landmarkBlocksPoint,
  landmarkInsideArena,
  MAX_MAP_TREES,
  ORCHARD_MAP_VERSION,
  treeColliderRadius,
  type KayKitBuildingAsset,
  type LandmarkKind,
  type OrchardLandmark,
  type OrchardMap,
  type OrchardPath,
  type OrchardTerrainZone,
  type OrchardTree,
  type TerrainZoneKind,
  type TreeVariant,
  validateOrchardMap,
} from './OrchardMap';

export const MAP_PRESETS = ['village', 'pond-garden', 'open-orchard'] as const;
export type MapPreset = typeof MAP_PRESETS[number];

export type MapGenerationOptions = {
  seed: number;
  preset: MapPreset;
  openness: number;
  landmarkDensity: number;
  name?: string;
};

const BASE_KID_START: Vec2 = { x: -9.1, z: 6.25 };
const BASE_GUARD_STARTS: [Vec2, Vec2] = [
  { x: -7.6, z: -6.25 },
  { x: 7.3, z: -6.25 },
];
const BASE_DELIVERY_ZONE: Vec2 = { x: 8.1, z: 5.35 };
const KID_START = scalePoint(BASE_KID_START, ARENA_SCALE);
const GUARD_STARTS: [Vec2, Vec2] = [
  scalePoint(BASE_GUARD_STARTS[0], ARENA_SCALE),
  scalePoint(BASE_GUARD_STARTS[1], ARENA_SCALE),
];
const DELIVERY_ZONE = scalePoint(BASE_DELIVERY_ZONE, ARENA_SCALE);

const LANDMARK_CLEARANCE = 3;
const TREE_IMPORTANT_CLEARANCE = 2.8;

export const DEFAULT_ORCHARD_MAP = generateOrchardMap({
  seed: 20260815,
  preset: 'village',
  openness: 0.82,
  landmarkDensity: 0.13,
  name: '果园村口',
});

export function generateMapCandidates(
  options: MapGenerationOptions,
  count = 4,
): OrchardMap[] {
  const poolSize = Math.max(12, count * 3);
  const pool = Array.from({ length: poolSize }, (_, index) => generateOrchardMap({
    ...options,
    seed: normalizeSeed(options.seed + index * 7919),
  })).sort((first, second) => candidateScore(second, options) - candidateScore(first, options));

  const selected: OrchardMap[] = [];
  const signatures = new Set<string>();
  for (const candidate of pool) {
    const signature = candidateSignature(candidate);
    if (signatures.has(signature) && selected.length < Math.ceil(count / 2)) continue;
    signatures.add(signature);
    selected.push(candidate);
    if (selected.length >= count) break;
  }
  for (const candidate of pool) {
    if (selected.length >= count) break;
    if (selected.includes(candidate)) continue;
    selected.push(candidate);
  }

  return selected.map((candidate, index) => ({
    ...cloneOrchardMap(candidate),
    name: `${presetName(options.preset)} ${index + 1}`,
  }));
}

export function generateOrchardMap(options: MapGenerationOptions): OrchardMap {
  const seed = normalizeSeed(options.seed);
  const random = createSeededRandom(seed);
  const openness = clamp(options.openness, 0.65, 0.94);
  const landmarkDensity = clamp(options.landmarkDensity, 0.06, 0.2);
  const appleSpawns = createAppleSpawns(options.preset, random);
  const importantPoints = [KID_START, ...GUARD_STARTS, DELIVERY_ZONE, ...appleSpawns];
  const terrainZones = createTerrainZones(options.preset, random);
  const landmarks = createLandmarks(
    options.preset,
    landmarkDensity,
    importantPoints,
    random,
  );
  const paths = createGeneratedPaths(options.preset, landmarks);
  const plantedTrees = plantOpenLandscape(
    terrainZones,
    landmarks,
    importantPoints,
    openness,
    random,
  );
  const trees = plantedTrees.filter((tree) => paths.every((path) =>
    distanceToGeneratedPath(tree, path) > path.width / 2 + 0.7));
  const map: OrchardMap = {
    version: ORCHARD_MAP_VERSION,
    id: `orchard-${seed}-${options.preset}`,
    name: options.name?.trim() || `${presetName(options.preset)} · ${seed}`,
    seed,
    worldStyle: {
      theme: themeForPreset(options.preset),
      tileShape: 'square',
    },
    trees,
    paths,
    clearings: [],
    landmarks,
    terrainZones,
    appleSpawns,
    kidStart: { ...KID_START },
    guardStarts: [{ ...GUARD_STARTS[0] }, { ...GUARD_STARTS[1] }],
    deliveryZone: { ...DELIVERY_ZONE },
  };
  return cloneOrchardMap(map);
}

function createGeneratedPaths(
  preset: MapPreset,
  landmarks: readonly OrchardLandmark[],
): OrchardPath[] {
  const templates: Record<MapPreset, OrchardPath[]> = {
    village: [
      {
        id: 'generated-main-road',
        width: 5.2,
        points: [
          { x: -34, z: 4 },
          { x: 34, z: 4 },
        ],
      },
      {
        id: 'generated-cross-road',
        width: 4.6,
        points: [
          { x: 2, z: -26 },
          { x: 2, z: 26 },
        ],
      },
    ],
    'pond-garden': [
      {
        id: 'generated-main-road',
        width: 5.2,
        points: [
          { x: -34, z: 8 },
          { x: -10, z: 8 },
          { x: -10, z: 14 },
          { x: 34, z: 14 },
        ],
      },
      {
        id: 'generated-cross-road',
        width: 4.5,
        points: [
          { x: -20, z: -26 },
          { x: -20, z: 8 },
          { x: -10, z: 8 },
        ],
      },
    ],
    'open-orchard': [
      {
        id: 'generated-main-road',
        width: 5.6,
        points: [
          { x: -34, z: 3 },
          { x: 34, z: 3 },
        ],
      },
      {
        id: 'generated-cross-road',
        width: 4.8,
        points: [
          { x: 0, z: -26 },
          { x: 0, z: 26 },
        ],
      },
    ],
  };
  const paths = templates[preset].map((path) => ({
    ...path,
    points: path.points.map((point) => ({ ...point })),
  }));
  landmarks.filter((landmark) => landmark.kind === 'homestead').forEach((landmark, index) => {
    const nearest = paths
      .flatMap((path) => closestPointsOnPath(path, landmark))
      .reduce((best, point) => distance(point, landmark) < distance(best, landmark) ? point : best);
    const deltaX = landmark.x - nearest.x;
    const deltaZ = landmark.z - nearest.z;
    const length = Math.max(0.001, Math.hypot(deltaX, deltaZ));
    const stopDistance = Math.max(landmark.radiusX, landmark.radiusZ) + 1.6;
    const approach = {
      x: landmark.x - deltaX / length * stopDistance,
      z: landmark.z - deltaZ / length * stopDistance,
    };
    const elbow = Math.abs(deltaX) >= Math.abs(deltaZ)
      ? { x: approach.x, z: nearest.z }
      : { x: nearest.x, z: approach.z };
    const points = [{ ...nearest }, elbow, approach].filter((point, pointIndex, entries) =>
      pointIndex === 0 || distance(point, entries[pointIndex - 1]) > 0.1);
    paths.push({
      id: `generated-building-road-${index}`,
      width: 4.2,
      points,
    });
  });
  return paths;
}

function closestPointsOnPath(path: OrchardPath, point: Vec2): Vec2[] {
  const closestPoints: Vec2[] = [];
  for (let index = 1; index < path.points.length; index += 1) {
    const start = path.points[index - 1];
    const end = path.points[index];
    const deltaX = end.x - start.x;
    const deltaZ = end.z - start.z;
    const lengthSquared = deltaX * deltaX + deltaZ * deltaZ;
    const progress = lengthSquared <= 0.001
      ? 0
      : clamp(
        ((point.x - start.x) * deltaX + (point.z - start.z) * deltaZ) / lengthSquared,
        0,
        1,
      );
    closestPoints.push({
      x: start.x + deltaX * progress,
      z: start.z + deltaZ * progress,
    });
  }
  return closestPoints.length > 0 ? closestPoints : path.points.map((entry) => ({ ...entry }));
}

export function presetName(preset: MapPreset): string {
  switch (preset) {
    case 'village':
      return '果园村口';
    case 'pond-garden':
      return '池塘花园';
    case 'open-orchard':
      return '开阔果园';
  }
}

function createAppleSpawns(preset: MapPreset, random: () => number): Vec2[] {
  const layouts: Record<MapPreset, Vec2[]> = {
    village: [
      { x: -6.2, z: 3.15 },
      { x: -2.2, z: 4.25 },
      { x: 2.25, z: 3.45 },
      { x: 5.8, z: 1.2 },
      { x: 3.95, z: -3.75 },
      { x: -4.35, z: -3.55 },
    ],
    'pond-garden': [
      { x: -6.4, z: 2.65 },
      { x: -2.6, z: 4.55 },
      { x: 1.35, z: 3.75 },
      { x: 5.55, z: 1.55 },
      { x: 4.5, z: -3.5 },
      { x: -3.85, z: -4.2 },
    ],
    'open-orchard': [
      { x: -6.7, z: 3.2 },
      { x: -2.7, z: 2.5 },
      { x: 1.0, z: 4.3 },
      { x: 5.9, z: 2.2 },
      { x: 4.9, z: -3.9 },
      { x: -4.8, z: -3.8 },
    ],
  };
  return layouts[preset].map((point) => scalePoint({
    x: point.x + jitter(random, 0.38),
    z: point.z + jitter(random, 0.32),
  }, ARENA_SCALE));
}

function createTerrainZones(
  preset: MapPreset,
  random: () => number,
): OrchardTerrainZone[] {
  const arenaArea = GAME_CONFIG.arenaHalfWidth * 2 * GAME_CONFIG.arenaHalfDepth * 2;
  const targetCoverage = arenaArea * (preset === 'open-orchard' ? 0.28 : 0.23);
  const zones: OrchardTerrainZone[] = [];
  let covered = 0;
  let attempts = 0;
  while (covered < targetCoverage && attempts < 120) {
    attempts += 1;
    const radiusX = lerp(5.2, 10.2, random());
    const radiusZ = lerp(3.7, 7.2, random());
    const x = jitter(random, GAME_CONFIG.arenaHalfWidth - radiusX - 1.5);
    const z = jitter(random, GAME_CONFIG.arenaHalfDepth - radiusZ - 1.5);
    const kind = terrainKind(preset, random());
    zones.push({
      id: `terrain-${zones.length}`,
      kind,
      x,
      z,
      rotationY: jitter(random, Math.PI * 0.18),
      radiusX,
      radiusZ,
    });
    covered += Math.PI * radiusX * radiusZ * 0.72;
  }
  return zones;
}

function terrainKind(preset: MapPreset, roll: number): TerrainZoneKind {
  if (preset === 'open-orchard') return roll < 0.58 ? 'orchard' : roll < 0.83 ? 'meadow' : 'wildflowers';
  if (preset === 'pond-garden') return roll < 0.5 ? 'meadow' : roll < 0.76 ? 'wildflowers' : 'orchard';
  return roll < 0.48 ? 'orchard' : roll < 0.82 ? 'meadow' : 'wildflowers';
}

function createLandmarks(
  preset: MapPreset,
  density: number,
  importantPoints: readonly Vec2[],
  random: () => number,
): OrchardLandmark[] {
  const arenaArea = GAME_CONFIG.arenaHalfWidth * 2 * GAME_CONFIG.arenaHalfDepth * 2;
  const targetBudget = arenaArea * density;
  const landmarks: OrchardLandmark[] = [];
  let usedBudget = 0;
  let attempts = 0;
  while (usedBudget < targetBudget && attempts < 240) {
    const kind = landmarkKind(preset, landmarks.length, random());
    const radiusX = kind === 'homestead' ? lerp(4.5, 5.7, random()) : lerp(3.4, 5, random());
    const radiusZ = kind === 'homestead' ? lerp(3.5, 4.5, random()) : lerp(2.6, 4, random());
    const x = jitter(random, GAME_CONFIG.arenaHalfWidth - radiusX - 2);
    const z = kind === 'homestead'
      ? lerp(-GAME_CONFIG.arenaHalfDepth + radiusZ + 2, -5.5, random())
      : jitter(random, GAME_CONFIG.arenaHalfDepth - radiusZ - 2);
    const legacyRotation = Math.round(random() * 3) * Math.PI / 2 + jitter(random, 0.08);
    const candidate: OrchardLandmark = {
      id: `landmark-${landmarks.length}`,
      kind,
      x,
      z,
      ...(kind === 'homestead' ? { asset: buildingForPreset(preset, landmarks.length) } : {}),
      rotationY: kind === 'homestead'
        ? alignToQuarterTurn(legacyRotation)
        : legacyRotation,
      radiusX,
      radiusZ,
    };
    attempts += 1;
    if (!landmarkInsideArena(candidate, 1)) continue;
    if (importantPoints.some((point) => landmarkBlocksPoint(candidate, point, LANDMARK_CLEARANCE))) {
      continue;
    }
    if (landmarks.some((existing) => landmarksOverlap(candidate, existing, 2.4))) continue;
    const cost = (radiusX * 2 + 6) * (radiusZ * 2 + 6);
    if (landmarks.length > 0 && usedBudget + cost > targetBudget * 1.22) break;
    landmarks.push(candidate);
    usedBudget += cost;
  }
  return landmarks;
}

function themeForPreset(preset: MapPreset): OrchardMap['worldStyle']['theme'] {
  if (preset === 'pond-garden') return 'riverside';
  if (preset === 'open-orchard') return 'fortified';
  return 'village';
}

function buildingForPreset(preset: MapPreset, index: number): KayKitBuildingAsset {
  const assets: Record<MapPreset, readonly KayKitBuildingAsset[]> = {
    village: ['house', 'market', 'farmPlot', 'lumbermill', 'well'],
    'pond-garden': ['watermill', 'market', 'mill', 'house', 'well'],
    'open-orchard': ['barracks', 'watchtower', 'castle', 'mine', 'house'],
  };
  const themeAssets = assets[preset];
  return themeAssets[index % themeAssets.length];
}

function landmarkKind(preset: MapPreset, index: number, roll: number): LandmarkKind {
  if (index === 0) return preset === 'pond-garden' ? 'pond' : 'homestead';
  if (preset === 'village') return roll < 0.62 ? 'homestead' : 'pond';
  if (preset === 'pond-garden') return roll < 0.68 ? 'pond' : 'homestead';
  return roll < 0.48 ? 'homestead' : 'pond';
}

function plantOpenLandscape(
  terrainZones: readonly OrchardTerrainZone[],
  landmarks: readonly OrchardLandmark[],
  importantPoints: readonly Vec2[],
  openness: number,
  random: () => number,
): OrchardTree[] {
  const arenaArea = GAME_CONFIG.arenaHalfWidth * 2 * GAME_CONFIG.arenaHalfDepth * 2;
  const targetCount = Math.min(
    MAX_MAP_TREES,
    Math.round(arenaArea * (0.01 + (1 - openness) * 0.045)),
  );
  const trees: OrchardTree[] = [];

  const orchardZones = terrainZones.filter((zone) => zone.kind === 'orchard');
  for (const zone of orchardZones) {
    const rowSpacing = 3.25;
    const columnSpacing = 3.6;
    for (let localZ = -zone.radiusZ + 1.4; localZ <= zone.radiusZ - 1.4; localZ += rowSpacing) {
      for (let localX = -zone.radiusX + 1.4; localX <= zone.radiusX - 1.4; localX += columnSpacing) {
        if (trees.length >= targetCount * 0.54 || random() < 0.42) continue;
        tryAddTree(
          trees,
          terrainLocalToWorld(zone, {
            x: localX + jitter(random, 0.24),
            z: localZ + jitter(random, 0.2),
          }),
          landmarks,
          importantPoints,
          random,
        );
      }
    }
  }

  let attempts = 0;
  while (trees.length < targetCount && attempts < targetCount * 35) {
    attempts += 1;
    const roll = random();
    let position: Vec2;
    if (roll < 0.56) position = edgePosition(random);
    else if (roll < 0.78 && landmarks.length > 0) {
      position = landmarkRimPosition(landmarks[Math.floor(random() * landmarks.length)], random);
    } else {
      position = {
        x: jitter(random, GAME_CONFIG.arenaHalfWidth - 1.4),
        z: jitter(random, GAME_CONFIG.arenaHalfDepth - 1.4),
      };
    }
    tryAddTree(trees, position, landmarks, importantPoints, random);
  }
  return trees;
}

function tryAddTree(
  trees: OrchardTree[],
  position: Vec2,
  landmarks: readonly OrchardLandmark[],
  importantPoints: readonly Vec2[],
  random: () => number,
): void {
  if (!insideArena(position, 0.75)) return;
  if (importantPoints.some((point) => distance(point, position) < TREE_IMPORTANT_CLEARANCE)) return;
  if (landmarks.some((landmark) => landmarkBlocksPoint(landmark, position, 1))) return;
  const variant = treeVariant(random());
  const scale = 0.86 + random() * 0.26;
  const candidate: OrchardTree = {
    id: `tree-${trees.length}`,
    ...position,
    variant,
    rotationY: random() * Math.PI * 2,
    scale,
  };
  const minimumSpacing = variant === 'stump' ? 1.38 : 2.25;
  if (trees.some((tree) => distance(tree, candidate) < Math.max(
    minimumSpacing,
    treeColliderRadius(tree) + treeColliderRadius(candidate) + 0.46,
  ))) return;
  trees.push(candidate);
}

function treeVariant(roll: number): TreeVariant {
  if (roll < 0.88) return 'stump';
  if (roll < 0.925) return 'broadleaf';
  if (roll < 0.9625) return 'pine';
  return 'cherry';
}

function edgePosition(random: () => number): Vec2 {
  const inset = lerp(1.1, 4.2, random());
  switch (Math.floor(random() * 4)) {
    case 0:
      return { x: jitter(random, GAME_CONFIG.arenaHalfWidth - 1), z: -GAME_CONFIG.arenaHalfDepth + inset };
    case 1:
      return { x: jitter(random, GAME_CONFIG.arenaHalfWidth - 1), z: GAME_CONFIG.arenaHalfDepth - inset };
    case 2:
      return { x: -GAME_CONFIG.arenaHalfWidth + inset, z: jitter(random, GAME_CONFIG.arenaHalfDepth - 1) };
    default:
      return { x: GAME_CONFIG.arenaHalfWidth - inset, z: jitter(random, GAME_CONFIG.arenaHalfDepth - 1) };
  }
}

function landmarkRimPosition(landmark: OrchardLandmark, random: () => number): Vec2 {
  const angle = random() * Math.PI * 2;
  const local = {
    x: Math.cos(angle) * (landmark.radiusX + lerp(1.2, 2.8, random())),
    z: Math.sin(angle) * (landmark.radiusZ + lerp(1.2, 2.8, random())),
  };
  const cosine = Math.cos(landmark.rotationY);
  const sine = Math.sin(landmark.rotationY);
  return {
    x: landmark.x + local.x * cosine + local.z * sine,
    z: landmark.z - local.x * sine + local.z * cosine,
  };
}

function terrainLocalToWorld(zone: OrchardTerrainZone, point: Vec2): Vec2 {
  const cosine = Math.cos(zone.rotationY);
  const sine = Math.sin(zone.rotationY);
  return {
    x: zone.x + point.x * cosine + point.z * sine,
    z: zone.z - point.x * sine + point.z * cosine,
  };
}

function landmarksOverlap(first: OrchardLandmark, second: OrchardLandmark, padding: number): boolean {
  const firstRadius = Math.hypot(first.radiusX, first.radiusZ);
  const secondRadius = Math.hypot(second.radiusX, second.radiusZ);
  return distance(first, second) < firstRadius + secondRadius + padding;
}

function candidateScore(map: OrchardMap, options: MapGenerationOptions): number {
  const validation = validateOrchardMap(map);
  if (!validation.valid) return -1_000_000 + validation.reachableTargets * 100;
  const arenaArea = GAME_CONFIG.arenaHalfWidth * 2 * GAME_CONFIG.arenaHalfDepth * 2;
  const targetTrees = arenaArea * (0.014 + (1 - clamp(options.openness, 0.65, 0.94)) * 0.055);
  const treeFit = 120 - Math.abs(map.trees.length - targetTrees);
  const landmarkKinds = new Set(map.landmarks.map((landmark) => landmark.kind)).size;
  const centralOccluders = map.landmarks.filter((landmark) =>
    landmark.kind === 'homestead' && Math.hypot(landmark.x, landmark.z) < 10,
  ).length;
  const tallCentralTrees = map.trees.filter((tree) =>
    tree.variant !== 'stump' && Math.hypot(tree.x, tree.z) < 8,
  ).length;
  return 1000 + treeFit + landmarkKinds * 24 + map.terrainZones.length * 3 -
    centralOccluders * 45 - tallCentralTrees * 10;
}

function candidateSignature(map: OrchardMap): string {
  const kinds = map.landmarks.map((landmark) => landmark.kind[0]).sort().join('');
  const centroid = map.landmarks.reduce(
    (total, landmark) => ({ x: total.x + landmark.x, z: total.z + landmark.z }),
    { x: 0, z: 0 },
  );
  const divisor = Math.max(1, map.landmarks.length);
  return `${kinds}:${Math.sign(centroid.x / divisor)}:${Math.sign(centroid.z / divisor)}`;
}

function scalePoint(point: Vec2, scale: number): Vec2 {
  return { x: point.x * scale, z: point.z * scale };
}

function distanceToGeneratedPath(point: Vec2, path: OrchardPath): number {
  let minimum = Number.POSITIVE_INFINITY;
  for (let index = 1; index < path.points.length; index += 1) {
    minimum = Math.min(
      minimum,
      distanceToGeneratedSegment(point, path.points[index - 1], path.points[index]),
    );
  }
  return minimum;
}

function distanceToGeneratedSegment(point: Vec2, start: Vec2, end: Vec2): number {
  const deltaX = end.x - start.x;
  const deltaZ = end.z - start.z;
  const lengthSquared = deltaX * deltaX + deltaZ * deltaZ;
  if (lengthSquared <= 0.000001) return distance(point, start);
  const projection = clamp(
    ((point.x - start.x) * deltaX + (point.z - start.z) * deltaZ) / lengthSquared,
    0,
    1,
  );
  return Math.hypot(
    point.x - (start.x + deltaX * projection),
    point.z - (start.z + deltaZ * projection),
  );
}

function distance(first: Vec2, second: Vec2): number {
  return Math.hypot(first.x - second.x, first.z - second.z);
}

function jitter(random: () => number, amount: number): number {
  return (random() * 2 - 1) * amount;
}

function normalizeSeed(seed: number): number {
  const normalized = Math.abs(Math.floor(seed)) % 2_147_483_647;
  return normalized || 1;
}

function lerp(start: number, end: number, progress: number): number {
  return start + (end - start) * progress;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
