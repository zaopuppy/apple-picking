import { ARENA_SCALE, GAME_CONFIG } from '../config';
import type { Vec2 } from '../types';
import { createSeededRandom } from '../../utils/random';
import {
  distanceToIslandOutline,
  pointInsideIslandOutline,
  validateIslandOutlineGeometry,
} from './IslandOutline';

export const ORCHARD_MAP_VERSION = 5;
export const MIN_MAP_APPLES = 6;
export const MAX_MAP_APPLES = 12;
export const MAX_MAP_TREES = 2000;
export const MAX_MAP_LANDMARKS = 48;
export const MAX_TERRAIN_ZONES = 64;
export const MAX_DELIVERY_ZONES = 4;
export const MAX_ISLAND_OUTLINE_POINTS = 64;
export const MAX_ISLAND_REGIONS = 24;
export const MAX_ISLAND_ROUTE_BLOCKS = 64;
export const MAX_ISLAND_WATER_SEGMENTS = 32;
export const MAX_ISLAND_WATER_BLOCKS = 64;
export const MAX_ISLAND_BRIDGES = 16;
export const TREE_COLLIDER_RADIUS = 0.31;

export const TREE_VARIANTS = ['stump', 'broadleaf', 'pine', 'cherry'] as const;
export const LANDMARK_KINDS = ['homestead', 'pond'] as const;
export const TERRAIN_ZONE_KINDS = ['meadow', 'orchard', 'wildflowers'] as const;
export const KAYKIT_WORLD_THEMES = ['village', 'riverside', 'fortified'] as const;
export const KAYKIT_TILE_SHAPES = ['square', 'hex'] as const;
export const ISLAND_REGION_KINDS = ['orchard', 'homestead', 'plaza', 'garden', 'beach'] as const;
export const ISLAND_ROUTE_BLOCK_KINDS = ['hedge', 'hill', 'shrine', 'woodlot'] as const;
export const KAYKIT_BUILDING_ASSETS = [
  'house',
  'market',
  'farmPlot',
  'lumbermill',
  'mill',
  'watermill',
  'well',
  'archeryRange',
  'barracks',
  'watchtower',
  'castle',
  'mine',
] as const;

export type TreeVariant = typeof TREE_VARIANTS[number];
export type LandmarkKind = typeof LANDMARK_KINDS[number];
export type TerrainZoneKind = typeof TERRAIN_ZONE_KINDS[number];
export type KayKitWorldTheme = typeof KAYKIT_WORLD_THEMES[number];
export type KayKitTileShape = typeof KAYKIT_TILE_SHAPES[number];
export type KayKitBuildingAsset = typeof KAYKIT_BUILDING_ASSETS[number];
export type OrchardIslandRegionKind = typeof ISLAND_REGION_KINDS[number];
export type OrchardIslandRouteBlockKind = typeof ISLAND_ROUTE_BLOCK_KINDS[number];

export type OrchardWorldStyle = {
  theme: KayKitWorldTheme;
  tileShape: KayKitTileShape;
};

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

export type OrchardLandmark = Vec2 & {
  id: string;
  kind: LandmarkKind;
  asset?: KayKitBuildingAsset;
  rotationY: number;
  radiusX: number;
  radiusZ: number;
};

export type OrchardTerrainZone = Vec2 & {
  id: string;
  kind: TerrainZoneKind;
  rotationY: number;
  radiusX: number;
  radiusZ: number;
};

export type OrchardDeliveryZone = Vec2 & {
  id: string;
};

export type OrchardIslandRegion = Vec2 & {
  id: string;
  kind: OrchardIslandRegionKind;
  rotationY: number;
  radiusX: number;
  radiusZ: number;
};

export type OrchardIslandRouteBlock = Vec2 & {
  id: string;
  kind: OrchardIslandRouteBlockKind;
  radiusX: number;
  radiusZ: number;
};

export type OrchardIslandWaterSegment = Vec2 & {
  id: string;
  sizeX: number;
  sizeZ: number;
};

export type OrchardIslandWaterBlock = Vec2 & {
  id: string;
  radiusX: number;
  radiusZ: number;
};

export type OrchardIslandBridge = Vec2 & {
  id: string;
  width: number;
  depth: number;
};

export type OrchardIslandLayout = {
  outline: Vec2[];
  regions: OrchardIslandRegion[];
  routeBlocks: OrchardIslandRouteBlock[];
  waterSegments: OrchardIslandWaterSegment[];
  waterBlocks: OrchardIslandWaterBlock[];
  bridges: OrchardIslandBridge[];
};

export type OrchardMap = {
  version: typeof ORCHARD_MAP_VERSION;
  id: string;
  name: string;
  seed: number;
  worldStyle: OrchardWorldStyle;
  trees: OrchardTree[];
  paths: OrchardPath[];
  clearings: OrchardClearing[];
  landmarks: OrchardLandmark[];
  terrainZones: OrchardTerrainZone[];
  appleSpawns: Vec2[];
  kidStart: Vec2;
  guardStarts: [Vec2, Vec2];
  deliveryZone: Vec2;
  deliveryZones?: OrchardDeliveryZone[];
  islandLayout?: OrchardIslandLayout;
};

