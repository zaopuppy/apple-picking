import * as THREE from 'three';
import {
  createNaturePackAppleVisual,
  loadNaturePackTreeVisuals,
} from '../assets/NaturePackAssets';
import { createMedievalHouseVisual } from '../assets/MedievalBuilderAssets';
import { createMedievalWorldVisual } from '../assets/MedievalWorldAssets';
import { GAME_CONFIG } from '../game/config';
import {
  resolveMedievalWorldMap,
  type MedievalWorldPreset,
} from '../game/maps/MedievalWorldExperiments';
import { ISLAND_APPLE_GROUPS, isIslandTourMap } from '../game/maps/IslandTourMap';
import type {
  KayKitTileShape,
  OrchardMap,
  OrchardTree,
  TreeVariant,
} from '../game/maps/OrchardMap';
import { deliveryZonesForMap } from '../game/maps/OrchardMap';
import type { AppleSnapshot, GameEvent, GameSnapshot, KidSnapshot } from '../game/types';
import { VfxSystem } from '../systems/VfxSystem';
import { disposeObject3D } from '../utils/dispose';
import {
  createAppleMaterial,
  createOrchardMaterials,
  ORCHARD_COLORS,
} from './OrchardMaterials';
import { createIslandWorldVisual, type IslandWorldVisual } from './IslandWorldView';
import {
  disposeImportedGuardView,
  loadImportedGuardView,
  syncImportedGuardView,
  type GuardRecoveryPhase,
  type ImportedGuardId,
  type ImportedGuardView,
} from './ImportedGuardView';
import {
  disposeImportedKidView,
  loadImportedKidView,
  syncImportedKidView,
  type ImportedKidView,
} from './ImportedKidView';
import { createWorldLandmarks, type HomesteadVisualSlot } from './WorldLandmarks';

type AppleTransition = {
  kind: 'pickup' | 'drop' | 'delivery';
  startedAt: number;
  duration: number;
  from: THREE.Vector3;
};

type AppleView = {
  root: THREE.Group;
  procedural: THREE.Group;
  imported: THREE.Group | null;
  materials: THREE.MeshStandardMaterial[];
  targetRing: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  baseRotation: number;
  transition: AppleTransition | null;
};

type DeliveryZoneVisual = {
  pulseRings: THREE.InstancedMesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  zones: ReadonlyArray<{ x: number; z: number }>;
};

const FIELD_GROUND_SIZE = Math.max(
  GAME_CONFIG.arenaHalfWidth * 2,
  GAME_CONFIG.arenaHalfDepth * 2,
) + 40;

export type EnvironmentAssetDiagnostics = {
  treeMode: 'loading' | 'imported' | 'procedural';
  fruitMode: 'loading' | 'imported' | 'procedural';
  externalRequested: boolean;
  treeVariants: number;
  treeInstances: number;
  stumpInstances: number;
  largeTreeInstances: number;
  treeTriangles: number;
  fruitInstances: number;
  fruitTriangles: number;
  mapId: string;
  mapName: string;
  paths: number;
  clearings: number;
  landmarks: number;
  terrainZones: number;
  deliveryZones: number;
  landmarkMode: 'loading' | 'imported' | 'procedural';
  importedHomesteads: number;
  landmarkMeshes: number;
  landmarkTriangles: number;
  landmarkAssetMeshes: number;
  landmarkAssetTriangles: number;
  landmarkAssetMaterials: number;
  landmarkAssetTextures: number;
  landmarkHouseBounds: {
    width: number;
    height: number;
    depth: number;
  } | null;
  landmarkLastFailure: string | null;
  worldMode: 'procedural' | 'loading' | 'medieval' | 'island';
  worldPreset: MedievalWorldPreset | null;
  worldTileInstances: number;
  worldPropInstances: number;
  worldMeshes: number;
  worldTriangles: number;
  worldMaterials: number;
  worldTextures: number;
  worldAssetRequests: number;
  worldCatalogAssets: number;
  worldTileShape: KayKitTileShape | null;
  worldLastFailure: string | null;
  groundMaterialMode: 'flat-color' | 'grass-texture';
  deliveryMarkerMode: 'ring' | 'parcel-sign';
  deliveryMarkerLabels: number;
  islandLayoutSource: 'none' | 'map-v5';
  islandOutlinePoints: number;
  islandRegions: number;
  waterSegments: number;
  waterCollisionBlocks: number;
  bridges: number;
  waterfalls: number;
  appleGroups: number;
  regionPropClusters: number;
  regionPropInstances: number;
  regionPropInstancedMeshes: number;
  natureMaterialProfile: 'source' | 'island-matte';
  visualScaleProfile: 'legacy' | 'island-toy-scale';
  contactShadowInstances: number;
  ambientMotionGroups: number;
  ambientMotionAmplitude: number;
  arenaWidth: number;
  arenaDepth: number;
  lastFailure: string | null;
};

export type CharacterAssetDiagnostics = {
  guard1Mode: 'loading' | 'imported' | 'failed';
  guard2Mode: 'loading' | 'imported' | 'failed';
  kidMode: 'loading' | 'imported' | 'failed';
  importedGuards: number;
  importedCharacters: number;
  meshes: number;
  triangles: number;
  materials: number;
  textures: number;
  animations: string[];
  kidAnimations: string[];
  currentAnimations: Record<ImportedGuardId | 'kid', string | null>;
  guardDetails: Record<ImportedGuardId, {
    recoveryPhase: GuardRecoveryPhase | null;
    posturePitch: number;
    height: number;
    animationPaused: boolean | null;
  } | null>;
  sockets: string[];
  kidSockets: string[];
  kidDetails: {
    backpackScaleZ: number;
    sweatDrops: number;
    postureLean: number;
    breathScaleY: number;
    animationPaused: boolean | null;
    headShakeAngle: number;
  } | null;
  lastFailure: string | null;
  lastFailures: Record<ImportedGuardId | 'kid', string | null>;
};

export class ArenaView {
  readonly root = new THREE.Group();

