import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { GAME_CONFIG } from '../game/config';
import type { MedievalWorldPreset } from '../game/maps/MedievalWorldExperiments';
import {
  alignToQuarterTurn,
  type KayKitTileShape,
  type OrchardLandmark,
  type OrchardMap,
  type OrchardPath,
} from '../game/maps/OrchardMap';

const WORLD_KIT_BASE_URL = `${import.meta.env.BASE_URL}assets/models/kaykit-medieval/world-kit/`;
const TILE_WIDTH = 4.1;
const TILE_DEPTH = TILE_WIDTH * 2 / Math.sqrt(3);
const TILE_ROW_SPACING = TILE_DEPTH * 0.75;

export const MEDIEVAL_BUILDER_CATALOG_COUNT = 226;

const ASSET_FILES = {
  forest: 'hex_forest.gltf.glb',
  forestDetail: 'hex_forest_detail.gltf.glb',
  forestRoad: 'hex_forest_roadA.gltf.glb',
  forestWater: 'hex_forest_waterA.gltf.glb',
  water: 'hex_water.gltf.glb',
  rock: 'hex_rock.gltf.glb',
  rockDetail: 'hex_rock_detail.gltf.glb',
  rockRoad: 'hex_rock_roadA.gltf.glb',
  sand: 'hex_sand.gltf.glb',
  sandDetail: 'hex_sand_detail.gltf.glb',
  sandRoad: 'hex_sand_roadA.gltf.glb',
  squareForest: 'square_forest.gltf.glb',
  squareForestDetail: 'square_forest_detail.gltf.glb',
  squareForestRoadA: 'square_forest_roadA.gltf.glb',
  squareForestRoadB: 'square_forest_roadB.gltf.glb',
  squareForestRoadC: 'square_forest_roadC.gltf.glb',
  squareForestRoadD: 'square_forest_roadD.gltf.glb',
  squareForestRoadE: 'square_forest_roadE.gltf.glb',
  squareWater: 'square_water.gltf.glb',
  squareRock: 'square_rock.gltf.glb',
  squareRockDetail: 'square_rock_detail.gltf.glb',
  squareRockRoadA: 'square_rock_roadA.gltf.glb',
  squareRockRoadB: 'square_rock_roadB.gltf.glb',
  squareRockRoadC: 'square_rock_roadC.gltf.glb',
  squareRockRoadD: 'square_rock_roadD.gltf.glb',
  squareRockRoadE: 'square_rock_roadE.gltf.glb',
  squareSand: 'square_sand.gltf.glb',
  squareSandDetail: 'square_sand_detail.gltf.glb',
  squareSandRoadA: 'square_sand_roadA.gltf.glb',
  squareSandRoadB: 'square_sand_roadB.gltf.glb',
  squareSandRoadC: 'square_sand_roadC.gltf.glb',
  squareSandRoadD: 'square_sand_roadD.gltf.glb',
  squareSandRoadE: 'square_sand_roadE.gltf.glb',
  archeryRange: 'archeryrange.gltf.glb',
  bridgeRoofed: 'bridge_roofed.gltf.glb',
  bridge: 'bridge.gltf.glb',
  market: 'market.gltf.glb',
  well: 'well.gltf.glb',
  farmPlot: 'farm_plot.gltf.glb',
  house: 'house.gltf.glb',
  lumbermill: 'lumbermill.gltf.glb',
  mill: 'mill.gltf.glb',
  watermill: 'watermill.gltf.glb',
  mine: 'mine.gltf.glb',
  mountain: 'mountain.gltf.glb',
  castle: 'castle.gltf.glb',
  barracks: 'barracks.gltf.glb',
  watchtower: 'watchtower.gltf.glb',
  wallCorner: 'wall_corner.gltf.glb',
  wallGateClosed: 'wall_gate_closed.gltf.glb',
  wallStraight: 'wall_straight.gltf.glb',
  wallGate: 'wall_gate.gltf.glb',
  wallHexCornerA: 'wall_hexCornerA.gltf.glb',
  wallHexCornerB: 'wall_hexCornerB.gltf.glb',
  forestDetailA: 'detail_forestA.gltf.glb',
  forestDetailB: 'detail_forestB.gltf.glb',
  hill: 'detail_hill.gltf.glb',
  rocksSmall: 'detail_rocks_small.gltf.glb',
  rocks: 'detail_rocks.gltf.glb',
  treeA: 'detail_treeA.gltf.glb',
  treeB: 'detail_treeB.gltf.glb',
  treeC: 'detail_treeC.gltf.glb',
  forestCluster: 'forest.gltf.glb',
} as const;