export type MapValidation = {
  valid: boolean;
  errors: string[];
  warnings: string[];
  reachableTargets: number;
  totalTargets: number;
};

type UnknownRecord = Record<string, unknown>;
type IndexedTree = { index: number; tree: OrchardTree };
type TreeSpatialIndex = {
  cellSize: number;
  buckets: Map<string, IndexedTree[]>;
};

const TREE_COLLIDER_RADII: Record<TreeVariant, number> = {
  stump: TREE_COLLIDER_RADIUS,
  broadleaf: 0.58,
  pine: 0.52,
  cherry: 0.6,
};
const MAX_TREE_COLLIDER_RADIUS = Math.max(...Object.values(TREE_COLLIDER_RADII)) * 1.35;

export function cloneOrchardMap(map: OrchardMap): OrchardMap {
  return {
    ...map,
    worldStyle: { ...map.worldStyle },
    trees: map.trees.map((tree) => ({ ...tree })),
    paths: map.paths.map((path) => ({
      ...path,
      points: path.points.map((point) => ({ ...point })),
    })),
    clearings: map.clearings.map((clearing) => ({ ...clearing })),
    landmarks: map.landmarks.map((landmark) => ({ ...landmark })),
    terrainZones: map.terrainZones.map((zone) => ({ ...zone })),
    appleSpawns: map.appleSpawns.map((apple) => ({ ...apple })),
    kidStart: { ...map.kidStart },
    guardStarts: [{ ...map.guardStarts[0] }, { ...map.guardStarts[1] }],
    deliveryZone: { ...map.deliveryZone },
    ...(map.deliveryZones
      ? { deliveryZones: map.deliveryZones.map((zone) => ({ ...zone })) }
      : {}),
    ...(map.islandLayout
      ? {
          islandLayout: {
            outline: map.islandLayout.outline.map((point) => ({ ...point })),
            regions: map.islandLayout.regions.map((region) => ({ ...region })),
            routeBlocks: map.islandLayout.routeBlocks.map((block) => ({ ...block })),
            waterSegments: map.islandLayout.waterSegments.map((segment) => ({ ...segment })),
            waterBlocks: map.islandLayout.waterBlocks.map((block) => ({ ...block })),
            bridges: map.islandLayout.bridges.map((bridge) => ({ ...bridge })),
          },
        }
      : {}),
  };
}

export function parseOrchardMap(value: unknown): OrchardMap | null {
  if (!isRecord(value) || ![1, 2, 3, 4, ORCHARD_MAP_VERSION].includes(Number(value.version))) return null;
  const sourceVersion = Number(value.version);
  const trees = parseArray(value.trees, parseTree);
  const paths = parseArray(value.paths, (entry, index) => parsePath(entry, index, sourceVersion));
  const clearings = parseArray(value.clearings, (entry, index) => parseClearing(entry, index, sourceVersion));
  const landmarks = sourceVersion >= 4
    ? parseArray(value.landmarks, parseLandmark)
    : [];
  const terrainZones = sourceVersion >= 4
    ? parseArray(value.terrainZones, parseTerrainZone)
    : [];
  const appleSpawns = parseArray(value.appleSpawns, parseVec2);
  const kidStart = parseVec2(value.kidStart, 0);
  const deliveryZone = parseVec2(value.deliveryZone, 0);
  const deliveryZones = value.deliveryZones === undefined
    ? undefined
    : parseArray(value.deliveryZones, parseDeliveryZone);
  const islandLayout = sourceVersion >= 5 && value.islandLayout !== undefined
    ? parseIslandLayout(value.islandLayout)
    : undefined;
  if (!trees || !paths || !clearings || !landmarks || !terrainZones || !appleSpawns || !kidStart || !deliveryZone) {
    return null;
  }
  if (value.deliveryZones !== undefined && !deliveryZones) return null;
  if (sourceVersion >= 5 && value.islandLayout !== undefined && !islandLayout) return null;
  if (!Array.isArray(value.guardStarts) || value.guardStarts.length !== 2) return null;
  const guard1 = parseVec2(value.guardStarts[0], 0);
  const guard2 = parseVec2(value.guardStarts[1], 1);
  if (!guard1 || !guard2) return null;

  const parsed: OrchardMap = {
    version: ORCHARD_MAP_VERSION,
    id: text(value.id, `map-${Date.now()}`),
    name: text(value.name, '未命名果园'),
    seed: finiteNumber(value.seed, 1),
    worldStyle: parseWorldStyle(value.worldStyle),
    trees: trees.slice(0, MAX_MAP_TREES),
    paths,
    clearings,
    landmarks: landmarks.slice(0, MAX_MAP_LANDMARKS),
    terrainZones: terrainZones.slice(0, MAX_TERRAIN_ZONES),
    appleSpawns: appleSpawns.slice(0, MAX_MAP_APPLES),
    kidStart,
    guardStarts: [guard1, guard2],
    deliveryZone: deliveryZones?.[0]
      ? { x: deliveryZones[0].x, z: deliveryZones[0].z }
      : deliveryZone,
    ...(deliveryZones?.length
      ? { deliveryZones: deliveryZones.slice(0, MAX_DELIVERY_ZONES) }
      : {}),
    ...(islandLayout ? { islandLayout } : {}),
  };
  if (sourceVersion === 1) return migrateVersionOneMap(parsed);
  if (sourceVersion === 2) return migrateVersionTwoMap(parsed);
  return parsed;
}

