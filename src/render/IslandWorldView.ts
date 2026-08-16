import * as THREE from 'three';
import {
  treeColliderRadius,
  type OrchardIslandBridge,
  type OrchardIslandLayout,
  type OrchardIslandRegion,
  type OrchardIslandRouteBlock,
  type OrchardLandmark,
  type OrchardMap,
  type OrchardPath,
} from '../game/maps/OrchardMap';
import { createIslandMaterials, type IslandMaterials } from './IslandMaterials';
import { createIslandRegionPropVisual } from './IslandRegionPropKit';

type WaveStrip = {
  mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  baseScale: number;
  phase: number;
};

type FlowerHeadMotion = {
  mesh: THREE.InstancedMesh;
  entries: Array<{
    x: number;
    z: number;
    baseY: number;
    baseRotationY: number;
    phase: number;
  }>;
};

type AmbientObjectMotion = {
  object: THREE.Object3D;
  baseRotationX: number;
  baseRotationZ: number;
  phase: number;
};

type ContactShadowPlacement = {
  x: number;
  y: number;
  z: number;
  sizeX: number;
  sizeZ: number;
};

type RectBlockDetail = {
  x: number;
  y: number;
  z: number;
  sizeX: number;
  sizeY: number;
  sizeZ: number;
};

export type IslandWorldVisual = {
  root: THREE.Group;
  tileInstances: number;
  propInstances: number;
  meshes: number;
  triangles: number;
  materials: number;
  textures: number;
  waterSegments: number;
  waterCollisionBlocks: number;
  bridges: number;
  waterfalls: number;
  regionPropClusters: number;
  regionPropInstances: number;
  regionPropInstancedMeshes: number;
  contactShadowInstances: number;
  ambientMotionGroups: number;
  readonly ambientMotionAmplitude: number;
  update(time: number, reducedMotion: boolean): void;
};

type WorldStats = {
  meshes: number;
  triangles: number;
  materials: number;
  textures: number;
};

const WATERFALL_OUTLETS = [
  { id: 'west', side: -1, x: -34.95, z: -5.8 },
  { id: 'east', side: 1, x: 34.95, z: -7.2 },
] as const;

export function createIslandWorldVisual(map: OrchardMap): IslandWorldVisual {
  const layout = map.islandLayout;
  if (!layout) throw new Error('Island world requires a v5 islandLayout.');
  const root = new THREE.Group();
  const materials = createIslandMaterials();
  const waves: WaveStrip[] = [];
  const flowerMotions: FlowerHeadMotion[] = [];
  const objectMotions: AmbientObjectMotion[] = [];
  const motionMatrix = new THREE.Object3D();
  let ambientMotionAmplitude = 0;
  let propInstances = 0;

  root.name = 'sweet-orchard-island-world';
  root.add(createOcean(materials, waves));
  root.add(createIslandBody(layout, materials));
  root.add(createIslandRegionPatches(layout.regions, materials));
  root.add(createNorthTerrace(materials));
  root.add(createHouseTerrace(materials));
  root.add(createTerrainPatches(map, materials));
  root.add(createPaths(map.paths, materials));
  const contactShadows = createContactShadows(map, materials);
  propInstances += contactShadows.instances;
  root.add(contactShadows.root);
  const waterway = createWaterway(layout, materials, waves);
  propInstances += waterway.userData.propInstances as number;
  root.add(waterway);
  root.add(createIslandEditableLandmarks(map.landmarks, materials));

  const orchard = createOrchardDetails(materials);
  propInstances += orchard.userData.propInstances as number;
  root.add(orchard);

  const beach = createBeachDetails(materials, objectMotions);
  propInstances += beach.userData.propInstances as number;
  root.add(beach);

  const garden = createGardenDetails(materials, flowerMotions);
  propInstances += garden.userData.propInstances as number;
  root.add(garden);

  const coast = createCoastalDetails(materials);
  propInstances += coast.userData.propInstances as number;
  root.add(coast);

  const routeBlocks = createRouteBlocks(layout.routeBlocks, materials);
  propInstances += routeBlocks.userData.propInstances as number;
  root.add(routeBlocks);

  const regionProps = createIslandRegionPropVisual(materials, layout.regions);
  propInstances += regionProps.propInstances;
  root.add(regionProps.root);

  root.add(createPlazaDetails(materials));
  const stats = measureWorld(root);

  return {
    root,
    tileInstances: 3,
    propInstances,
    waterSegments: layout.waterSegments.length,
    waterCollisionBlocks: layout.waterBlocks.length,
    bridges: layout.bridges.length,
    waterfalls: WATERFALL_OUTLETS.length,
    regionPropClusters: regionProps.clusters,
    regionPropInstances: regionProps.propInstances,
    regionPropInstancedMeshes: regionProps.instancedMeshes,
    contactShadowInstances: contactShadows.instances,
    ambientMotionGroups: waves.length + flowerMotions.length + objectMotions.length,
    get ambientMotionAmplitude(): number {
      return ambientMotionAmplitude;
    },
    ...stats,
    update(time: number, reducedMotion: boolean): void {
      ambientMotionAmplitude = reducedMotion ? 0 : Math.sin(time * 0.85);
      for (const wave of waves) {
        const motion = reducedMotion ? 0 : Math.sin(time * 0.52 + wave.phase);
        const scale = wave.baseScale + motion * 0.018;
        wave.mesh.scale.set(scale, scale * 0.76, 1);
        wave.mesh.material.opacity = 0.2 + (motion + 1) * 0.065;
      }
      updateFlowerMotions(flowerMotions, time, reducedMotion, motionMatrix);
      for (const motion of objectMotions) {
        const sway = reducedMotion ? 0 : Math.sin(time * 0.72 + motion.phase);
        motion.object.rotation.x = motion.baseRotationX + sway * 0.018;
        motion.object.rotation.z = motion.baseRotationZ + sway * 0.026;
      }
    },
  };
}

