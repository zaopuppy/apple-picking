import * as THREE from 'three';
import type { KidSnapshot } from '../game/types';
import {
  createCharacterMaterial,
  ORCHARD_COLORS,
  type OrchardMaterials,
} from './OrchardMaterials';

type Limb = {
  pivot: THREE.Group;
  mesh: THREE.Mesh;
};

export type CharacterView = {
  root: THREE.Group;
  model: THREE.Group;
  torso: THREE.Mesh;
  headPivot: THREE.Group;
  leftArm: Limb;
  rightArm: Limb;
  leftLeg: Limb;
  rightLeg: Limb;
  bodyMaterial: THREE.MeshStandardMaterial;
  stateRing: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  hat: THREE.Group;
  backpack: THREE.Group | null;
  backpackBody: THREE.Mesh | null;
  sweat: THREE.InstancedMesh | null;
};

const matrixDummy = new THREE.Object3D();

export function createKidCharacter(materials: OrchardMaterials): CharacterView {
  const bodyMaterial = createCharacterMaterial(ORCHARD_COLORS.kidCloth, 0.76);
  const accentMaterial = createCharacterMaterial(ORCHARD_COLORS.kidAccent, 0.7);
  const skinMaterial = createCharacterMaterial(ORCHARD_COLORS.kidSkin, 0.82);
  const hairMaterial = createCharacterMaterial(ORCHARD_COLORS.kidHair, 0.9);
  const view = createBaseCharacter(bodyMaterial, accentMaterial, materials);

  view.torso.geometry.dispose();
  view.torso.geometry = new THREE.DodecahedronGeometry(0.46, 0);
  view.torso.scale.set(0.78, 1.08, 0.72);
  view.torso.position.y = 0.78;

  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.29, 1), skinMaterial);
  head.castShadow = true;
  view.headPivot.position.set(0, 1.27, 0.01);
  view.headPivot.add(head);

  const hair = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.13, 8), hairMaterial);
  hair.position.y = 0.25;
  hair.castShadow = true;
  view.hat.add(hair);
  const hairTuft = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.24, 5), hairMaterial);
  hairTuft.position.set(0.12, 0.37, -0.03);
  hairTuft.rotation.z = -0.35;
  hairTuft.castShadow = true;
  view.hat.add(hairTuft);

  const face = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.1, 0.045), materials.faceDark);
  face.position.set(0, -0.01, 0.276);
  view.headPivot.add(face);

  const backpack = new THREE.Group();
  backpack.position.set(0, 0.78, -0.35);
  const backpackBody = new THREE.Mesh(
    new THREE.CylinderGeometry(0.27, 0.22, 0.5, 6),
    accentMaterial,
  );
  backpackBody.castShadow = true;
  backpack.add(backpackBody);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.255, 0.032, 4, 8), materials.woodDark);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.25;
  rim.castShadow = true;
  backpack.add(rim);
  const strap = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.025, 4, 10, Math.PI), materials.woodDark);
  strap.rotation.set(Math.PI / 2, 0, Math.PI / 2);
  strap.position.set(0, 0.12, 0.04);
  backpack.add(strap);
  view.model.add(backpack);
  view.backpack = backpack;
  view.backpackBody = backpackBody;

  const sweatMaterial = new THREE.MeshBasicMaterial({
    color: ORCHARD_COLORS.sweat,
    transparent: true,
    opacity: 0.86,
    depthWrite: false,
  });
  view.sweat = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.11, 0), sweatMaterial, 4);
  view.sweat.count = 0;
  view.sweat.frustumCulled = false;
  view.root.add(view.sweat);

  return view;
}

