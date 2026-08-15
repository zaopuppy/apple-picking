import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GAME_CONFIG } from '../game/config';
import type { GuardSnapshot } from '../game/types';
import { ORCHARD_COLORS } from './OrchardMaterials';

const GUARD_ASSET_URL = `${import.meta.env.BASE_URL}assets/models/kaykit-adventurers/Ranger_Guard.glb`;

const REQUIRED_ANIMATIONS = [
  'Idle_A',
  'Running_A',
  'Jump_Full_Short',
  'Jump_Land',
  'Hit_A',
] as const;

type GuardAnimationName = typeof REQUIRED_ANIMATIONS[number];

export type ImportedGuardView = {
  root: THREE.Group;
  motionRoot: THREE.Group;
  scene: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: Map<GuardAnimationName, THREE.AnimationAction>;
  materials: THREE.MeshStandardMaterial[];
  stateRing: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  stunMarks: THREE.InstancedMesh;
  currentAnimation: GuardAnimationName | null;
  lastUpdateTime: number;
  triangles: number;
  meshes: number;
  materialCount: number;
  textureCount: number;
  sockets: string[];
};

const matrixDummy = new THREE.Object3D();

export async function loadImportedGuardView(): Promise<ImportedGuardView> {
  const gltf = await new GLTFLoader().loadAsync(GUARD_ASSET_URL);
  const clips = new Map(gltf.animations.map((clip) => [clip.name, clip]));
  for (const animation of REQUIRED_ANIMATIONS) {
    if (!clips.has(animation)) throw new Error(`Guard asset is missing animation: ${animation}`);
  }

  const root = new THREE.Group();
  root.name = 'imported-guard1-root';
  const motionRoot = new THREE.Group();
  motionRoot.name = 'imported-guard1-motion';
  root.add(motionRoot);

  const scene = gltf.scene;
  scene.name = 'kaykit-ranger-guard';
  scene.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(scene);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const scale = 1.72 / Math.max(size.y, 0.001);
  scene.scale.setScalar(scale);
  scene.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);

  const materials = new Set<THREE.MeshStandardMaterial>();
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
    const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of objectMaterials) {
      if (!(material instanceof THREE.MeshStandardMaterial)) continue;
      material.roughness = 0.82;
      material.metalness = 0;
      materials.add(material);
      for (const value of Object.values(material) as unknown[]) {
        if (value instanceof THREE.Texture) textures.add(value);
      }
    }
  });
  motionRoot.add(scene);
  const cap = createGuardCap();
  cap.position.set(0, 1.57, 0.015);
  motionRoot.add(cap);

  const stateRing = new THREE.Mesh(
    new THREE.RingGeometry(0.58, 0.67, 24),
    new THREE.MeshBasicMaterial({
      color: ORCHARD_COLORS.guardBlueAccent,
      transparent: true,
      opacity: 0.78,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  stateRing.rotation.x = -Math.PI / 2;
  stateRing.position.y = 0.035;
  root.add(stateRing);

  const stunMarks = new THREE.InstancedMesh(
    new THREE.TetrahedronGeometry(0.1, 0),
    new THREE.MeshBasicMaterial({
      color: ORCHARD_COLORS.reward,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
    }),
    3,
  );
  stunMarks.count = 0;
  stunMarks.frustumCulled = false;
  root.add(stunMarks);

  const mixer = new THREE.AnimationMixer(scene);
  const actions = new Map<GuardAnimationName, THREE.AnimationAction>();
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
    materials: [...materials],
    stateRing,
    stunMarks,
    currentAnimation: null,
    lastUpdateTime: 0,
    triangles,
    meshes,
    materialCount: materials.size,
    textureCount: textures.size,
    sockets: findSocketLabels(scene),
  };
}

export function syncImportedGuardView(
  view: ImportedGuardView,
  guard: GuardSnapshot,
  time: number,
  reducedMotion: boolean,
): void {
  view.root.position.set(guard.position.x, 0, guard.position.z);
  view.root.rotation.y = Math.atan2(guard.facing.x, guard.facing.z);
  view.motionRoot.position.set(0, 0, 0);
  view.motionRoot.rotation.set(0, 0, 0);
  view.motionRoot.scale.set(1, 1, 1);

  const animation = selectAnimation(guard);
  const action = activateAnimation(view, animation, guard.state !== 'Move');
  const delta = view.lastUpdateTime === 0
    ? 0
    : THREE.MathUtils.clamp(time - view.lastUpdateTime, 0, 0.1);
  view.lastUpdateTime = time;

  if (guard.state === 'Move') {
    action.paused = reducedMotion;
    action.timeScale = animation === 'Running_A' ? 1.12 : 0.88;
    if (reducedMotion) action.time = 0;
    view.mixer.update(reducedMotion ? 0 : delta);
    const cooldownSlump = guard.pounceReady ? 0 : 0.07;
    view.motionRoot.rotation.x = cooldownSlump;
    view.motionRoot.position.y = guard.pounceReady ? -0.025 : 0;
  } else {
    action.paused = true;
    action.time = stateAnimationTime(action.getClip().duration, guard);
    view.mixer.update(0);
  }

  if (guard.state === 'Pounce') {
    view.motionRoot.position.y = 0.05;
    view.motionRoot.rotation.x = 0.34;
    view.motionRoot.scale.set(0.96, 0.91, 1.1);
  } else if (guard.state === 'Recover') {
    const remaining = THREE.MathUtils.clamp(guard.stateTicks / GAME_CONFIG.recoverTicks, 0, 1);
    const down = THREE.MathUtils.smoothstep(remaining, 0, 1);
    view.motionRoot.position.y = 0.03 * down;
    view.motionRoot.rotation.x = 0.58 * down;
    view.motionRoot.scale.set(1.02, 1 - down * 0.08, 1.03);
  } else if (guard.state === 'Stunned') {
    view.motionRoot.position.y = 0.1;
    view.motionRoot.rotation.z = 1.02;
    view.motionRoot.scale.set(1.04, 0.94, 1);
  }

  view.stateRing.visible = guard.state !== 'Move' || !guard.pounceReady;
  view.stateRing.material.color.set(
    guard.state === 'Stunned'
      ? ORCHARD_COLORS.reward
      : guard.state === 'Recover'
        ? '#e2a43a'
        : guard.state === 'Pounce'
          ? '#b8d9ff'
          : '#d7d5b0',
  );
  view.stateRing.material.opacity = guard.state === 'Move' ? 0.42 : 0.78;
  view.stateRing.rotation.z = reducedMotion ? 0 : time * (guard.state === 'Stunned' ? 3.8 : 1.1);

  for (const material of view.materials) {
    material.emissive.set(guard.state === 'Pounce' ? '#5ea9ff' : '#000000');
    material.emissiveIntensity = guard.state === 'Pounce' ? 0.1 : 0;
  }
  updateStunMarks(view, guard.state === 'Stunned', time, reducedMotion);
}

export function disposeImportedGuardView(view: ImportedGuardView): void {
  view.mixer.stopAllAction();
  view.mixer.uncacheRoot(view.scene);
}

function selectAnimation(guard: GuardSnapshot): GuardAnimationName {
  if (guard.state === 'Pounce') return 'Jump_Full_Short';
  if (guard.state === 'Recover') return 'Jump_Land';
  if (guard.state === 'Stunned') return 'Hit_A';
  return guard.movementAmount > 0.08 ? 'Running_A' : 'Idle_A';
}

function activateAnimation(
  view: ImportedGuardView,
  name: GuardAnimationName,
  immediate: boolean,
): THREE.AnimationAction {
  const action = view.actions.get(name);
  if (!action) throw new Error(`Guard animation action is unavailable: ${name}`);
  if (view.currentAnimation === name) return action;

  const previous = view.currentAnimation ? view.actions.get(view.currentAnimation) : undefined;
  action.reset().setEffectiveWeight(1).play();
  if (previous && immediate) previous.stop();
  else if (previous) action.crossFadeFrom(previous, 0.12, false);
  view.currentAnimation = name;
  return action;
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

function stateAnimationTime(duration: number, guard: GuardSnapshot): number {
  if (guard.state === 'Pounce') {
    return (1 - guard.stateTicks / GAME_CONFIG.pounceTicks) * duration;
  }
  if (guard.state === 'Recover') {
    return (1 - guard.stateTicks / GAME_CONFIG.recoverTicks) * duration;
  }
  if (guard.state === 'Stunned') {
    const progress = 1 - guard.stateTicks / GAME_CONFIG.stunTicks;
    return Math.min(1, progress * 2.4) * duration;
  }
  return 0;
}

function createGuardCap(): THREE.Group {
  const cap = new THREE.Group();
  cap.name = 'guard-identity-cap';
  const material = new THREE.MeshStandardMaterial({
    color: ORCHARD_COLORS.guardBlue,
    roughness: 0.76,
    metalness: 0,
    flatShading: true,
  });
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, 0.16, 8), material);
  crown.position.y = 0.08;
  crown.castShadow = true;
  const brim = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.045, 0.3), material);
  brim.position.set(0, 0.015, 0.07);
  brim.castShadow = true;
  cap.add(crown, brim);
  return cap;
}

function updateStunMarks(
  view: ImportedGuardView,
  active: boolean,
  time: number,
  reducedMotion: boolean,
): void {
  if (!active) {
    view.stunMarks.count = 0;
    return;
  }
  view.stunMarks.count = 3;
  for (let index = 0; index < 3; index += 1) {
    const angle = index * Math.PI * 2 / 3 + (reducedMotion ? 0 : time * 2.4);
    matrixDummy.position.set(Math.cos(angle) * 0.42, 1.72 + Math.sin(angle * 2) * 0.04, Math.sin(angle) * 0.42);
    matrixDummy.rotation.set(angle, angle * 0.7, 0);
    matrixDummy.scale.setScalar(index === 0 ? 1.05 : 0.82);
    matrixDummy.updateMatrix();
    view.stunMarks.setMatrixAt(index, matrixDummy.matrix);
  }
  view.stunMarks.instanceMatrix.needsUpdate = true;
}