function createContactShadows(
  map: OrchardMap,
  materials: IslandMaterials,
): { root: THREE.Group; instances: number } {
  const placements: ContactShadowPlacement[] = map.trees
    .filter((tree) => tree.variant !== 'stump')
    .map((tree) => {
      const radius = treeColliderRadius(tree);
      return {
        x: tree.x + 0.16,
        y: 0.052,
        z: tree.z + 0.12,
        sizeX: radius * 1.72,
        sizeZ: radius * 1.08,
      };
    });
  placements.push(
    { x: -24.2, y: 0.69, z: -21.15, sizeX: 1.85, sizeZ: 0.72 },
    { x: -12.6, y: 0.69, z: -21.05, sizeX: 1.85, sizeZ: 0.72 },
    { x: -29, y: 0.052, z: 14.2, sizeX: 1.25, sizeZ: 0.72 },
  );

  const root = new THREE.Group();
  root.name = 'island-instanced-contact-shadows';
  const shadows = new THREE.InstancedMesh(
    new THREE.CircleGeometry(1, 24),
    materials.groundContact,
    placements.length,
  );
  const matrix = new THREE.Object3D();
  placements.forEach((placement, index) => {
    setInstanceTransform(
      shadows,
      index,
      matrix,
      [placement.x, placement.y, placement.z],
      [placement.sizeX, placement.sizeZ, 1],
      [-Math.PI / 2, 0, 0],
    );
  });
  shadows.name = 'island-contact-shadow-ellipses';
  shadows.renderOrder = 1;
  shadows.instanceMatrix.needsUpdate = true;
  shadows.computeBoundingSphere();
  root.add(shadows);
  return { root, instances: placements.length };
}

function createOcean(materials: IslandMaterials, waves: WaveStrip[]): THREE.Group {
  const group = new THREE.Group();
  group.name = 'island-ocean';

  const ocean = new THREE.Mesh(new THREE.PlaneGeometry(126, 112), materials.water);
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.y = -2.55;
  ocean.receiveShadow = true;
  group.add(ocean);

  const ringGeometry = new THREE.RingGeometry(33, 34, 64);
  const waveStripCount = window.matchMedia('(max-width: 600px)').matches ? 0 : 3;
  for (let index = 0; index < waveStripCount; index += 1) {
    const material = materials.waterLight.clone();
    material.opacity = 0.22 + index * 0.035;
    const strip = new THREE.Mesh(ringGeometry, material);
    strip.name = `island-foam-ring-${index + 1}`;
    strip.rotation.x = -Math.PI / 2;
    strip.rotation.z = index * 0.16;
    strip.position.set(index === 1 ? 0.7 : -0.5, -2.45 + index * 0.015, 0.5);
    const baseScale = 1 + index * 0.105;
    strip.scale.set(baseScale, baseScale * 0.76, 1);
    waves.push({ mesh: strip, baseScale, phase: index * 2.1 });
    group.add(strip);
  }
  return group;
}

function createWaterway(
  layout: OrchardIslandLayout,
  materials: IslandMaterials,
  waves: WaveStrip[],
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'island-stepped-waterway-and-bridges';
  const blockGeometry = new THREE.BoxGeometry(1, 1, 1);
  const bankMesh = new THREE.InstancedMesh(
    blockGeometry,
    materials.cliffDark,
    layout.waterSegments.length,
  );
  const waterMesh = new THREE.InstancedMesh(
    blockGeometry,
    materials.water,
    layout.waterSegments.length,
  );
  const foamMesh = new THREE.InstancedMesh(
    blockGeometry,
    materials.waterLight,
    layout.waterSegments.length * 2,
  );
  const matrix = new THREE.Object3D();

  layout.waterSegments.forEach((segment, index) => {
    setInstanceTransform(
      bankMesh,
      index,
      matrix,
      [segment.x, 0.035, segment.z],
      [segment.sizeX + 0.5, 0.12, segment.sizeZ + 0.5],
    );
    setInstanceTransform(
      waterMesh,
      index,
      matrix,
      [segment.x, 0.105, segment.z],
      [segment.sizeX, 0.08, segment.sizeZ],
    );
    for (const side of [-1, 1]) {
      setInstanceTransform(
        foamMesh,
        index * 2 + (side > 0 ? 1 : 0),
        matrix,
        [segment.x, 0.155, segment.z + side * (segment.sizeZ / 2 - 0.12)],
        [segment.sizeX - 0.25, 0.025, 0.18],
      );
    }
  });
  bankMesh.name = 'island-waterway-dark-rectangular-banks';
  waterMesh.name = 'island-waterway-blue-rectangular-water';
  foamMesh.name = 'island-waterway-light-bank-lines';
  bankMesh.receiveShadow = true;
  waterMesh.receiveShadow = true;
  bankMesh.instanceMatrix.needsUpdate = true;
  waterMesh.instanceMatrix.needsUpdate = true;
  foamMesh.instanceMatrix.needsUpdate = true;
  group.add(bankMesh, waterMesh, foamMesh);

  const bridges = createWaterwayBridges(layout.bridges, materials, blockGeometry, matrix);
  const waterfalls = createWaterfallOutlets(materials, blockGeometry, matrix, waves);
  group.add(bridges, waterfalls);
  group.userData.propInstances =
    layout.waterSegments.length * 4 +
    (bridges.userData.propInstances as number) +
    (waterfalls.userData.propInstances as number);
  return group;
}