export function validateOrchardMap(map: OrchardMap): MapValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const deliveryZones = deliveryZonesForMap(map);
  const importantPoints = [
    map.kidStart,
    ...map.guardStarts,
    ...deliveryZones,
    ...map.appleSpawns,
  ];
  if (map.appleSpawns.length < MIN_MAP_APPLES) {
    errors.push(`至少需要 ${MIN_MAP_APPLES} 个果实出生点。`);
  }
  if (map.appleSpawns.length > MAX_MAP_APPLES) {
    errors.push(`果实出生点不能超过 ${MAX_MAP_APPLES} 个。`);
  }
  if (map.trees.length > MAX_MAP_TREES) {
    errors.push(`树木不能超过 ${MAX_MAP_TREES} 棵。`);
  }
  if (map.landmarks.length > MAX_MAP_LANDMARKS) {
    errors.push(`地标不能超过 ${MAX_MAP_LANDMARKS} 个。`);
  }
  if (map.terrainZones.length > MAX_TERRAIN_ZONES) {
    errors.push(`地表区域不能超过 ${MAX_TERRAIN_ZONES} 个。`);
  }
  if (deliveryZones.length > MAX_DELIVERY_ZONES) {
    errors.push(`投递区不能超过 ${MAX_DELIVERY_ZONES} 个。`);
  }
  if (new Set(deliveryZones.map((zone) => zone.id)).size !== deliveryZones.length) {
    errors.push('投递区 ID 不能重复。');
  }
  if (map.deliveryZones?.[0] &&
    (!approximatelyEqual(map.deliveryZone.x, map.deliveryZones[0].x) ||
      !approximatelyEqual(map.deliveryZone.z, map.deliveryZones[0].z))) {
    errors.push('主投递区兼容字段必须与投递区列表第一项一致。');
  }
  validateIslandLayout(map.islandLayout, map.landmarks, importantPoints, errors);
  if (map.trees.length > 360) warnings.push('树木较多，可能切碎开放地形并遮挡角色。');

  if (importantPoints.some((point) => !insideArena(point, 0.65))) {
    errors.push('出生点、果实或投递区超出了可玩边界。');
  }
  const outOfBoundsLandmarks = map.landmarks.filter((landmark) =>
    !landmark.id.startsWith('island-coast-edge-') && !landmarkInsideArena(landmark)).length;
  if (outOfBoundsLandmarks > 0) errors.push(`有 ${outOfBoundsLandmarks} 个地标超出了可玩边界。`);

  const treeIndex = createTreeSpatialIndex(map.trees);
  const blockedImportantPoints = importantPoints.filter((point) =>
    pointBlockedByTree(treeIndex, point, 0.64) ||
      map.landmarks.some((landmark) => landmarkBlocksPoint(landmark, point, 0.64)),
  ).length;
  if (blockedImportantPoints > 0) {
    errors.push(`有 ${blockedImportantPoints} 个关键点被障碍挡住。`);
  }

  if (map.landmarks.length > 0) {
    const crampedImportantPoints = importantPoints.filter((point) =>
      pointBlockedByTree(treeIndex, point, 1.5) ||
        map.landmarks.some((landmark) => landmarkBlocksPoint(landmark, point, 1.5)),
    ).length;
    if (crampedImportantPoints > 0) {
      errors.push(`有 ${crampedImportantPoints} 个关键点缺少宽阔活动空间。`);
    }
  }

  const reachability = measureReachability(map, treeIndex);
  if (reachability.reachableTargets < reachability.totalTargets) {
    errors.push(
      `只有 ${reachability.reachableTargets}/${reachability.totalTargets} 个目标可从小偷出生点到达。`,
    );
  }
  if (map.landmarks.length > 0 && reachability.openRatio < 0.58) {
    errors.push('开放地形不足，地标和树木把地图切得过于拥挤。');
  } else if (map.landmarks.length > 0 && reachability.openRatio < 0.68) {
    warnings.push('可行走面积偏紧，建议减少地标覆盖率或树木。');
  }

  const closeTreePairs = countCloseTreePairs(map.trees, treeIndex);
  if (closeTreePairs > Math.max(6, map.trees.length * 0.12)) {
    warnings.push('部分树木过度重叠，建议用擦除工具整理边缘。');
  }
  if (map.landmarks.length === 0 && map.terrainZones.length > 0) {
    warnings.push('地图还没有语义地标，可加入小院或池塘作为方向参照。');
  }

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
  return TREE_COLLIDER_RADII[tree.variant] * tree.scale;
}

export function deliveryZonesForMap(map: OrchardMap): readonly OrchardDeliveryZone[] {
  if (map.deliveryZones && map.deliveryZones.length > 0) return map.deliveryZones;
  return [{ id: 'delivery-primary', ...map.deliveryZone }];
}

