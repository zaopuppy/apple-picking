import { GAME_CONFIG } from '../config';
import type { Vec2 } from '../types';
import {
  deliveryZonesForMap,
  MAX_DELIVERY_ZONES,
  type OrchardDeliveryZone,
  type OrchardMap,
} from './OrchardMap';

const DELIVERY_CENTER_PADDING = 0.65;

export function addDeliveryZone(map: OrchardMap, point: Vec2): OrchardDeliveryZone | null {
  const zones = editableDeliveryZones(map);
  if (zones.length >= MAX_DELIVERY_ZONES) return null;
  const zone = {
    id: nextDeliveryZoneId(zones),
    ...clampDeliveryPoint(point),
  };
  zones.push(zone);
  synchronizePrimaryDeliveryZone(map);
  return zone;
}

export function moveDeliveryZone(map: OrchardMap, id: string, point: Vec2): boolean {
  const zones = editableDeliveryZones(map);
  const zone = zones.find((entry) => entry.id === id);
  if (!zone) return false;
  Object.assign(zone, clampDeliveryPoint(point));
  synchronizePrimaryDeliveryZone(map);
  return true;
}

export function removeDeliveryZone(map: OrchardMap, id: string): boolean {
  const zones = editableDeliveryZones(map);
  if (zones.length <= 1) return false;
  const index = zones.findIndex((entry) => entry.id === id);
  if (index < 0) return false;
  zones.splice(index, 1);
  synchronizePrimaryDeliveryZone(map);
  return true;
}

export function reorderDeliveryZone(map: OrchardMap, id: string, offset: -1 | 1): boolean {
  const zones = editableDeliveryZones(map);
  const index = zones.findIndex((entry) => entry.id === id);
  const nextIndex = index + offset;
  if (index < 0 || nextIndex < 0 || nextIndex >= zones.length) return false;
  const [zone] = zones.splice(index, 1);
  zones.splice(nextIndex, 0, zone);
  synchronizePrimaryDeliveryZone(map);
  return true;
}

export function synchronizePrimaryDeliveryZone(map: OrchardMap): void {
  const primary = map.deliveryZones?.[0];
  if (!primary) return;
  map.deliveryZone = { x: primary.x, z: primary.z };
}

function editableDeliveryZones(map: OrchardMap): OrchardDeliveryZone[] {
  if (!map.deliveryZones || map.deliveryZones.length === 0) {
    map.deliveryZones = deliveryZonesForMap(map).map((zone) => ({ ...zone }));
  }
  return map.deliveryZones;
}

function nextDeliveryZoneId(zones: readonly OrchardDeliveryZone[]): string {
  const ids = new Set(zones.map((zone) => zone.id));
  let serial = 1;
  while (ids.has(`delivery-custom-${serial}`)) serial += 1;
  return `delivery-custom-${serial}`;
}

function clampDeliveryPoint(point: Vec2): Vec2 {
  return {
    x: clamp(
      point.x,
      -GAME_CONFIG.arenaHalfWidth + DELIVERY_CENTER_PADDING,
      GAME_CONFIG.arenaHalfWidth - DELIVERY_CENTER_PADDING,
    ),
    z: clamp(
      point.z,
      -GAME_CONFIG.arenaHalfDepth + DELIVERY_CENTER_PADDING,
      GAME_CONFIG.arenaHalfDepth - DELIVERY_CENTER_PADDING,
    ),
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
