import { GAME_CONFIG } from '../config';
import type {
  OrchardIslandBridge,
  OrchardIslandLayout,
  OrchardIslandWaterBlock,
  OrchardIslandWaterSegment,
  OrchardLandmark,
  OrchardMap,
} from './OrchardMap';

export type EditableIslandGeometryKind = 'region' | 'route-block' | 'bridge';

export type IslandGeometryUpdate = {
  x: number;
  z: number;
  sizeX: number;
  sizeZ: number;
};

const ARENA_PADDING = 0.4;
const WATER_BANK_PADDING = 0.35;
const MIN_WATER_BLOCK_WIDTH = 1;

export function applyIslandGeometryUpdate(
  map: OrchardMap,
  kind: EditableIslandGeometryKind,
  id: string,
  update: IslandGeometryUpdate,
): boolean {
  const layout = map.islandLayout;
  if (!layout || !validUpdate(update)) return false;

  if (kind === 'region') {
    const region = layout.regions.find((entry) => entry.id === id);
    if (!region) return false;
    region.radiusX = clamp(update.sizeX, 1, Math.min(36, GAME_CONFIG.arenaHalfWidth - ARENA_PADDING));
    region.radiusZ = clamp(update.sizeZ, 1, Math.min(28, GAME_CONFIG.arenaHalfDepth - ARENA_PADDING));
    region.x = clampCenter(update.x, region.radiusX, GAME_CONFIG.arenaHalfWidth);
    region.z = clampCenter(update.z, region.radiusZ, GAME_CONFIG.arenaHalfDepth);
    return true;
  }

  if (kind === 'route-block') {
    const block = layout.routeBlocks.find((entry) => entry.id === id);
    if (!block) return false;
    block.radiusX = clamp(update.sizeX, 0.5, Math.min(20, GAME_CONFIG.arenaHalfWidth - ARENA_PADDING));
    block.radiusZ = clamp(update.sizeZ, 0.5, Math.min(20, GAME_CONFIG.arenaHalfDepth - ARENA_PADDING));
    block.x = clampCenter(update.x, block.radiusX, GAME_CONFIG.arenaHalfWidth);
    block.z = clampCenter(update.z, block.radiusZ, GAME_CONFIG.arenaHalfDepth);
    synchronizeIslandCollisionProxies(map);
    return true;
  }

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
  synchronizeIslandCollisionProxies(map, previousWaterBlockIds);
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
    Number.isFinite(update.sizeX) && Number.isFinite(update.sizeZ);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