  private readonly materials = createOrchardMaterials();
  private readonly appleViews = new Map<number, AppleView>();
  private readonly pickingRing: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private readonly vfx: VfxSystem;
  private readonly matrixDummy = new THREE.Object3D();
  private readonly appleTarget = new THREE.Vector3();
  private readonly proceduralWorldVisuals = new THREE.Group();
  private readonly proceduralTreeVisuals = new THREE.Group();
  private readonly importedGuardViews = new Map<ImportedGuardId, ImportedGuardView>();
  private readonly islandWorld: boolean;
  private readonly worldPreset: MedievalWorldPreset | null;
  private islandWorldVisual: IslandWorldVisual | null = null;
  private deliveryZoneVisual: DeliveryZoneVisual | null = null;
  private importedKidView: ImportedKidView | null = null;
  private disposed = false;
  private environmentDiagnostics: EnvironmentAssetDiagnostics = {
    treeMode: 'procedural',
    fruitMode: 'procedural',
    externalRequested: false,
    treeVariants: 0,
    treeInstances: 0,
    stumpInstances: 0,
    largeTreeInstances: 0,
    treeTriangles: 0,
    fruitInstances: 0,
    fruitTriangles: 0,
    mapId: '',
    mapName: '',
    paths: 0,
    clearings: 0,
    landmarks: 0,
    terrainZones: 0,
    deliveryZones: 0,
    landmarkMode: 'procedural',
    importedHomesteads: 0,
    landmarkMeshes: 0,
    landmarkTriangles: 0,
    landmarkAssetMeshes: 0,
    landmarkAssetTriangles: 0,
    landmarkAssetMaterials: 0,
    landmarkAssetTextures: 0,
    landmarkHouseBounds: null,
    landmarkLastFailure: null,
    worldMode: 'procedural',
    worldPreset: null,
    worldTileInstances: 0,
    worldPropInstances: 0,
    worldMeshes: 0,
    worldTriangles: 0,
    worldMaterials: 0,
    worldTextures: 0,
    worldAssetRequests: 0,
    worldCatalogAssets: 0,
    worldTileShape: null,
    worldLastFailure: null,
    groundMaterialMode: 'flat-color',
    deliveryMarkerMode: 'ring',
    deliveryMarkerLabels: 0,
    islandLayoutSource: 'none',
    islandOutlinePoints: 0,
    islandRegions: 0,
    waterSegments: 0,
    waterCollisionBlocks: 0,
    bridges: 0,
    waterfalls: 0,
    appleGroups: 0,
    regionPropClusters: 0,
    regionPropInstances: 0,
    regionPropInstancedMeshes: 0,
    natureMaterialProfile: 'source',
    visualScaleProfile: 'legacy',
    contactShadowInstances: 0,
    ambientMotionGroups: 0,
    ambientMotionAmplitude: 0,
    arenaWidth: GAME_CONFIG.arenaHalfWidth * 2,
    arenaDepth: GAME_CONFIG.arenaHalfDepth * 2,
    lastFailure: null,
  };
  private characterDiagnostics: CharacterAssetDiagnostics = {
    guard1Mode: 'loading',
    guard2Mode: 'loading',
    kidMode: 'loading',
    importedGuards: 0,
    importedCharacters: 0,
    meshes: 0,
    triangles: 0,
    materials: 0,
    textures: 0,
    animations: [],
    kidAnimations: [],
    currentAnimations: { guard1: null, guard2: null, kid: null },
    guardDetails: { guard1: null, guard2: null },
    sockets: [],
    kidSockets: [],
    kidDetails: null,
    lastFailure: null,
    lastFailures: { guard1: null, guard2: null, kid: null },
  };
  constructor(scene: THREE.Scene, private readonly map: OrchardMap) {
    this.islandWorld = isIslandTourMap(map);
    this.worldPreset = this.islandWorld ? null : resolveMedievalWorldMap(map)?.preset ?? null;
    this.environmentDiagnostics = {
      ...this.environmentDiagnostics,
      treeInstances: map.trees.length,
      stumpInstances: map.trees.filter((tree) => tree.variant === 'stump').length,
      largeTreeInstances: map.trees.filter((tree) => tree.variant !== 'stump').length,
      fruitInstances: map.appleSpawns.length,
      mapId: map.id,
      mapName: map.name,
      paths: map.paths.length,
      clearings: map.clearings.length,
      landmarks: map.landmarks.length,
      terrainZones: map.terrainZones.length,
      deliveryZones: deliveryZonesForMap(map).length,
      worldPreset: this.worldPreset,
      visualScaleProfile: this.islandWorld ? 'island-toy-scale' : 'legacy',
    };
    this.createWorld();
    void this.installImportedGuard('guard1');
    void this.installImportedGuard('guard2');
    void this.installImportedKid();
    for (let id = 0; id < map.appleSpawns.length; id += 1) this.createApple(id);
    void this.installImportedApples();

    this.pickingRing = new THREE.Mesh(
      new THREE.RingGeometry(0.62, 0.75, 28),
      new THREE.MeshBasicMaterial({
        color: ORCHARD_COLORS.reward,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.82,
        depthWrite: false,
      }),
    );
    this.pickingRing.rotation.x = -Math.PI / 2;
    this.pickingRing.position.y = 0.042;
    this.pickingRing.visible = false;
    this.root.add(this.pickingRing);
    this.vfx = new VfxSystem(this.root);
    scene.add(this.root);
  }

  handleEvent(event: GameEvent, snapshot: GameSnapshot, time: number): void {
    if (event.type === 'restarted') {
      this.vfx.clear();
      for (const view of this.appleViews.values()) view.transition = null;
      return;
    }

    switch (event.type) {
      case 'picked': {
        const view = this.appleViews.get(event.appleId);
        if (!view) return;
        view.transition = {
          kind: 'pickup',
          startedAt: time,
          duration: 0.34,
          from: view.root.position.clone(),
        };
        this.vfx.emit('pickup', view.root.position.clone(), time, event.appleId);
        return;
      }
      case 'dropped': {
        const view = this.appleViews.get(event.appleId);
        const apple = snapshot.apples.find((candidate) => candidate.id === event.appleId);
        if (!view || !apple) return;
        const duration = event.reason === 'capture' ? 0.46 : 0.36;
        view.transition = {
          kind: 'drop',
          startedAt: time,
          duration,
          from: view.root.position.clone(),
        };
        this.vfx.emit(
          'drop',
          new THREE.Vector3(apple.position.x, 0.03, apple.position.z),
          time + duration * 0.82,
          event.appleId,
        );
        return;
      }
      case 'delivered': {
        const view = this.appleViews.get(event.appleId);
        if (!view) return;
        view.transition = {
          kind: 'delivery',
          startedAt: time,
          duration: 0.44,
          from: view.root.position.clone(),
        };
        const apple = snapshot.apples.find((candidate) => candidate.id === event.appleId);
        this.vfx.emit(
          'delivery',
          new THREE.Vector3(
            apple?.position.x ?? this.map.deliveryZone.x,
            0.12,
            apple?.position.z ?? this.map.deliveryZone.z,
          ),
          time + 0.34,
          event.total,
        );
        return;
      }
      case 'delivery-lost': {
        const view = this.appleViews.get(event.appleId);
        const apple = snapshot.apples.find((candidate) => candidate.id === event.appleId);
        if (view) view.transition = null;
        if (apple) {
          this.vfx.emit(
            'drop',
            new THREE.Vector3(apple.position.x, 0.03, apple.position.z),
            time,
            event.appleId,
          );
        }
        return;
      }
      case 'pounce': {
        const guard = snapshot.guards.find((candidate) => candidate.id === event.guardId);
        if (guard) {
          this.vfx.emit('pounce', new THREE.Vector3(guard.position.x, 0.05, guard.position.z), time, event.guardId === 'guard1' ? 1 : 2);
        }
        return;
      }
      case 'guards-stunned': {
        const [guard1, guard2] = snapshot.guards;
        this.vfx.emit(
          'stun',
          new THREE.Vector3(
            (guard1.position.x + guard2.position.x) / 2,
            0.08,
            (guard1.position.z + guard2.position.z) / 2,
          ),
          time,
          snapshot.tick,
        );
        return;
      }
      case 'captured':
        this.vfx.emit('capture', new THREE.Vector3(snapshot.kid.position.x, 0.08, snapshot.kid.position.z), time, event.catches);
        return;
      default:
        return;
    }
  }