function validateIslandLayout(
  layout: OrchardIslandLayout | undefined,
  landmarks: readonly OrchardLandmark[],
  importantPoints: readonly Vec2[],
  errors: string[],
): void {
  if (!layout) return;
  if (layout.outline.length < 3 || layout.outline.length > MAX_ISLAND_OUTLINE_POINTS) {
    errors.push(`岛屿轮廓需要 3-${MAX_ISLAND_OUTLINE_POINTS} 个点。`);
  }
  if (layout.regions.length === 0 || layout.regions.length > MAX_ISLAND_REGIONS) {
    errors.push(`岛屿区域需要 1-${MAX_ISLAND_REGIONS} 个。`);
  }
  if (layout.routeBlocks.length > MAX_ISLAND_ROUTE_BLOCKS) {
    errors.push(`岛屿通路块不能超过 ${MAX_ISLAND_ROUTE_BLOCKS} 个。`);
  }
  if (layout.waterSegments.length > MAX_ISLAND_WATER_SEGMENTS) {
    errors.push(`岛屿水面段不能超过 ${MAX_ISLAND_WATER_SEGMENTS} 个。`);
  }
  if (layout.waterBlocks.length > MAX_ISLAND_WATER_BLOCKS) {
    errors.push(`岛屿水域碰撞块不能超过 ${MAX_ISLAND_WATER_BLOCKS} 个。`);
  }
  if (layout.bridges.length > MAX_ISLAND_BRIDGES) {
    errors.push(`岛屿桥梁不能超过 ${MAX_ISLAND_BRIDGES} 个。`);
  }

  const semanticObjects = [
    ...layout.regions,
    ...layout.routeBlocks,
    ...layout.waterSegments,
    ...layout.waterBlocks,
    ...layout.bridges,
  ];
  if (new Set(semanticObjects.map((entry) => entry.id)).size !== semanticObjects.length) {
    errors.push('岛屿语义对象 ID 不能重复。');
  }
  if (layout.outline.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.z))) {
    errors.push('岛屿轮廓包含无效坐标。');
  }
  const outlineErrors = validateIslandOutlineGeometry(layout.outline);
  for (const error of outlineErrors) {
    if (!errors.includes(error)) errors.push(error);
  }
  if (outlineErrors.length === 0) {
    const semanticCenters = [
      ...importantPoints,
      ...layout.regions,
      ...layout.routeBlocks,
      ...layout.waterSegments,
      ...layout.bridges,
    ];
    if (semanticCenters.some((point) =>
      !pointInsideIslandOutline(point, layout.outline) ||
        distanceToIslandOutline(point, layout.outline) < 0.3)) {
      errors.push('海岸线必须包住出生点、目标和岛屿语义中心。');
    }
  }
  if (layout.regions.some((region) =>
    !ISLAND_REGION_KINDS.includes(region.kind) ||
      !positiveFiniteDimensions(region.radiusX, region.radiusZ))) {
    errors.push('岛屿区域包含无效类型或尺寸。');
  }
  if (layout.routeBlocks.some((block) =>
    !ISLAND_ROUTE_BLOCK_KINDS.includes(block.kind) ||
      !positiveFiniteDimensions(block.radiusX, block.radiusZ))) {
    errors.push('岛屿通路块包含无效类型或尺寸。');
  }
  if (layout.waterSegments.some((segment) =>
    !positiveFiniteDimensions(segment.sizeX, segment.sizeZ)) ||
      layout.waterBlocks.some((block) => !positiveFiniteDimensions(block.radiusX, block.radiusZ)) ||
      layout.bridges.some((bridge) => !positiveFiniteDimensions(bridge.width, bridge.depth))) {
    errors.push('岛屿水系或桥梁包含无效尺寸。');
  }
  const collisionBlocks = [...layout.routeBlocks, ...layout.waterBlocks];
  if (collisionBlocks.some((block) => {
    const proxy = landmarks.find((landmark) => landmark.id === block.id);
    return !proxy || proxy.kind !== 'homestead' || proxy.rotationY !== 0 ||
      !approximatelyEqual(proxy.x, block.x) || !approximatelyEqual(proxy.z, block.z) ||
      !approximatelyEqual(proxy.radiusX, block.radiusX) || !approximatelyEqual(proxy.radiusZ, block.radiusZ);
  })) {
    errors.push('岛屿通路或水域碰撞代理与语义结构不同步。');
  }
}

function positiveFiniteDimensions(first: number, second: number): boolean {
  return Number.isFinite(first) && first > 0 && Number.isFinite(second) && second > 0;
}

function approximatelyEqual(first: number, second: number): boolean {
  return Math.abs(first - second) < 0.0001;
}

export function landmarkBlocksPoint(
  landmark: OrchardLandmark,
  point: Vec2,
  padding = 0,
): boolean {
  const local = worldToLandmark(point, landmark);
  const radiusX = landmark.radiusX + padding;
  const radiusZ = landmark.radiusZ + padding;
  if (landmark.kind === 'homestead') {
    return Math.abs(local.x) < radiusX && Math.abs(local.z) < radiusZ;
  }
  return (local.x / radiusX) ** 2 + (local.z / radiusZ) ** 2 < 1;
}