type AssetId = keyof typeof ASSET_FILES;
const STATIC_PROP_ASSETS = new Set<AssetId>([
  'wallStraight',
  'wallCorner',
  'wallGate',
  'wallGateClosed',
  'watchtower',
  'forestCluster',
  'forestDetailA',
  'forestDetailB',
  'rocks',
  'rocksSmall',
]);
type TileAssetId = Extract<AssetId,
  | 'forest'
  | 'forestDetail'
  | 'forestRoad'
  | 'forestWater'
  | 'water'
  | 'rock'
  | 'rockDetail'
  | 'rockRoad'
  | 'sand'
  | 'sandDetail'
  | 'sandRoad'
  | 'squareForest'
  | 'squareForestDetail'
  | 'squareForestRoadA'
  | 'squareForestRoadB'
  | 'squareForestRoadC'
  | 'squareForestRoadD'
  | 'squareForestRoadE'
  | 'squareWater'
  | 'squareRock'
  | 'squareRockDetail'
  | 'squareRockRoadA'
  | 'squareRockRoadB'
  | 'squareRockRoadC'
  | 'squareRockRoadD'
  | 'squareRockRoadE'
  | 'squareSand'
  | 'squareSandDetail'
  | 'squareSandRoadA'
  | 'squareSandRoadB'
  | 'squareSandRoadC'
  | 'squareSandRoadD'
  | 'squareSandRoadE'
>;

type Placement = {
  x: number;
  y: number;
  z: number;
  rotationY: number;
  targetWidth: number;
};

type TilePlacement = Placement & {
  asset: TileAssetId;
};

type TileCell = {
  column: number;
  row: number;
  x: number;
  z: number;
};

type SquareSurface = 'forest' | 'rock' | 'sand' | 'water';

const ROAD_NORTH = 1;
const ROAD_EAST = 2;
const ROAD_SOUTH = 4;
const ROAD_WEST = 8;

type PropPlacement = Placement & {
  asset: AssetId;
};

type MeshPart = {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  matrix: THREE.Matrix4;
  triangles: number;
};

type AssetPrototype = {
  id: AssetId;
  scene: THREE.Group;
  bounds: THREE.Box3;
  size: THREE.Vector3;
  center: THREE.Vector3;
  parts: MeshPart[];
  meshes: number;
  triangles: number;
  materials: Set<THREE.Material>;
  textures: Set<THREE.Texture>;
};

export type LoadedMedievalWorldVisual = {
  root: THREE.Group;
  preset: MedievalWorldPreset;
  tileInstances: number;
  propInstances: number;
  meshes: number;
  triangles: number;
  materials: number;
  textures: number;
  assetRequests: number;
  catalogAssets: number;
  tileShape: KayKitTileShape;
};

const loader = new GLTFLoader();
const gltfPromises = new Map<AssetId, Promise<GLTF>>();
const prototypePromises = new Map<AssetId, Promise<AssetPrototype>>();

export async function createMedievalWorldVisual(
  preset: MedievalWorldPreset,
  map: OrchardMap,
): Promise<LoadedMedievalWorldVisual> {
  const tilePlacements = createTilePlacements(preset, map);
  const propPlacements = createPropPlacements(preset, map);
  const requestedAssets = new Set<AssetId>([
    ...tilePlacements.map((placement) => placement.asset),
    ...propPlacements.map((placement) => placement.asset),
  ]);
  const prototypes = new Map<AssetId, AssetPrototype>();
  await Promise.all([...requestedAssets].map(async (id) => {
    prototypes.set(id, await loadPrototype(id));
  }));

  const root = new THREE.Group();
  root.name = `kaykit-medieval-world-${preset}`;
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const foundationMaterial = new THREE.MeshStandardMaterial({
    color: preset === 'fortified' ? '#53604b' : preset === 'riverside' ? '#5b7454' : '#4d6b49',
    roughness: 0.94,
    metalness: 0,
  });
  const foundation = new THREE.Mesh(
    new THREE.PlaneGeometry(
      GAME_CONFIG.arenaHalfWidth * 2 + 12,
      GAME_CONFIG.arenaHalfDepth * 2 + 12,
    ),
    foundationMaterial,
  );
  foundation.name = 'kaykit-square-tile-foundation';
  foundation.rotation.x = -Math.PI / 2;
  foundation.position.y = -1.78;
  foundation.receiveShadow = true;
  root.add(foundation);
  materials.add(foundationMaterial);
  let meshes = 1;
  let triangles = 2;

  const placementsByAsset = groupPlacements(tilePlacements);
  for (const [asset, placements] of placementsByAsset) {
    const prototype = prototypes.get(asset);
    if (!prototype) continue;
    const instances = createInstancedAsset(prototype, placements, `kaykit-tiles-${asset}`, 'top');
    root.add(instances.root);
    meshes += instances.meshes;
    triangles += instances.triangles;
    for (const material of prototype.materials) materials.add(material);
    for (const texture of prototype.textures) textures.add(texture);
  }

  const propPlacementsByAsset = groupPropPlacements(propPlacements);
  for (const [asset, placements] of propPlacementsByAsset) {
    const prototype = prototypes.get(asset);
    if (!prototype) continue;
    if (placements.length >= 3 && STATIC_PROP_ASSETS.has(asset)) {
      const instances = createInstancedAsset(prototype, placements, `kaykit-props-${asset}`, 'bottom');
      root.add(instances.root);
      meshes += instances.meshes;
      triangles += instances.triangles;
    } else {
      for (const placement of placements) {
        root.add(createProp(prototype, placement));
        meshes += prototype.meshes;
        triangles += prototype.triangles;
      }
    }
    for (const material of prototype.materials) materials.add(material);
    for (const texture of prototype.textures) textures.add(texture);
  }

  root.updateMatrixWorld(true);
  return {
    root,
    preset,
    tileInstances: tilePlacements.length,
    propInstances: propPlacements.length,
    meshes,
    triangles,
    materials: materials.size,
    textures: textures.size,
    assetRequests: requestedAssets.size,
    catalogAssets: MEDIEVAL_BUILDER_CATALOG_COUNT,
    tileShape: map.worldStyle.tileShape,
  };
}

