import { GAME_CONFIG } from '../config';
import type { Vec2 } from '../types';
import {
  distanceToIslandOutline,
  pointInsideIslandOutline,
  signedIslandOutlineArea,
  validateIslandOutlineGeometry,
} from './IslandOutline';
import type {
  OrchardIslandBridge,
  OrchardIslandLayout,
  OrchardIslandWaterBlock,
  OrchardIslandWaterSegment,
  OrchardLandmark,
  OrchardMap,
  OrchardIslandRegionKind,
  OrchardIslandRouteBlockKind,
} from './OrchardMap';
import {
  cloneOrchardMap,
  deliveryZonesForMap,
  ISLAND_REGION_KINDS,
  ISLAND_ROUTE_BLOCK_KINDS,
  MAX_ISLAND_BRIDGES,
  MAX_ISLAND_OUTLINE_POINTS,
  MAX_ISLAND_REGIONS,
  MAX_ISLAND_ROUTE_BLOCKS,
  MAX_ISLAND_WATER_SEGMENTS,
  MAX_MAP_LANDMARKS,
} from './OrchardMap';

export type EditableIslandGeometryKind = 'region' | 'route-block' | 'water-segment' | 'bridge';
export type IslandObjectKind = EditableIslandGeometryKind;

export type IslandGeometryUpdate = {
  x: number;
  z: number;
  sizeX: number;
  sizeZ: number;
  semanticKind?: OrchardIslandRegionKind | OrchardIslandRouteBlockKind;
  rotationY?: number;
};

export type IslandObjectEditResult = {
  ok: boolean;
  kind: IslandObjectKind;
  id?: string;
  error?: string;
};

const ARENA_PADDING = 0.4;
const WATER_BANK_PADDING = 0.35;
const MIN_WATER_BLOCK_WIDTH = 1;
const COAST_COLLIDER_HALF_DEPTH = 0.36;
const COAST_COLLIDER_OVERLAP = 0.18;
const COAST_CONTENT_PADDING = 0.3;

export type IslandOutlineEditResult = {
  ok: boolean;
  index: number;
  error?: string;
};

export function moveIslandOutlinePoint(
  map: OrchardMap,
  index: number,
  point: Vec2,
): IslandOutlineEditResult {
  const outline = map.islandLayout?.outline;
  if (!outline || !outline[index]) return outlineFailure(index, '找不到对应的海岸节点。');
  const candidate = outline.map((entry, entryIndex) => entryIndex === index ? { ...point } : { ...entry });
  const error = validateOutlineCandidate(map, candidate);
  if (error) return outlineFailure(index, error);
  map.islandLayout!.outline = candidate;
  synchronizeIslandCoastCollisionProxies(map);
  return { ok: true, index };
}

export function insertIslandOutlinePoint(
  map: OrchardMap,
  afterIndex: number,
): IslandOutlineEditResult {
  const outline = map.islandLayout?.outline;
  if (!outline || !outline[afterIndex]) return outlineFailure(afterIndex, '找不到对应的海岸节点。');
  if (outline.length >= MAX_ISLAND_OUTLINE_POINTS) {
    return outlineFailure(afterIndex, `海岸节点最多 ${MAX_ISLAND_OUTLINE_POINTS} 个。`);
  }
  const nextIndex = (afterIndex + 1) % outline.length;
  const start = outline[afterIndex];
  const end = outline[nextIndex];
  const insertedIndex = afterIndex + 1;
  const candidate = outline.map((point) => ({ ...point }));
  candidate.splice(insertedIndex, 0, {
    x: (start.x + end.x) / 2,
    z: (start.z + end.z) / 2,
  });
  const error = validateOutlineCandidate(map, candidate);
  if (error) return outlineFailure(afterIndex, error);
  map.islandLayout!.outline = candidate;
  synchronizeIslandCoastCollisionProxies(map);
  return { ok: true, index: insertedIndex };
}

export function removeIslandOutlinePoint(
  map: OrchardMap,
  index: number,
): IslandOutlineEditResult {
  const outline = map.islandLayout?.outline;
  if (!outline || !outline[index]) return outlineFailure(index, '找不到对应的海岸节点。');
  if (outline.length <= 3) return outlineFailure(index, '岛屿轮廓至少保留 3 个节点。');
  const candidate = outline.filter((_, entryIndex) => entryIndex !== index).map((point) => ({ ...point }));
  const error = validateOutlineCandidate(map, candidate);
  if (error) return outlineFailure(index, error);
  map.islandLayout!.outline = candidate;
  synchronizeIslandCoastCollisionProxies(map);
  return { ok: true, index: Math.min(index, candidate.length - 1) };
}

