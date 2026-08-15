import { createSeededRandom } from '../../utils/random';
import type { Vec2 } from '../types';
import {
  cloneOrchardMap,
  MAX_MAP_TREES,
  ORCHARD_MAP_VERSION,
  type OrchardClearing,
  type OrchardMap,
  type OrchardPath,
  type OrchardTree,
  TREE_COLLIDER_RADIUS,
  TREE_VARIANTS,
} from './OrchardMap';

export const MAP_PRESETS = ['winding', 'clearings', 'crossroads'] as const;
export type MapPreset = typeof MAP_PRESETS[number];

export type MapGenerationOptions = {
  seed: number;
  preset: MapPreset;
  density: number;
  pathWidth: number;
  name?: string;
};

const KID_START: Vec2 = { x: -9.1, z: 6.25 };
const GUARD_STARTS: [Vec2, Vec2] = [
  { x: -7.6, z: -6.25 },
  { x: 7.3, z: -6.25 },
];
const DELIVERY_ZONE: Vec2 = { x: 8.1, z: 5.35 };

export const DEFAULT_ORCHARD_MAP = generateOrchardMap({
  seed: 20260815,
  preset: 'clearings',
  density: 0.78,
  pathWidth: 2.35,
  name: '林间集市',
});

export function generateMapCandidates(
  options: MapGenerationOptions,
  count = 4,
): OrchardMap[] {
  return Array.from({ length: count }, (_, index) => generateOrchardMap({
    ...options,
    seed: normalizeSeed(options.seed + index * 7919),
    name: `${presetName(options.preset)} ${index + 1}`,
  }));
}

export function generateOrchardMap(options: MapGenerationOptions): OrchardMap {
  const seed = normalizeSeed(options.seed);
  const random = createSeededRandom(seed);
  const density = clamp(options.density, 0.35, 1);
  const pathWidth = clamp(options.pathWidth, 1.8, 4.2);
  const layout = createLayout(options.preset, pathWidth, random);
  const trees = plantForest(layout.paths, layout.clearings, density, random);
  const map: OrchardMap = {
    version: ORCHARD_MAP_VERSION,
    id: `orchard-${seed}-${options.preset}`,
    name: options.name?.trim() || `${presetName(options.preset)} · ${seed}`,
    seed,
    trees,
    paths: layout.paths,
    clearings: layout.clearings,
    appleSpawns: layout.apples,
    kidStart: { ...KID_START },
    guardStarts: [{ ...GUARD_STARTS[0] }, { ...GUARD_STARTS[1] }],
    deliveryZone: { ...DELIVERY_ZONE },
  };
  return cloneOrchardMap(map);
}

export function presetName(preset: MapPreset): string {
  switch (preset) {
    case 'winding':
      return '蜿蜒果径';
    case 'clearings':
      return '林间空地';
    case 'crossroads':
      return '交错林路';
  }
}

function createLayout(
  preset: MapPreset,
  pathWidth: number,
  random: () => number,
): { paths: OrchardPath[]; clearings: OrchardClearing[]; apples: Vec2[] } {
  switch (preset) {
    case 'winding':
      return windingLayout(pathWidth, random);
    case 'clearings':
      return clearingsLayout(pathWidth, random);
    case 'crossroads':
      return crossroadsLayout(pathWidth, random);
  }
}

