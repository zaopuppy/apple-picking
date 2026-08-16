import { GAME_CONFIG } from '../config';
import type { Vec2 } from '../types';

export const MIN_ISLAND_OUTLINE_AREA = 500;
export const MIN_ISLAND_OUTLINE_EDGE = 1;

const EPSILON = 0.0001;

export function validateIslandOutlineGeometry(outline: readonly Vec2[]): string[] {
  const errors: string[] = [];
  if (outline.length < 3) return ['岛屿轮廓至少需要 3 个节点。'];
  if (outline.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.z))) {
    return ['岛屿轮廓包含无效坐标。'];
  }
  if (outline.some((point) =>
    Math.abs(point.x) > GAME_CONFIG.arenaHalfWidth ||
      Math.abs(point.z) > GAME_CONFIG.arenaHalfDepth)) {
    errors.push('岛屿轮廓节点不能超出竞技区域。');
  }
  if (outline.some((point, index) =>
    distance(point, outline[(index + 1) % outline.length]) < MIN_ISLAND_OUTLINE_EDGE)) {
    errors.push(`岛屿轮廓相邻节点至少间隔 ${MIN_ISLAND_OUTLINE_EDGE}。`);
  }
  if (Math.abs(signedIslandOutlineArea(outline)) < MIN_ISLAND_OUTLINE_AREA) {
    errors.push(`岛屿轮廓面积不能小于 ${MIN_ISLAND_OUTLINE_AREA}。`);
  }
  if (islandOutlineSelfIntersects(outline)) {
    errors.push('岛屿轮廓不能自相交。');
  }
  return errors;
}

export function signedIslandOutlineArea(outline: readonly Vec2[]): number {
  let sum = 0;
  outline.forEach((point, index) => {
    const next = outline[(index + 1) % outline.length];
    sum += point.x * next.z - next.x * point.z;
  });
  return sum / 2;
}

export function pointInsideIslandOutline(point: Vec2, outline: readonly Vec2[]): boolean {
  if (outline.length < 3) return false;
  if (distanceToIslandOutline(point, outline) <= EPSILON) return true;
  let inside = false;
  for (let index = 0, previous = outline.length - 1; index < outline.length; previous = index++) {
    const start = outline[index];
    const end = outline[previous];
    const crosses = (start.z > point.z) !== (end.z > point.z) &&
      point.x < (end.x - start.x) * (point.z - start.z) / (end.z - start.z) + start.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function distanceToIslandOutline(point: Vec2, outline: readonly Vec2[]): number {
  if (outline.length === 0) return Number.POSITIVE_INFINITY;
  let minimum = Number.POSITIVE_INFINITY;
  outline.forEach((start, index) => {
    minimum = Math.min(minimum, distanceToSegment(
      point,
      start,
      outline[(index + 1) % outline.length],
    ));
  });
  return minimum;
}

function islandOutlineSelfIntersects(outline: readonly Vec2[]): boolean {
  for (let firstIndex = 0; firstIndex < outline.length; firstIndex += 1) {
    const firstEndIndex = (firstIndex + 1) % outline.length;
    for (let secondIndex = firstIndex + 1; secondIndex < outline.length; secondIndex += 1) {
      const secondEndIndex = (secondIndex + 1) % outline.length;
      if (firstIndex === secondIndex || firstIndex === secondEndIndex ||
        firstEndIndex === secondIndex || firstEndIndex === secondEndIndex) continue;
      if (segmentsIntersect(
        outline[firstIndex],
        outline[firstEndIndex],
        outline[secondIndex],
        outline[secondEndIndex],
      )) return true;
    }
  }
  return false;
}

function segmentsIntersect(firstStart: Vec2, firstEnd: Vec2, secondStart: Vec2, secondEnd: Vec2): boolean {
  const firstA = orientation(firstStart, firstEnd, secondStart);
  const firstB = orientation(firstStart, firstEnd, secondEnd);
  const secondA = orientation(secondStart, secondEnd, firstStart);
  const secondB = orientation(secondStart, secondEnd, firstEnd);
  if (Math.abs(firstA) <= EPSILON && pointOnSegment(secondStart, firstStart, firstEnd)) return true;
  if (Math.abs(firstB) <= EPSILON && pointOnSegment(secondEnd, firstStart, firstEnd)) return true;
  if (Math.abs(secondA) <= EPSILON && pointOnSegment(firstStart, secondStart, secondEnd)) return true;
  if (Math.abs(secondB) <= EPSILON && pointOnSegment(firstEnd, secondStart, secondEnd)) return true;
  return (firstA > 0) !== (firstB > 0) && (secondA > 0) !== (secondB > 0);
}

function orientation(start: Vec2, end: Vec2, point: Vec2): number {
  return (end.x - start.x) * (point.z - start.z) - (end.z - start.z) * (point.x - start.x);
}

function pointOnSegment(point: Vec2, start: Vec2, end: Vec2): boolean {
  return point.x >= Math.min(start.x, end.x) - EPSILON &&
    point.x <= Math.max(start.x, end.x) + EPSILON &&
    point.z >= Math.min(start.z, end.z) - EPSILON &&
    point.z <= Math.max(start.z, end.z) + EPSILON;
}

function distanceToSegment(point: Vec2, start: Vec2, end: Vec2): number {
  const deltaX = end.x - start.x;
  const deltaZ = end.z - start.z;
  const lengthSquared = deltaX * deltaX + deltaZ * deltaZ;
  if (lengthSquared <= EPSILON) return distance(point, start);
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