function createTilePlacements(
  preset: MedievalWorldPreset,
  map: OrchardMap,
): TilePlacement[] {
  const tileShape = map.worldStyle.tileShape;
  const tileWidth = tileShape === 'square' ? 4 : TILE_WIDTH;
  const tileDepth = tileShape === 'square' ? 4 : TILE_DEPTH;
  const rowSpacing = tileShape === 'square' ? tileDepth : TILE_ROW_SPACING;
  const halfWidth = GAME_CONFIG.arenaHalfWidth + tileWidth * 1.2;
  const halfDepth = GAME_CONFIG.arenaHalfDepth + tileDepth * 1.1;
  const cells: TileCell[] = [];
  let row = 0;
  for (let z = -halfDepth; z <= halfDepth; z += rowSpacing) {
    const offsetX = tileShape === 'hex' && row % 2 !== 0 ? tileWidth / 2 : 0;
    let column = 0;
    for (let x = -halfWidth - offsetX; x <= halfWidth; x += tileWidth) {
      cells.push({ column, row, x, z });
      column += 1;
    }
    row += 1;
  }
  const roadCells = tileShape === 'square'
    ? createSquareRoadCells(map, cells, tileWidth)
    : new Set<string>();
  return cells.map((cell) => {
    const roadMask = tileShape === 'square' ? squareRoadMask(cell, roadCells) : 0;
    const selection = chooseTileAsset(
      preset,
      map,
      tileShape,
      tileWidth,
      cell.x,
      cell.z,
      cell.column,
      cell.row,
      roadMask,
    );
    return {
      asset: selection.asset,
      x: cell.x,
      y: 0.035,
      z: cell.z,
      rotationY: tileShape === 'square'
        ? selection.rotationY
        : tileRotation(map.paths, cell.x, cell.z, cell.column, cell.row),
      targetWidth: tileShape === 'square' ? tileWidth * 0.993 : tileWidth,
    };
  });
}

function chooseTileAsset(
  preset: MedievalWorldPreset,
  map: OrchardMap,
  tileShape: KayKitTileShape,
  tileWidth: number,
  x: number,
  z: number,
  column: number,
  row: number,
  roadMask: number,
): { asset: TileAssetId; rotationY: number } {
  if (tileShape === 'square') {
    const detailRoll = stableRoll(column, row, map.seed);
    const surface = chooseSquareSurface(preset, map, x, z);
    if (roadMask !== 0 && surface !== 'water') {
      return squareRoadAsset(surface, roadMask);
    }
    const detailed = detailRoll < squareDetailChance(map, surface, x, z);
    return { asset: squareSurfaceAsset(surface, detailed), rotationY: 0 };
  }
  return {
    asset: chooseHexTileAsset(preset, map, tileWidth, x, z, column, row),
    rotationY: 0,
  };
}

function chooseHexTileAsset(
  preset: MedievalWorldPreset,
  map: OrchardMap,
  tileWidth: number,
  x: number,
  z: number,
  column: number,
  row: number,
): TileAssetId {
  const tile = <THex extends TileAssetId, TSquare extends TileAssetId>(
    hex: THex,
    _square: TSquare,
  ): THex | TSquare => hex;
  const pond = nearestPond(map.landmarks, x, z);
  if (pond.normalizedDistance < 0.78) return tile('water', 'squareWater');
  if (pond.normalizedDistance < 1.42) return 'forestWater';

  const pathDistance = nearestPathDistance(map.paths, x, z);
  const onRoad = pathDistance < tileWidth * 0.72;
  const detailRoll = stableRoll(column, row, map.seed);
  if (preset === 'fortified') {
    const edgeDistance = Math.min(
      GAME_CONFIG.arenaHalfWidth - Math.abs(x),
      GAME_CONFIG.arenaHalfDepth - Math.abs(z),
    );
    if (onRoad) return detailRoll < 0.16
      ? tile('sandDetail', 'squareSandDetail')
      : tile('sand', 'squareSand');
    if (edgeDistance < 5.2 || z < -18) return detailRoll < 0.18
      ? tile('rockDetail', 'squareRockDetail')
      : tile('rock', 'squareRock');
    return detailRoll < 0.14
      ? tile('forestDetail', 'squareForestDetail')
      : tile('forest', 'squareForest');
  }
  if (preset === 'riverside') {
    if (onRoad) return detailRoll < 0.16
      ? tile('sandDetail', 'squareSandDetail')
      : tile('sand', 'squareSand');
    if (map.clearings.some((clearing) => Math.hypot(x - clearing.x, z - clearing.z) < clearing.radius)) {
      return detailRoll < 0.22
        ? tile('sandDetail', 'squareSandDetail')
        : tile('sand', 'squareSand');
    }
    return detailRoll < 0.16
      ? tile('forestDetail', 'squareForestDetail')
      : tile('forest', 'squareForest');
  }
  if (onRoad) return detailRoll < 0.16
    ? tile('sandDetail', 'squareSandDetail')
    : tile('sand', 'squareSand');
  if (map.clearings.some((clearing) => Math.hypot(x - clearing.x, z - clearing.z) < clearing.radius)) {
    return detailRoll < 0.2
      ? tile('sandDetail', 'squareSandDetail')
      : tile('sand', 'squareSand');
  }
  return detailRoll < 0.18
    ? tile('forestDetail', 'squareForestDetail')
    : tile('forest', 'squareForest');
}