export function synchronizeIslandCoastCollisionProxies(map: OrchardMap): void {
  const outline = map.islandLayout?.outline;
  if (!outline) return;
  const preserved = map.landmarks.filter((landmark) =>
    !landmark.id.startsWith('island-boundary-') &&
      !landmark.id.startsWith('island-coast-edge-'));
  map.landmarks = [...preserved, ...outline.map((start, index) => {
    const end = outline[(index + 1) % outline.length];
    const deltaX = end.x - start.x;
    const deltaZ = end.z - start.z;
    return {
      id: `island-coast-edge-${index + 1}`,
      kind: 'homestead' as const,
      x: (start.x + end.x) / 2,
      z: (start.z + end.z) / 2,
      rotationY: -Math.atan2(deltaZ, deltaX),
      radiusX: Math.hypot(deltaX, deltaZ) / 2 + COAST_COLLIDER_OVERLAP,
      radiusZ: COAST_COLLIDER_HALF_DEPTH,
    };
  })];
}

export function addIslandObject(
  map: OrchardMap,
  kind: IslandObjectKind,
  point: Vec2,
): IslandObjectEditResult {
  const draft = cloneOrchardMap(map);
  const layout = draft.islandLayout;
  if (!layout) return objectFailure(kind, '当前地图没有 v5 岛屿结构。');
  const id = uniqueIslandObjectId(layout, kind);

  if (kind === 'region') {
    if (layout.regions.length >= MAX_ISLAND_REGIONS) {
      return objectFailure(kind, `岛屿区域最多 ${MAX_ISLAND_REGIONS} 个。`);
    }
    const radiusX = 6;
    const radiusZ = 4.5;
    layout.regions.push({
      id,
      kind: 'garden',
      x: clampCenter(point.x, radiusX, GAME_CONFIG.arenaHalfWidth),
      z: clampCenter(point.z, radiusZ, GAME_CONFIG.arenaHalfDepth),
      rotationY: 0,
      radiusX,
      radiusZ,
    });
  } else if (kind === 'route-block') {
    if (layout.routeBlocks.length >= MAX_ISLAND_ROUTE_BLOCKS) {
      return objectFailure(kind, `矩形通路块最多 ${MAX_ISLAND_ROUTE_BLOCKS} 个。`);
    }
    const radiusX = 3.6;
    const radiusZ = 2.4;
    layout.routeBlocks.push({
      id,
      kind: 'hedge',
      x: clampCenter(point.x, radiusX, GAME_CONFIG.arenaHalfWidth),
      z: clampCenter(point.z, radiusZ, GAME_CONFIG.arenaHalfDepth),
      radiusX,
      radiusZ,
    });
    synchronizeIslandCollisionProxies(draft);
  } else if (kind === 'water-segment') {
    if (layout.waterSegments.length >= MAX_ISLAND_WATER_SEGMENTS) {
      return objectFailure(kind, `水面段最多 ${MAX_ISLAND_WATER_SEGMENTS} 个。`);
    }
    const sizeX = 14;
    const sizeZ = 3.4;
    layout.waterSegments.push({
      id,
      x: clampCenter(point.x, sizeX / 2, GAME_CONFIG.arenaHalfWidth),
      z: clampCenter(point.z, sizeZ / 2, GAME_CONFIG.arenaHalfDepth),
      sizeX,
      sizeZ,
    });
    const obsoleteWaterBlockIds = new Set(layout.waterBlocks.map((block) => block.id));
    rebuildIslandWaterBlocks(layout);
    synchronizeIslandCollisionProxies(draft, obsoleteWaterBlockIds);
  } else {
    if (layout.bridges.length >= MAX_ISLAND_BRIDGES) {
      return objectFailure(kind, `桥梁最多 ${MAX_ISLAND_BRIDGES} 座。`);
    }
    const segment = waterSegmentAtPoint(layout, point);
    if (!segment) return objectFailure(kind, '请在一段可见水面上放置桥梁。');
    const width = Math.min(5.2, Math.max(1, segment.sizeX - MIN_WATER_BLOCK_WIDTH));
    layout.bridges.push({
      id,
      x: clamp(
        point.x,
        segment.x - segment.sizeX / 2 + width / 2,
        segment.x + segment.sizeX / 2 - width / 2,
      ),
      z: segment.z,
      width,
      depth: clamp(segment.sizeZ + 1.8, segment.sizeZ + 0.6, 24),
    });
    const obsoleteWaterBlockIds = new Set(layout.waterBlocks.map((block) => block.id));
    rebuildIslandWaterBlocks(layout);
    synchronizeIslandCollisionProxies(draft, obsoleteWaterBlockIds);
  }

  const error = islandDraftIssue(draft);
  if (error) return objectFailure(kind, error);
  commitIslandDraft(map, draft);
  return { ok: true, kind, id };
}

