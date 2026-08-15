import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { GAME_CONFIG } from '../game/config';
import type { KidSnapshot } from '../game/types';
import { ORCHARD_COLORS, type OrchardMaterials } from './OrchardMaterials';

const KID_ASSET_URL = `${import.meta.env.BASE_URL}assets/models/kaykit-adventurers/Rogue_Kid.glb`;
const KID_HEIGHT = 1.56;

const REQUIRED_ANIMATIONS = [
  'Idle_A',
  'Running_A',
  'PickUp',
  'Hit_A',
] as const;

type KidAnimationName = typeof REQUIRED_ANIMATIONS[number];

let kidAssetPromise: ReturnType<GLTFLoader['loadAsync']> | null = null;

export type ImportedKidView = {
  root: THREE.Group;
  motionRoot: THREE.Group;
  scene: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: Map<KidAnimationName, THREE.AnimationAction>;
  materials: THREE.MeshStandardMaterial[];
  backpack: THREE.Group;
  backpackBody: THREE.Mesh;
  stateRing: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  sweat: THREE.InstancedMesh;
  currentAnimation: KidAnimationName | null;
  lastUpdateTime: number;
  triangles: number;
  meshes: number;
  materialCount: number;
  textureCount: number;
  sockets: string[];
};

const matrixDummy = new THREE.Object3D();

