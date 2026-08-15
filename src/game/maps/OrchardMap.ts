import { GAME_CONFIG } from '../config';
import type { Vec2 } from '../types';

export const ORCHARD_MAP_VERSION = 1;
export const MIN_MAP_APPLES = 6;
export const MAX_MAP_APPLES = 12;
export const MAX_MAP_TREES = 180;
export const TREE_COLLIDER_RADIUS = 0.42;

export const TREE_VARIANTS = ['broadleaf', 'pine', 'cherry'] as const;

export type TreeVariant = typeof TREE_VARIANTS[number];

export type OrchardTree = Vec2 & {
  id: string;
  variant: TreeVariant;
  rotationY: number;
  scale: number;
};

export type OrchardPath = {
  id: string;
  width: number;
  points: Vec2[];
};

export type OrchardClearing = Vec2 & {
  id: string;
  radius: number;
};

export type OrchardMap = {
  version: typeof ORCHARD_MAP_VERSION;
  id: string;
  name: string;
  seed: number;
  trees: OrchardTree[];
  paths: OrchardPath[];
  clearings: OrchardClearing[];
  appleSpawns: Vec2[];
  kidStart: Vec2;
  guardStarts: [Vec2, Vec2];
  deliveryZone: Vec2;
};

export type MapValidation = {
  valid: boolean;
  errors: string[];
  warnings: string[];
  reachableTargets: number;
  totalTargets: number;
};

type UnknownRecord = Record<string, unknown>;

export function cloneOrchardMap(map: OrchardMap): OrchardMap {
  return {
    ...map,
    trees: map.trees.map((tree) => ({ ...tree })),
    paths: map.paths.map((path) => ({
      ...path,
      points: path.points.map((point) => ({ ...point })),
    })),
    clearings: map.clearings.map((clearing) => ({ ...clearing })),
    appleSpawns: map.appleSpawns.map((apple) => ({ ...apple })),
    kidStart: { ...map.kidStart },
    guardStarts: [{ ...map.guardStarts[0] }, { ...map.guardStarts[1] }],
    deliveryZone: { ...map.deliveryZone },
  };
}

export function parseOrchardMap(value: unknown): OrchardMap | null {
  if (!isRecord(value) || value.version !== ORCHARD_MAP_VERSION) return null;
  const trees = parseArray(value.trees, parseTree);
  const paths = parseArray(value.paths, parsePath);
  const clearings = parseArray(value.clearings, parseClearing);
  const appleSpawns = parseArray(value.appleSpawns, parseVec2);
  const kidStart = parseVec2(value.kidStart, 0);
  const deliveryZone = parseVec2(value.deliveryZone, 0);
  if (!trees || !paths || !clearings || !appleSpawns || !kidStart || !deliveryZone) return null;
  if (!Array.isArray(value.guardStarts) || value.guardStarts.length !== 2) return null;
  const guard1 = parseVec2(value.guardStarts[0], 0);
  const guard2 = parseVec2(value.guardStarts[1], 1);
  if (!guard1 || !guard2) return null;

  return {
    version: ORCHARD_MAP_VERSION,
    id: text(value.id, `map-${Date.now()}`),
    name: text(value.name, '未命名果园'),
    seed: finiteNumber(value.seed, 1),
    trees: trees.slice(0, MAX_MAP_TREES),
    paths,
    clearings,
    appleSpawns: appleSpawns.slice(0, MAX_MAP_APPLES),
    kidStart,
    guardStarts: [guard1, guard2],
    deliveryZone,
  };
}

export function validateOrchardMap(map: OrchardMap): MapValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (map.appleSpawns.length < MIN_MAP_APPLES) {
    errors.push(`至少需要 ${MIN_MAP_APPLES} 个果实出生点。`);
  }
  if (map.appleSpawns.length > MAX_MAP_APPLES) {
    errors.push(`果实出生点不能超过 ${MAX_MAP_APPLES} 个。`);
  }
  if (map.trees.length > MAX_MAP_TREES) {
    errors.push(`树木不能超过 ${MAX_MAP_TREES} 棵。`);
  }
  if (map.trees.length < 24) warnings.push('树木较少，地图可能缺少树林小路的感觉。');

  const importantPoints = [
    map.kidStart,
    ...map.guardStarts,
    map.deliveryZone,
    ...map.appleSpawns,
  ];
  if (importantPoints.some((point) => !insideArena(point, 0.65))) {
    errors.push('出生点、果实或投递区超出了可玩边界。');
  }

  const blockedImportantPoints = importantPoints.filter((point) =>
    map.trees.some((tree) => circlesOverlap(
      point,
      0.64,
      tree,
      TREE_COLLIDER_RADIUS * tree.scale,
    )),
  ).length;
  if (blockedImportantPoints > 0) {
    errors.push(`有 ${blockedImportantPoints} 个关键点被树木挡住。`);
  }

  const reachability = measureReachability(map);
  if (reachability.reachableTargets < reachability.totalTargets) {
    errors.push(
      `只有 ${reachability.reachableTargets}/${reachability.totalTargets} 个目标可从小偷出生点到达。`,
    );
  }

  const closeTreePairs = countCloseTreePairs(map.trees);
  if (closeTreePairs > Math.max(6, map.trees.length * 0.12)) {
    warnings.push('部分树木过度重叠，建议用擦除工具整理边缘。');
  }
  if (map.paths.length === 0) warnings.push('还没有地面小路，可使用“小路”工具绘制。');
  if (map.clearings.length === 0) warnings.push('还没有标记空地，可用“空地”工具快速开辟。');

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    reachableTargets: reachability.reachableTargets,
    totalTargets: reachability.totalTargets,
  };
}

