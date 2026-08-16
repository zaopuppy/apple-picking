import { cloneOrchardMap, type OrchardMap, type OrchardPath } from './OrchardMap';
import { generateOrchardMap } from './MapGenerator';

export const MEDIEVAL_WORLD_PRESETS = ['village', 'riverside', 'fortified'] as const;

export type MedievalWorldPreset = typeof MEDIEVAL_WORLD_PRESETS[number];

export type MedievalWorldSelection = {
  preset: MedievalWorldPreset;
  map: OrchardMap;
};

type ExperimentDefinition = {
  name: string;
  seed: number;
  generatorPreset: 'village' | 'pond-garden' | 'open-orchard';
  openness: number;
  landmarkDensity: number;
  paths: OrchardPath[];
  clearings: OrchardMap['clearings'];
};

const DEFINITIONS: Record<MedievalWorldPreset, ExperimentDefinition> = {
  village: {
    name: 'KayKit 林间村落',
    seed: 20260821,
    generatorPreset: 'village',
    openness: 0.86,
    landmarkDensity: 0.11,
    paths: [
      {
        id: 'village-main-road',
        width: 5.6,
        points: [
          { x: -34, z: 5 },
          { x: -16, z: 2 },
          { x: 2, z: 3.5 },
          { x: 18, z: 0 },
          { x: 34, z: 3 },
        ],
      },
      {
        id: 'village-market-road',
        width: 4.8,
        points: [
          { x: -7, z: -25 },
          { x: -6, z: -10 },
          { x: 2, z: 3.5 },
          { x: 8, z: 17 },
          { x: 24, z: 25 },
        ],
      },
    ],
    clearings: [
      { id: 'village-square', x: 1, z: 3, radius: 6.8 },
      { id: 'village-orchard', x: -20, z: 14, radius: 5.4 },
    ],
  },
  riverside: {
    name: 'KayKit 河畔集市',
    seed: 20260903,
    generatorPreset: 'pond-garden',
    openness: 0.88,
    landmarkDensity: 0.14,
    paths: [
      {
        id: 'riverside-promenade',
        width: 5.8,
        points: [
          { x: -34, z: 9 },
          { x: -19, z: 6 },
          { x: -4, z: 9 },
          { x: 12, z: 6 },
          { x: 34, z: 10 },
        ],
      },
      {
        id: 'riverside-market-road',
        width: 4.6,
        points: [
          { x: -19, z: -25 },
          { x: -12, z: -9 },
          { x: -4, z: 9 },
          { x: 4, z: 23 },
        ],
      },
    ],
    clearings: [
      { id: 'riverside-market', x: -5, z: 8, radius: 7.2 },
      { id: 'riverside-meadow', x: 20, z: -10, radius: 6 },
    ],
  },
  fortified: {
    name: 'KayKit 城堡果园',
    seed: 20261007,
    generatorPreset: 'open-orchard',
    openness: 0.84,
    landmarkDensity: 0.12,
    paths: [
      {
        id: 'fortified-grand-road',
        width: 6.4,
        points: [
          { x: 0, z: -26 },
          { x: 0, z: -12 },
          { x: -2, z: 2 },
          { x: 8, z: 15 },
          { x: 25, z: 25 },
        ],
      },
      {
        id: 'fortified-orchard-road',
        width: 5.2,
        points: [
          { x: -34, z: 5 },
          { x: -18, z: 1 },
          { x: -2, z: 2 },
          { x: 17, z: 0 },
          { x: 34, z: -4 },
        ],
      },
    ],
    clearings: [
      { id: 'fortified-courtyard', x: 0, z: -10, radius: 7.6 },
      { id: 'fortified-orchard', x: 18, z: 11, radius: 6.2 },
    ],
  },
};

const EXPERIMENT_MAPS = Object.fromEntries(
  MEDIEVAL_WORLD_PRESETS.map((preset) => [preset, createExperimentMap(preset)]),
) as Record<MedievalWorldPreset, OrchardMap>;

export function readMedievalWorldPreset(search = window.location.search): MedievalWorldPreset | null {
  const parameters = new URLSearchParams(search);
  const world = parameters.get('world');
  if (world === 'classic') return null;
  if (world !== null && world !== 'medieval') return null;
  const layout = parameters.get('layout');
  return MEDIEVAL_WORLD_PRESETS.includes(layout as MedievalWorldPreset)
    ? layout as MedievalWorldPreset
    : 'village';
}

export function resolveMedievalWorldMap(
  fallback: OrchardMap,
  search = window.location.search,
): MedievalWorldSelection | null {
  const parameters = new URLSearchParams(search);
  if (parameters.get('world') === 'custom') {
    return {
      preset: fallback.worldStyle.theme,
      map: cloneOrchardMap(fallback),
    };
  }
  const preset = readMedievalWorldPreset(search);
  if (!preset) return null;
  return {
    preset,
    map: cloneOrchardMap(EXPERIMENT_MAPS[preset] ?? fallback),
  };
}

export function getMedievalExperimentMaps(): OrchardMap[] {
  return MEDIEVAL_WORLD_PRESETS.map((preset) => cloneOrchardMap(EXPERIMENT_MAPS[preset]));
}

function createExperimentMap(preset: MedievalWorldPreset): OrchardMap {
  const definition = DEFINITIONS[preset];
  const generated = generateOrchardMap({
    seed: definition.seed,
    preset: definition.generatorPreset,
    openness: definition.openness,
    landmarkDensity: definition.landmarkDensity,
    name: definition.name,
  });
  const trees = generated.trees.filter((tree) =>
    definition.paths.every((path) => distanceToPath(tree, path) > path.width / 2 + 0.85) &&
    definition.clearings.every((clearing) => Math.hypot(
      tree.x - clearing.x,
      tree.z - clearing.z,
    ) > clearing.radius + 0.8),
  );
  return {
    ...generated,
    id: `medieval-experiment-${preset}`,
    name: definition.name,
    worldStyle: {
      theme: preset,
      tileShape: 'square',
    },
    trees,
    paths: definition.paths.map((path) => ({
      ...path,
      points: path.points.map((point) => ({ ...point })),
    })),
    clearings: definition.clearings.map((clearing) => ({ ...clearing })),
  };
}

function distanceToPath(point: { x: number; z: number }, path: OrchardPath): number {
  let minimum = Number.POSITIVE_INFINITY;
  for (let index = 1; index < path.points.length; index += 1) {
    minimum = Math.min(minimum, distanceToSegment(point, path.points[index - 1], path.points[index]));
  }
  return minimum;
}

function distanceToSegment(
  point: { x: number; z: number },
  start: { x: number; z: number },
  end: { x: number; z: number },
): number {
  const deltaX = end.x - start.x;
  const deltaZ = end.z - start.z;
  const lengthSquared = deltaX * deltaX + deltaZ * deltaZ;
  if (lengthSquared <= 0.000001) return Math.hypot(point.x - start.x, point.z - start.z);
  const projection = Math.max(0, Math.min(1,
    ((point.x - start.x) * deltaX + (point.z - start.z) * deltaZ) / lengthSquared,
  ));
  return Math.hypot(
    point.x - (start.x + deltaX * projection),
    point.z - (start.z + deltaZ * projection),
  );
}