export function removeIslandObject(
  map: OrchardMap,
  kind: IslandObjectKind,
  id: string,
): IslandObjectEditResult {
  const draft = cloneOrchardMap(map);
  const layout = draft.islandLayout;
  if (!layout) return objectFailure(kind, '当前地图没有 v5 岛屿结构。');

  if (kind === 'region') {
    if (layout.regions.length <= 1) return objectFailure(kind, '岛屿至少保留一个区域。');
    const next = layout.regions.filter((entry) => entry.id !== id);
    if (next.length === layout.regions.length) return objectFailure(kind, '找不到对应的岛屿区域。');
    layout.regions = next;
  } else if (kind === 'route-block') {
    const next = layout.routeBlocks.filter((entry) => entry.id !== id);
    if (next.length === layout.routeBlocks.length) return objectFailure(kind, '找不到对应的矩形通路块。');
    layout.routeBlocks = next;
    draft.landmarks = draft.landmarks.filter((landmark) => landmark.id !== id);
    synchronizeIslandCollisionProxies(draft);
  } else if (kind === 'water-segment') {
    const segment = layout.waterSegments.find((entry) => entry.id === id);
    if (!segment) return objectFailure(kind, '找不到对应的水面段。');
    const attachedBridgeIds = new Set(layout.bridges
      .filter((bridge) => waterSegmentForBridge(layout, bridge)?.id === id)
      .map((bridge) => bridge.id));
    const obsoleteWaterBlockIds = new Set(layout.waterBlocks.map((block) => block.id));
    layout.waterSegments = layout.waterSegments.filter((entry) => entry.id !== id);
    layout.bridges = layout.bridges.filter((bridge) => !attachedBridgeIds.has(bridge.id));
    rebuildIslandWaterBlocks(layout);
    synchronizeIslandCollisionProxies(draft, obsoleteWaterBlockIds);
  } else {
    const next = layout.bridges.filter((entry) => entry.id !== id);
    if (next.length === layout.bridges.length) return objectFailure(kind, '找不到对应的桥梁。');
    const obsoleteWaterBlockIds = new Set(layout.waterBlocks.map((block) => block.id));
    layout.bridges = next;
    rebuildIslandWaterBlocks(layout);
    synchronizeIslandCollisionProxies(draft, obsoleteWaterBlockIds);
  }

  const error = islandDraftIssue(draft);
  if (error) return objectFailure(kind, error);
  commitIslandDraft(map, draft);
  return { ok: true, kind, id };
}