function windingLayout(
  width: number,
  random: () => number,
): { paths: OrchardPath[]; clearings: OrchardClearing[]; apples: Vec2[] } {
  const upper = { x: -3.6 + jitter(random, 0.8), z: 3.7 + jitter(random, 0.45) };
  const heart = { x: 0.1 + jitter(random, 0.8), z: 0.15 + jitter(random, 0.7) };
  const east = { x: 4.5 + jitter(random, 0.55), z: 2.1 + jitter(random, 0.7) };
  const westLow = { x: -5.2 + jitter(random, 0.6), z: -3.6 + jitter(random, 0.55) };
  const eastLow = { x: 4.1 + jitter(random, 0.6), z: -3.75 + jitter(random, 0.5) };
  return {
    paths: [
      path('main', width, [KID_START, upper, heart, east, DELIVERY_ZONE]),
      path('west-branch', width * 0.92, [heart, westLow, GUARD_STARTS[0]]),
      path('east-branch', width * 0.92, [heart, eastLow, GUARD_STARTS[1]]),
      path('low-link', width * 0.78, [westLow, { x: -0.5, z: -5.4 }, eastLow]),
    ],
    clearings: clearingsFrom([
      [KID_START, 1.35],
      [upper, 1.65],
      [heart, 2.05],
      [east, 1.55],
      [westLow, 1.45],
      [eastLow, 1.5],
      [DELIVERY_ZONE, 2.35],
      [GUARD_STARTS[0], 1.25],
      [GUARD_STARTS[1], 1.25],
    ]),
    apples: [
      offset(upper, -0.45, 0.2),
      offset(heart, -0.7, 0.25),
      offset(heart, 0.75, -0.35),
      offset(east, 0.2, -0.4),
      offset(westLow, 0.25, 0.2),
      offset(eastLow, -0.3, 0.25),
    ],
  };
}

function clearingsLayout(
  width: number,
  random: () => number,
): { paths: OrchardPath[]; clearings: OrchardClearing[]; apples: Vec2[] } {
  const west = { x: -5.2 + jitter(random, 0.45), z: 1.6 + jitter(random, 0.6) };
  const north = { x: 0.1 + jitter(random, 0.6), z: 3.6 + jitter(random, 0.4) };
  const center = { x: -0.2 + jitter(random, 0.55), z: -0.5 + jitter(random, 0.5) };
  const east = { x: 5.0 + jitter(random, 0.45), z: 0.45 + jitter(random, 0.7) };
  const southWest = { x: -4.7 + jitter(random, 0.55), z: -4.7 + jitter(random, 0.45) };
  const southEast = { x: 4.3 + jitter(random, 0.5), z: -4.5 + jitter(random, 0.5) };
  return {
    paths: [
      path('north-arc', width, [KID_START, west, north, DELIVERY_ZONE]),
      path('center-crossing', width * 0.95, [west, center, east, DELIVERY_ZONE]),
      path('south-arc', width * 0.88, [GUARD_STARTS[0], southWest, center, southEast, GUARD_STARTS[1]]),
      path('vertical-link', width * 0.78, [north, center]),
    ],
    clearings: clearingsFrom([
      [KID_START, 1.3],
      [west, 1.8],
      [north, 1.65],
      [center, 2.15],
      [east, 1.75],
      [southWest, 1.4],
      [southEast, 1.4],
      [DELIVERY_ZONE, 2.35],
      [GUARD_STARTS[0], 1.2],
      [GUARD_STARTS[1], 1.2],
    ]),
    apples: [
      offset(west, -0.45, 0.1),
      offset(north, 0.25, 0.35),
      offset(center, -0.7, 0.3),
      offset(center, 0.7, -0.25),
      offset(east, 0.25, 0.25),
      offset(southWest, 0.2, 0.15),
    ],
  };
}

function crossroadsLayout(
  width: number,
  random: () => number,
): { paths: OrchardPath[]; clearings: OrchardClearing[]; apples: Vec2[] } {
  const hub = { x: jitter(random, 0.6), z: jitter(random, 0.5) };
  const west = { x: -5.8 + jitter(random, 0.45), z: -0.2 + jitter(random, 0.5) };
  const east = { x: 5.7 + jitter(random, 0.45), z: 0.2 + jitter(random, 0.5) };
  const north = { x: -0.5 + jitter(random, 0.55), z: 5.25 + jitter(random, 0.35) };
  const south = { x: 0.6 + jitter(random, 0.55), z: -5.25 + jitter(random, 0.35) };
  return {
    paths: [
      path('west-east', width, [west, hub, east]),
      path('north-south', width, [north, hub, south]),
      path('kid-route', width * 0.88, [KID_START, north, hub]),
      path('delivery-route', width * 0.88, [hub, east, DELIVERY_ZONE]),
      path('guard-route', width * 0.82, [GUARD_STARTS[0], south, GUARD_STARTS[1]]),
    ],
    clearings: clearingsFrom([
      [KID_START, 1.3],
      [west, 1.55],
      [east, 1.55],
      [north, 1.55],
      [south, 1.55],
      [hub, 2.25],
      [DELIVERY_ZONE, 2.35],
      [GUARD_STARTS[0], 1.2],
      [GUARD_STARTS[1], 1.2],
    ]),
    apples: [
      offset(west, -0.25, 0.35),
      offset(north, 0.3, -0.2),
      offset(hub, -0.75, 0.35),
      offset(hub, 0.75, -0.35),
      offset(east, 0.2, 0.35),
      offset(south, -0.25, 0.25),
    ],
  };
}