function chooseSquareSurface(
  preset: MedievalWorldPreset,
  map: OrchardMap,
  x: number,
  z: number,
): SquareSurface {
  if (nearestPond(map.landmarks, x, z).normalizedDistance < 0.82) return 'water';
  if (insideHomesteadCourtyard(map.landmarks, x, z)) return 'sand';
  if (preset === 'fortified') {
    const edgeDistance = Math.min(
      GAME_CONFIG.arenaHalfWidth - Math.abs(x),
      GAME_CONFIG.arenaHalfDepth - Math.abs(z),
    );
    if (edgeDistance < 4.8 || z < -18) return 'rock';
  }
  return 'forest';
}

function squareDetailChance(
  map: OrchardMap,
  surface: SquareSurface,
  x: number,
  z: number,
): number {
  if (surface === 'water') return 0;
  if (surface === 'sand') return 0.11;
  if (surface === 'rock') return 0.13;
  const inOrchard = map.terrainZones.some((zone) => {
    if (zone.kind !== 'orchard') return false;
    const cosine = Math.cos(zone.rotationY);
    const sine = Math.sin(zone.rotationY);
    const deltaX = x - zone.x;
    const deltaZ = z - zone.z;
    const localX = deltaX * cosine - deltaZ * sine;
    const localZ = deltaX * sine + deltaZ * cosine;
    return Math.hypot(
      localX / Math.max(0.001, zone.radiusX),
      localZ / Math.max(0.001, zone.radiusZ),
    ) < 0.82;
  });
  if (inOrchard) return 0.34;
  const inClearing = map.clearings.some((clearing) =>
    Math.hypot(x - clearing.x, z - clearing.z) < clearing.radius);
  return inClearing ? 0.04 : 0.16;
}

function squareSurfaceAsset(surface: SquareSurface, detailed: boolean): TileAssetId {
  if (surface === 'water') return 'squareWater';
  if (surface === 'rock') return detailed ? 'squareRockDetail' : 'squareRock';
  if (surface === 'sand') return detailed ? 'squareSandDetail' : 'squareSand';
  return detailed ? 'squareForestDetail' : 'squareForest';
}

function squareRoadAsset(
  surface: Exclude<SquareSurface, 'water'>,
  mask: number,
): { asset: TileAssetId; rotationY: number } {
  const connectionCount = countRoadConnections(mask);
  const suffix = connectionCount <= 1
    ? 'A'
    : connectionCount === 2 && isOppositeRoad(mask)
      ? 'B'
      : connectionCount === 2
        ? 'C'
        : connectionCount === 3
          ? 'D'
          : 'E';
  const family = surface === 'rock'
    ? 'squareRockRoad'
    : surface === 'sand'
      ? 'squareSandRoad'
      : 'squareForestRoad';
  return {
    asset: `${family}${suffix}` as TileAssetId,
    rotationY: squareRoadRotation(mask, suffix),
  };
}

function createSquareRoadCells(
  map: OrchardMap,
  cells: readonly TileCell[],
  tileWidth: number,
): Set<string> {
  const roadCells = new Set<string>();
  const cellsByKey = new Map(cells.map((cell) => [tileCellKey(cell.column, cell.row), cell]));
  const minX = Math.min(...cells.map((cell) => cell.x));
  const minZ = Math.min(...cells.map((cell) => cell.z));
  const maxColumn = Math.max(...cells.map((cell) => cell.column));
  const maxRow = Math.max(...cells.map((cell) => cell.row));
  const nearestCell = (point: { x: number; z: number }): TileCell => {
    const column = Math.max(0, Math.min(maxColumn, Math.round((point.x - minX) / tileWidth)));
    const row = Math.max(0, Math.min(maxRow, Math.round((point.z - minZ) / tileWidth)));
    return cellsByKey.get(tileCellKey(column, row)) ?? cells[0];
  };

  for (const path of map.paths) {
    for (let index = 1; index < path.points.length; index += 1) {
      connectSquareCells(
        roadCells,
        nearestCell(path.points[index - 1]),
        nearestCell(path.points[index]),
        cellsByKey,
      );
    }
  }

  const currentRoadCells = (): TileCell[] => [...roadCells]
    .map((key) => cellsByKey.get(key))
    .filter((cell): cell is TileCell => Boolean(cell));
  for (const landmark of map.landmarks) {
    if (landmark.kind !== 'homestead') continue;
    const candidates = currentRoadCells();
    if (candidates.length === 0) break;
    const nearestRoad = candidates.reduce((best, candidate) =>
      Math.hypot(candidate.x - landmark.x, candidate.z - landmark.z) <
      Math.hypot(best.x - landmark.x, best.z - landmark.z)
        ? candidate
        : best,
    );
    const nearestRoadDistance = Math.hypot(nearestRoad.x - landmark.x, nearestRoad.z - landmark.z);
    if (nearestRoadDistance <= Math.max(landmark.radiusX, landmark.radiusZ) + tileWidth * 0.72) {
      continue;
    }
    const deltaX = landmark.x - nearestRoad.x;
    const deltaZ = landmark.z - nearestRoad.z;
    const length = Math.max(0.001, Math.hypot(deltaX, deltaZ));
    const approachDistance = Math.max(landmark.radiusX, landmark.radiusZ) + tileWidth * 0.45;
    const approach = nearestCell({
      x: landmark.x - deltaX / length * approachDistance,
      z: landmark.z - deltaZ / length * approachDistance,
    });
    connectSquareCells(roadCells, nearestRoad, approach, cellsByKey);
  }
  return roadCells;
}