export function syncKidCharacter(
  view: CharacterView,
  kid: KidSnapshot,
  time: number,
  reducedMotion: boolean,
): void {
  view.root.position.set(kid.position.x, 0, kid.position.z);
  view.root.rotation.y = Math.atan2(kid.facing.x, kid.facing.z);

  const load = kid.carriedAppleIds.length;
  const loadRatio = load / 6;
  const motion = reducedMotion ? 0 : kid.movementAmount;
  const gait = Math.sin(time * (8.5 + motion * 4));
  const breath = reducedMotion ? 0 : Math.sin(time * (2.2 + loadRatio * 0.7)) * (0.018 + loadRatio * 0.02);
  const picking = kid.state === 'Picking' ? Math.sin(kid.pickingProgress * Math.PI / 2) : 0;
  const bob = reducedMotion ? 0 : Math.abs(gait) * 0.035 * motion;
  const lean = loadRatio * 0.18 + motion * 0.05 + picking * 0.32;

  view.model.position.set(0, bob - picking * 0.08, 0);
  view.model.rotation.set(lean, 0, reducedMotion ? 0 : gait * 0.025 * motion);
  view.model.scale.set(1, 1, 1);
  view.torso.scale.set(0.78 - breath * 0.35, 1.08 + breath, 0.72 - breath * 0.35);
  view.headPivot.rotation.set(-lean * 0.42, reducedMotion ? 0 : -gait * 0.025 * motion, 0);
  view.hat.rotation.set(0, 0, 0);

  const stride = gait * 0.65 * motion * (1 - loadRatio * 0.42);
  view.leftLeg.pivot.rotation.set(stride, 0, loadRatio * 0.08);
  view.rightLeg.pivot.rotation.set(-stride, 0, -loadRatio * 0.08);
  view.leftArm.pivot.rotation.set(-stride * 0.72 - picking * 1.05, 0, -0.08 - loadRatio * 0.16);
  view.rightArm.pivot.rotation.set(stride * 0.72 - picking * 1.05, 0, 0.08 + loadRatio * 0.16);

  if (view.backpack && view.backpackBody) {
    view.backpack.position.set(0, 0.78 - loadRatio * 0.08, -0.35 - loadRatio * 0.04);
    view.backpack.rotation.set(-lean * 0.35, 0, reducedMotion ? 0 : -gait * 0.04 * motion);
    view.backpackBody.scale.set(1 + loadRatio * 0.24, 1 + loadRatio * 0.12, 1 + loadRatio * 0.32);
  }

  view.stateRing.visible = kid.state !== 'Normal';
  view.stateRing.material.color.set(kid.state === 'Picking' ? ORCHARD_COLORS.reward : ORCHARD_COLORS.invincible);
  view.stateRing.material.opacity = kid.state === 'Invincible'
    ? reducedMotion ? 0.72 : 0.38 + Math.abs(Math.sin(time * 9)) * 0.46
    : 0.82;
  view.stateRing.rotation.z = reducedMotion ? 0 : -time * 1.4;

  view.bodyMaterial.emissive.set(kid.state === 'Invincible' ? ORCHARD_COLORS.invincible : '#000000');
  view.bodyMaterial.emissiveIntensity = kid.state === 'Invincible' ? 0.48 : 0;
  updateSweat(view, load, kid.movementAmount, time, reducedMotion);
}

function createBaseCharacter(
  bodyMaterial: THREE.MeshStandardMaterial,
  accentMaterial: THREE.MeshStandardMaterial,
  materials: OrchardMaterials,
): CharacterView {
  const root = new THREE.Group();
  const model = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.DodecahedronGeometry(0.48, 0), bodyMaterial);
  torso.castShadow = true;
  model.add(torso);

  const headPivot = new THREE.Group();
  const hat = new THREE.Group();
  headPivot.add(hat);
  model.add(headPivot);

  const armGeometry = new THREE.CapsuleGeometry(0.075, 0.3, 2, 6);
  const legGeometry = new THREE.CapsuleGeometry(0.085, 0.25, 2, 6);
  const leftArm = createLimb(armGeometry, bodyMaterial, -0.38, 0.94, 0);
  const rightArm = createLimb(armGeometry, bodyMaterial, 0.38, 0.94, 0);
  const leftLeg = createLimb(legGeometry, materials.boot, -0.16, 0.53, 0.02);
  const rightLeg = createLimb(legGeometry, materials.boot, 0.16, 0.53, 0.02);
  model.add(leftArm.pivot, rightArm.pivot, leftLeg.pivot, rightLeg.pivot);

  const stateRing = new THREE.Mesh(
    new THREE.RingGeometry(0.5, 0.57, 24),
    new THREE.MeshBasicMaterial({
      color: accentMaterial.color,
      transparent: true,
      opacity: 0.78,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  stateRing.rotation.x = -Math.PI / 2;
  stateRing.position.y = 0.035;
  root.add(model, stateRing);

  return {
    root,
    model,
    torso,
    headPivot,
    leftArm,
    rightArm,
    leftLeg,
    rightLeg,
    bodyMaterial,
    stateRing,
    hat,
    backpack: null,
    backpackBody: null,
    sweat: null,
  };
}

function createLimb(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  x: number,
  y: number,
  z: number,
): Limb {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, z);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = -0.23;
  mesh.castShadow = true;
  pivot.add(mesh);
  return { pivot, mesh };
}

function updateSweat(
  view: CharacterView,
  load: number,
  movementAmount: number,
  time: number,
  reducedMotion: boolean,
): void {
  if (!view.sweat) return;
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
    matrixDummy.position.set(side * (0.42 + phase * 0.16), 1.43 + phase * 0.28, 0.12 - phase * 0.22);
    matrixDummy.rotation.set(0, 0, side * 0.28);
    matrixDummy.scale.set(0.78 - phase * 0.25, 1.12 - phase * 0.38, 0.78 - phase * 0.25);
    matrixDummy.updateMatrix();
    view.sweat.setMatrixAt(index, matrixDummy.matrix);
  }
  view.sweat.instanceMatrix.needsUpdate = true;
}