export function applyIslandGeometryUpdate(
  map: OrchardMap,
  kind: EditableIslandGeometryKind,
  id: string,
  update: IslandGeometryUpdate,
): boolean {
  const draft = cloneOrchardMap(map);
  const layout = draft.islandLayout;
  if (!layout || !validUpdate(update)) return false;

  if (kind === 'region') {
    const region = layout.regions.find((entry) => entry.id === id);
    if (!region) return false;
    if (update.semanticKind && ISLAND_REGION_KINDS.includes(
      update.semanticKind as OrchardIslandRegionKind,
    )) region.kind = update.semanticKind as OrchardIslandRegionKind;
    if (update.rotationY !== undefined) region.rotationY = normalizeAngle(update.rotationY);
    region.radiusX = clamp(update.sizeX, 1, Math.min(36, GAME_CONFIG.arenaHalfWidth - ARENA_PADDING));
    region.radiusZ = clamp(update.sizeZ, 1, Math.min(28, GAME_CONFIG.arenaHalfDepth - ARENA_PADDING));
    region.x = clampCenter(update.x, region.radiusX, GAME_CONFIG.arenaHalfWidth);
    region.z = clampCenter(update.z, region.radiusZ, GAME_CONFIG.arenaHalfDepth);
  } else if (kind === 'route-block') {
    const block = layout.routeBlocks.find((entry) => entry.id === id);
    if (!block) return false;
    if (update.semanticKind && ISLAND_ROUTE_BLOCK_KINDS.includes(
      update.semanticKind as OrchardIslandRouteBlockKind,
    )) block.kind = update.semanticKind as OrchardIslandRouteBlockKind;
    block.radiusX = clamp(update.sizeX, 0.5, Math.min(20, GAME_CONFIG.arenaHalfWidth - ARENA_PADDING));
    block.radiusZ = clamp(update.sizeZ, 0.5, Math.min(20, GAME_CONFIG.arenaHalfDepth - ARENA_PADDING));
    block.x = clampCenter(update.x, block.radiusX, GAME_CONFIG.arenaHalfWidth);
    block.z = clampCenter(update.z, block.radiusZ, GAME_CONFIG.arenaHalfDepth);
    synchronizeIslandCollisionProxies(draft);
  } else if (kind === 'water-segment') {
    const segment = layout.waterSegments.find((entry) => entry.id === id);
    if (!segment) return false;
    const attachedBridgeIds = new Set(layout.bridges
      .filter((bridge) => waterSegmentForBridge(layout, bridge)?.id === id)
      .map((bridge) => bridge.id));
    const previousWaterBlockIds = new Set(layout.waterBlocks.map((block) => block.id));
    segment.sizeX = clamp(update.sizeX, 2, (GAME_CONFIG.arenaHalfWidth - ARENA_PADDING) * 2);
    segment.sizeZ = clamp(update.sizeZ, 1, 18);
    segment.x = clampCenter(update.x, segment.sizeX / 2, GAME_CONFIG.arenaHalfWidth);
    segment.z = clampCenter(update.z, segment.sizeZ / 2, GAME_CONFIG.arenaHalfDepth);
    for (const bridge of layout.bridges.filter((entry) => attachedBridgeIds.has(entry.id))) {
      const maximumWidth = Math.max(1, Math.min(24, segment.sizeX - MIN_WATER_BLOCK_WIDTH));
      bridge.width = clamp(bridge.width, 1, maximumWidth);
      bridge.depth = clamp(bridge.depth, segment.sizeZ + 0.6, 24);
      bridge.x = clamp(
        bridge.x,
        segment.x - segment.sizeX / 2 + bridge.width / 2,
        segment.x + segment.sizeX / 2 - bridge.width / 2,
      );
      bridge.z = segment.z;
    }
    rebuildIslandWaterBlocks(layout);
    synchronizeIslandCollisionProxies(draft, previousWaterBlockIds);
  } else {
    const bridge = layout.bridges.find((entry) => entry.id === id);
    if (!bridge) return false;
    const segment = waterSegmentForBridge(layout, bridge);
    if (!segment) return false;
    const previousWaterBlockIds = new Set(layout.waterBlocks.map((block) => block.id));
    const maximumWidth = Math.max(1, Math.min(24, segment.sizeX - MIN_WATER_BLOCK_WIDTH));
    bridge.width = clamp(update.sizeX, 1, maximumWidth);
    bridge.depth = clamp(update.sizeZ, Math.min(24, segment.sizeZ + 0.6), 24);
    bridge.x = clamp(
      update.x,
      segment.x - segment.sizeX / 2 + bridge.width / 2,
      segment.x + segment.sizeX / 2 - bridge.width / 2,
    );
    bridge.z = segment.z;
    rebuildIslandWaterBlocks(layout);
    synchronizeIslandCollisionProxies(draft, previousWaterBlockIds);
  }
  if (islandDraftIssue(draft)) return false;
  commitIslandDraft(map, draft);
  return true;
}

