import * as THREE from 'three';
import {
  createNaturePackAppleVisual,
  loadNaturePackTreeVisuals,
} from '../assets/NaturePackAssets';
import { GAME_CONFIG } from '../game/config';
import type { OrchardMap, OrchardTree, TreeVariant } from '../game/maps/OrchardMap';
import type { AppleSnapshot, GameEvent, GameSnapshot, KidSnapshot } from '../game/types';
import { VfxSystem } from '../systems/VfxSystem';
import { disposeObject3D } from '../utils/dispose';
import {
  createAppleMaterial,
  createOrchardMaterials,
  ORCHARD_COLORS,
} from './OrchardMaterials';
import {
  disposeImportedGuardView,
  loadImportedGuardView,
  syncImportedGuardView,
  type ImportedGuardId,
  type ImportedGuardView,
} from './ImportedGuardView';
import {
  disposeImportedKidView,
  loadImportedKidView,
  syncImportedKidView,
  type ImportedKidView,
} from './ImportedKidView';

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

const FIELD_GROUND_SIZE = 44;

export type EnvironmentAssetDiagnostics = {
  treeMode: 'loading' | 'imported' | 'procedural';
  fruitMode: 'loading' | 'imported' | 'procedural';
  externalRequested: boolean;
  treeVariants: number;
  treeInstances: number;
  treeTriangles: number;
  fruitInstances: number;
  fruitTriangles: number;
  mapId: string;
  mapName: string;
  paths: number;
  clearings: number;
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
  private readonly proceduralTreeVisuals = new THREE.Group();
  private readonly importedGuardViews = new Map<ImportedGuardId, ImportedGuardView>();
  private importedKidView: ImportedKidView | null = null;
  private disposed = false;
  private environmentDiagnostics: EnvironmentAssetDiagnostics = {
    treeMode: 'procedural',
    fruitMode: 'procedural',
    externalRequested: false,
    treeVariants: 0,
    treeInstances: 0,
    treeTriangles: 0,
    fruitInstances: 0,
    fruitTriangles: 0,
    mapId: '',
    mapName: '',
    paths: 0,
    clearings: 0,
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
    sockets: [],
    kidSockets: [],
    kidDetails: null,
    lastFailure: null,
    lastFailures: { guard1: null, guard2: null, kid: null },
  };
  constructor(scene: THREE.Scene, private readonly map: OrchardMap) {
    this.environmentDiagnostics = {
      ...this.environmentDiagnostics,
      treeInstances: map.trees.length,
      fruitInstances: map.appleSpawns.length,
      mapId: map.id,
      mapName: map.name,
      paths: map.paths.length,
      clearings: map.clearings.length,
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
    return { ...this.environmentDiagnostics };
  }

  getCharacterDiagnostics(): CharacterAssetDiagnostics {
    return {
      ...this.characterDiagnostics,
      animations: [...this.characterDiagnostics.animations],
      kidAnimations: [...this.characterDiagnostics.kidAnimations],
      currentAnimations: { ...this.characterDiagnostics.currentAnimations },
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
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(FIELD_GROUND_SIZE, FIELD_GROUND_SIZE),
      this.materials.grass,
    );
    floor.name = 'full-viewport-field-ground';
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.root.add(floor);

    this.createFurrows();
    this.createGroundPaths();
    this.createFence();
    this.createForest();
    this.createDeliveryZone();
  }

  private createFurrows(): void {
    const count = 11;
    const furrows = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(GAME_CONFIG.arenaHalfWidth * 2 - 1, 0.12),
      this.materials.soil,
      count,
    );
    for (let index = 0; index < count; index += 1) {
      const z = -7.5 + index * 1.5;
      this.matrixDummy.position.set(0, 0.009, z);
      this.matrixDummy.rotation.set(-Math.PI / 2, 0, 0);
      this.matrixDummy.scale.set(1, 1, 1);
      this.matrixDummy.updateMatrix();
      furrows.setMatrixAt(index, this.matrixDummy.matrix);
    }
    furrows.instanceMatrix.needsUpdate = true;
    this.root.add(furrows);
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
    for (let x = -halfWidth; x <= halfWidth; x += 3) {
      for (const z of [-halfDepth - 0.18, halfDepth + 0.18]) {
        parts.push({ position: new THREE.Vector3(x, 0.45, z), scale: new THREE.Vector3(0.18, 0.9, 0.18) });
      }
    }
    for (let z = -halfDepth; z <= halfDepth; z += 3) {
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
    this.root.add(fence);
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
    this.root.add(segments, clearings);
  }

  private createForest(): void {
    const treeCount = this.map.trees.length;
    const trunks = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.16, 0.22, 1, 7),
      this.materials.wood,
      treeCount,
    );
    const crowns = new THREE.InstancedMesh(
      new THREE.DodecahedronGeometry(0.78, 0),
      this.materials.leaf,
      treeCount,
    );
    trunks.castShadow = true;
    crowns.castShadow = true;
    this.map.trees.forEach((tree, index) => {
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
    trunks.instanceMatrix.needsUpdate = true;
    crowns.instanceMatrix.needsUpdate = true;
    if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
    this.proceduralTreeVisuals.name = 'procedural-orchard-trees';
    this.proceduralTreeVisuals.add(trunks, crowns);
    this.root.add(this.proceduralTreeVisuals);

    if (new URLSearchParams(window.location.search).get('trees') === 'procedural') return;
    this.environmentDiagnostics = {
      ...this.environmentDiagnostics,
      treeMode: 'loading',
      externalRequested: true,
    };
    void this.installImportedTrees(this.map.trees);
  }

  private async installImportedTrees(placements: readonly OrchardTree[]): Promise<void> {
    try {
      const imported = await loadNaturePackTreeVisuals(placements);
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
        const imported = await createNaturePackAppleVisual();
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

  private createDeliveryZone(): void {
    const fill = new THREE.Mesh(
      new THREE.CircleGeometry(GAME_CONFIG.deliveryRadius, 48),
      new THREE.MeshBasicMaterial({
        color: '#f3d46d',
        transparent: true,
        opacity: 0.14,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    const outline = new THREE.Mesh(
      new THREE.RingGeometry(GAME_CONFIG.deliveryRadius - 0.12, GAME_CONFIG.deliveryRadius + 0.04, 48),
      new THREE.MeshBasicMaterial({
        color: '#f3d46d',
        transparent: true,
        opacity: 0.78,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    fill.rotation.x = -Math.PI / 2;
    outline.rotation.x = -Math.PI / 2;
    fill.position.set(this.map.deliveryZone.x, 0.021, this.map.deliveryZone.z);
    outline.position.set(this.map.deliveryZone.x, 0.026, this.map.deliveryZone.z);
    this.root.add(fill, outline);
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

function proceduralCrownScale(variant: TreeVariant, scale: number): THREE.Vector3 {
  switch (variant) {
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