function createWaterfallOutlets(
  materials: IslandMaterials,
  blockGeometry: THREE.BoxGeometry,
  matrix: THREE.Object3D,
  waves: WaveStrip[],
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'island-waterway-coastal-waterfalls';
  const curtains = new THREE.InstancedMesh(
    blockGeometry,
    materials.water,
    WATERFALL_OUTLETS.length,
  );
  const waterfallFoamMaterial = materials.waterLight.clone();
  waterfallFoamMaterial.opacity = 0.62;
  const flowLines = new THREE.InstancedMesh(
    blockGeometry,
    waterfallFoamMaterial,
    WATERFALL_OUTLETS.length * 3,
  );
  const lips = new THREE.InstancedMesh(
    blockGeometry,
    waterfallFoamMaterial,
    WATERFALL_OUTLETS.length,
  );
  const splashGeometry = new THREE.RingGeometry(0.58, 1.28, 28);

  WATERFALL_OUTLETS.forEach((outlet, outletIndex) => {
    const rotationZ = -outlet.side * 0.75;
    const cascadeX = outlet.x + outlet.side * 0.9;
    setInstanceTransform(
      curtains,
      outletIndex,
      matrix,
      [cascadeX, -1.25, outlet.z],
      [3.45, 0.16, 3.08],
      [0, 0, rotationZ],
    );
    setInstanceTransform(
      lips,
      outletIndex,
      matrix,
      [outlet.side * 34.62, 0.17, outlet.z],
      [0.68, 0.08, 3.28],
    );
    for (let lineIndex = 0; lineIndex < 3; lineIndex += 1) {
      setInstanceTransform(
        flowLines,
        outletIndex * 3 + lineIndex,
        matrix,
        [cascadeX, -1.14, outlet.z + (lineIndex - 1) * 0.88],
        [3.04 - Math.abs(lineIndex - 1) * 0.18, 0.035, 0.34],
        [0, 0, rotationZ],
      );
    }

    const splashMaterial = waterfallFoamMaterial.clone();
    splashMaterial.opacity = 0.3;
    const splash = new THREE.Mesh(splashGeometry, splashMaterial);
    splash.name = `island-waterfall-${outlet.id}-splash`;
    splash.rotation.x = -Math.PI / 2;
    splash.position.set(outlet.side * 37, -2.38, outlet.z);
    waves.push({ mesh: splash, baseScale: 1, phase: outletIndex * Math.PI + 0.7 });
    group.add(splash);
  });

  curtains.name = 'island-waterfall-sloped-cascade-sheets';
  flowLines.name = 'island-waterfall-flow-lines';
  lips.name = 'island-waterfall-foam-lips';
  curtains.receiveShadow = true;
  curtains.instanceMatrix.needsUpdate = true;
  flowLines.instanceMatrix.needsUpdate = true;
  lips.instanceMatrix.needsUpdate = true;
  group.add(curtains, flowLines, lips);
  group.userData.propInstances =
    curtains.count + flowLines.count + lips.count + WATERFALL_OUTLETS.length;
  return group;
}

function createWaterwayBridges(
  bridges: readonly OrchardIslandBridge[],
  materials: IslandMaterials,
  blockGeometry: THREE.BoxGeometry,
  matrix: THREE.Object3D,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'island-traversable-double-bridges';
  const plankCountPerBridge = 10;
  const plankMesh = new THREE.InstancedMesh(
    blockGeometry,
    materials.wood,
    bridges.length * plankCountPerBridge,
  );
  const supportMesh = new THREE.InstancedMesh(
    blockGeometry,
    materials.woodDark,
    bridges.length * 2,
  );

  bridges.forEach((bridge, bridgeIndex) => {
    appendBridgePlanks(plankMesh, bridge, bridgeIndex, plankCountPerBridge, matrix);
    for (const side of [-1, 1]) {
      setInstanceTransform(
        supportMesh,
        bridgeIndex * 2 + (side > 0 ? 1 : 0),
        matrix,
        [bridge.x + side * (bridge.width / 2 - 0.24), 0.205, bridge.z],
        [0.28, 0.16, bridge.depth],
      );
    }
  });
  plankMesh.name = 'island-bridge-wooden-planks';
  supportMesh.name = 'island-bridge-dark-support-beams';
  plankMesh.castShadow = true;
  plankMesh.receiveShadow = true;
  supportMesh.castShadow = true;
  plankMesh.instanceMatrix.needsUpdate = true;
  supportMesh.instanceMatrix.needsUpdate = true;
  group.add(supportMesh, plankMesh);
  group.userData.propInstances = plankMesh.count + supportMesh.count;
  return group;
}

function appendBridgePlanks(
  plankMesh: THREE.InstancedMesh,
  bridge: OrchardIslandBridge,
  bridgeIndex: number,
  plankCount: number,
  matrix: THREE.Object3D,
): void {
  const plankDepth = bridge.depth / plankCount * 0.84;
  for (let index = 0; index < plankCount; index += 1) {
    const offset = (index + 0.5) / plankCount - 0.5;
    setInstanceTransform(
      plankMesh,
      bridgeIndex * plankCount + index,
      matrix,
      [bridge.x, 0.32 + (index % 2) * 0.018, bridge.z + offset * bridge.depth],
      [bridge.width - 0.18, 0.16, plankDepth],
    );
  }
}

function createIslandBody(layout: OrchardIslandLayout, materials: IslandMaterials): THREE.Mesh {
  const outline = layout.outline.map((point) => [point.x, point.z] as const);
  const geometry = extrudePolygon(outline, 2.7, 0.75);
  const island = new THREE.Mesh(geometry, [materials.grass, materials.cliff]);
  island.name = 'island-stepped-main-body';
  island.rotation.x = Math.PI / 2;
  island.position.y = -0.38;
  island.castShadow = true;
  island.receiveShadow = true;
  return island;
}