export async function loadImportedKidView(materials: OrchardMaterials): Promise<ImportedKidView> {
  const gltf = await loadKidAsset();
  const clips = new Map(gltf.animations.map((clip) => [clip.name, clip]));
  for (const animation of REQUIRED_ANIMATIONS) {
    if (!clips.has(animation)) throw new Error(`Kid asset is missing animation: ${animation}`);
  }

  const root = new THREE.Group();
  root.name = 'imported-kid-root';
  const motionRoot = new THREE.Group();
  motionRoot.name = 'imported-kid-motion';
  root.add(motionRoot);

  const scene = cloneSkeleton(gltf.scene) as THREE.Group;
  scene.name = 'kaykit-rogue-kid';
  shareKidSkeleton(scene);
  scene.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(scene);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const scale = KID_HEIGHT / Math.max(size.y, 0.001);
  scene.scale.setScalar(scale);
  scene.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);

  const importedMaterials = new Set<THREE.MeshStandardMaterial>();
  const materialClones = new Map<THREE.Material, THREE.Material>();
  const textures = new Set<THREE.Texture>();
  let triangles = 0;
  let meshes = 0;
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    meshes += 1;
    object.castShadow = true;
    object.receiveShadow = true;
    const indexCount = object.geometry.index?.count;
    triangles += indexCount ? indexCount / 3 : (object.geometry.attributes.position?.count ?? 0) / 3;
    const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material];
    const objectMaterials = sourceMaterials.map((material) => {
      const cloned = materialClones.get(material) ?? material.clone();
      materialClones.set(material, cloned);
      return cloned;
    });
    object.material = Array.isArray(object.material) ? objectMaterials : objectMaterials[0] ?? object.material;
    for (const material of objectMaterials) {
      if (!(material instanceof THREE.MeshStandardMaterial)) continue;
      material.roughness = 0.84;
      material.metalness = 0;
      importedMaterials.add(material);
      for (const value of Object.values(material) as unknown[]) {
        if (value instanceof THREE.Texture) textures.add(value);
      }
    }
  });
  motionRoot.add(scene);

  const { root: backpack, body: backpackBody } = createBackpack(materials);
  motionRoot.add(backpack);

  const stateRing = new THREE.Mesh(
    new THREE.RingGeometry(0.5, 0.59, 24),
    new THREE.MeshBasicMaterial({
      color: ORCHARD_COLORS.reward,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  stateRing.rotation.x = -Math.PI / 2;
  stateRing.position.y = 0.035;
  root.add(stateRing);

  const sweat = new THREE.InstancedMesh(
    new THREE.OctahedronGeometry(0.11, 0),
    new THREE.MeshBasicMaterial({
      color: ORCHARD_COLORS.sweat,
      transparent: true,
      opacity: 0.86,
      depthWrite: false,
    }),
    4,
  );
  sweat.count = 0;
  sweat.frustumCulled = false;
  root.add(sweat);

  const mixer = new THREE.AnimationMixer(scene);
  const actions = new Map<KidAnimationName, THREE.AnimationAction>();
  for (const name of REQUIRED_ANIMATIONS) {
    const clip = clips.get(name);
    if (!clip) continue;
    const action = mixer.clipAction(clip);
    if (name === 'Idle_A' || name === 'Running_A') {
      action.setLoop(THREE.LoopRepeat, Number.POSITIVE_INFINITY);
    } else {
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
    }
    actions.set(name, action);
  }

  return {
    root,
    motionRoot,
    scene,
    mixer,
    actions,
    materials: [...importedMaterials],
    backpack,
    backpackBody,
    stateRing,
    sweat,
    currentAnimation: null,
    lastUpdateTime: 0,
    triangles,
    meshes,
    materialCount: importedMaterials.size,
    textureCount: textures.size,
    sockets: findSocketLabels(scene),
  };
}

export function syncImportedKidView(
  view: ImportedKidView,
  kid: KidSnapshot,
  time: number,
  reducedMotion: boolean,
): void {
  view.root.position.set(kid.position.x, 0, kid.position.z);
  view.root.rotation.y = Math.atan2(kid.facing.x, kid.facing.z);

  const load = kid.carriedAppleIds.length;
  const loadRatio = THREE.MathUtils.clamp(load / 6, 0, 1);
  const motion = reducedMotion ? 0 : kid.movementAmount;
  const gait = Math.sin(time * (8.5 + motion * 3));
  const breath = reducedMotion
    ? 0
    : Math.sin(time * (2.1 + loadRatio * 0.65)) * (0.009 + loadRatio * 0.009);
  const picking = kid.state === 'Picking' ? Math.sin(kid.pickingProgress * Math.PI / 2) : 0;
  const lean = loadRatio * 0.17 + motion * 0.035 + picking * 0.06;
  const wobble = reducedMotion ? 0 : gait * 0.025 * motion * (0.4 + loadRatio * 0.6);

  view.motionRoot.position.set(0, -picking * 0.035, 0);
  view.motionRoot.rotation.set(lean, 0, wobble);
  view.motionRoot.scale.set(1 - breath * 0.22, 1 + breath, 1 - breath * 0.22);

  const animation = selectAnimation(kid);
  const action = activateAnimation(view, animation, kid.state !== 'Normal');
  const delta = view.lastUpdateTime === 0
    ? 0
    : THREE.MathUtils.clamp(time - view.lastUpdateTime, 0, 0.1);
  view.lastUpdateTime = time;

  if (kid.state === 'Normal') {
    action.paused = reducedMotion;
    action.timeScale = animation === 'Running_A' ? 1.08 - loadRatio * 0.24 : 0.9;
    if (reducedMotion) action.time = 0;
    view.mixer.update(reducedMotion ? 0 : delta);
  } else {
    action.paused = true;
    action.time = stateAnimationTime(action.getClip().duration, kid);
    view.mixer.update(0);
  }

  view.backpack.position.set(0, 0.82 - loadRatio * 0.08, -0.31 - loadRatio * 0.05);
  view.backpack.rotation.set(-lean * 0.28, 0, -wobble * 1.35);
  view.backpackBody.scale.set(1 + loadRatio * 0.24, 1 + loadRatio * 0.12, 1 + loadRatio * 0.32);

  view.stateRing.visible = kid.state !== 'Normal';
  view.stateRing.material.color.set(
    kid.state === 'Picking' ? ORCHARD_COLORS.reward : ORCHARD_COLORS.invincible,
  );
  view.stateRing.material.opacity = kid.state === 'Invincible'
    ? reducedMotion ? 0.72 : 0.38 + Math.abs(Math.sin(time * 9)) * 0.46
    : 0.82;
  view.stateRing.rotation.z = reducedMotion ? 0 : -time * 1.4;

  for (const material of view.materials) {
    material.emissive.set(kid.state === 'Invincible' ? ORCHARD_COLORS.invincible : '#000000');
    material.emissiveIntensity = kid.state === 'Invincible' ? 0.42 : 0;
  }
  updateSweat(view, load, kid.movementAmount, time, reducedMotion);
}

export function disposeImportedKidView(view: ImportedKidView): void {
  view.mixer.stopAllAction();
  view.mixer.uncacheRoot(view.scene);
}

function selectAnimation(kid: KidSnapshot): KidAnimationName {
  if (kid.state === 'Picking') return 'PickUp';
  if (kid.state === 'Invincible') return 'Hit_A';
  return kid.movementAmount > 0.08 ? 'Running_A' : 'Idle_A';
}

function activateAnimation(
  view: ImportedKidView,
  name: KidAnimationName,
  immediate: boolean,
): THREE.AnimationAction {
  const action = view.actions.get(name);
  if (!action) throw new Error(`Kid animation action is unavailable: ${name}`);
  if (view.currentAnimation === name) return action;

  const previous = view.currentAnimation ? view.actions.get(view.currentAnimation) : undefined;
  action.reset().setEffectiveWeight(1).play();
  if (previous && immediate) previous.stop();
  else if (previous) action.crossFadeFrom(previous, 0.12, false);
  view.currentAnimation = name;
  return action;
}

function stateAnimationTime(duration: number, kid: KidSnapshot): number {
  if (kid.state === 'Picking') return kid.pickingProgress * duration;
  if (kid.state === 'Invincible') {
    const progress = 1 - kid.stateTicks / GAME_CONFIG.invincibleTicks;
    return Math.min(1, progress * 2.2) * duration;
  }
  return 0;
}

function createBackpack(materials: OrchardMaterials): { root: THREE.Group; body: THREE.Mesh } {
  const root = new THREE.Group();
  root.name = 'kid-apple-basket';
  const basketMaterial = new THREE.MeshStandardMaterial({
    color: ORCHARD_COLORS.kidAccent,
    roughness: 0.78,
    metalness: 0,
    flatShading: true,
  });
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.27, 0.22, 0.5, 6),
    basketMaterial,
  );
  body.castShadow = true;
  root.add(body);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.255, 0.032, 4, 8), materials.woodDark);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.25;
  rim.castShadow = true;
  root.add(rim);
  const strap = new THREE.Mesh(
    new THREE.TorusGeometry(0.33, 0.025, 4, 10, Math.PI),
    materials.woodDark,
  );
  strap.rotation.set(Math.PI / 2, 0, Math.PI / 2);
  strap.position.set(0, 0.12, 0.04);
  root.add(strap);
  return { root, body };
}