export function rebuildIslandWaterBlocks(layout: OrchardIslandLayout): void {
  const previousBlocks = layout.waterBlocks;
  const reservedIds = new Set([
    ...layout.regions.map((entry) => entry.id),
    ...layout.routeBlocks.map((entry) => entry.id),
    ...layout.waterSegments.map((entry) => entry.id),
    ...layout.bridges.map((entry) => entry.id),
    ...previousBlocks.map((entry) => entry.id),
  ]);
  const nextBlocks: OrchardIslandWaterBlock[] = [];

  for (const segment of layout.waterSegments) {
    const reusableIds = previousBlocks
      .filter((block) => Math.abs(block.z - segment.z) < 0.001)
      .sort((first, second) => first.x - second.x)
      .map((block) => block.id);
    const intervals = waterCollisionIntervals(layout, segment);
    intervals.forEach(([start, end], index) => {
      const radiusX = (end - start) / 2;
      if (radiusX * 2 < MIN_WATER_BLOCK_WIDTH) return;
      const id = reusableIds[index] ?? uniqueWaterBlockId(segment.id, index, reservedIds);
      reservedIds.add(id);
      nextBlocks.push({
        id,
        x: (start + end) / 2,
        z: segment.z,
        radiusX,
        radiusZ: Math.max(0.5, segment.sizeZ / 2 - WATER_BANK_PADDING),
      });
    });
  }

  layout.waterBlocks = nextBlocks;
}

export function synchronizeIslandCollisionProxies(
  map: OrchardMap,
  obsoleteWaterBlockIds: ReadonlySet<string> = new Set(),
): void {
  const layout = map.islandLayout;
  if (!layout) return;
  const proxyIds = new Set([
    ...layout.routeBlocks.map((block) => block.id),
    ...layout.waterBlocks.map((block) => block.id),
    ...obsoleteWaterBlockIds,
  ]);
  const proxies: OrchardLandmark[] = [
    ...layout.routeBlocks.map((block) => collisionProxy(block)),
    ...layout.waterBlocks.map((block) => collisionProxy(block)),
  ];
  map.landmarks = [
    ...map.landmarks.filter((landmark) => !proxyIds.has(landmark.id)),
    ...proxies,
  ];
}

export function waterSegmentForBridge(
  layout: OrchardIslandLayout,
  bridge: OrchardIslandBridge,
): OrchardIslandWaterSegment | null {
  let nearest: OrchardIslandWaterSegment | null = null;
  let nearestScore = Number.POSITIVE_INFINITY;
  for (const segment of layout.waterSegments) {
    const start = segment.x - segment.sizeX / 2;
    const end = segment.x + segment.sizeX / 2;
    const horizontalDistance = bridge.x < start
      ? start - bridge.x
      : bridge.x > end
        ? bridge.x - end
        : 0;
    const score = Math.abs(bridge.z - segment.z) * 4 + horizontalDistance;
    if (score < nearestScore) {
      nearest = segment;
      nearestScore = score;
    }
  }
  return nearest;
}

function waterCollisionIntervals(
  layout: OrchardIslandLayout,
  segment: OrchardIslandWaterSegment,
): Array<readonly [number, number]> {
  const start = segment.x - segment.sizeX / 2;
  const end = segment.x + segment.sizeX / 2;
  const gaps = layout.bridges
    .filter((bridge) => waterSegmentForBridge(layout, bridge)?.id === segment.id)
    .map((bridge) => ({
      start: clamp(bridge.x - bridge.width / 2, start, end),
      end: clamp(bridge.x + bridge.width / 2, start, end),
    }))
    .sort((first, second) => first.start - second.start);
  const intervals: Array<readonly [number, number]> = [];
  let cursor = start;
  for (const gap of gaps) {
    if (gap.start > cursor) intervals.push([cursor, gap.start]);
    cursor = Math.max(cursor, gap.end);
  }
  if (cursor < end) intervals.push([cursor, end]);
  return intervals;
}

function collisionProxy(
  block: { id: string; x: number; z: number; radiusX: number; radiusZ: number },
): OrchardLandmark {
  return {
    id: block.id,
    x: block.x,
    z: block.z,
    radiusX: block.radiusX,
    radiusZ: block.radiusZ,
    kind: 'homestead',
    rotationY: 0,
  };
}