function createNorthTerrace(materials: IslandMaterials): THREE.Mesh {
  const outline: ReadonlyArray<readonly [number, number]> = [
    [-30.2, -23.3],
    [-17, -24.2],
    [-3, -23.4],
    [-2.2, -19.3],
    [-10.5, -18.7],
    [-21, -19.2],
    [-29.8, -20],
  ];
  const terrace = new THREE.Mesh(
    extrudePolygon(outline, 0.72, 0.28),
    [materials.grassLight, materials.cliffDark],
  );
  terrace.name = 'island-north-visual-terrace';
  terrace.rotation.x = Math.PI / 2;
  terrace.position.y = 0.62;
  terrace.castShadow = true;
  terrace.receiveShadow = true;
  return terrace;
}

function createHouseTerrace(materials: IslandMaterials): THREE.Mesh {
  const outline: ReadonlyArray<readonly [number, number]> = [
    [15.3, -21.8],
    [20.7, -23.2],
    [27.7, -21.7],
    [28.4, -14.3],
    [24.5, -13.3],
    [17, -14],
  ];
  const terrace = new THREE.Mesh(
    extrudePolygon(outline, 0.66, 0.25),
    [materials.grassLight, materials.cliffDark],
  );
  terrace.name = 'island-house-visual-terrace';
  terrace.rotation.x = Math.PI / 2;
  terrace.position.y = 0.56;
  terrace.castShadow = true;
  terrace.receiveShadow = true;
  return terrace;
}

function createIslandRegionPatches(
  regions: readonly OrchardIslandRegion[],
  materials: IslandMaterials,
): THREE.Group {
  const group = new THREE.Group();
  const geometry = new THREE.CircleGeometry(1, 48);
  group.name = 'island-v5-semantic-region-patches';
  for (const [index, region] of regions.entries()) {
    const material = region.kind === 'plaza'
      ? materials.sandLight
      : region.kind === 'beach'
        ? materials.sand
        : region.kind === 'orchard'
          ? materials.grassDark
          : region.kind === 'garden'
            ? materials.grassPatch
            : materials.grassLight;
    const patch = new THREE.Mesh(geometry, material);
    patch.name = `island-region-patch-${region.id}`;
    patch.rotation.x = -Math.PI / 2;
    patch.rotation.z = -region.rotationY;
    patch.position.set(region.x, 0.008 + index * 0.0002, region.z);
    patch.scale.set(region.radiusX, region.radiusZ, 1);
    patch.receiveShadow = true;
    patch.userData.regionId = region.id;
    patch.userData.regionKind = region.kind;
    group.add(patch);
  }
  group.userData.regionIds = regions.map((region) => region.id);
  return group;
}

function createTerrainPatches(map: OrchardMap, materials: IslandMaterials): THREE.Group {
  const group = new THREE.Group();
  group.name = 'island-authored-ground-patches';
  for (const zone of map.terrainZones) {
    const patch = new THREE.Mesh(new THREE.CircleGeometry(1, 48), materials.grassPatch);
    patch.name = `island-zone-${zone.kind}`;
    patch.rotation.x = -Math.PI / 2;
    patch.rotation.z = -zone.rotationY;
    patch.position.set(zone.x, 0.025, zone.z);
    patch.scale.set(zone.radiusX, zone.radiusZ, 1);
    patch.receiveShadow = true;
    group.add(patch);
  }
  return group;
}

function createPaths(paths: readonly OrchardPath[], materials: IslandMaterials): THREE.Group {
  const group = new THREE.Group();
  group.name = 'island-sand-path-network';
  const capGeometry = new THREE.CylinderGeometry(1, 1, 0.075, 28);
  const caps: Array<{ x: number; z: number; radius: number }> = [];
  const segments: Array<{
    x: number;
    z: number;
    length: number;
    width: number;
    rotationY: number;
  }> = [];

  for (const path of paths) {
    path.points.forEach((point) => caps.push({ x: point.x, z: point.z, radius: path.width / 2 }));
    for (let index = 1; index < path.points.length; index += 1) {
      const start = path.points[index - 1];
      const end = path.points[index];
      const dx = end.x - start.x;
      const dz = end.z - start.z;
      const length = Math.hypot(dx, dz);
      segments.push({
        x: (start.x + end.x) / 2,
        z: (start.z + end.z) / 2,
        length,
        width: path.width,
        rotationY: -Math.atan2(dz, dx),
      });
    }
  }

  const matrix = new THREE.Object3D();
  const segmentMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 0.075, 1),
    materials.sand,
    segments.length,
  );
  segments.forEach((segment, index) => {
    setInstanceTransform(
      segmentMesh,
      index,
      matrix,
      [segment.x, 0.07, segment.z],
      [segment.length, 1, segment.width],
      [0, segment.rotationY, 0],
    );
  });
  segmentMesh.name = 'island-path-segments';
  segmentMesh.receiveShadow = true;
  segmentMesh.instanceMatrix.needsUpdate = true;

  const capMesh = new THREE.InstancedMesh(capGeometry, materials.sand, caps.length);
  caps.forEach((cap, index) => {
    setInstanceTransform(
      capMesh,
      index,
      matrix,
      [cap.x, 0.07, cap.z],
      [cap.radius, 1, cap.radius],
    );
  });
  capMesh.name = 'island-path-rounded-caps';
  capMesh.receiveShadow = true;
  capMesh.instanceMatrix.needsUpdate = true;
  group.add(segmentMesh, capMesh);
  return group;
}

