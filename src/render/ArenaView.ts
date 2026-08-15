import * as THREE from 'three';
import {
  loadForestTreeVisuals,
  type TreePlacement,
} from '../assets/ForestTreeAssets';
import { APPLE_SPAWNS, DELIVERY_ZONE, GAME_CONFIG, OBSTACLES } from '../game/config';
import type { AppleSnapshot, GameEvent, GameSnapshot, KidSnapshot } from '../game/types';
import { VfxSystem } from '../systems/VfxSystem';
import { disposeObject3D } from '../utils/dispose';
import {
  createGuardCharacter,
  createKidCharacter,
  syncGuardCharacter,
  syncKidCharacter,
  type CharacterView,
} from './CharacterView';
import {
  createAppleMaterial,
  createOrchardMaterials,
  ORCHARD_COLORS,
} from './OrchardMaterials';
import {
  disposeImportedGuardView,
  loadImportedGuardView,
  syncImportedGuardView,
  type ImportedGuardView,
} from './ImportedGuardView';

type AppleTransition = {
  kind: 'pickup' | 'drop' | 'delivery';
  startedAt: number;
  duration: number;
  from: THREE.Vector3;
  deliveryIndex?: number;
};

type AppleView = {
  root: THREE.Group;
  body: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  stem: THREE.Mesh;
  leaf: THREE.Mesh;
  targetRing: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  baseRotation: number;
  transition: AppleTransition | null;
};

const DELIVERY_SLOTS = [
  [-0.42, 0.48, 0.04],
  [0, 0.45, -0.18],
  [0.43, 0.47, 0.06],
  [-0.24, 0.66, -0.08],
  [0.26, 0.67, -0.04],
  [0, 0.82, 0.06],
] as const;

const FIELD_GROUND_SIZE = 44;

export type EnvironmentAssetDiagnostics = {
  treeMode: 'loading' | 'imported' | 'procedural';
  externalRequested: boolean;
  treeVariants: number;
  treeInstances: number;
  treeTriangles: number;
  lastFailure: string | null;
};

export type CharacterAssetDiagnostics = {
  guard1Mode: 'loading' | 'imported' | 'procedural';
  externalRequested: boolean;
  meshes: number;
  triangles: number;
  materials: number;
  textures: number;
  animations: string[];
  currentAnimation: string | null;
  sockets: string[];
  lastFailure: string | null;
};

export class ArenaView {
  readonly root = new THREE.Group();

  private readonly materials = createOrchardMaterials();
  private readonly guardViews = new Map<'guard1' | 'guard2', CharacterView>();
  private readonly kidView: CharacterView;
  private readonly appleViews = new Map<number, AppleView>();
  private readonly pickingRing: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private readonly vfx: VfxSystem;
  private readonly matrixDummy = new THREE.Object3D();
  private readonly appleTarget = new THREE.Vector3();
  private readonly proceduralTreeVisuals = new THREE.Group();
  private importedGuardView: ImportedGuardView | null = null;
  private disposed = false;
  private environmentDiagnostics: EnvironmentAssetDiagnostics = {
    treeMode: 'procedural',
    externalRequested: false,
    treeVariants: 0,
    treeInstances: OBSTACLES.length * 3,
    treeTriangles: 0,
    lastFailure: null,
  };
  private characterDiagnostics: CharacterAssetDiagnostics = {
    guard1Mode: 'procedural',
    externalRequested: false,
    meshes: 0,
    triangles: 0,
    materials: 0,
    textures: 0,
    animations: [],
    currentAnimation: null,
    sockets: [],
    lastFailure: null,
  };
  private deliveryApples!: THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;