function findSocketLabels(scene: THREE.Group): string[] {
  const names: string[] = [];
  scene.traverse((object) => names.push(object.name.toLowerCase()));
  const sockets: string[] = [];
  if (names.includes('head')) sockets.push('head');
  if (names.some((name) => name.includes('handslot') && name.endsWith('l'))) sockets.push('left-hand');
  if (names.some((name) => name.includes('handslot') && name.endsWith('r'))) sockets.push('right-hand');
  if (names.includes('spine') || names.includes('chest')) sockets.push('back');
  return sockets;
}

function loadKidAsset(): ReturnType<GLTFLoader['loadAsync']> {
  kidAssetPromise ??= new GLTFLoader().loadAsync(KID_ASSET_URL);
  return kidAssetPromise;
}

function shareKidSkeleton(scene: THREE.Group): void {
  let sharedSkeleton: THREE.Skeleton | null = null;
  scene.traverse((object) => {
    if (!(object instanceof THREE.SkinnedMesh)) return;
    if (!sharedSkeleton) {
      sharedSkeleton = object.skeleton;
      return;
    }
    const sameBones = object.skeleton.bones.length === sharedSkeleton.bones.length &&
      object.skeleton.bones.every((bone, index) => bone === sharedSkeleton?.bones[index]);
    if (sameBones) object.bind(sharedSkeleton, object.bindMatrix);
  });
}

function updateSweat(
  view: ImportedKidView,
  load: number,
  movementAmount: number,
  time: number,
  reducedMotion: boolean,
): void {
  const active = load >= 4 && movementAmount > 0.2;
  if (!active) {
    view.sweat.count = 0;
    return;
  }

  const count = reducedMotion ? 1 : load >= 6 ? 4 : 2;
  view.sweat.count = count;
  for (let index = 0; index < count; index += 1) {
    const phase = reducedMotion ? 0.22 : (time * 1.6 + index / count) % 1;
    const side = index % 2 === 0 ? -1 : 1;
    matrixDummy.position.set(
      side * (0.42 + phase * 0.16),
      1.36 + phase * 0.28,
      0.12 - phase * 0.22,
    );
    matrixDummy.rotation.set(0, 0, side * 0.28);
    matrixDummy.scale.set(0.78 - phase * 0.25, 1.12 - phase * 0.38, 0.78 - phase * 0.25);
    matrixDummy.updateMatrix();
    view.sweat.setMatrixAt(index, matrixDummy.matrix);
  }
  view.sweat.instanceMatrix.needsUpdate = true;
}