function createIslandEditableLandmarks(
  landmarks: readonly OrchardLandmark[],
  materials: IslandMaterials,
): THREE.Group {
  const group = new THREE.Group();
  const renderedIds: string[] = [];
  group.name = 'island-editable-landmark-visuals';
  for (const landmark of landmarks) {
    if (landmark.kind === 'pond') {
      group.add(createPond(materials, landmark));
      renderedIds.push(landmark.id);
    } else if (landmark.asset) {
      group.add(createCottage(materials, landmark));
      renderedIds.push(landmark.id);
    }
  }
  group.userData.landmarkIds = renderedIds;
  return group;
}

function createPond(
  materials: IslandMaterials,
  landmark: OrchardLandmark,
): THREE.Group {
  const group = new THREE.Group();
  group.name = `island-pond-${landmark.id}`;
  group.position.set(landmark.x, 0, landmark.z);
  group.rotation.y = landmark.rotationY;
  group.userData.landmarkId = landmark.id;
  group.userData.landmarkKind = landmark.kind;

  const bank = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.16, 40), materials.stone);
  bank.scale.set(landmark.radiusX + 0.5, 1, landmark.radiusZ + 0.5);
  bank.position.y = 0.06;
  bank.receiveShadow = true;

  const water = new THREE.Mesh(new THREE.CircleGeometry(1, 48), materials.water);
  water.rotation.x = -Math.PI / 2;
  water.scale.set(
    Math.max(0.5, landmark.radiusX - 0.05),
    Math.max(0.5, landmark.radiusZ - 0.05),
    1,
  );
  water.position.y = 0.15;

  const highlight = new THREE.Mesh(
    new THREE.RingGeometry(0.72, 0.82, 48),
    materials.waterLight,
  );
  highlight.rotation.x = -Math.PI / 2;
  highlight.scale.set(
    Math.max(0.4, landmark.radiusX - 0.4),
    Math.max(0.4, landmark.radiusZ - 0.5),
    1,
  );
  highlight.position.y = 0.17;
  group.add(bank, water, highlight, createFootbridge(materials));
  return group;
}

function createFootbridge(materials: IslandMaterials): THREE.Group {
  const bridge = new THREE.Group();
  bridge.name = 'island-pond-footbridge';
  bridge.position.set(0, 0.32, 3.05);
  for (let index = -3; index <= 3; index += 1) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.12, 1.8), materials.wood);
    plank.position.set(index * 0.66, Math.cos(index * 0.38) * 0.13, 0);
    plank.rotation.z = -index * 0.018;
    plank.castShadow = true;
    bridge.add(plank);
  }
  return bridge;
}

function createCottage(
  materials: IslandMaterials,
  landmark: OrchardLandmark,
): THREE.Group {
  const house = new THREE.Group();
  house.name = `island-cottage-${landmark.id}`;
  house.position.set(
    landmark.x,
    landmark.id === 'island-main-house' ? 0.62 : 0.06,
    landmark.z,
  );
  house.rotation.y = landmark.rotationY;
  house.scale.set(
    landmark.radiusX / 5.2,
    Math.min(landmark.radiusX / 5.2, landmark.radiusZ / 3.7),
    landmark.radiusZ / 3.7,
  );
  house.userData.landmarkId = landmark.id;
  house.userData.landmarkKind = landmark.kind;
  house.userData.asset = landmark.asset;

  const foundation = meshBox([9.2, 0.45, 6.1], materials.stone, [0, 0.22, 0]);
  const walls = meshBox([8.4, 3.8, 5.4], materials.plaster, [0, 2.2, 0]);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(5.9, 2.8, 4), materials.roof);
  roof.name = 'island-cottage-roof';
  roof.position.y = 5.25;
  roof.rotation.y = Math.PI / 4;
  roof.scale.z = 0.78;
  roof.castShadow = true;

  const door = meshBox([1.25, 2.35, 0.2], materials.woodDark, [0.6, 1.45, 2.78]);
  const awning = meshBox([2.5, 0.18, 1.25], materials.roofLight, [0.6, 3.05, 3.25]);
  awning.rotation.x = -0.18;
  const leftWindow = createWindow(materials, -2.25, 2.15, 2.78);
  const rightWindow = createWindow(materials, 2.75, 2.15, 2.78);
  const chimney = meshBox([0.85, 2.3, 0.85], materials.cliffDark, [-2.7, 5.25, -0.8]);

  const steps = new THREE.Group();
  for (let index = 0; index < 3; index += 1) {
    steps.add(meshBox(
      [2.7 + index * 0.45, 0.18, 0.72],
      materials.stone,
      [0.6, 0.33 - index * 0.13, 3.2 + index * 0.56],
    ));
  }
  house.add(foundation, walls, roof, door, awning, leftWindow, rightWindow, chimney, steps);
  markShadows(house);
  return house;
}

function createWindow(
  materials: IslandMaterials,
  x: number,
  y: number,
  z: number,
): THREE.Group {
  const window = new THREE.Group();
  const pane = meshBox([1.45, 1.35, 0.18], materials.window, [x, y, z]);
  const horizontal = meshBox([1.6, 0.13, 0.25], materials.woodDark, [x, y, z + 0.08]);
  const vertical = meshBox([0.13, 1.5, 0.25], materials.woodDark, [x, y, z + 0.08]);
  window.add(pane, horizontal, vertical);
  return window;
}

function createOrchardDetails(materials: IslandMaterials): THREE.Group {
  const group = new THREE.Group();
  group.name = 'island-orchard-details';
  let propInstances = 0;

  for (const z of [-16.8, -9.2]) {
    for (let x = -30; x <= -12; x += 4.5) {
      const patch = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.45), materials.grassDark);
      patch.rotation.x = -Math.PI / 2;
      patch.position.set(x, 0.04, z);
      group.add(patch);
      propInstances += 1;
    }
  }

  const crates = new THREE.Group();
  crates.position.set(-10.2, 0, -2.7);
  crates.add(
    meshBox([1.5, 0.9, 1.25], materials.wood, [0, 0.45, 0]),
    meshBox([1.2, 0.75, 1.05], materials.woodDark, [1.25, 0.38, 0.25]),
  );
  group.add(crates);
  propInstances += 2;
  group.userData.propInstances = propInstances;
  return group;
}