function connectSquareCells(
  roadCells: Set<string>,
  start: TileCell,
  end: TileCell,
  cellsByKey: ReadonlyMap<string, TileCell>,
): void {
  let column = start.column;
  let row = start.row;
  const columnStep = Math.sign(end.column - start.column);
  const rowStep = Math.sign(end.row - start.row);
  roadCells.add(tileCellKey(column, row));
  while (column !== end.column) {
    column += columnStep;
    const key = tileCellKey(column, row);
    if (cellsByKey.has(key)) roadCells.add(key);
  }
  while (row !== end.row) {
    row += rowStep;
    const key = tileCellKey(column, row);
    if (cellsByKey.has(key)) roadCells.add(key);
  }
}

function squareRoadMask(cell: TileCell, roadCells: ReadonlySet<string>): number {
  if (!roadCells.has(tileCellKey(cell.column, cell.row))) return 0;
  let mask = 0;
  if (roadCells.has(tileCellKey(cell.column, cell.row - 1))) mask |= ROAD_NORTH;
  if (roadCells.has(tileCellKey(cell.column + 1, cell.row))) mask |= ROAD_EAST;
  if (roadCells.has(tileCellKey(cell.column, cell.row + 1))) mask |= ROAD_SOUTH;
  if (roadCells.has(tileCellKey(cell.column - 1, cell.row))) mask |= ROAD_WEST;
  return mask || ROAD_SOUTH;
}

function countRoadConnections(mask: number): number {
  let count = 0;
  for (const direction of [ROAD_NORTH, ROAD_EAST, ROAD_SOUTH, ROAD_WEST]) {
    if ((mask & direction) !== 0) count += 1;
  }
  return count;
}

function isOppositeRoad(mask: number): boolean {
  return mask === (ROAD_NORTH | ROAD_SOUTH) || mask === (ROAD_EAST | ROAD_WEST);
}

function squareRoadRotation(mask: number, suffix: string): number {
  if (suffix === 'A') {
    if ((mask & ROAD_EAST) !== 0) return Math.PI / 2;
    if ((mask & ROAD_NORTH) !== 0) return Math.PI;
    if ((mask & ROAD_WEST) !== 0) return -Math.PI / 2;
    return 0;
  }
  if (suffix === 'B') return (mask & ROAD_EAST) !== 0 ? Math.PI / 2 : 0;
  if (suffix === 'C') {
    if (mask === (ROAD_NORTH | ROAD_EAST)) return Math.PI / 2;
    if (mask === (ROAD_NORTH | ROAD_WEST)) return Math.PI;
    if (mask === (ROAD_SOUTH | ROAD_WEST)) return -Math.PI / 2;
    return 0;
  }
  if (suffix === 'D') {
    const missing = (ROAD_NORTH | ROAD_EAST | ROAD_SOUTH | ROAD_WEST) ^ mask;
    if (missing === ROAD_WEST) return Math.PI / 2;
    if (missing === ROAD_SOUTH) return Math.PI;
    if (missing === ROAD_EAST) return -Math.PI / 2;
  }
  return 0;
}

function insideHomesteadCourtyard(
  landmarks: readonly OrchardLandmark[],
  x: number,
  z: number,
): boolean {
  return landmarks.some((landmark) => {
    if (landmark.kind !== 'homestead') return false;
    const cosine = Math.cos(landmark.rotationY);
    const sine = Math.sin(landmark.rotationY);
    const deltaX = x - landmark.x;
    const deltaZ = z - landmark.z;
    const localX = deltaX * cosine - deltaZ * sine;
    const localZ = deltaX * sine + deltaZ * cosine;
    return Math.abs(localX) <= landmark.radiusX * 1.24 &&
      Math.abs(localZ) <= landmark.radiusZ * 1.3;
  });
}

function tileCellKey(column: number, row: number): string {
  return `${column}:${row}`;
}

