import * as THREE from 'three';

export type VfxKind = 'pickup' | 'drop' | 'capture' | 'delivery' | 'pounce' | 'stun';

type VfxStyle = {
  color: string;
  duration: number;
  radius: number;
  lift: number;
};

type VfxSlot = {
  root: THREE.Group;
  ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  particles: THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  active: boolean;
  startedAt: number;
  style: VfxStyle;
  seed: number;
};

const SLOT_COUNT = 12;
const PARTICLE_COUNT = 5;
const matrixDummy = new THREE.Object3D();

const STYLES: Record<VfxKind, VfxStyle> = {
  pickup: { color: '#ffe071', duration: 0.34, radius: 0.85, lift: 0.55 },
  drop: { color: '#d7ad73', duration: 0.3, radius: 0.62, lift: 0.25 },
  capture: { color: '#ef6a4a', duration: 0.48, radius: 1.35, lift: 0.8 },
  delivery: { color: '#fff0a2', duration: 0.46, radius: 1.1, lift: 0.72 },
  pounce: { color: '#b8d9ff', duration: 0.26, radius: 0.75, lift: 0.32 },
  stun: { color: '#ffe071', duration: 0.52, radius: 1.2, lift: 0.9 },
};

export class VfxSystem {
  readonly root = new THREE.Group();

  private readonly slots: VfxSlot[] = [];
  private nextSlot = 0;

  constructor(parent: THREE.Object3D) {
    for (let index = 0; index < SLOT_COUNT; index += 1) {
      const root = new THREE.Group();
      root.visible = false;
      const ringMaterial = new THREE.MeshBasicMaterial({
        color: '#ffffff',
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.58, 24), ringMaterial);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.045;
      const particleMaterial = new THREE.MeshBasicMaterial({
        color: '#ffffff',
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const particles = new THREE.InstancedMesh(
        new THREE.TetrahedronGeometry(0.075, 0),
        particleMaterial,
        PARTICLE_COUNT,
      );
      particles.frustumCulled = false;
      root.add(ring, particles);
      this.root.add(root);
      this.slots.push({
        root,
        ring,
        particles,
        active: false,
        startedAt: 0,
        style: STYLES.pickup,
        seed: index,
      });
    }
    parent.add(this.root);
  }

  emit(kind: VfxKind, position: THREE.Vector3, time: number, seed = 0): void {
    const slot = this.slots[this.nextSlot];
    this.nextSlot = (this.nextSlot + 1) % this.slots.length;
    slot.active = true;
    slot.startedAt = time;
    slot.style = STYLES[kind];
    slot.seed = seed;
    slot.root.visible = true;
    slot.root.position.copy(position);
    slot.ring.material.color.set(slot.style.color);
    slot.particles.material.color.set(slot.style.color);
  }

  update(time: number, reducedMotion: boolean): void {
    for (const slot of this.slots) {
      if (!slot.active) continue;
      const rawProgress = (time - slot.startedAt) / slot.style.duration;
      if (rawProgress < 0) {
        slot.root.visible = false;
        continue;
      }
      if (rawProgress >= 1) {
        slot.active = false;
        slot.root.visible = false;
        continue;
      }
      slot.root.visible = true;
      const progress = THREE.MathUtils.clamp(rawProgress, 0, 1);
      const eased = 1 - (1 - progress) ** 3;
      const fade = 1 - progress;
      const motionScale = reducedMotion ? 0.35 : 1;
      slot.ring.scale.setScalar(0.35 + eased * slot.style.radius);
      slot.ring.material.opacity = fade * 0.72;
      slot.ring.position.y = 0.045 + eased * 0.08 * motionScale;
      slot.particles.material.opacity = fade * 0.9;

      for (let index = 0; index < PARTICLE_COUNT; index += 1) {
        const angle = index * Math.PI * 2 / PARTICLE_COUNT + slot.seed * 0.73;
        const radius = eased * slot.style.radius * (0.45 + index * 0.07) * motionScale;
        matrixDummy.position.set(
          Math.cos(angle) * radius,
          0.12 + Math.sin(progress * Math.PI) * slot.style.lift * motionScale,
          Math.sin(angle) * radius,
        );
        matrixDummy.rotation.set(angle + progress * 2, progress * 3 + index, angle * 0.4);
        matrixDummy.scale.setScalar((0.55 + index * 0.08) * fade);
        matrixDummy.updateMatrix();
        slot.particles.setMatrixAt(index, matrixDummy.matrix);
      }
      slot.particles.instanceMatrix.needsUpdate = true;
    }
  }

  clear(): void {
    for (const slot of this.slots) {
      slot.active = false;
      slot.root.visible = false;
    }
  }
}