function createBeachDetails(
  materials: IslandMaterials,
  objectMotions: AmbientObjectMotion[],
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'island-beach-details';
  let propInstances = 0;

  const dock = new THREE.Group();
  dock.name = 'island-seaside-dock';
  dock.position.set(-24, -0.02, 22.5);
  for (let index = 0; index < 6; index += 1) {
    dock.add(meshBox([4.5, 0.18, 1.05], materials.wood, [0, 0.15, index * 0.92]));
    propInstances += 1;
  }
  for (const x of [-1.8, 1.8]) {
    for (const z of [0, 4.6]) {
      dock.add(meshBox([0.22, 1.5, 0.22], materials.woodDark, [x, -0.45, z]));
      propInstances += 1;
    }
  }
  group.add(dock);

  const parasol = new THREE.Group();
  parasol.position.set(-29, 0, 14.2);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 3.1, 8), materials.woodDark);
  pole.position.y = 1.55;
  const canopy = new THREE.Mesh(new THREE.ConeGeometry(2.35, 0.75, 10), materials.roofLight);
  canopy.position.y = 3.15;
  objectMotions.push({
    object: canopy,
    baseRotationX: canopy.rotation.x,
    baseRotationZ: canopy.rotation.z,
    phase: 1.7,
  });
  parasol.add(pole, canopy);
  markShadows(parasol);
  group.add(parasol);
  propInstances += 2;
  group.userData.propInstances = propInstances;
  return group;
}

function createGardenDetails(
  materials: IslandMaterials,
  flowerMotions: FlowerHeadMotion[],
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'island-flower-garden-details';
  if (window.matchMedia('(max-width: 600px)').matches) {
    group.userData.propInstances = 0;
    return group;
  }
  const positions: Array<readonly [number, number]> = [];
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 7; column += 1) {
      positions.push([8 + column * 3.25 + (row % 2) * 0.55, 7 + row * 3.4]);
    }
  }

  const stems = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.035, 0.05, 0.55, 5),
    materials.foliage,
    positions.length,
  );
  const flowerMaterials = [materials.flowerPink, materials.flowerYellow, materials.flowerWhite];
  const flowerMeshes = flowerMaterials.map((material) => new THREE.InstancedMesh(
    new THREE.OctahedronGeometry(0.18, 0),
    material,
    Math.ceil(positions.length / flowerMaterials.length),
  ));
  const flowerCounts = flowerMaterials.map(() => 0);
  const flowerMotionEntries: FlowerHeadMotion['entries'][] = flowerMaterials.map(() => []);
  const matrix = new THREE.Object3D();
  positions.forEach(([x, z], index) => {
    matrix.position.set(x, 0.31, z);
    matrix.scale.setScalar(1);
    matrix.updateMatrix();
    stems.setMatrixAt(index, matrix.matrix);
    const materialIndex = index % flowerMaterials.length;
    const flowerIndex = flowerCounts[materialIndex];
    matrix.position.y = 0.67 + (index % 4) * 0.025;
    matrix.rotation.y = index * 0.7;
    matrix.updateMatrix();
    flowerMeshes[materialIndex].setMatrixAt(flowerIndex, matrix.matrix);
    flowerMotionEntries[materialIndex].push({
      x,
      z,
      baseY: matrix.position.y,
      baseRotationY: matrix.rotation.y,
      phase: index * 0.63,
    });
    flowerCounts[materialIndex] += 1;
  });
  stems.instanceMatrix.needsUpdate = true;
  stems.name = 'island-flower-stems';
  group.add(stems);
  flowerMeshes.forEach((mesh, index) => {
    mesh.count = flowerCounts[index];
    mesh.instanceMatrix.needsUpdate = true;
    mesh.name = `island-flower-heads-${index + 1}`;
    mesh.castShadow = true;
    group.add(mesh);
    flowerMotions.push({ mesh, entries: flowerMotionEntries[index] });
  });
  group.userData.propInstances = positions.length * 2;
  return group;
}

function updateFlowerMotions(
  motions: readonly FlowerHeadMotion[],
  time: number,
  reducedMotion: boolean,
  matrix: THREE.Object3D,
): void {
  for (const motion of motions) {
    motion.entries.forEach((entry, index) => {
      const sway = reducedMotion ? 0 : Math.sin(time * 0.94 + entry.phase);
      matrix.position.set(entry.x, entry.baseY + sway * 0.026, entry.z);
      matrix.rotation.set(sway * 0.045, entry.baseRotationY + sway * 0.13, sway * 0.035);
      matrix.scale.set(1 + sway * 0.028, 1 - sway * 0.018, 1);
      matrix.updateMatrix();
      motion.mesh.setMatrixAt(index, matrix.matrix);
    });
    motion.mesh.instanceMatrix.needsUpdate = true;
  }
}