export function insideArena(point: Vec2, padding = 0): boolean {
  return Math.abs(point.x) <= GAME_CONFIG.arenaHalfWidth - padding &&
    Math.abs(point.z) <= GAME_CONFIG.arenaHalfDepth - padding;
}

export function treeColliderRadius(tree: OrchardTree): number {
  return TREE_COLLIDER_RADIUS * tree.scale;
}

function measureReachability(map: OrchardMap): { reachableTargets: number; totalTargets: number } {
  const cellSize = 0.5;
  const minX = -GAME_CONFIG.arenaHalfWidth + GAME_CONFIG.kidRadius;
  const minZ = -GAME_CONFIG.arenaHalfDepth + GAME_CONFIG.kidRadius;
  const columns = Math.floor((GAME_CONFIG.arenaHalfWidth * 2 - GAME_CONFIG.kidRadius * 2) / cellSize) + 1;
  const rows = Math.floor((GAME_CONFIG.arenaHalfDepth * 2 - GAME_CONFIG.kidRadius * 2) / cellSize) + 1;
  const blocked = new Uint8Array(columns * rows);
  const key = (column: number, row: number) => row * columns + column;
  const pointAt = (column: number, row: number): Vec2 => ({
    x: minX + column * cellSize,
    z: minZ + row * cellSize,
  });

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const point = pointAt(column, row);
      blocked[key(column, row)] = map.trees.some((tree) => circlesOverlap(
        point,
        GAME_CONFIG.kidRadius,
        tree,
        treeColliderRadius(tree),
      )) ? 1 : 0;
    }
  }

  const nearestCell = (point: Vec2): [number, number] => [
    clamp(Math.round((point.x - minX) / cellSize), 0, columns - 1),
    clamp(Math.round((point.z - minZ) / cellSize), 0, rows - 1),
  ];
  const [startColumn, startRow] = nearestCell(map.kidStart);
  const visited = new Uint8Array(columns * rows);
  const queue: Array<[number, number]> = [[startColumn, startRow]];
  visited[key(startColumn, startRow)] = 1;
  let cursor = 0;
  while (cursor < queue.length) {
    const [column, row] = queue[cursor];
    cursor += 1;
    for (const [nextColumn, nextRow] of [
      [column - 1, row],
      [column + 1, row],
      [column, row - 1],
      [column, row + 1],
    ]) {
      if (nextColumn < 0 || nextColumn >= columns || nextRow < 0 || nextRow >= rows) continue;
      const index = key(nextColumn, nextRow);
      if (blocked[index] || visited[index]) continue;
      visited[index] = 1;
      queue.push([nextColumn, nextRow]);
    }
  }

  const targets = [map.deliveryZone, ...map.appleSpawns, ...map.guardStarts];
  const reachableTargets = targets.filter((target) => {
    const [column, row] = nearestCell(target);
    return visited[key(column, row)] === 1;
  }).length;
  return { reachableTargets, totalTargets: targets.length };
}

function countCloseTreePairs(trees: readonly OrchardTree[]): number {
  let count = 0;
  for (let first = 0; first < trees.length; first += 1) {
    for (let second = first + 1; second < trees.length; second += 1) {
      if (circlesOverlap(trees[first], 0.34, trees[second], 0.34)) count += 1;
    }
  }
  return count;
}

function circlesOverlap(first: Vec2, firstRadius: number, second: Vec2, secondRadius: number): boolean {
  const deltaX = first.x - second.x;
  const deltaZ = first.z - second.z;
  const radius = firstRadius + secondRadius;
  return deltaX * deltaX + deltaZ * deltaZ < radius * radius;
}

function parseTree(value: unknown, index: number): OrchardTree | null {
  if (!isRecord(value)) return null;
  const point = parseVec2(value, index);
  if (!point) return null;
  const variant = TREE_VARIANTS.includes(value.variant as TreeVariant)
    ? value.variant as TreeVariant
    : TREE_VARIANTS[index % TREE_VARIANTS.length];
  return {
    ...point,
    id: text(value.id, `tree-${index}`),
    variant,
    rotationY: finiteNumber(value.rotationY, 0),
    scale: clamp(finiteNumber(value.scale, 1), 0.65, 1.35),
  };
}

function parsePath(value: unknown, index: number): OrchardPath | null {
  if (!isRecord(value)) return null;
  const points = parseArray(value.points, parseVec2);
  if (!points || points.length < 2) return null;
  return {
    id: text(value.id, `path-${index}`),
    width: clamp(finiteNumber(value.width, 2.4), 1.4, 5),
    points,
  };
}

function parseClearing(value: unknown, index: number): OrchardClearing | null {
  if (!isRecord(value)) return null;
  const point = parseVec2(value, index);
  if (!point) return null;
  return {
    ...point,
    id: text(value.id, `clearing-${index}`),
    radius: clamp(finiteNumber(value.radius, 1.8), 1, 4),
  };
}

function parseVec2(value: unknown, _index: number): Vec2 | null {
  if (!isRecord(value)) return null;
  if (!Number.isFinite(value.x) || !Number.isFinite(value.z)) return null;
  return { x: Number(value.x), z: Number(value.z) };
}

function parseArray<T>(
  value: unknown,
  parser: (entry: unknown, index: number) => T | null,
): T[] | null {
  if (!Array.isArray(value)) return null;
  const parsed: T[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const entry = parser(value[index], index);
    if (!entry) return null;
    parsed.push(entry);
  }
  return parsed;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown, fallback: number): number {
  return Number.isFinite(value) ? Number(value) : fallback;
}

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 80) : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