function uniqueWaterBlockId(
  segmentId: string,
  index: number,
  reservedIds: ReadonlySet<string>,
): string {
  const base = `${segmentId}-block-${index + 1}`;
  if (!reservedIds.has(base)) return base;
  let suffix = 2;
  while (reservedIds.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

function clampCenter(value: number, radius: number, halfExtent: number): number {
  return clamp(value, -halfExtent + radius + ARENA_PADDING, halfExtent - radius - ARENA_PADDING);
}

function validUpdate(update: IslandGeometryUpdate): boolean {
  return Number.isFinite(update.x) && Number.isFinite(update.z) &&
    Number.isFinite(update.sizeX) && Number.isFinite(update.sizeZ) &&
    (update.rotationY === undefined || Number.isFinite(update.rotationY));
}

function validateOutlineCandidate(map: OrchardMap, candidate: readonly Vec2[]): string | null {
  const geometryError = validateIslandOutlineGeometry(candidate)[0];
  if (geometryError) return geometryError;
  const currentArea = signedIslandOutlineArea(map.islandLayout?.outline ?? []);
  const candidateArea = signedIslandOutlineArea(candidate);
  if (currentArea !== 0 && Math.sign(currentArea) !== Math.sign(candidateArea)) {
    return '海岸节点顺序不能翻转。';
  }
  const contentError = islandContentIssue(map, candidate);
  if (contentError) return contentError;
  const preservedLandmarks = map.landmarks.filter((landmark) =>
    !landmark.id.startsWith('island-boundary-') &&
      !landmark.id.startsWith('island-coast-edge-')).length;
  if (preservedLandmarks + candidate.length > MAX_MAP_LANDMARKS) {
    return `海岸碰撞代理会让地标超过 ${MAX_MAP_LANDMARKS} 个上限。`;
  }
  return null;
}

function islandDraftIssue(map: OrchardMap): string | null {
  const outline = map.islandLayout?.outline;
  if (!outline) return '当前地图没有 v5 岛屿结构。';
  const geometryError = validateIslandOutlineGeometry(outline)[0];
  if (geometryError) return geometryError;
  const contentError = islandContentIssue(map, outline);
  if (contentError) return contentError;
  if (map.landmarks.length > MAX_MAP_LANDMARKS) {
    return `结构碰撞代理会让地标超过 ${MAX_MAP_LANDMARKS} 个上限。`;
  }
  return null;
}

function islandContentIssue(map: OrchardMap, outline: readonly Vec2[]): string | null {
  const anchors = [
    map.kidStart,
    ...map.guardStarts,
    ...deliveryZonesForMap(map),
    ...map.appleSpawns,
    ...(map.islandLayout?.regions ?? []),
    ...(map.islandLayout?.routeBlocks ?? []),
    ...(map.islandLayout?.waterSegments ?? []),
    ...(map.islandLayout?.bridges ?? []),
  ];
  return anchors.some((point) =>
    !pointInsideIslandOutline(point, outline) ||
      distanceToIslandOutline(point, outline) < COAST_CONTENT_PADDING)
    ? '海岸线必须包住出生点、目标和岛屿语义中心。'
    : null;
}

function uniqueIslandObjectId(layout: OrchardIslandLayout, kind: IslandObjectKind): string {
  const prefix = kind === 'region'
    ? 'island-region-custom'
    : kind === 'route-block'
      ? 'island-route-custom'
      : kind === 'water-segment'
        ? 'island-water-custom'
        : 'island-bridge-custom';
  const ids = new Set([
    ...layout.regions.map((entry) => entry.id),
    ...layout.routeBlocks.map((entry) => entry.id),
    ...layout.waterSegments.map((entry) => entry.id),
    ...layout.waterBlocks.map((entry) => entry.id),
    ...layout.bridges.map((entry) => entry.id),
  ]);
  let suffix = 1;
  while (ids.has(`${prefix}-${suffix}`)) suffix += 1;
  return `${prefix}-${suffix}`;
}

function waterSegmentAtPoint(
  layout: OrchardIslandLayout,
  point: Vec2,
): OrchardIslandWaterSegment | null {
  return layout.waterSegments
    .filter((segment) =>
      Math.abs(point.x - segment.x) <= segment.sizeX / 2 &&
        Math.abs(point.z - segment.z) <= segment.sizeZ / 2 + 0.8)
    .sort((first, second) =>
      Math.hypot(point.x - first.x, point.z - first.z) -
        Math.hypot(point.x - second.x, point.z - second.z) ||
      first.id.localeCompare(second.id))[0] ?? null;
}

function commitIslandDraft(map: OrchardMap, draft: OrchardMap): void {
  map.islandLayout = draft.islandLayout;
  map.landmarks = draft.landmarks;
}

function objectFailure(kind: IslandObjectKind, error: string): IslandObjectEditResult {
  return { ok: false, kind, error };
}

function normalizeAngle(value: number): number {
  const fullTurn = Math.PI * 2;
  return ((value % fullTurn) + fullTurn) % fullTurn;
}

function outlineFailure(index: number, error: string): IslandOutlineEditResult {
  return { ok: false, index, error };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