function createCoastalDetails(materials: IslandMaterials): THREE.Group {
  const group = new THREE.Group();
  group.name = 'island-coastal-rocks-and-shrubs';
  const rocks: Array<readonly [number, number, number]> = [
    [-33, -14, 1.2],
    [-34, 4, 0.9],
    [-31, 20, 1.35],
    [-8, 24, 0.85],
    [6, 24.5, 1.05],
    [25, 22, 1.3],
    [32, 14, 0.95],
    [33, -6, 1.15],
    [29, -20, 1.1],
  ];
  const rockMesh = new THREE.InstancedMesh(
    new THREE.DodecahedronGeometry(0.72, 0),
    materials.stone,
    rocks.length,
  );
  const shrubs: Array<readonly [number, number, number]> = [
    [-32, -5, 1.2],
    [-32, 8, 1.35],
    [-28, 20, 1.1],
    [-5, 23.5, 1.25],
    [12, 23.4, 1.15],
    [29, 18, 1.25],
    [31, 4, 1.1],
    [30, -11, 1.3],
  ];
  const shrubMesh = new THREE.InstancedMesh(
    new THREE.DodecahedronGeometry(0.86, 0),
    materials.foliage,
    shrubs.length,
  );
  const matrix = new THREE.Object3D();
  rocks.forEach(([x, z, scale], index) => {
    matrix.position.set(x, 0.42 * scale, z);
    matrix.rotation.set(index * 0.13, index * 0.67, index * 0.09);
    matrix.scale.set(scale, scale * 0.76, scale * 0.88);
    matrix.updateMatrix();
    rockMesh.setMatrixAt(index, matrix.matrix);
  });
  shrubs.forEach(([x, z, scale], index) => {
    matrix.position.set(x, 0.62 * scale, z);
    matrix.rotation.set(0, index * 0.9, 0);
    matrix.scale.set(scale * 1.2, scale * 0.8, scale);
    matrix.updateMatrix();
    shrubMesh.setMatrixAt(index, matrix.matrix);
  });
  rockMesh.instanceMatrix.needsUpdate = true;
  shrubMesh.instanceMatrix.needsUpdate = true;
  rockMesh.castShadow = true;
  shrubMesh.castShadow = true;
  group.add(rockMesh, shrubMesh);
  group.userData.propInstances = rocks.length + shrubs.length;
  return group;
}

function createRouteBlocks(
  routeBlocks: readonly OrchardIslandRouteBlock[],
  materials: IslandMaterials,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'island-route-defining-blocks';
  const blockGeometry = new THREE.BoxGeometry(1, 1, 1);
  const baseMesh = new THREE.InstancedMesh(
    blockGeometry,
    materials.cliff,
    routeBlocks.length,
  );
  const topMesh = new THREE.InstancedMesh(
    blockGeometry,
    materials.flowerWhite,
    routeBlocks.length,
  );
  const foliageParts: RectBlockDetail[] = [];
  const totemParts: Array<{
    x: number;
    y: number;
    z: number;
    scaleX: number;
    scaleY: number;
    scaleZ: number;
    color: THREE.ColorRepresentation;
  }> = [];
  const timberParts: RectBlockDetail[] = [];
  const matrix = new THREE.Object3D();

  routeBlocks.forEach((block, index) => {
    const height = routeBlockHeight(block);
    setInstanceTransform(
      baseMesh,
      index,
      matrix,
      [block.x, height / 2, block.z],
      [block.radiusX * 2, height, block.radiusZ * 2],
    );
    setInstanceTransform(
      topMesh,
      index,
      matrix,
      [block.x, height + 0.055, block.z],
      [block.radiusX * 2 - 0.26, 0.11, block.radiusZ * 2 - 0.26],
    );
    topMesh.setColorAt(index, routeBlockTopColor(block.kind));
    appendRouteBlockProps(block, height, foliageParts, totemParts, timberParts);
  });
  baseMesh.name = 'island-route-block-cliff-bases';
  topMesh.name = 'island-route-block-colored-tops';
  baseMesh.castShadow = true;
  baseMesh.receiveShadow = true;
  topMesh.receiveShadow = true;
  baseMesh.instanceMatrix.needsUpdate = true;
  topMesh.instanceMatrix.needsUpdate = true;
  if (topMesh.instanceColor) topMesh.instanceColor.needsUpdate = true;
  group.add(baseMesh, topMesh);

  if (foliageParts.length > 0) {
    const foliageBlocks = new THREE.InstancedMesh(
      blockGeometry,
      materials.foliage,
      foliageParts.length,
    );
    foliageParts.forEach((part, index) => {
      setInstanceTransform(
        foliageBlocks,
        index,
        matrix,
        [part.x, part.y, part.z],
        [part.sizeX, part.sizeY, part.sizeZ],
      );
    });
    foliageBlocks.name = 'island-route-block-rectangular-foliage';
    foliageBlocks.castShadow = true;
    foliageBlocks.instanceMatrix.needsUpdate = true;
    group.add(foliageBlocks);
  }

  if (totemParts.length > 0) {
    const totems = new THREE.InstancedMesh(blockGeometry, materials.flowerWhite, totemParts.length);
    totemParts.forEach((part, index) => {
      setInstanceTransform(
        totems,
        index,
        matrix,
        [part.x, part.y, part.z],
        [part.scaleX, part.scaleY, part.scaleZ],
        [0, index * 0.24, 0],
      );
      totems.setColorAt(index, new THREE.Color(part.color));
    });
    totems.name = 'island-route-block-totems';
    totems.castShadow = true;
    totems.instanceMatrix.needsUpdate = true;
    if (totems.instanceColor) totems.instanceColor.needsUpdate = true;
    group.add(totems);
  }

  if (timberParts.length > 0) {
    const timber = new THREE.InstancedMesh(
      blockGeometry,
      materials.wood,
      timberParts.length,
    );
    timberParts.forEach((part, index) => {
      setInstanceTransform(
        timber,
        index,
        matrix,
        [part.x, part.y, part.z],
        [part.sizeX, part.sizeY, part.sizeZ],
      );
    });
    timber.name = 'island-route-block-rectangular-timber';
    timber.castShadow = true;
    timber.instanceMatrix.needsUpdate = true;
    group.add(timber);
  }

  group.userData.propInstances =
    routeBlocks.length * 2 + foliageParts.length + totemParts.length + timberParts.length;
  return group;
}