export function landmarkInsideArena(landmark: OrchardLandmark, padding = 0.4): boolean {
  const cosine = Math.abs(Math.cos(landmark.rotationY));
  const sine = Math.abs(Math.sin(landmark.rotationY));
  const extentX = cosine * landmark.radiusX + sine * landmark.radiusZ;
  const extentZ = sine * landmark.radiusX + cosine * landmark.radiusZ;
  return Math.abs(landmark.x) + extentX <= GAME_CONFIG.arenaHalfWidth - padding &&
    Math.abs(landmark.z) + extentZ <= GAME_CONFIG.arenaHalfDepth - padding;
}

export function resolveCircleAgainstLandmark(
  position: Vec2,
  radius: number,
  landmark: OrchardLandmark,
): void {
  const local = worldToLandmark(position, landmark);
  const radiusX = landmark.radiusX + radius;
  const radiusZ = landmark.radiusZ + radius;
  if (landmark.kind === 'homestead') {
    if (Math.abs(local.x) >= radiusX || Math.abs(local.z) >= radiusZ) return;
    const pushX = radiusX - Math.abs(local.x);
    const pushZ = radiusZ - Math.abs(local.z);
    if (pushX < pushZ) local.x = (local.x < 0 ? -1 : 1) * radiusX;
    else local.z = (local.z < 0 ? -1 : 1) * radiusZ;
  } else {
    const normalized = Math.hypot(local.x / radiusX, local.z / radiusZ);
    if (normalized >= 1) return;
    if (normalized <= 0.000001) local.x = radiusX;
    else {
      local.x /= normalized;
      local.z /= normalized;
    }
  }
  const world = landmarkToWorld(local, landmark);
  position.x = world.x;
  position.z = world.z;
}

export function upgradeSparseLegacyMap(map: OrchardMap): OrchardMap {
  if ((!map.id.endsWith('-expanded') && !map.id.endsWith('-compact')) || map.trees.length >= 240) return map;
  return fillExpandedLegacyMap(map);
}

function measureReachability(
  map: OrchardMap,
  treeIndex: TreeSpatialIndex,
): { reachableTargets: number; totalTargets: number; openRatio: number } {
  const cellSize = 1;
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
  let openCells = 0;

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const point = pointAt(column, row);
      const isBlocked = pointBlockedByTree(treeIndex, point, GAME_CONFIG.kidRadius) ||
        map.landmarks.some((landmark) => landmarkBlocksPoint(landmark, point, GAME_CONFIG.kidRadius));
      blocked[key(column, row)] = isBlocked ? 1 : 0;
      if (!isBlocked) openCells += 1;
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

  const targets = [...deliveryZonesForMap(map), ...map.appleSpawns, ...map.guardStarts];
  const reachableTargets = targets.filter((target) => {
    const [column, row] = nearestCell(target);
    return visited[key(column, row)] === 1;
  }).length;
  return {
    reachableTargets,
    totalTargets: targets.length,
    openRatio: openCells / Math.max(1, columns * rows),
  };
}

function countCloseTreePairs(
  trees: readonly OrchardTree[],
  treeIndex: TreeSpatialIndex,
): number {
  let count = 0;
  for (let first = 0; first < trees.length; first += 1) {
    const tree = trees[first];
    for (const candidate of nearbyTrees(treeIndex, tree, 1.2)) {
      if (candidate.index <= first) continue;
      if (circlesOverlap(tree, 0.34 * tree.scale, candidate.tree, 0.34 * candidate.tree.scale)) {
        count += 1;
      }
    }
  }
  return count;
}

function createTreeSpatialIndex(trees: readonly OrchardTree[]): TreeSpatialIndex {
  const index: TreeSpatialIndex = { cellSize: 2, buckets: new Map() };
  trees.forEach((tree, treeIndex) => {
    const key = spatialKey(tree.x, tree.z, index.cellSize);
    const bucket = index.buckets.get(key) ?? [];
    bucket.push({ index: treeIndex, tree });
    index.buckets.set(key, bucket);
  });
  return index;
}

function nearbyTrees(index: TreeSpatialIndex, point: Vec2, radius: number): IndexedTree[] {
  const result: IndexedTree[] = [];
  const minimumX = Math.floor((point.x - radius) / index.cellSize);
  const maximumX = Math.floor((point.x + radius) / index.cellSize);
  const minimumZ = Math.floor((point.z - radius) / index.cellSize);
  const maximumZ = Math.floor((point.z + radius) / index.cellSize);
  for (let x = minimumX; x <= maximumX; x += 1) {
    for (let z = minimumZ; z <= maximumZ; z += 1) {
      const bucket = index.buckets.get(`${x}:${z}`);
      if (bucket) result.push(...bucket);
    }
  }
  return result;
}

function pointBlockedByTree(index: TreeSpatialIndex, point: Vec2, radius: number): boolean {
  return nearbyTrees(index, point, radius + MAX_TREE_COLLIDER_RADIUS).some(({ tree }) =>
    circlesOverlap(point, radius, tree, treeColliderRadius(tree)),
  );
}