function createPropPlacements(
  preset: MedievalWorldPreset,
  map: OrchardMap,
): PropPlacement[] {
  const homesteadAssets: Record<MedievalWorldPreset, AssetId[]> = {
    village: ['market', 'farmPlot', 'lumbermill', 'well'],
    riverside: ['watermill', 'market', 'mill', 'well'],
    fortified: ['castle', 'barracks', 'watchtower', 'watchtower'],
  };
  const placements: PropPlacement[] = [];
  let homesteadIndex = 0;
  for (const landmark of map.landmarks) {
    if (landmark.kind === 'homestead') {
      const assets = homesteadAssets[preset];
      const asset = landmark.asset ?? assets[homesteadIndex % assets.length];
      placements.push({
        asset,
        x: landmark.x,
        y: 0.045,
        z: landmark.z,
        rotationY: alignToQuarterTurn(landmark.rotationY),
        targetWidth: Math.min(10.5, Math.max(4.4, landmark.radiusX * 1.55)),
      });
      homesteadIndex += 1;
    } else {
      const angle = landmark.rotationY + Math.PI * 0.2;
      placements.push({
        asset: 'rocks',
        x: landmark.x + Math.cos(angle) * landmark.radiusX * 0.72,
        y: 0.05,
        z: landmark.z + Math.sin(angle) * landmark.radiusZ * 0.72,
        rotationY: landmark.rotationY,
        targetWidth: Math.min(3.4, landmark.radiusX * 0.8),
      });
    }
  }

  if (preset === 'fortified') {
    placements.push(...createFortifiedPerimeter(map));
  } else {
    for (const [x, z, rotationY] of [
      [-GAME_CONFIG.arenaHalfWidth - 2.2, -GAME_CONFIG.arenaHalfDepth + 3, 0.3],
      [GAME_CONFIG.arenaHalfWidth + 2.2, -GAME_CONFIG.arenaHalfDepth + 8, -0.4],
    ] as const) {
      placements.push({
        asset: 'forestCluster',
        x,
        y: 0.04,
        z,
        rotationY,
        targetWidth: 6.8,
      });
    }
  }
  placements.push(...createOuterScenery(preset));
  return placements;
}

function createFortifiedPerimeter(map: OrchardMap): PropPlacement[] {
  const placements: PropPlacement[] = [];
  const wallWidth = 6.15;
  const west = -GAME_CONFIG.arenaHalfWidth - 0.35;
  const east = GAME_CONFIG.arenaHalfWidth + 0.35;
  const north = -GAME_CONFIG.arenaHalfDepth - 0.2;
  const south = GAME_CONFIG.arenaHalfDepth + 0.2;
  const gates = perimeterGatePositions(map);
  const addHorizontalWall = (z: number, side: 'north' | 'south', rotationY: number): void => {
    for (let x = -30.75; x <= 30.75; x += wallWidth) {
      const gate = gates.some((candidate) => candidate.side === side && Math.abs(candidate.coordinate - x) < wallWidth * 0.52);
      placements.push({
        asset: gate ? 'wallGate' : 'wallStraight',
        x,
        y: 0.045,
        z,
        rotationY,
        targetWidth: wallWidth,
      });
    }
  };
  const addVerticalWall = (x: number, side: 'west' | 'east', rotationY: number): void => {
    for (let z = -18.45; z <= 18.45; z += wallWidth) {
      const gate = gates.some((candidate) => candidate.side === side && Math.abs(candidate.coordinate - z) < wallWidth * 0.52);
      placements.push({
        asset: gate ? 'wallGate' : 'wallStraight',
        x,
        y: 0.045,
        z,
        rotationY,
        targetWidth: wallWidth,
      });
    }
  };
  addHorizontalWall(north, 'north', 0);
  addHorizontalWall(south, 'south', 0);
  addVerticalWall(west, 'west', Math.PI / 2);
  addVerticalWall(east, 'east', Math.PI / 2);
  for (const [x, z, rotationY] of [
    [west, north, 0],
    [east, north, Math.PI / 2],
    [east, south, Math.PI],
    [west, south, -Math.PI / 2],
  ] as const) {
    placements.push({
      asset: 'wallCorner',
      x,
      y: 0.045,
      z,
      rotationY,
      targetWidth: wallWidth,
    });
  }
  return placements;
}

function perimeterGatePositions(
  map: OrchardMap,
): Array<{ side: 'north' | 'south' | 'west' | 'east'; coordinate: number }> {
  const gates: Array<{ side: 'north' | 'south' | 'west' | 'east'; coordinate: number }> = [];
  for (const path of map.paths) {
    for (const point of [path.points[0], path.points[path.points.length - 1]]) {
      if (!point) continue;
      const horizontalEdge = GAME_CONFIG.arenaHalfWidth - Math.abs(point.x);
      const verticalEdge = GAME_CONFIG.arenaHalfDepth - Math.abs(point.z);
      if (horizontalEdge < verticalEdge) {
        gates.push({ side: point.x < 0 ? 'west' : 'east', coordinate: point.z });
      } else {
        gates.push({ side: point.z < 0 ? 'north' : 'south', coordinate: point.x });
      }
    }
  }
  return gates;
}