  sync(snapshot: GameSnapshot, renderTime: number, reducedMotion: boolean): void {
    for (const guard of snapshot.guards) {
      const imported = this.importedGuardViews.get(guard.id);
      if (imported) {
        syncImportedGuardView(imported, guard, renderTime, reducedMotion);
        this.characterDiagnostics.currentAnimations[guard.id] = imported.currentAnimation;
        this.characterDiagnostics.guardDetails[guard.id] = {
          recoveryPhase: imported.recoveryPhase,
          posturePitch: imported.motionRoot.rotation.x,
          height: imported.motionRoot.position.y,
          animationPaused: imported.currentAnimation
            ? imported.actions.get(imported.currentAnimation)?.paused ?? null
            : null,
        };
      }
    }
    if (this.importedKidView) {
      syncImportedKidView(this.importedKidView, snapshot.kid, renderTime, reducedMotion);
      this.characterDiagnostics.currentAnimations.kid = this.importedKidView.currentAnimation;
      this.characterDiagnostics.kidDetails = {
        backpackScaleZ: this.importedKidView.backpackBody.scale.z,
        sweatDrops: this.importedKidView.sweat.count,
        postureLean: this.importedKidView.motionRoot.rotation.x,
        breathScaleY: this.importedKidView.motionRoot.scale.y,
        animationPaused: this.importedKidView.currentAnimation
          ? this.importedKidView.actions.get(this.importedKidView.currentAnimation)?.paused ?? null
          : null,
        headShakeAngle: this.importedKidView.headShakeAngle,
      };
    }
    for (const apple of snapshot.apples) this.syncApple(apple, snapshot, renderTime, reducedMotion);
    this.islandWorldVisual?.update(renderTime, reducedMotion);
    this.syncDeliveryZones(renderTime, reducedMotion);

    this.pickingRing.visible = snapshot.kid.state === 'Picking';
    if (this.pickingRing.visible) {
      this.pickingRing.position.x = snapshot.kid.position.x;
      this.pickingRing.position.z = snapshot.kid.position.z;
      const progress = 1.08 - snapshot.kid.pickingProgress * 0.72;
      this.pickingRing.scale.setScalar(progress);
      this.pickingRing.material.opacity = 0.42 + snapshot.kid.pickingProgress * 0.48;
      this.pickingRing.rotation.z = reducedMotion ? 0 : -renderTime * 1.7;
    }
    this.vfx.update(renderTime, reducedMotion);
  }

  getEnvironmentDiagnostics(): EnvironmentAssetDiagnostics {
    return {
      ...this.environmentDiagnostics,
      ambientMotionAmplitude: this.islandWorldVisual?.ambientMotionAmplitude ?? 0,
      landmarkHouseBounds: this.environmentDiagnostics.landmarkHouseBounds
        ? { ...this.environmentDiagnostics.landmarkHouseBounds }
        : null,
    };
  }

  getCharacterDiagnostics(): CharacterAssetDiagnostics {
    return {
      ...this.characterDiagnostics,
      animations: [...this.characterDiagnostics.animations],
      kidAnimations: [...this.characterDiagnostics.kidAnimations],
      currentAnimations: { ...this.characterDiagnostics.currentAnimations },
      guardDetails: {
        guard1: this.characterDiagnostics.guardDetails.guard1
          ? { ...this.characterDiagnostics.guardDetails.guard1 }
          : null,
        guard2: this.characterDiagnostics.guardDetails.guard2
          ? { ...this.characterDiagnostics.guardDetails.guard2 }
          : null,
      },
      sockets: [...this.characterDiagnostics.sockets],
      kidSockets: [...this.characterDiagnostics.kidSockets],
      kidDetails: this.characterDiagnostics.kidDetails
        ? { ...this.characterDiagnostics.kidDetails }
        : null,
      lastFailures: { ...this.characterDiagnostics.lastFailures },
    };
  }

  dispose(): void {
    this.disposed = true;
    for (const imported of this.importedGuardViews.values()) disposeImportedGuardView(imported);
    if (this.importedKidView) disposeImportedKidView(this.importedKidView);
    disposeObject3D(this.root);
    this.root.removeFromParent();
  }

  private createWorld(): void {
    if (this.islandWorld) {
      const island = createIslandWorldVisual(this.map);
      this.islandWorldVisual = island;
      this.root.add(island.root);
      this.environmentDiagnostics = {
        ...this.environmentDiagnostics,
        worldMode: 'island',
        worldPreset: null,
        worldTileInstances: island.tileInstances,
        worldPropInstances: island.propInstances,
        worldMeshes: island.meshes,
        worldTriangles: island.triangles,
        worldMaterials: island.materials,
        worldTextures: island.textures,
        worldAssetRequests: 0,
        worldCatalogAssets: 0,
        worldTileShape: null,
        worldLastFailure: null,
        groundMaterialMode: 'grass-texture',
        islandLayoutSource: 'map-v5',
        islandOutlinePoints: this.map.islandLayout?.outline.length ?? 0,
        islandRegions: this.map.islandLayout?.regions.length ?? 0,
        waterSegments: island.waterSegments,
        waterCollisionBlocks: island.waterCollisionBlocks,
        bridges: island.bridges,
        waterfalls: island.waterfalls,
        appleGroups: ISLAND_APPLE_GROUPS.length,
        regionPropClusters: island.regionPropClusters,
        regionPropInstances: island.regionPropInstances,
        regionPropInstancedMeshes: island.regionPropInstancedMeshes,
        contactShadowInstances: island.contactShadowInstances,
        ambientMotionGroups: island.ambientMotionGroups,
      };
      this.createForest();
      this.createDeliveryZones();
      return;
    }
    this.proceduralWorldVisuals.name = 'procedural-world-fallback';
    this.root.add(this.proceduralWorldVisuals);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(FIELD_GROUND_SIZE, FIELD_GROUND_SIZE),
      this.materials.grass,
    );
    floor.name = 'full-viewport-field-ground';
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.proceduralWorldVisuals.add(floor);