function spatialKey(x: number, z: number, cellSize: number): string {
  return `${Math.floor(x / cellSize)}:${Math.floor(z / cellSize)}`;
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

function parsePath(value: unknown, index: number, sourceVersion: number): OrchardPath | null {
  if (!isRecord(value)) return null;
  const points = parseArray(value.points, parseVec2);
  if (!points || points.length < 2) return null;
  return {
    id: text(value.id, `path-${index}`),
    width: sourceVersion === 1
      ? clamp(finiteNumber(value.width, 2.4), 1.4, 5)
      : sourceVersion === 2
        ? clamp(finiteNumber(value.width, 12), 6, 25)
        : clamp(finiteNumber(value.width, 7.2), 1.4, 15),
    points,
  };
}

function parseClearing(value: unknown, index: number, sourceVersion: number): OrchardClearing | null {
  if (!isRecord(value)) return null;
  const point = parseVec2(value, index);
  if (!point) return null;
  return {
    ...point,
    id: text(value.id, `clearing-${index}`),
    radius: sourceVersion === 1
      ? clamp(finiteNumber(value.radius, 1.8), 1, 4)
      : sourceVersion === 2
        ? clamp(finiteNumber(value.radius, 8), 3, 24)
        : clamp(finiteNumber(value.radius, 4.8), 1.8, 15),
  };
}

function parseLandmark(value: unknown, index: number): OrchardLandmark | null {
  if (!isRecord(value)) return null;
  const point = parseVec2(value, index);
  if (!point) return null;
  const kind = LANDMARK_KINDS.includes(value.kind as LandmarkKind)
    ? value.kind as LandmarkKind
    : LANDMARK_KINDS[index % LANDMARK_KINDS.length];
  const asset = KAYKIT_BUILDING_ASSETS.includes(value.asset as KayKitBuildingAsset)
    ? value.asset as KayKitBuildingAsset
    : undefined;
  return {
    ...point,
    id: text(value.id, `landmark-${index}`),
    kind,
    ...(kind === 'homestead' && asset ? { asset } : {}),
    rotationY: kind === 'homestead'
      ? alignToQuarterTurn(finiteNumber(value.rotationY, 0))
      : finiteNumber(value.rotationY, 0),
    radiusX: clamp(finiteNumber(value.radiusX, kind === 'homestead' ? 5 : 4), 0.25, 40),
    radiusZ: clamp(finiteNumber(value.radiusZ, kind === 'homestead' ? 4 : 3.2), 0.25, 30),
  };
}

function parseWorldStyle(value: unknown): OrchardWorldStyle {
  if (!isRecord(value)) return { theme: 'village', tileShape: 'square' };
  return {
    theme: KAYKIT_WORLD_THEMES.includes(value.theme as KayKitWorldTheme)
      ? value.theme as KayKitWorldTheme
      : 'village',
    tileShape: KAYKIT_TILE_SHAPES.includes(value.tileShape as KayKitTileShape)
      ? value.tileShape as KayKitTileShape
      : 'square',
  };
}

function parseTerrainZone(value: unknown, index: number): OrchardTerrainZone | null {
  if (!isRecord(value)) return null;
  const point = parseVec2(value, index);
  if (!point) return null;
  const kind = TERRAIN_ZONE_KINDS.includes(value.kind as TerrainZoneKind)
    ? value.kind as TerrainZoneKind
    : TERRAIN_ZONE_KINDS[index % TERRAIN_ZONE_KINDS.length];
  return {
    ...point,
    id: text(value.id, `terrain-${index}`),
    kind,
    rotationY: finiteNumber(value.rotationY, 0),
    radiusX: clamp(finiteNumber(value.radiusX, 6), 2.5, 18),
    radiusZ: clamp(finiteNumber(value.radiusZ, 4.5), 2.5, 14),
  };
}

function parseDeliveryZone(value: unknown, index: number): OrchardDeliveryZone | null {
  if (!isRecord(value)) return null;
  const point = parseVec2(value, index);
  if (!point) return null;
  return {
    ...point,
    id: text(value.id, `delivery-${index + 1}`),
  };
}

function parseIslandLayout(value: unknown): OrchardIslandLayout | null {
  if (!isRecord(value)) return null;
  const outline = parseArray(value.outline, parseVec2);
  const regions = parseArray(value.regions, parseIslandRegion);
  const routeBlocks = parseArray(value.routeBlocks, parseIslandRouteBlock);
  const waterSegments = parseArray(value.waterSegments, parseIslandWaterSegment);
  const waterBlocks = parseArray(value.waterBlocks, parseIslandWaterBlock);
  const bridges = parseArray(value.bridges, parseIslandBridge);
  if (!outline || outline.length < 3 || !regions || regions.length === 0 || !routeBlocks ||
    !waterSegments || !waterBlocks || !bridges) {
    return null;
  }
  return {
    outline: outline.slice(0, MAX_ISLAND_OUTLINE_POINTS),
    regions: regions.slice(0, MAX_ISLAND_REGIONS),
    routeBlocks: routeBlocks.slice(0, MAX_ISLAND_ROUTE_BLOCKS),
    waterSegments: waterSegments.slice(0, MAX_ISLAND_WATER_SEGMENTS),
    waterBlocks: waterBlocks.slice(0, MAX_ISLAND_WATER_BLOCKS),
    bridges: bridges.slice(0, MAX_ISLAND_BRIDGES),
  };
}

function parseIslandRegion(value: unknown, index: number): OrchardIslandRegion | null {
  if (!isRecord(value)) return null;
  const point = parseVec2(value, index);
  if (!point || !ISLAND_REGION_KINDS.includes(value.kind as OrchardIslandRegionKind)) return null;
  return {
    ...point,
    id: text(value.id, `island-region-${index + 1}`),
    kind: value.kind as OrchardIslandRegionKind,
    rotationY: finiteNumber(value.rotationY, 0),
    radiusX: clamp(finiteNumber(value.radiusX, 6), 1, 36),
    radiusZ: clamp(finiteNumber(value.radiusZ, 5), 1, 28),
  };
}

function parseIslandRouteBlock(value: unknown, index: number): OrchardIslandRouteBlock | null {
  if (!isRecord(value)) return null;
  const point = parseVec2(value, index);
  if (!point || !ISLAND_ROUTE_BLOCK_KINDS.includes(value.kind as OrchardIslandRouteBlockKind)) {
    return null;
  }
  return {
    ...point,
    id: text(value.id, `island-route-block-${index + 1}`),
    kind: value.kind as OrchardIslandRouteBlockKind,
    radiusX: clamp(finiteNumber(value.radiusX, 2), 0.5, 20),
    radiusZ: clamp(finiteNumber(value.radiusZ, 2), 0.5, 20),
  };
}

function parseIslandWaterSegment(value: unknown, index: number): OrchardIslandWaterSegment | null {
  if (!isRecord(value)) return null;
  const point = parseVec2(value, index);
  if (!point) return null;
  return {
    ...point,
    id: text(value.id, `island-water-segment-${index + 1}`),
    sizeX: clamp(finiteNumber(value.sizeX, 8), 1, 80),
    sizeZ: clamp(finiteNumber(value.sizeZ, 3), 1, 56),
  };
}

function parseIslandWaterBlock(value: unknown, index: number): OrchardIslandWaterBlock | null {
  if (!isRecord(value)) return null;
  const point = parseVec2(value, index);
  if (!point) return null;
  return {
    ...point,
    id: text(value.id, `island-water-block-${index + 1}`),
    radiusX: clamp(finiteNumber(value.radiusX, 3), 0.5, 40),
    radiusZ: clamp(finiteNumber(value.radiusZ, 1.5), 0.5, 28),
  };
}

function parseIslandBridge(value: unknown, index: number): OrchardIslandBridge | null {
  if (!isRecord(value)) return null;
  const point = parseVec2(value, index);
  if (!point) return null;
  return {
    ...point,
    id: text(value.id, `island-bridge-${index + 1}`),
    width: clamp(finiteNumber(value.width, 5), 1, 24),
    depth: clamp(finiteNumber(value.depth, 5), 1, 24),
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

function worldToLandmark(point: Vec2, landmark: OrchardLandmark): Vec2 {
  const deltaX = point.x - landmark.x;
  const deltaZ = point.z - landmark.z;
  const cosine = Math.cos(landmark.rotationY);
  const sine = Math.sin(landmark.rotationY);
  return {
    x: deltaX * cosine - deltaZ * sine,
    z: deltaX * sine + deltaZ * cosine,
  };
}

function landmarkToWorld(point: Vec2, landmark: OrchardLandmark): Vec2 {
  const cosine = Math.cos(landmark.rotationY);
  const sine = Math.sin(landmark.rotationY);
  return {
    x: landmark.x + point.x * cosine + point.z * sine,
    z: landmark.z - point.x * sine + point.z * cosine,
  };
}

function migrateVersionOneMap(map: OrchardMap): OrchardMap {
  const scalePoint = (point: Vec2): Vec2 => ({
    x: point.x * ARENA_SCALE,
    z: point.z * ARENA_SCALE,
  });
  const migrated: OrchardMap = {
    ...map,
    id: `${map.id}-expanded`,
    name: `${map.name} · 扩展版`,
    trees: map.trees.map((tree, index) => ({
      ...tree,
      ...scalePoint(tree),
      variant: index % 20 === 0 ? tree.variant : 'stump',
    })),
    paths: map.paths.map((path) => ({
      ...path,
      width: path.width * ARENA_SCALE,
      points: path.points.map(scalePoint),
    })),
    clearings: map.clearings.map((clearing) => ({
      ...clearing,
      ...scalePoint(clearing),
      radius: clearing.radius * ARENA_SCALE,
    })),
    appleSpawns: map.appleSpawns.map(scalePoint),
    kidStart: scalePoint(map.kidStart),
    guardStarts: [scalePoint(map.guardStarts[0]), scalePoint(map.guardStarts[1])],
    deliveryZone: scalePoint(map.deliveryZone),
    ...(map.deliveryZones
      ? { deliveryZones: map.deliveryZones.map((zone) => ({ ...zone, ...scalePoint(zone) })) }
      : {}),
  };
  return fillExpandedLegacyMap(migrated);
}

function migrateVersionTwoMap(map: OrchardMap): OrchardMap {
  const scale = ARENA_SCALE / 5;
  const scalePoint = (point: Vec2): Vec2 => ({
    x: point.x * scale,
    z: point.z * scale,
  });
  const scaled: OrchardMap = {
    ...map,
    id: `${map.id}-compact`,
    name: `${map.name} · 三倍版`,
    trees: map.trees.map((tree) => ({ ...tree, ...scalePoint(tree) })),
    paths: map.paths.map((path) => ({
      ...path,
      width: path.width * scale,
      points: path.points.map(scalePoint),
    })),
    clearings: map.clearings.map((clearing) => ({
      ...clearing,
      ...scalePoint(clearing),
      radius: clearing.radius * scale,
    })),
    appleSpawns: map.appleSpawns.map(scalePoint),
    kidStart: scalePoint(map.kidStart),
    guardStarts: [scalePoint(map.guardStarts[0]), scalePoint(map.guardStarts[1])],
    deliveryZone: scalePoint(map.deliveryZone),
    ...(map.deliveryZones
      ? { deliveryZones: map.deliveryZones.map((zone) => ({ ...zone, ...scalePoint(zone) })) }
      : {}),
  };
  return fillExpandedLegacyMap({
    ...scaled,
    trees: thinTreesForCompactMap(scaled),
  });
}

function thinTreesForCompactMap(map: OrchardMap): OrchardTree[] {
  const selected: OrchardTree[] = [];
  const treeIndex = createTreeSpatialIndex(selected);
  const importantPoints = [map.kidStart, ...map.guardStarts, ...deliveryZonesForMap(map), ...map.appleSpawns];
  const ordered = [
    ...map.trees.filter((tree) => tree.variant !== 'stump'),
    ...map.trees.filter((tree) => tree.variant === 'stump'),
  ];

  for (const tree of ordered) {
    if (!insideArena(tree, 0.8)) continue;
    const radius = treeColliderRadius(tree);
    if (importantPoints.some((point) => circlesOverlap(point, 0.7, tree, radius))) continue;
    if (nearbyTrees(treeIndex, tree, radius + MAX_TREE_COLLIDER_RADIUS).some(({ tree: existing }) =>
      circlesOverlap(tree, radius * 1.18, existing, treeColliderRadius(existing) * 1.18),
    )) continue;
    const copy = { ...tree };
    const index = selected.length;
    selected.push(copy);
    addTreeToSpatialIndex(treeIndex, copy, index);
  }

  return selected;
}

function fillExpandedLegacyMap(map: OrchardMap): OrchardMap {
  const trees = map.trees.map((tree) => ({ ...tree }));
  const treeIndex = createTreeSpatialIndex(trees);
  const random = createSeededRandom(map.seed ^ 0x5f3759df);
  const importantPoints = [map.kidStart, ...map.guardStarts, ...deliveryZonesForMap(map), ...map.appleSpawns];
  const spacing = 2.15;
  let serial = 0;

  for (let z = -GAME_CONFIG.arenaHalfDepth + 1.6; z <= GAME_CONFIG.arenaHalfDepth - 1.6; z += spacing) {
    for (let x = -GAME_CONFIG.arenaHalfWidth + 1.6; x <= GAME_CONFIG.arenaHalfWidth - 1.6; x += spacing) {
      if (trees.length >= MAX_MAP_TREES || random() > 0.94) continue;
      const position = {
        x: x + (random() - 0.5) * spacing * 0.34,
        z: z + (random() - 0.5) * spacing * 0.34,
      };
      if (map.paths.some((path) => distanceToPath(position, path) < path.width / 2 + 0.55)) continue;
      if (map.clearings.some((clearing) => distance(position, clearing) < clearing.radius + 0.55)) continue;
      if (importantPoints.some((point) => distance(position, point) < 1.7)) continue;
      const scale = 0.82 + random() * 0.3;
      const minimumDistance = TREE_COLLIDER_RADIUS * (scale + 1.35) * 1.35;
      if (nearbyTrees(treeIndex, position, minimumDistance).some(({ tree }) =>
        distance(position, tree) < TREE_COLLIDER_RADIUS * (scale + tree.scale) * 1.35,
      )) continue;

      const tree: OrchardTree = {
        ...position,
        id: `legacy-fill-${serial}`,
        variant: 'stump',
        rotationY: random() * Math.PI * 2,
        scale,
      };
      const index = trees.length;
      trees.push(tree);
      addTreeToSpatialIndex(treeIndex, tree, index);
      serial += 1;
    }
  }

  return { ...map, trees };
}

function addTreeToSpatialIndex(index: TreeSpatialIndex, tree: OrchardTree, treeIndex: number): void {
  const key = spatialKey(tree.x, tree.z, index.cellSize);
  const bucket = index.buckets.get(key) ?? [];
  bucket.push({ index: treeIndex, tree });
  index.buckets.set(key, bucket);
}

function distanceToPath(point: Vec2, path: OrchardPath): number {
  let minimum = Number.POSITIVE_INFINITY;
  for (let index = 1; index < path.points.length; index += 1) {
    minimum = Math.min(minimum, distanceToSegment(point, path.points[index - 1], path.points[index]));
  }
  return minimum;
}

function distanceToSegment(point: Vec2, start: Vec2, end: Vec2): number {
  const deltaX = end.x - start.x;
  const deltaZ = end.z - start.z;
  const lengthSquared = deltaX * deltaX + deltaZ * deltaZ;
  if (lengthSquared === 0) return distance(point, start);
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

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function alignToQuarterTurn(rotationY: number): number {
  const quarterTurn = Math.PI / 2;
  return Math.round(rotationY / quarterTurn) * quarterTurn;
}
