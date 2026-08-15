import { DEFAULT_ORCHARD_MAP } from '../game/maps/MapGenerator';
import {
  cloneOrchardMap,
  parseOrchardMap,
  type OrchardMap,
  validateOrchardMap,
} from '../game/maps/OrchardMap';

const ACTIVE_MAP_KEY = 'apple-picking.active-map.v1';
const MAP_LIBRARY_KEY = 'apple-picking.map-library.v1';
const MAX_SAVED_MAPS = 24;

export function loadActiveMap(): OrchardMap {
  const stored = readMap(ACTIVE_MAP_KEY);
  if (!stored || !validateOrchardMap(stored).valid) return cloneOrchardMap(DEFAULT_ORCHARD_MAP);
  return stored;
}

export function setActiveMap(map: OrchardMap): boolean {
  if (!validateOrchardMap(map).valid) return false;
  return write(ACTIVE_MAP_KEY, JSON.stringify(map));
}

export function loadSavedMaps(): OrchardMap[] {
  try {
    const raw = localStorage.getItem(MAP_LIBRARY_KEY);
    if (!raw) return [];
    const values: unknown = JSON.parse(raw);
    if (!Array.isArray(values)) return [];
    return values
      .map((value) => parseOrchardMap(value))
      .filter((map): map is OrchardMap => Boolean(map));
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

function write(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}