    this.createTerrainZones();
    this.createGroundPaths();
    this.createFence();
    this.createLandmarks();
    this.createForest();
    this.createDeliveryZones();
    if (this.worldPreset) {
      this.environmentDiagnostics = {
        ...this.environmentDiagnostics,
        externalRequested: true,
        worldMode: 'loading',
      };
      void this.installMedievalWorld(this.worldPreset);
    }
  }

  private async installMedievalWorld(preset: MedievalWorldPreset): Promise<void> {
    try {
      const imported = await createMedievalWorldVisual(preset, this.map);
      if (this.disposed) {
        disposeObject3D(imported.root);
        return;
      }
      this.proceduralWorldVisuals.visible = false;
      this.root.add(imported.root);
      this.environmentDiagnostics = {
        ...this.environmentDiagnostics,
        worldMode: 'medieval',
        worldPreset: preset,
        worldTileInstances: imported.tileInstances,
        worldPropInstances: imported.propInstances,
        worldMeshes: imported.meshes,
        worldTriangles: imported.triangles,
        worldMaterials: imported.materials,
        worldTextures: imported.textures,
        worldAssetRequests: imported.assetRequests,
        worldCatalogAssets: imported.catalogAssets,
        worldTileShape: imported.tileShape,
        worldLastFailure: null,
      };
    } catch (error) {
      const failure = error instanceof Error ? error.message : String(error);
      this.environmentDiagnostics = {
        ...this.environmentDiagnostics,
        worldMode: 'procedural',
        worldLastFailure: failure,
        lastFailure: failure,
      };
    }
  }

  private createTerrainZones(): void {
    for (const kind of ['meadow', 'orchard', 'wildflowers'] as const) {
      const zones = this.map.terrainZones.filter((zone) => zone.kind === kind);
      if (zones.length === 0) continue;
      const material = kind === 'meadow'
        ? this.materials.meadow
        : kind === 'orchard'
          ? this.materials.orchardGround
          : this.materials.wildflowersGround;
      const zoneMeshes = new THREE.InstancedMesh(
        new THREE.CircleGeometry(1, 32),
        material,
        zones.length,
      );
      zoneMeshes.name = `terrain-zones-${kind}`;
      zoneMeshes.receiveShadow = true;
      const layerHeight = kind === 'meadow' ? 0.01 : kind === 'orchard' ? 0.013 : 0.016;
      zones.forEach((zone, index) => {
        this.setInstance(
          zoneMeshes,
          index,
          new THREE.Vector3(zone.x, layerHeight + index * 0.00002, zone.z),
          new THREE.Vector3(zone.radiusX, zone.radiusZ, 1),
          new THREE.Euler(-Math.PI / 2, 0, -zone.rotationY),
        );
      });
      zoneMeshes.instanceMatrix.needsUpdate = true;
      this.proceduralWorldVisuals.add(zoneMeshes);
    }

    const orchardZones = this.map.terrainZones.filter((zone) => zone.kind === 'orchard');
    const furrowParts = orchardZones.flatMap((zone) => {
      const parts: Array<{ x: number; z: number; width: number; rotationY: number }> = [];
      for (let localZ = -zone.radiusZ + 1.15; localZ <= zone.radiusZ - 1.15; localZ += 2.25) {
        const cosine = Math.cos(zone.rotationY);
        const sine = Math.sin(zone.rotationY);
        parts.push({
          x: zone.x + localZ * sine,
          z: zone.z + localZ * cosine,
          width: zone.radiusX * 1.78,
          rotationY: zone.rotationY,
        });
      }
      return parts;
    });
    if (furrowParts.length === 0) return;
    const furrows = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 0.12),
      this.materials.soilDark,
      furrowParts.length,
    );
    furrows.name = 'orchard-zone-furrows';
    furrowParts.forEach((part, index) => {
      this.setInstance(
        furrows,
        index,
        new THREE.Vector3(part.x, 0.018, part.z),
        new THREE.Vector3(part.width, 1, 1),
        new THREE.Euler(-Math.PI / 2, 0, -part.rotationY),
      );
    });
    furrows.instanceMatrix.needsUpdate = true;
    this.proceduralWorldVisuals.add(furrows);
  }

  private createLandmarks(): void {
    const visuals = createWorldLandmarks(this.map.landmarks, this.materials);
    this.environmentDiagnostics = {
      ...this.environmentDiagnostics,
      landmarkMeshes: visuals.meshes,
      landmarkTriangles: visuals.triangles,
    };
    this.proceduralWorldVisuals.add(visuals.root);
    if (
      visuals.homesteads.length === 0 ||
      this.worldPreset !== null ||
      new URLSearchParams(window.location.search).get('landmarks') === 'procedural'
    ) return;
    this.environmentDiagnostics = {
      ...this.environmentDiagnostics,
      landmarkMode: 'loading',
      externalRequested: true,
    };
    void this.installImportedHomesteads(visuals.homesteads);
  }

  private async installImportedHomesteads(
    slots: readonly HomesteadVisualSlot[],
  ): Promise<void> {
    let visibleMeshes = this.environmentDiagnostics.landmarkMeshes;
    let visibleTriangles = this.environmentDiagnostics.landmarkTriangles;
    let importedHomesteads = 0;
    try {
      for (const slot of slots) {
        const imported = await createMedievalHouseVisual(slot.targetWidth);
        if (this.disposed) {
          disposeObject3D(imported.root);
          return;
        }
        slot.fallback.visible = false;
        slot.mount.add(imported.root);
        importedHomesteads += 1;
        visibleMeshes += imported.meshes - slot.fallbackMeshes;
        visibleTriangles += imported.triangles - slot.fallbackTriangles;
        this.environmentDiagnostics = {
          ...this.environmentDiagnostics,
          importedHomesteads,
          landmarkMeshes: visibleMeshes,
          landmarkTriangles: visibleTriangles,
          landmarkAssetMeshes: imported.meshes,
          landmarkAssetTriangles: imported.triangles,
          landmarkAssetMaterials: imported.materials,
          landmarkAssetTextures: imported.textures,
          landmarkHouseBounds: { ...imported.bounds },
        };
      }
      this.environmentDiagnostics = {
        ...this.environmentDiagnostics,
        landmarkMode: 'imported',
        landmarkLastFailure: null,
      };
    } catch (error) {
      const failure = error instanceof Error ? error.message : String(error);
      this.environmentDiagnostics = {
        ...this.environmentDiagnostics,
        landmarkMode: importedHomesteads > 0 ? 'imported' : 'procedural',
        landmarkLastFailure: failure,
        lastFailure: failure,
      };
    }
  }

  private createFence(): void {
    const parts: Array<{ position: THREE.Vector3; scale: THREE.Vector3 }> = [];
    const halfWidth = GAME_CONFIG.arenaHalfWidth;
    const halfDepth = GAME_CONFIG.arenaHalfDepth;
    for (const z of [-halfDepth - 0.18, halfDepth + 0.18]) {
      for (const y of [0.3, 0.65]) {
        parts.push({
          position: new THREE.Vector3(0, y, z),
          scale: new THREE.Vector3(halfWidth * 2 + 0.5, 0.14, 0.14),
        });
      }
    }
    for (const x of [-halfWidth - 0.18, halfWidth + 0.18]) {
      for (const y of [0.3, 0.65]) {
        parts.push({
          position: new THREE.Vector3(x, y, 0),
          scale: new THREE.Vector3(0.14, 0.14, halfDepth * 2 + 0.5),
        });
      }
    }
    for (let x = -halfWidth; x <= halfWidth; x += 5) {
      for (const z of [-halfDepth - 0.18, halfDepth + 0.18]) {
        parts.push({ position: new THREE.Vector3(x, 0.45, z), scale: new THREE.Vector3(0.18, 0.9, 0.18) });
      }
    }
    for (let z = -halfDepth; z <= halfDepth; z += 5) {
      for (const x of [-halfWidth - 0.18, halfWidth + 0.18]) {
        parts.push({ position: new THREE.Vector3(x, 0.45, z), scale: new THREE.Vector3(0.18, 0.9, 0.18) });
      }
    }

    const fence = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.materials.wood, parts.length);
    fence.castShadow = true;
    parts.forEach((part, index) => {
      this.matrixDummy.position.copy(part.position);
      this.matrixDummy.rotation.set(0, 0, 0);
      this.matrixDummy.scale.copy(part.scale);
      this.matrixDummy.updateMatrix();
      fence.setMatrixAt(index, this.matrixDummy.matrix);
    });
    fence.instanceMatrix.needsUpdate = true;
    this.proceduralWorldVisuals.add(fence);
  }

  private createGroundPaths(): void {
    const pathSegments = this.map.paths.reduce(
      (total, path) => total + Math.max(0, path.points.length - 1),
      0,
    );
    const pathMaterial = this.materials.soil.clone();
    pathMaterial.color.set('#a48058');
    pathMaterial.roughness = 1;
    const segments = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      pathMaterial,
      pathSegments,
    );
    segments.name = 'orchard-ground-path-segments';
    segments.receiveShadow = true;
    let segmentIndex = 0;
    for (const path of this.map.paths) {
      for (let index = 1; index < path.points.length; index += 1) {
        const start = path.points[index - 1];
        const end = path.points[index];
        const deltaX = end.x - start.x;
        const deltaZ = end.z - start.z;
        const length = Math.hypot(deltaX, deltaZ);
        this.setInstance(
          segments,
          segmentIndex,
          new THREE.Vector3((start.x + end.x) / 2, 0.014, (start.z + end.z) / 2),
          new THREE.Vector3(length, path.width, 1),
          new THREE.Euler(-Math.PI / 2, 0, -Math.atan2(deltaZ, deltaX)),
        );
        segmentIndex += 1;
      }
    }
    segments.instanceMatrix.needsUpdate = true;

    const clearingMaterial = pathMaterial.clone();
    clearingMaterial.color.set('#ad8c62');
    const clearings = new THREE.InstancedMesh(
      new THREE.CircleGeometry(1, 28),
      clearingMaterial,
      this.map.clearings.length,
    );
    clearings.name = 'orchard-ground-clearings';
    clearings.receiveShadow = true;
    this.map.clearings.forEach((clearing, index) => {
      this.setInstance(
        clearings,
        index,
        new THREE.Vector3(clearing.x, 0.016, clearing.z),
        new THREE.Vector3(clearing.radius, clearing.radius, 1),
        new THREE.Euler(-Math.PI / 2, 0, 0),
      );
    });
    clearings.instanceMatrix.needsUpdate = true;
    this.proceduralWorldVisuals.add(segments, clearings);
  }

  private createForest(): void {
    const stumps = this.map.trees.filter((tree) => tree.variant === 'stump');
    const largeTrees = this.map.trees.filter((tree) => tree.variant !== 'stump');
    const stumpMeshes = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.25, 0.32, 0.42, 8),
      this.materials.wood,
      stumps.length,
    );
    const trunks = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.16, 0.22, 1, 7),
      this.materials.wood,
      largeTrees.length,
    );
    const crowns = new THREE.InstancedMesh(
      new THREE.DodecahedronGeometry(0.78, 0),
      this.materials.leaf,
      largeTrees.length,
    );
    stumpMeshes.name = 'procedural-orchard-stumps';
    stumpMeshes.receiveShadow = true;
    trunks.castShadow = true;
    crowns.castShadow = true;
    stumps.forEach((tree, index) => {
      this.setInstance(
        stumpMeshes,
        index,
        new THREE.Vector3(tree.x, 0.21 * tree.scale, tree.z),
        new THREE.Vector3(tree.scale, tree.scale, tree.scale),
        new THREE.Euler(0, tree.rotationY, 0),
      );
    });
    largeTrees.forEach((tree, index) => {
      const trunkHeight = tree.variant === 'pine' ? 1.45 : 1.25;
      const crownScale = proceduralCrownScale(tree.variant, tree.scale);
      this.setInstance(
        trunks,
        index,
        new THREE.Vector3(tree.x, trunkHeight * tree.scale / 2, tree.z),
        new THREE.Vector3(tree.scale, trunkHeight * tree.scale, tree.scale),
        new THREE.Euler(0, tree.rotationY, 0),
      );
      this.setInstance(
        crowns,
        index,
        new THREE.Vector3(tree.x, (tree.variant === 'pine' ? 1.85 : 1.72) * tree.scale, tree.z),
        crownScale,
        new THREE.Euler(0.08, tree.rotationY, -0.06),
      );
      crowns.setColorAt(index, proceduralTreeColor(tree.variant));
    });
    stumpMeshes.instanceMatrix.needsUpdate = true;
    trunks.instanceMatrix.needsUpdate = true;
    crowns.instanceMatrix.needsUpdate = true;
    if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
    this.proceduralTreeVisuals.name = 'procedural-orchard-trees';
    this.proceduralTreeVisuals.add(stumpMeshes, trunks, crowns);
    this.root.add(this.proceduralTreeVisuals);

    const proceduralTreesRequested =
      new URLSearchParams(window.location.search).get('trees') === 'procedural' ||
      (this.islandWorld && window.matchMedia('(max-width: 600px)').matches);
    if (proceduralTreesRequested) return;
    this.environmentDiagnostics = {
      ...this.environmentDiagnostics,
      treeMode: 'loading',
      externalRequested: true,
    };
    void this.installImportedTrees(this.map.trees);
  }

  private async installImportedTrees(placements: readonly OrchardTree[]): Promise<void> {
    try {
      const imported = await loadNaturePackTreeVisuals(
        placements,
        this.islandWorld ? 'island-matte' : 'source',
      );
      if (this.disposed) {
        disposeObject3D(imported.root);
        return;
      }
      this.proceduralTreeVisuals.visible = false;
      this.root.add(imported.root);
      this.environmentDiagnostics = {
        ...this.environmentDiagnostics,
        treeMode: 'imported',
        treeVariants: imported.variants,
        treeInstances: imported.instances,
        treeTriangles: imported.triangles,
        natureMaterialProfile: imported.materialProfile,
        lastFailure: null,
      };
    } catch (error) {
      this.environmentDiagnostics = {
        ...this.environmentDiagnostics,
        treeMode: 'procedural',
        lastFailure: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async installImportedApples(): Promise<void> {
    if (new URLSearchParams(window.location.search).get('fruit') === 'procedural') return;
    this.environmentDiagnostics = {
      ...this.environmentDiagnostics,
      fruitMode: 'loading',
      externalRequested: true,
    };
    try {
      let triangles = 0;
      for (const view of this.appleViews.values()) {
        const imported = await createNaturePackAppleVisual(
          this.islandWorld ? 'island-matte' : 'source',
        );
        if (this.disposed) {
          disposeObject3D(imported.root);
          return;
        }
        view.procedural.visible = false;
        view.imported = imported.root;
        view.materials = imported.materials;
        view.root.add(imported.root);
        triangles += imported.triangles;
      }
      this.environmentDiagnostics = {
        ...this.environmentDiagnostics,
        fruitMode: 'imported',
        fruitTriangles: triangles,
        natureMaterialProfile: this.islandWorld ? 'island-matte' : 'source',
        lastFailure: null,
      };
    } catch (error) {
      this.environmentDiagnostics = {
        ...this.environmentDiagnostics,
        fruitMode: 'procedural',
        lastFailure: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async installImportedGuard(id: ImportedGuardId): Promise<void> {
    try {
      const imported = await loadImportedGuardView(id);
      if (this.disposed) {
        disposeImportedGuardView(imported);
        disposeObject3D(imported.root);
        return;
      }
      this.importedGuardViews.set(id, imported);
      this.root.add(imported.root);
      this.setGuardMode(id, 'imported');
      this.characterDiagnostics.lastFailures[id] = null;
      this.refreshImportedCharacterDiagnostics();
    } catch (error) {
      const failure = error instanceof Error ? error.message : String(error);
      this.setGuardMode(id, 'failed');
      this.characterDiagnostics.lastFailures[id] = failure;
      this.refreshImportedCharacterDiagnostics();
    }
  }

  private async installImportedKid(): Promise<void> {
    try {
      const imported = await loadImportedKidView(this.materials);
      if (this.disposed) {
        disposeImportedKidView(imported);
        disposeObject3D(imported.root);
        return;
      }
      this.importedKidView = imported;
      this.root.add(imported.root);
      this.characterDiagnostics.kidMode = 'imported';
      this.characterDiagnostics.lastFailures.kid = null;
      this.refreshImportedCharacterDiagnostics();
    } catch (error) {
      this.characterDiagnostics.kidMode = 'failed';
      this.characterDiagnostics.lastFailures.kid = error instanceof Error ? error.message : String(error);
      this.refreshImportedCharacterDiagnostics();
    }
  }

  private setGuardMode(
    id: ImportedGuardId,
    mode: CharacterAssetDiagnostics['guard1Mode'],
  ): void {
    if (id === 'guard1') this.characterDiagnostics.guard1Mode = mode;
    else this.characterDiagnostics.guard2Mode = mode;
  }

  private refreshImportedCharacterDiagnostics(): void {
    const guards = [...this.importedGuardViews.values()];
    const firstGuard = guards[0];
    const kid = this.importedKidView;
    const imported = kid ? [...guards, kid] : guards;
    this.characterDiagnostics.importedGuards = guards.length;
    this.characterDiagnostics.importedCharacters = imported.length;
    this.characterDiagnostics.meshes = imported.reduce((total, view) => total + view.meshes, 0);
    this.characterDiagnostics.triangles = imported.reduce((total, view) => total + view.triangles, 0);
    this.characterDiagnostics.materials = imported.reduce((total, view) => total + view.materialCount, 0);
    this.characterDiagnostics.textures = (firstGuard?.textureCount ?? 0) + (kid?.textureCount ?? 0);
    this.characterDiagnostics.animations = firstGuard ? [...firstGuard.actions.keys()] : [];
    this.characterDiagnostics.kidAnimations = kid ? [...kid.actions.keys()] : [];
    this.characterDiagnostics.sockets = firstGuard ? [...firstGuard.sockets] : [];
    this.characterDiagnostics.kidSockets = kid ? [...kid.sockets] : [];
    this.characterDiagnostics.lastFailure =
      this.characterDiagnostics.lastFailures.guard1 ??
      this.characterDiagnostics.lastFailures.guard2 ??
      this.characterDiagnostics.lastFailures.kid;
  }

  private createDeliveryZones(): void {
    const zones = deliveryZonesForMap(this.map);
    if (!this.islandWorld) {
      this.createRingDeliveryZones(zones);
      return;
    }
    this.environmentDiagnostics = {
      ...this.environmentDiagnostics,
      deliveryMarkerMode: 'parcel-sign',
      deliveryMarkerLabels: zones.length,
    };
    const fillGeometry = new THREE.CircleGeometry(GAME_CONFIG.deliveryRadius - 0.18, 48);
    const outlineGeometry = new THREE.RingGeometry(
      GAME_CONFIG.deliveryRadius - 0.22,
      GAME_CONFIG.deliveryRadius + 0.12,
      48,
    );
    const pulseGeometry = new THREE.RingGeometry(
      GAME_CONFIG.deliveryRadius + 0.26,
      GAME_CONFIG.deliveryRadius + 0.56,
      48,
    );
    const fillMaterial = new THREE.MeshBasicMaterial({
      color: '#f8df75',
      transparent: true,
      opacity: this.islandWorld ? 0.28 : 0.2,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const outlineMaterial = new THREE.MeshBasicMaterial({
      color: '#fff2a9',
      transparent: true,
      opacity: 0.98,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const pulseMaterial = new THREE.MeshBasicMaterial({
      color: '#f2a33b',
      transparent: true,
      opacity: 0.32,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const fills = new THREE.InstancedMesh(fillGeometry, fillMaterial, zones.length);
    const outlines = new THREE.InstancedMesh(outlineGeometry, outlineMaterial, zones.length);
    const pulseRings = new THREE.InstancedMesh(pulseGeometry, pulseMaterial, zones.length);
    fills.name = 'delivery-zone-fills';
    outlines.name = 'delivery-zone-outlines';
    pulseRings.name = 'delivery-zone-pulse-rings';
    fills.renderOrder = 3;
    outlines.renderOrder = 4;
    pulseRings.renderOrder = 2;

    const padMaterial = new THREE.MeshStandardMaterial({
      color: '#f7e7a3',
      roughness: 0.94,
      metalness: 0,
    });
    const parcelMaterial = new THREE.MeshStandardMaterial({
      color: '#dc8b37',
      roughness: 0.86,
      metalness: 0,
    });
    const ribbonMaterial = new THREE.MeshStandardMaterial({
      color: '#fff4c7',
      roughness: 0.9,
      metalness: 0,
    });
    const pads = new THREE.InstancedMesh(new THREE.BoxGeometry(1.95, 0.09, 1.95), padMaterial, zones.length);
    const parcels = new THREE.InstancedMesh(new THREE.BoxGeometry(0.92, 0.34, 0.72), parcelMaterial, zones.length);
    const ribbons = new THREE.InstancedMesh(new THREE.BoxGeometry(1.02, 0.055, 0.17), ribbonMaterial, zones.length * 2);
    pads.name = 'delivery-zone-parcel-pads';
    parcels.name = 'delivery-zone-parcels';
    ribbons.name = 'delivery-zone-parcel-ribbons';
    pads.castShadow = true;
    parcels.castShadow = true;
    parcels.receiveShadow = true;

    const labelTexture = createDeliveryLabelTexture();
    const labelMaterial = new THREE.SpriteMaterial({
      map: labelTexture,
      transparent: true,
      depthWrite: false,
      sizeAttenuation: true,
    });
    const labelRoot = new THREE.Group();
    labelRoot.name = 'delivery-zone-labels';

    zones.forEach((zone, index) => {
      this.setInstance(
        fills,
        index,
        new THREE.Vector3(zone.x, 0.03, zone.z),
        new THREE.Vector3(1, 1, 1),
        new THREE.Euler(-Math.PI / 2, 0, 0),
      );
      this.setInstance(
        outlines,
        index,
        new THREE.Vector3(zone.x, 0.045, zone.z),
        new THREE.Vector3(1, 1, 1),
        new THREE.Euler(-Math.PI / 2, 0, 0),
      );
      this.setInstance(
        pulseRings,
        index,
        new THREE.Vector3(zone.x, 0.038, zone.z),
        new THREE.Vector3(1, 1, 1),
        new THREE.Euler(-Math.PI / 2, 0, 0),
      );
      this.setInstance(
        pads,
        index,
        new THREE.Vector3(zone.x, 0.095, zone.z),
        new THREE.Vector3(1, 1, 1),
        new THREE.Euler(0, Math.PI / 4, 0),
      );
      this.setInstance(
        parcels,
        index,
        new THREE.Vector3(zone.x, 0.31, zone.z),
        new THREE.Vector3(1, 1, 1),
        new THREE.Euler(0, Math.PI / 4, 0),
      );
      for (let ribbonIndex = 0; ribbonIndex < 2; ribbonIndex += 1) {
        this.setInstance(
          ribbons,
          index * 2 + ribbonIndex,
          new THREE.Vector3(zone.x, 0.51, zone.z),
          new THREE.Vector3(1, 1, 1),
          new THREE.Euler(0, Math.PI / 4 + ribbonIndex * Math.PI / 2, 0),
        );
      }

      const label = new THREE.Sprite(labelMaterial);
      label.name = `delivery-zone-${zone.id}-label`;
      label.position.set(zone.x, 2.1, zone.z - 1.65);
      label.scale.set(4.25, 1.6, 1);
      label.renderOrder = 6;
      labelRoot.add(label);
    });

    fills.instanceMatrix.needsUpdate = true;
    outlines.instanceMatrix.needsUpdate = true;
    pulseRings.instanceMatrix.needsUpdate = true;
    pads.instanceMatrix.needsUpdate = true;
    parcels.instanceMatrix.needsUpdate = true;
    ribbons.instanceMatrix.needsUpdate = true;
    this.deliveryZoneVisual = { pulseRings, zones };
    this.root.add(fills, outlines, pulseRings, pads, parcels, ribbons, labelRoot);
  }

  private createRingDeliveryZones(zones: ReadonlyArray<{ x: number; z: number }>): void {
    const fillGeometry = new THREE.CircleGeometry(GAME_CONFIG.deliveryRadius, 48);
    const outlineGeometry = new THREE.RingGeometry(
      GAME_CONFIG.deliveryRadius - 0.12,
      GAME_CONFIG.deliveryRadius + 0.04,
      48,
    );
    const fillMaterial = new THREE.MeshBasicMaterial({
      color: '#f3d46d',
      transparent: true,
      opacity: 0.14,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const outlineMaterial = new THREE.MeshBasicMaterial({
      color: '#f3d46d',
      transparent: true,
      opacity: 0.78,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const fills = new THREE.InstancedMesh(fillGeometry, fillMaterial, zones.length);
    const outlines = new THREE.InstancedMesh(outlineGeometry, outlineMaterial, zones.length);
    fills.name = 'delivery-zone-fills';
    outlines.name = 'delivery-zone-outlines';
    zones.forEach((zone, index) => {
      this.setInstance(
        fills,
        index,
        new THREE.Vector3(zone.x, 0.021, zone.z),
        new THREE.Vector3(1, 1, 1),
        new THREE.Euler(-Math.PI / 2, 0, 0),
      );
      this.setInstance(
        outlines,
        index,
        new THREE.Vector3(zone.x, 0.026, zone.z),
        new THREE.Vector3(1, 1, 1),
        new THREE.Euler(-Math.PI / 2, 0, 0),
      );
    });
    fills.instanceMatrix.needsUpdate = true;
    outlines.instanceMatrix.needsUpdate = true;
    this.environmentDiagnostics = {
      ...this.environmentDiagnostics,
      deliveryMarkerMode: 'ring',
      deliveryMarkerLabels: 0,
    };
    this.root.add(fills, outlines);
  }

  private syncDeliveryZones(time: number, reducedMotion: boolean): void {
    const visual = this.deliveryZoneVisual;
    if (!visual) return;
    const pulse = reducedMotion ? 0.5 : (Math.sin(time * 2.1) + 1) / 2;
    const scale = 0.985 + pulse * 0.045;
    visual.pulseRings.material.opacity = 0.18 + pulse * 0.24;
    visual.zones.forEach((zone, index) => {
      this.matrixDummy.position.set(zone.x, 0.038, zone.z);
      this.matrixDummy.scale.set(scale, scale, 1);
      this.matrixDummy.rotation.set(-Math.PI / 2, 0, 0);
      this.matrixDummy.updateMatrix();
      visual.pulseRings.setMatrixAt(index, this.matrixDummy.matrix);
    });
    visual.pulseRings.instanceMatrix.needsUpdate = true;
  }

  private createApple(id: number): void {
    const root = new THREE.Group();
    const procedural = new THREE.Group();
    procedural.name = `procedural-apple-${id}`;
    const body = new THREE.Mesh(createAppleGeometry(id % 3, 0.34), createAppleMaterial(id));
    body.position.y = 0.38;
    body.castShadow = true;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.043, 0.2, 5), this.materials.appleStem);
    stem.position.set(0, 0.72, 0);
    stem.rotation.z = id % 2 === 0 ? 0.16 : -0.2;
    stem.castShadow = true;

    const leafShape = new THREE.Shape();
    leafShape.moveTo(0, 0);
    leafShape.quadraticCurveTo(0.13, 0.11, 0.27, 0.02);
    leafShape.quadraticCurveTo(0.13, -0.08, 0, 0);
    const leaf = new THREE.Mesh(
      new THREE.ShapeGeometry(leafShape, 3),
      new THREE.MeshStandardMaterial({
        color: ORCHARD_COLORS.appleLeaf,
        roughness: 0.9,
        metalness: 0,
        side: THREE.DoubleSide,
        flatShading: true,
      }),
    );
    leaf.position.set(0.04, 0.73, 0.01);
    leaf.rotation.set(-1.05, 0, id * 0.82);
    leaf.castShadow = true;

    const targetRing = new THREE.Mesh(
      new THREE.RingGeometry(0.46, 0.56, 24),
      new THREE.MeshBasicMaterial({
        color: '#fff1a8',
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.88,
        depthWrite: false,
      }),
    );
    targetRing.rotation.x = -Math.PI / 2;
    targetRing.position.y = 0.025;
    targetRing.visible = false;
    procedural.add(body, stem, leaf);
    root.add(procedural, targetRing);
    this.appleViews.set(id, {
      root,
      procedural,
      imported: null,
      materials: [body.material],
      targetRing,
      baseRotation: id * 1.37,
      transition: null,
    });
    this.root.add(root);
  }

  private syncApple(
    apple: AppleSnapshot,
    snapshot: GameSnapshot,
    time: number,
    reducedMotion: boolean,
  ): void {
    const view = this.appleViews.get(apple.id);
    if (!view) return;
    view.targetRing.visible = snapshot.kid.pickingTargetId === apple.id && apple.state === 'Ground';
    for (const material of view.materials) {
      material.transparent = apple.lockTicks > 0;
      material.opacity = apple.lockTicks > 0 ? 0.62 : 1;
      material.depthWrite = apple.lockTicks === 0;
      material.emissiveIntensity = view.targetRing.visible
        ? 0.22
        : apple.state === 'Delivered'
          ? 0.16
          : 0.08;
    }
    view.root.scale.setScalar(1);

    const target = this.appleTarget;
    if (apple.state === 'Carried') {
      const index = snapshot.kid.carriedAppleIds.indexOf(apple.id);
      this.getCarriedTarget(snapshot.kid, Math.max(0, index), target);
    } else {
      target.set(apple.position.x, 0, apple.position.z);
    }

    const transition = view.transition;
    if (transition) {
      const progress = THREE.MathUtils.clamp((time - transition.startedAt) / transition.duration, 0, 1);
      if (progress < 1) {
        const eased = 1 - (1 - progress) ** 3;
        view.root.visible = true;
        view.root.position.lerpVectors(transition.from, target, eased);
        const arc = Math.sin(progress * Math.PI);
        view.root.position.y += arc * (transition.kind === 'drop' ? 0.95 : 0.72);
        const pop = transition.kind === 'drop' ? 0.12 : 0.28;
        view.root.scale.setScalar(1 + arc * pop);
        view.root.rotation.y = view.baseRotation + progress * Math.PI * (transition.kind === 'drop' ? 1.4 : 0.8);
        return;
      }
      view.transition = null;
    }

    view.root.visible = true;
    view.root.position.copy(target);
    if (apple.state === 'Carried') {
      const index = Math.max(0, snapshot.kid.carriedAppleIds.indexOf(apple.id));
      const sway = reducedMotion ? 0 : Math.sin(time * 7.2 + index * 1.9) * (0.025 + snapshot.kid.movementAmount * 0.055);
      view.root.position.y += Math.abs(sway) * 0.5;
      view.root.rotation.set(sway * 0.7, Math.atan2(snapshot.kid.facing.x, snapshot.kid.facing.z) + view.baseRotation + sway, sway);
    } else {
      const settle = reducedMotion ? 0 : Math.sin(time * 1.7 + apple.id * 0.9) * 0.012;
      view.root.position.y = settle;
      view.root.rotation.set(0, view.baseRotation, 0);
      view.procedural.rotation.z = reducedMotion ? 0 : Math.sin(time * 1.9 + apple.id) * 0.025;
      if (view.imported) {
        view.imported.rotation.z = reducedMotion ? 0 : Math.sin(time * 1.9 + apple.id) * 0.025;
      }
    }
  }

  private getCarriedTarget(kid: KidSnapshot, index: number, target: THREE.Vector3): void {
    const column = index % 2 === 0 ? -1 : 1;
    const row = Math.floor(index / 2);
    const rightX = kid.facing.z;
    const rightZ = -kid.facing.x;
    const backDistance = 0.36 + row * 0.035;
    target.set(
      kid.position.x - kid.facing.x * backDistance + rightX * column * 0.2,
      0.98 + row * 0.25,
      kid.position.z - kid.facing.z * backDistance + rightZ * column * 0.2,
    );
  }

  private setInstance(
    mesh: THREE.InstancedMesh,
    index: number,
    position: THREE.Vector3,
    scale: THREE.Vector3,
    rotation = new THREE.Euler(),
  ): void {
    this.matrixDummy.position.copy(position);
    this.matrixDummy.rotation.copy(rotation);
    this.matrixDummy.scale.copy(scale);
    this.matrixDummy.updateMatrix();
    mesh.setMatrixAt(index, this.matrixDummy.matrix);
  }
}

function createDeliveryLabelTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 96;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to create the delivery label texture.');

  context.beginPath();
  context.roundRect(5, 5, 246, 86, 25);
  context.fillStyle = '#fff2b6';
  context.fill();
  context.lineWidth = 7;
  context.strokeStyle = '#6f4a26';
  context.stroke();

  context.fillStyle = '#dc8b37';
  context.fillRect(25, 29, 44, 37);
  context.fillStyle = '#fff4c7';
  context.fillRect(43, 29, 8, 37);
  context.fillRect(25, 43, 44, 8);

  context.fillStyle = '#4a351f';
  context.font = '700 42px "Microsoft YaHei", "Noto Sans SC", sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText('投递', 165, 49);

  const texture = new THREE.CanvasTexture(canvas);
  texture.name = 'delivery-zone-label-texture';
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

function proceduralCrownScale(variant: TreeVariant, scale: number): THREE.Vector3 {
  switch (variant) {
    case 'stump':
      return new THREE.Vector3(scale, scale, scale);
    case 'broadleaf':
      return new THREE.Vector3(1.05, 0.9, 1.02).multiplyScalar(scale);
    case 'pine':
      return new THREE.Vector3(0.78, 1.22, 0.78).multiplyScalar(scale);
    case 'cherry':
      return new THREE.Vector3(1.12, 0.84, 1.08).multiplyScalar(scale);
  }
}

function proceduralTreeColor(variant: TreeVariant): THREE.Color {
  switch (variant) {
    case 'stump':
      return new THREE.Color('#6b4a31');
    case 'broadleaf':
      return new THREE.Color(ORCHARD_COLORS.leaf);
    case 'pine':
      return new THREE.Color('#315f3b');
    case 'cherry':
      return new THREE.Color('#d790a4');
  }
}

function createAppleGeometry(variant: number, radius: number): THREE.BufferGeometry {
  const geometry = new THREE.SphereGeometry(radius, 10, 7).toNonIndexed();
  const positions = geometry.getAttribute('position');
  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index);
    const y = positions.getY(index);
    const z = positions.getZ(index);
    const angle = Math.atan2(z, x);
    const normalizedY = y / radius;
    const lobe = 1 + Math.cos(angle * (5 + variant) + variant * 0.9) * (0.035 + variant * 0.008);
    const asymmetry = 1 + Math.sin(angle + variant * 1.4) * 0.035;
    const taper = 1 - Math.max(0, Math.abs(normalizedY) - 0.52) * 0.16;
    const topDent = normalizedY > 0.5 ? (normalizedY - 0.5) * radius * 0.2 : 0;
    positions.setXYZ(
      index,
      x * lobe * taper * asymmetry,
      y * (0.9 + variant * 0.025) - topDent,
      z * lobe * taper / asymmetry,
    );
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}