function createOuterScenery(preset: MedievalWorldPreset): PropPlacement[] {
  const north = -GAME_CONFIG.arenaHalfDepth - 4.5;
  const west = -GAME_CONFIG.arenaHalfWidth - 4.8;
  const east = GAME_CONFIG.arenaHalfWidth + 4.8;
  const presets: Record<MedievalWorldPreset, Array<{
    asset: AssetId;
    x: number;
    z: number;
    rotationY: number;
    targetWidth: number;
  }>> = {
    village: [
      { asset: 'forestCluster', x: -25, z: north, rotationY: 0, targetWidth: 8.4 },
      { asset: 'forestDetailA', x: -9, z: north - 0.3, rotationY: 0, targetWidth: 7.2 },
      { asset: 'hill', x: 10, z: north, rotationY: 0, targetWidth: 7.6 },
      { asset: 'forestCluster', x: 26, z: north + 0.4, rotationY: Math.PI / 2, targetWidth: 8.4 },
      { asset: 'forestDetailA', x: west, z: -16, rotationY: 0, targetWidth: 6.8 },
      { asset: 'treeA', x: west - 0.5, z: -5, rotationY: 0, targetWidth: 3.8 },
      { asset: 'treeB', x: east, z: -14, rotationY: 0, targetWidth: 3.8 },
      { asset: 'forestDetailB', x: east, z: -2, rotationY: 0, targetWidth: 6.8 },
    ],
    riverside: [
      { asset: 'rocks', x: -26, z: north, rotationY: 0, targetWidth: 5.4 },
      { asset: 'forestDetailB', x: -10, z: north, rotationY: 0, targetWidth: 7.2 },
      { asset: 'hill', x: 10, z: north, rotationY: 0, targetWidth: 7.4 },
      { asset: 'forestDetailA', x: 27, z: north, rotationY: 0, targetWidth: 7.2 },
      { asset: 'hill', x: west, z: -14, rotationY: 0, targetWidth: 6.4 },
      { asset: 'treeC', x: west, z: -3, rotationY: 0, targetWidth: 3.8 },
      { asset: 'rocksSmall', x: east, z: -14, rotationY: 0, targetWidth: 4.4 },
      { asset: 'forestDetailA', x: east, z: -2, rotationY: 0, targetWidth: 6.8 },
    ],
    fortified: [
      { asset: 'mountain', x: west - 1, z: -14, rotationY: 0, targetWidth: 9.2 },
      { asset: 'mine', x: west, z: 0, rotationY: Math.PI / 2, targetWidth: 7.2 },
      { asset: 'mountain', x: -18, z: north - 1, rotationY: 0, targetWidth: 9.2 },
      { asset: 'rocks', x: 0, z: north, rotationY: 0, targetWidth: 5.4 },
      { asset: 'mountain', x: 20, z: north - 1, rotationY: Math.PI / 2, targetWidth: 9.2 },
      { asset: 'rocks', x: east, z: -14, rotationY: 0, targetWidth: 5.4 },
      { asset: 'treeC', x: east, z: -2, rotationY: 0, targetWidth: 3.8 },
    ],
  };
  return presets[preset].map((placement) => ({
    ...placement,
    y: 0.045,
  }));
}

function createInstancedAsset(
  prototype: AssetPrototype,
  placements: readonly Placement[],
  name: string,
  anchorY: 'top' | 'bottom',
): { root: THREE.Group; meshes: number; triangles: number } {
  const root = new THREE.Group();
  root.name = name;
  const anchor = new THREE.Matrix4().makeTranslation(
    -prototype.center.x,
    -(anchorY === 'top' ? prototype.bounds.max.y : prototype.bounds.min.y),
    -prototype.center.z,
  );
  const wrapper = new THREE.Object3D();
  const matrix = new THREE.Matrix4();
  for (const [partIndex, part] of prototype.parts.entries()) {
    const instances = new THREE.InstancedMesh(
      part.geometry,
      part.material,
      placements.length,
    );
    instances.name = `${name}-${partIndex}`;
    instances.receiveShadow = true;
    instances.castShadow = false;
    instances.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    const anchoredPart = anchor.clone().multiply(part.matrix);
    placements.forEach((placement, index) => {
      const sourceWidth = anchorY === 'bottom'
        ? Math.max(prototype.size.x, prototype.size.z)
        : prototype.size.x;
      const scale = placement.targetWidth / Math.max(0.001, sourceWidth);
      wrapper.position.set(placement.x, placement.y, placement.z);
      wrapper.rotation.set(0, placement.rotationY, 0);
      wrapper.scale.setScalar(scale);
      wrapper.updateMatrix();
      matrix.multiplyMatrices(wrapper.matrix, anchoredPart);
      instances.setMatrixAt(index, matrix);
    });
    instances.instanceMatrix.needsUpdate = true;
    instances.computeBoundingSphere();
    root.add(instances);
  }
  return {
    root,
    meshes: prototype.parts.length,
    triangles: prototype.triangles * placements.length,
  };
}

function createProp(prototype: AssetPrototype, placement: PropPlacement): THREE.Group {
  const scene = prototype.scene.clone(true);
  scene.name = `kaykit-prop-${placement.asset}`;
  scene.position.set(-prototype.center.x, -prototype.bounds.min.y, -prototype.center.z);
  const scale = placement.targetWidth / Math.max(
    0.001,
    Math.max(prototype.size.x, prototype.size.z),
  );
  const normalized = new THREE.Group();
  normalized.add(scene);
  normalized.scale.setScalar(scale);
  const root = new THREE.Group();
  root.name = `kaykit-prop-placement-${placement.asset}`;
  root.position.set(placement.x, placement.y, placement.z);
  root.rotation.y = placement.rotationY;
  root.add(normalized);
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.castShadow = true;
    object.receiveShadow = true;
  });
  return root;
}

