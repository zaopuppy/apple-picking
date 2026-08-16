import { DEFAULT_ORCHARD_MAP } from '../game/maps/MapGenerator';
import {
  cloneOrchardMap,
  parseOrchardMap,
  type OrchardMap,
  upgradeSparseLegacyMap,
  validateOrchardMap,
} from '../game/maps/OrchardMap';

const ACTIVE_MAP_KEY = 'apple-picking.active-map.v5';
const MAP_LIBRARY_KEY = 'apple-picking.map-library.v5';
const LEGACY_ACTIVE_MAP_KEYS = [
  'apple-picking.active-map.v4',
  'apple-picking.active-map.v3',
  'apple-picking.active-map.v2',
  'apple-picking.active-map.v1',
] as const;
const LEGACY_MAP_LIBRARY_KEYS = [
  'apple-picking.map-library.v4',
  'apple-picking.map-library.v3',
  'apple-picking.map-library.v2',
  'apple-picking.map-library.v1',
] as const;
const MAX_SAVED_MAPS = 24;

export function loadActiveMap(): OrchardMap {
  const current = readMap(ACTIVE_MAP_KEY);
  if (current && validateOrchardMap(current).valid) {
    return replaceLegacyDefault(current);
  }
  const stored = readFirstMap(LEGACY_ACTIVE_MAP_KEYS);
  if (!stored || !validateOrchardMap(stored).valid) return cloneOrchardMap(DEFAULT_ORCHARD_MAP);
  return replaceLegacyDefault(stored);
}

export function setActiveMap(map: OrchardMap): boolean {
  if (!validateOrchardMap(map).valid) return false;
  return write(ACTIVE_MAP_KEY, JSON.stringify(map));
}

export function loadSavedMaps(): OrchardMap[] {
  try {
    const current = localStorage.getItem(MAP_LIBRARY_KEY);
    const raw = current ?? firstStoredValue(LEGACY_MAP_LIBRARY_KEYS);
    if (!raw) return [];
    const values: unknown = JSON.parse(raw);
    if (!Array.isArray(values)) return [];
    const parsedMaps = values
      .map((value) => parseOrchardMap(value))
      .filter((map): map is OrchardMap => Boolean(map));
    const maps = parsedMaps.map((map) => upgradeSparseLegacyMap(map));
    const upgraded = maps.some((map, index) => map !== parsedMaps[index]);
    if ((current === null || upgraded) && maps.length > 0) {
      write(MAP_LIBRARY_KEY, JSON.stringify(maps));
    }
    return maps;
  } catch {
    return [];
  }
}

export function saveMapToLibrary(map: OrchardMap): boolean {
  const library = loadSavedMaps();
  const index = library.findIndex((entry) => entry.id === map.id);
  if (index >= 0) library[index] = cloneOrchardMap(map);
  else library.unshift(cloneOrchardMap(map));
  return write(MAP_LIBRARY_KEY, JSON.stringify(library.slice(0, MAX_SAVED_MAPS)));
}

export function deleteSavedMap(id: string): boolean {
  const library = loadSavedMaps().filter((map) => map.id !== id);
  return write(MAP_LIBRARY_KEY, JSON.stringify(library));
}

function readMap(key: string): OrchardMap | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? parseOrchardMap(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function readFirstMap(keys: readonly string[]): OrchardMap | null {
  for (const key of keys) {
    const map = readMap(key);
    if (map) return map;
  }
  return null;
}

function firstStoredValue(keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = localStorage.getItem(key);
    if (value !== null) return value;
  }
  return null;
}

function replaceLegacyDefault(map: OrchardMap): OrchardMap {
  const currentDefaultIdentity = [
    [`${DEFAULT_ORCHARD_MAP.id}-expanded`, `${DEFAULT_ORCHARD_MAP.name} · 扩展版`],
    [`${DEFAULT_ORCHARD_MAP.id}-compact`, `${DEFAULT_ORCHARD_MAP.name} · 三倍版`],
  ].some(([id, name]) => map.id === id && map.name === name);
  const historicalDefaultIdentity = [
    ['orchard-20260815-clearings', '林间集市'],
    ['orchard-20260815-clearings-expanded', '林间集市 · 扩展版'],
    ['orchard-20260815-clearings-compact', '林间集市 · 三倍版'],
  ].some(([id, name]) => map.id === id && map.name === name);
  const isLegacyDefault = (currentDefaultIdentity || historicalDefaultIdentity) &&
    map.seed === DEFAULT_ORCHARD_MAP.seed;
  const selected = isLegacyDefault
    ? cloneOrchardMap(DEFAULT_ORCHARD_MAP)
    : upgradeSparseLegacyMap(map);
  write(ACTIVE_MAP_KEY, JSON.stringify(selected));
  return selected;
}

function write(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}
