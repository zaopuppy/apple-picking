import { GAME_CONFIG } from './config';
import {
  resolveCircleAgainstLandmark,
  treeColliderRadius,
  type OrchardMap,
  type OrchardTree,
} from './maps/OrchardMap';
import type { Vec2 } from './types';

export function constrainCircleToMap(
  map: OrchardMap,
  position: Vec2,
  radius: number,
): void {
  position.x = clamp(
    position.x,
    -GAME_CONFIG.arenaHalfWidth + radius,
    GAME_CONFIG.arenaHalfWidth - radius,
  );
  position.z = clamp(
    position.z,
    -GAME_CONFIG.arenaHalfDepth + radius,
    GAME_CONFIG.arenaHalfDepth - radius,
  );
  for (const tree of map.trees) resolveCircleAgainstTree(position, radius, tree);
  for (const landmark of map.landmarks) {
    resolveCircleAgainstLandmark(position, radius, landmark);
  }
  position.x = clamp(
    position.x,
    -GAME_CONFIG.arenaHalfWidth + radius,
    GAME_CONFIG.arenaHalfWidth - radius,
  );
  position.z = clamp(
    position.z,
    -GAME_CONFIG.arenaHalfDepth + radius,
    GAME_CONFIG.arenaHalfDepth - radius,
  );
}

function resolveCircleAgainstTree(position: Vec2, radius: number, tree: OrchardTree): void {
  const deltaX = position.x - tree.x;
  const deltaZ = position.z - tree.z;
  const minimumDistance = radius + treeColliderRadius(tree);
  const distanceSq = deltaX * deltaX + deltaZ * deltaZ;
  if (distanceSq >= minimumDistance * minimumDistance) return;

  if (distanceSq > 0.000001) {
    const distance = Math.sqrt(distanceSq);
    const push = minimumDistance - distance;
    position.x += deltaX / distance * push;
    position.z += deltaZ / distance * push;
    return;
  }
  position.x = tree.x + minimumDistance;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