function appendRouteBlockProps(
  block: OrchardIslandRouteBlock,
  height: number,
  foliageParts: RectBlockDetail[],
  totemParts: Array<{
    x: number;
    y: number;
    z: number;
    scaleX: number;
    scaleY: number;
    scaleZ: number;
    color: THREE.ColorRepresentation;
  }>,
  timberParts: RectBlockDetail[],
): void {
  if (block.kind === 'hedge') {
    foliageParts.push(
      {
        x: block.x,
        y: height + 0.42,
        z: block.z - block.radiusZ * 0.42,
        sizeX: block.radiusX * 1.65,
        sizeY: 0.72,
        sizeZ: 0.62,
      },
      {
        x: block.x,
        y: height + 0.42,
        z: block.z + block.radiusZ * 0.42,
        sizeX: block.radiusX * 1.65,
        sizeY: 0.72,
        sizeZ: 0.62,
      },
      {
        x: block.x + block.radiusX * 0.38,
        y: height + 0.47,
        z: block.z,
        sizeX: 0.7,
        sizeY: 0.82,
        sizeZ: block.radiusZ * 1.1,
      },
    );
    return;
  }

  if (block.kind === 'hill') {
    foliageParts.push(
      {
        x: block.x - block.radiusX * 0.12,
        y: height + 0.16,
        z: block.z,
        sizeX: block.radiusX * 1.42,
        sizeY: 0.3,
        sizeZ: block.radiusZ * 1.25,
      },
      {
        x: block.x + block.radiusX * 0.18,
        y: height + 0.37,
        z: block.z - block.radiusZ * 0.08,
        sizeX: block.radiusX * 0.92,
        sizeY: 0.28,
        sizeZ: block.radiusZ * 0.82,
      },
    );
    return;
  }

  if (block.kind === 'shrine') {
    const baseY = height + 0.12;
    totemParts.push(
      {
        x: block.x,
        y: baseY + 0.62,
        z: block.z,
        scaleX: 0.42,
        scaleY: 1.24,
        scaleZ: 0.42,
        color: '#7d4b32',
      },
      {
        x: block.x,
        y: baseY + 1.36,
        z: block.z,
        scaleX: 0.88,
        scaleY: 0.38,
        scaleZ: 0.72,
        color: '#de6e5d',
      },
      {
        x: block.x,
        y: baseY + 1.76,
        z: block.z,
        scaleX: 0.58,
        scaleY: 0.42,
        scaleZ: 0.58,
        color: '#f0d35f',
      },
    );
    return;
  }

  for (let index = -2; index <= 2; index += 1) {
    timberParts.push({
      x: block.x,
      y: height + 0.24 + Math.abs(index) * 0.035,
      z: block.z + index * 0.68,
      sizeX: Math.min(3.2, block.radiusX * 0.9),
      sizeY: 0.32,
      sizeZ: 0.42,
    });
  }
}

function routeBlockHeight(block: OrchardIslandRouteBlock): number {
  if (block.kind === 'hill') return 0.76;
  if (block.kind === 'shrine') return 0.24;
  return 0.4;
}

function routeBlockTopColor(kind: OrchardIslandRouteBlock['kind']): THREE.Color {
  switch (kind) {
    case 'hedge':
      return new THREE.Color('#78aa4e');
    case 'hill':
      return new THREE.Color('#9ac966');
    case 'shrine':
      return new THREE.Color('#e5c77f');
    case 'woodlot':
      return new THREE.Color('#9b6a48');
  }
}

function setInstanceTransform(
  mesh: THREE.InstancedMesh,
  index: number,
  matrix: THREE.Object3D,
  position: readonly [number, number, number],
  scale: readonly [number, number, number],
  rotation: readonly [number, number, number] = [0, 0, 0],
): void {
  matrix.position.set(...position);
  matrix.scale.set(...scale);
  matrix.rotation.set(...rotation);
  matrix.updateMatrix();
  mesh.setMatrixAt(index, matrix.matrix);
}

function createPlazaDetails(materials: IslandMaterials): THREE.Group {
  const group = new THREE.Group();
  group.name = 'island-central-plaza';
  const plaza = new THREE.Mesh(new THREE.CylinderGeometry(4.35, 4.35, 0.12, 40), materials.sandLight);
  plaza.position.set(0, 0.07, 3);
  plaza.receiveShadow = true;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(3.55, 0.1, 8, 40), materials.stone);
  ring.position.set(0, 0.17, 3);
  ring.rotation.x = Math.PI / 2;
  group.add(plaza, ring);
  return group;
}

function extrudePolygon(
  points: ReadonlyArray<readonly [number, number]>,
  depth: number,
  bevelSize: number,
): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  points.forEach(([x, z], index) => {
    if (index === 0) shape.moveTo(x, z);
    else shape.lineTo(x, z);
  });
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelSegments: 2,
    bevelSize,
    bevelThickness: Math.min(depth * 0.22, 0.38),
    curveSegments: 2,
  });
}

function meshBox(
  size: readonly [number, number, number],
  material: THREE.Material,
  position: readonly [number, number, number],
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function markShadows(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.castShadow = true;
    object.receiveShadow = true;
  });
}

function measureWorld(root: THREE.Object3D): WorldStats {
  let meshes = 0;
  let triangles = 0;
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    meshes += 1;
    const instanceCount = object instanceof THREE.InstancedMesh ? object.count : 1;
    const geometry = object.geometry;
    triangles += Math.round(
      ((geometry.index?.count ?? geometry.getAttribute('position')?.count ?? 0) / 3) * instanceCount,
    );
    const meshMaterials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of meshMaterials) {
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) textures.add(value);
      }
    }
  });
  return {
    meshes,
    triangles,
    materials: materials.size,
    textures: textures.size,
  };
}