function plantForest(
  paths: readonly OrchardPath[],
  clearings: readonly OrchardClearing[],
  density: number,
  random: () => number,
): OrchardTree[] {
  const spacing = lerp(1.52, 1.02, density);
  const trees: OrchardTree[] = [];
  let serial = 0;
  for (let z = -8.3; z <= 8.3; z += spacing) {
    for (let x = -11.35; x <= 11.35; x += spacing) {
      if (random() > lerp(0.84, 0.97, density)) continue;
      const position = {
        x: x + jitter(random, spacing * 0.18),
        z: z + jitter(random, spacing * 0.18),
      };
      if (clearings.some((clearing) => distance(position, clearing) < clearing.radius + 0.25)) continue;
      if (paths.some((candidate) => distanceToPath(position, candidate) < candidate.width / 2 + 0.28)) continue;
      if (distance(position, DELIVERY_ZONE) < 2.55) continue;
      const variantRoll = random();
      const variant = variantRoll < 0.5
        ? TREE_VARIANTS[0]
        : variantRoll < 0.72
          ? TREE_VARIANTS[1]
          : TREE_VARIANTS[2];
      const scale = 0.82 + random() * 0.3;
      if (trees.some((tree) => distance(position, tree) < TREE_COLLIDER_RADIUS * (scale + tree.scale) * 1.35)) {
        continue;
      }
      trees.push({
        id: `tree-${serial}`,
        ...position,
        variant,
        rotationY: random() * Math.PI * 2,
        scale,
      });
      serial += 1;
    }
  }
  if (trees.length <= MAX_MAP_TREES) return trees;
  for (let index = trees.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [trees[index], trees[target]] = [trees[target], trees[index]];
  }
  return trees
    .slice(0, MAX_MAP_TREES)
    .sort((first, second) => first.id.localeCompare(second.id));
}

function path(id: string, width: number, points: Vec2[]): OrchardPath {
  return { id, width, points: points.map((point) => ({ ...point })) };
}

function clearingsFrom(entries: Array<[Vec2, number]>): OrchardClearing[] {
  return entries.map(([point, radius], index) => ({
    id: `clearing-${index}`,
    ...point,
    radius,
  }));
}

function distanceToPath(point: Vec2, candidate: OrchardPath): number {
  let minimum = Number.POSITIVE_INFINITY;
  for (let index = 1; index < candidate.points.length; index += 1) {
    minimum = Math.min(minimum, distanceToSegment(point, candidate.points[index - 1], candidate.points[index]));
  }
  return minimum;
}

function distanceToSegment(point: Vec2, start: Vec2, end: Vec2): number {
  const deltaX = end.x - start.x;
  const deltaZ = end.z - start.z;
  const denominator = deltaX * deltaX + deltaZ * deltaZ;
  const t = denominator <= 0.00001
    ? 0
    : clamp(((point.x - start.x) * deltaX + (point.z - start.z) * deltaZ) / denominator, 0, 1);
  return Math.hypot(point.x - (start.x + deltaX * t), point.z - (start.z + deltaZ * t));
}

function distance(first: Vec2, second: Vec2): number {
  return Math.hypot(first.x - second.x, first.z - second.z);
}

function offset(point: Vec2, x: number, z: number): Vec2 {
  return { x: point.x + x, z: point.z + z };
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