  constructor(scene: THREE.Scene) {
    this.createWorld();
    this.guardViews.set('guard1', createGuardCharacter('guard1', this.materials));
    this.guardViews.set('guard2', createGuardCharacter('guard2', this.materials));
    for (const view of this.guardViews.values()) this.root.add(view.root);
    if (new URLSearchParams(window.location.search).get('guard') !== 'procedural') {
      this.characterDiagnostics = {
        ...this.characterDiagnostics,
        guard1Mode: 'loading',
        externalRequested: true,
      };
      void this.installImportedGuard();
    }
    this.kidView = createKidCharacter(this.materials);
    this.root.add(this.kidView.root);
    for (let id = 0; id < APPLE_SPAWNS.length; id += 1) this.createApple(id);

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
          deliveryIndex: event.total - 1,
        };
        this.vfx.emit(
          'delivery',
          new THREE.Vector3(DELIVERY_ZONE.x, 0.12, DELIVERY_ZONE.z),
          time + 0.34,
          event.total,
        );
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
      if (guard.id === 'guard1' && this.importedGuardView) {
        syncImportedGuardView(this.importedGuardView, guard, renderTime, reducedMotion);
        this.characterDiagnostics.currentAnimation = this.importedGuardView.currentAnimation;
        continue;
      }
      const view = this.guardViews.get(guard.id);
      if (view) syncGuardCharacter(view, guard, renderTime, reducedMotion);
    }
    syncKidCharacter(this.kidView, snapshot.kid, renderTime, reducedMotion);
    for (const apple of snapshot.apples) this.syncApple(apple, snapshot, renderTime, reducedMotion);
    this.syncDeliveryPile(snapshot, renderTime);

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
      sockets: [...this.characterDiagnostics.sockets],
    };
  }

  dispose(): void {
    this.disposed = true;
    if (this.importedGuardView) disposeImportedGuardView(this.importedGuardView);
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
    this.createFence();
    this.createTreeRows();
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

  private createTreeRows(): void {
    const treeCount = OBSTACLES.length * 3;
    const patches = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      this.materials.soilDark,
      OBSTACLES.length,
    );
    const trunks = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.18, 0.23, 1, 7),
      this.materials.wood,
      treeCount * 2,
    );
    const crowns = new THREE.InstancedMesh(
      new THREE.DodecahedronGeometry(0.72, 0),
      this.materials.leaf,
      treeCount * 2,
    );
    trunks.castShadow = true;
    crowns.castShadow = true;

    let treeIndex = 0;
    let crownIndex = 0;
    OBSTACLES.forEach((obstacle, rowIndex) => {
      this.setInstance(
        patches,
        rowIndex,
        new THREE.Vector3(obstacle.x, 0.06, obstacle.z),
        new THREE.Vector3(obstacle.halfWidth * 2, 0.12, 1.35),
      );
      for (let index = 0; index < 3; index += 1) {
        const offset = (index - 1) * obstacle.halfWidth * 0.72;
        const x = obstacle.x + offset;
        const phase = rowIndex * 3 + index;
        this.setInstance(
          trunks,
          treeIndex * 2,
          new THREE.Vector3(x, 0.62, obstacle.z),
          new THREE.Vector3(1, 1.14 + (phase % 2) * 0.08, 1),
        );
        this.setInstance(
          trunks,
          treeIndex * 2 + 1,
          new THREE.Vector3(x + 0.13, 1.12, obstacle.z + 0.02),
          new THREE.Vector3(0.62, 0.48, 0.62),
          new THREE.Euler(0, 0, phase % 2 === 0 ? -0.52 : 0.52),
        );

        const primaryColor = new THREE.Color(rowIndex % 2 === 0 ? ORCHARD_COLORS.leaf : ORCHARD_COLORS.leafLight);
        const secondaryColor = primaryColor.clone().offsetHSL(0.015, -0.02, 0.06);
        this.setInstance(
          crowns,
          crownIndex,
          new THREE.Vector3(x - 0.18, 1.58 + (phase % 2) * 0.05, obstacle.z),
          new THREE.Vector3(0.9, 0.82, 0.88),
          new THREE.Euler(0.12, phase * 0.58, 0.08),
        );
        crowns.setColorAt(crownIndex, primaryColor);
        crownIndex += 1;
        this.setInstance(
          crowns,
          crownIndex,
          new THREE.Vector3(x + 0.28, 1.64, obstacle.z - 0.04),
          new THREE.Vector3(0.72, 0.68, 0.76),
          new THREE.Euler(-0.08, phase * 0.41, -0.1),
        );
        crowns.setColorAt(crownIndex, secondaryColor);
        crownIndex += 1;
        treeIndex += 1;
      }
    });
    patches.instanceMatrix.needsUpdate = true;
    trunks.instanceMatrix.needsUpdate = true;
    crowns.instanceMatrix.needsUpdate = true;
    if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
    this.proceduralTreeVisuals.name = 'procedural-orchard-trees';
    this.proceduralTreeVisuals.add(trunks, crowns);
    this.root.add(patches, this.proceduralTreeVisuals);

    if (new URLSearchParams(window.location.search).get('trees') === 'procedural') return;
    this.environmentDiagnostics = {
      ...this.environmentDiagnostics,
      treeMode: 'loading',
      externalRequested: true,
    };
    void this.installImportedTrees(this.createTreePlacements());
  }

  private createTreePlacements(): TreePlacement[] {
    const placements: TreePlacement[] = [];
    OBSTACLES.forEach((obstacle, rowIndex) => {
      for (let index = 0; index < 3; index += 1) {
        placements.push({
          variant: index,
          x: obstacle.x + (index - 1) * obstacle.halfWidth * 0.72,
          z: obstacle.z,
          rotationY: rowIndex * 0.74 + index * 1.91,
        });
      }
    });
    return placements;
  }

  private async installImportedTrees(placements: readonly TreePlacement[]): Promise<void> {
    try {
      const imported = await loadForestTreeVisuals(placements);
      if (this.disposed) {
        disposeObject3D(imported.root);
        return;
      }
      this.proceduralTreeVisuals.visible = false;
      this.root.add(imported.root);
      this.environmentDiagnostics = {
        treeMode: 'imported',
        externalRequested: true,
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

  private async installImportedGuard(): Promise<void> {
    try {
      const imported = await loadImportedGuardView();
      if (this.disposed) {
        disposeImportedGuardView(imported);
        disposeObject3D(imported.root);
        return;
      }
      const procedural = this.guardViews.get('guard1');
      if (procedural) procedural.root.visible = false;
      this.importedGuardView = imported;
      this.root.add(imported.root);
      this.characterDiagnostics = {
        guard1Mode: 'imported',
        externalRequested: true,
        meshes: imported.meshes,
        triangles: imported.triangles,
        materials: imported.materialCount,
        textures: imported.textureCount,
        animations: [...imported.actions.keys()],
        currentAnimation: imported.currentAnimation,
        sockets: [...imported.sockets],
        lastFailure: null,
      };
    } catch (error) {
      this.characterDiagnostics = {
        ...this.characterDiagnostics,
        guard1Mode: 'procedural',
        lastFailure: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private createDeliveryZone(): void {
    const marker = new THREE.Mesh(
      new THREE.RingGeometry(1.72, 2.03, 36),
      new THREE.MeshBasicMaterial({
        color: '#f3d46d',
        transparent: true,
        opacity: 0.58,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    marker.rotation.x = -Math.PI / 2;
    marker.position.set(DELIVERY_ZONE.x, 0.025, DELIVERY_ZONE.z);
    this.root.add(marker);

    const basket = new THREE.Group();
    basket.position.set(DELIVERY_ZONE.x, 0, DELIVERY_ZONE.z);
    const inner = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.82, 0.42, 10), this.materials.basketCloth);
    inner.position.y = 0.23;
    inner.receiveShadow = true;
    basket.add(inner);

    const slats = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.materials.wood, 10);
    slats.castShadow = true;
    for (let index = 0; index < 10; index += 1) {
      const angle = index * Math.PI * 2 / 10;
      this.matrixDummy.position.set(Math.cos(angle) * 0.77, 0.28, Math.sin(angle) * 0.77);
      this.matrixDummy.rotation.set(0, -angle, Math.sin(angle) * 0.045);
      this.matrixDummy.scale.set(0.14, 0.54, 0.08);
      this.matrixDummy.updateMatrix();
      slats.setMatrixAt(index, this.matrixDummy.matrix);
    }
    slats.instanceMatrix.needsUpdate = true;
    basket.add(slats);

    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.82, 0.07, 5, 16), this.materials.woodDark);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.55;
    rim.castShadow = true;
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.055, 5, 16, Math.PI), this.materials.woodDark);
    handle.position.y = 0.5;
    handle.castShadow = true;
    basket.add(rim, handle);

    this.deliveryApples = new THREE.InstancedMesh(
      createAppleGeometry(1, 0.23),
      createAppleMaterial(0),
      DELIVERY_SLOTS.length,
    );
    this.deliveryApples.count = 0;
    this.deliveryApples.castShadow = true;
    basket.add(this.deliveryApples);
    this.root.add(basket);
  }

  private createApple(id: number): void {
    const root = new THREE.Group();
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
    root.add(body, stem, leaf, targetRing);
    this.appleViews.set(id, {
      root,
      body,
      stem,
      leaf,
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
    view.body.material.transparent = apple.lockTicks > 0;
    view.body.material.opacity = apple.lockTicks > 0 ? 0.62 : 1;
    view.body.material.emissiveIntensity = view.targetRing.visible ? 0.22 : 0.1;
    view.root.scale.setScalar(1);

    const target = this.appleTarget;
    if (apple.state === 'Carried') {
      const index = snapshot.kid.carriedAppleIds.indexOf(apple.id);
      this.getCarriedTarget(snapshot.kid, Math.max(0, index), target);
    } else if (apple.state === 'Delivered') {
      const deliveryIndex = view.transition?.deliveryIndex ?? Math.max(0, snapshot.delivered - 1);
      this.getDeliveryTarget(deliveryIndex, target);
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

    if (apple.state === 'Delivered') {
      view.root.visible = false;
      return;
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
      view.leaf.rotation.z = view.baseRotation * 0.22 + (reducedMotion ? 0 : Math.sin(time * 1.9 + apple.id) * 0.16);
    }
  }

  private syncDeliveryPile(snapshot: GameSnapshot, time: number): void {
    let pending = 0;
    for (const apple of snapshot.apples) {
      const transition = this.appleViews.get(apple.id)?.transition;
      if (apple.state === 'Delivered' && transition?.kind === 'delivery') {
        const progress = (time - transition.startedAt) / transition.duration;
        if (progress < 1) pending += 1;
      }
    }
    const visibleCount = THREE.MathUtils.clamp(snapshot.delivered - pending, 0, DELIVERY_SLOTS.length);
    this.deliveryApples.count = visibleCount;
    for (let index = 0; index < visibleCount; index += 1) {
      const slot = DELIVERY_SLOTS[index];
      this.matrixDummy.position.set(slot[0], slot[1], slot[2]);
      this.matrixDummy.rotation.set(index * 0.21, index * 1.17, index % 2 === 0 ? 0.12 : -0.16);
      this.matrixDummy.scale.set(1, 1, 1);
      this.matrixDummy.updateMatrix();
      this.deliveryApples.setMatrixAt(index, this.matrixDummy.matrix);
    }
    this.deliveryApples.instanceMatrix.needsUpdate = true;
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

  private getDeliveryTarget(index: number, target: THREE.Vector3): void {
    const slot = DELIVERY_SLOTS[THREE.MathUtils.clamp(index, 0, DELIVERY_SLOTS.length - 1)];
    target.set(DELIVERY_ZONE.x + slot[0], slot[1], DELIVERY_ZONE.z + slot[2]);
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