async function loadPrototype(id: AssetId): Promise<AssetPrototype> {
  let promise = prototypePromises.get(id);
  if (promise) return promise;
  promise = loadGltf(id).then((gltf) => {
    gltf.scene.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(gltf.scene);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    if (bounds.isEmpty() || size.x <= 0 || size.y <= 0 || size.z <= 0) {
      throw new Error(`KayKit world asset has invalid bounds: ${id}`);
    }
    const parts: MeshPart[] = [];
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    let triangles = 0;
    gltf.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const meshMaterials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of meshMaterials) {
        materials.add(material);
        for (const value of Object.values(material) as unknown[]) {
          if (value instanceof THREE.Texture) textures.add(value);
        }
      }
      const indexCount = object.geometry.index?.count;
      const vertexCount = object.geometry.attributes.position?.count ?? 0;
      const meshTriangles = indexCount ? indexCount / 3 : vertexCount / 3;
      triangles += meshTriangles;
      parts.push({
        geometry: object.geometry,
        material: object.material,
        matrix: object.matrixWorld.clone(),
        triangles: meshTriangles,
      });
    });
    return {
      id,
      scene: gltf.scene,
      bounds,
      size,
      center,
      parts,
      meshes: parts.length,
      triangles,
      materials,
      textures,
    };
  });
  prototypePromises.set(id, promise);
  return promise;
}

function loadGltf(id: AssetId): Promise<GLTF> {
  let promise = gltfPromises.get(id);
  if (promise) return promise;
  promise = loader.loadAsync(`${WORLD_KIT_BASE_URL}${ASSET_FILES[id]}`);
  gltfPromises.set(id, promise);
  return promise;
}

function groupPlacements(
  placements: readonly TilePlacement[],
): Map<TileAssetId, Placement[]> {
  const grouped = new Map<TileAssetId, Placement[]>();
  for (const placement of placements) {
    const group = grouped.get(placement.asset) ?? [];
    group.push(placement);
    grouped.set(placement.asset, group);
  }
  return grouped;
}

function groupPropPlacements(
  placements: readonly PropPlacement[],
): Map<AssetId, PropPlacement[]> {
  const grouped = new Map<AssetId, PropPlacement[]>();
  for (const placement of placements) {
    const group = grouped.get(placement.asset) ?? [];
    group.push(placement);
    grouped.set(placement.asset, group);
  }
  return grouped;
}

function nearestPond(
  landmarks: readonly OrchardLandmark[],
  x: number,
  z: number,
): { normalizedDistance: number } {
  let normalizedDistance = Number.POSITIVE_INFINITY;
  for (const landmark of landmarks) {
    if (landmark.kind !== 'pond') continue;
    const cosine = Math.cos(landmark.rotationY);
    const sine = Math.sin(landmark.rotationY);
    const deltaX = x - landmark.x;
    const deltaZ = z - landmark.z;
    const localX = deltaX * cosine - deltaZ * sine;
    const localZ = deltaX * sine + deltaZ * cosine;
    normalizedDistance = Math.min(normalizedDistance, Math.hypot(
      localX / Math.max(0.001, landmark.radiusX),
      localZ / Math.max(0.001, landmark.radiusZ),
    ));
  }
  return { normalizedDistance };
}

function tileRotation(
  paths: readonly OrchardPath[],
  x: number,
  z: number,
  column: number,
  row: number,
): number {
  let nearestDistance = Number.POSITIVE_INFINITY;
  let direction = 0;
  for (const path of paths) {
    for (let index = 1; index < path.points.length; index += 1) {
      const start = path.points[index - 1];
      const end = path.points[index];
      const distance = distanceToSegment({ x, z }, start, end);
      if (distance >= nearestDistance) continue;
      nearestDistance = distance;
      direction = Math.atan2(end.x - start.x, end.z - start.z);
    }
  }
  if (!Number.isFinite(nearestDistance)) return stableRoll(column, row, 17) * Math.PI * 2;
  const step = Math.PI / 3;
  return Math.round(direction / step) * step;
}

function nearestPathDistance(
  paths: readonly OrchardPath[],
  x: number,
  z: number,
): number {
  let minimum = Number.POSITIVE_INFINITY;
  for (const path of paths) {
    for (let index = 1; index < path.points.length; index += 1) {
      minimum = Math.min(minimum, distanceToSegment({ x, z }, path.points[index - 1], path.points[index]));
    }
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

function stableRoll(column: number, row: number, seed: number): number {
  let value = (column * 73856093) ^ (row * 19349663) ^ seed;
  value = Math.imul(value ^ (value >>> 16), 2246822519);
  value = Math.imul(value ^ (value >>> 13), 3266489917);
  return ((value ^ (value >>> 16)) >>> 0) / 0x100000000;
}
