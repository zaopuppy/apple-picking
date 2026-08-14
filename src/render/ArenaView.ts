import * as THREE from 'three';
import { APPLE_SPAWNS, DELIVERY_ZONE, GAME_CONFIG, OBSTACLES } from '../game/config';
import type { AppleSnapshot, GameSnapshot, GuardSnapshot, KidSnapshot } from '../game/types';
import { disposeObject3D } from '../utils/dispose';

type CharacterView = {
  root: THREE.Group;
  model: THREE.Group;
  bodyMaterial: THREE.MeshStandardMaterial;
  stateRing: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
};

type AppleView = {
  root: THREE.Group;
  bodyMaterial: THREE.MeshStandardMaterial;
  targetRing: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
};

export class ArenaView {
  readonly root = new THREE.Group();

  private readonly guardViews = new Map<GuardSnapshot['id'], CharacterView>();
  private readonly kidView: CharacterView;
  private readonly appleViews = new Map<number, AppleView>();
  private readonly pickingRing: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;

  constructor(scene: THREE.Scene) {
    this.createWorld();
    this.guardViews.set('guard1', this.createCharacter('#2962a3', '#d8edff', 'guard'));
    this.guardViews.set('guard2', this.createCharacter('#4f7c3a', '#e6f4cf', 'guard'));
    this.kidView = this.createCharacter('#e65c38', '#ffd45c', 'kid');
    for (let id = 0; id < APPLE_SPAWNS.length; id += 1) this.createApple(id);

    this.pickingRing = new THREE.Mesh(
      new THREE.RingGeometry(0.62, 0.76, 40),
      new THREE.MeshBasicMaterial({ color: '#ffd45c', side: THREE.DoubleSide, transparent: true }),
    );
    this.pickingRing.rotation.x = -Math.PI / 2;
    this.pickingRing.position.y = 0.035;
    this.pickingRing.visible = false;
    this.root.add(this.pickingRing);
    scene.add(this.root);
  }

  sync(snapshot: GameSnapshot, renderTime: number, reducedMotion: boolean): void {
    for (const guard of snapshot.guards) {
      const view = this.guardViews.get(guard.id);
      if (view) this.syncGuard(view, guard, renderTime, reducedMotion);
    }
    this.syncKid(this.kidView, snapshot.kid, renderTime, reducedMotion);
    for (const apple of snapshot.apples) this.syncApple(apple, snapshot, renderTime, reducedMotion);

    const target = snapshot.kid.pickingTargetId === null
      ? null
      : snapshot.apples.find((apple) => apple.id === snapshot.kid.pickingTargetId);
    this.pickingRing.visible = snapshot.kid.state === 'Picking';
    if (this.pickingRing.visible) {
      this.pickingRing.position.x = snapshot.kid.position.x;
      this.pickingRing.position.z = snapshot.kid.position.z;
      const progress = 0.22 + snapshot.kid.pickingProgress * 0.78;
      this.pickingRing.scale.setScalar(progress);
      this.pickingRing.material.opacity = 0.5 + snapshot.kid.pickingProgress * 0.5;
      if (target) {
        const targetView = this.appleViews.get(target.id);
        if (targetView) targetView.targetRing.visible = true;
      }
    }
  }

  dispose(): void {
    disposeObject3D(this.root);
    this.root.removeFromParent();
  }

  private createWorld(): void {
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(GAME_CONFIG.arenaHalfWidth * 2, GAME_CONFIG.arenaHalfDepth * 2),
      new THREE.MeshStandardMaterial({ color: '#8eae62', roughness: 0.96, metalness: 0 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.root.add(floor);

    const soilMaterial = new THREE.MeshStandardMaterial({ color: '#6f5435', roughness: 1 });
    const stripeGeometry = new THREE.PlaneGeometry(GAME_CONFIG.arenaHalfWidth * 2 - 1, 0.12);
    for (let z = -7.5; z <= 7.5; z += 1.5) {
      const stripe = new THREE.Mesh(stripeGeometry, soilMaterial);
      stripe.rotation.x = -Math.PI / 2;
      stripe.position.set(0, 0.008, z);
      stripe.material = soilMaterial;
      this.root.add(stripe);
    }

    this.createFence();
    OBSTACLES.forEach((obstacle, index) => this.createTreeRow(obstacle.x, obstacle.z, obstacle.halfWidth, index));
    this.createDeliveryZone();
  }

  private createFence(): void {
    const wood = new THREE.MeshStandardMaterial({ color: '#725139', roughness: 0.82 });
    const postGeometry = new THREE.BoxGeometry(0.18, 0.9, 0.18);
    const railHorizontal = new THREE.BoxGeometry(GAME_CONFIG.arenaHalfWidth * 2 + 0.5, 0.14, 0.14);
    const railVertical = new THREE.BoxGeometry(0.14, 0.14, GAME_CONFIG.arenaHalfDepth * 2 + 0.5);
    for (const z of [-GAME_CONFIG.arenaHalfDepth - 0.18, GAME_CONFIG.arenaHalfDepth + 0.18]) {
      for (const y of [0.3, 0.65]) {
        const rail = new THREE.Mesh(railHorizontal, wood);
        rail.position.set(0, y, z);
        rail.castShadow = true;
        this.root.add(rail);
      }
    }
    for (const x of [-GAME_CONFIG.arenaHalfWidth - 0.18, GAME_CONFIG.arenaHalfWidth + 0.18]) {
      for (const y of [0.3, 0.65]) {
        const rail = new THREE.Mesh(railVertical, wood);
        rail.position.set(x, y, 0);
        rail.castShadow = true;
        this.root.add(rail);
      }
    }
    for (let x = -GAME_CONFIG.arenaHalfWidth; x <= GAME_CONFIG.arenaHalfWidth; x += 3) {
      for (const z of [-GAME_CONFIG.arenaHalfDepth - 0.18, GAME_CONFIG.arenaHalfDepth + 0.18]) {
        const post = new THREE.Mesh(postGeometry, wood);
        post.position.set(x, 0.45, z);
        post.castShadow = true;
        this.root.add(post);
      }
    }
    for (let z = -GAME_CONFIG.arenaHalfDepth; z <= GAME_CONFIG.arenaHalfDepth; z += 3) {
      for (const x of [-GAME_CONFIG.arenaHalfWidth - 0.18, GAME_CONFIG.arenaHalfWidth + 0.18]) {
        const post = new THREE.Mesh(postGeometry, wood);
        post.position.set(x, 0.45, z);
        post.castShadow = true;
        this.root.add(post);
      }
    }
  }

  private createTreeRow(x: number, z: number, halfWidth: number, rowIndex: number): void {
    const patch = new THREE.Mesh(
      new THREE.BoxGeometry(halfWidth * 2, 0.12, 1.35),
      new THREE.MeshStandardMaterial({ color: '#765735', roughness: 1 }),
    );
    patch.position.set(x, 0.06, z);
    patch.receiveShadow = true;
    this.root.add(patch);

    const trunkGeometry = new THREE.CylinderGeometry(0.17, 0.22, 1.15, 8);
    const crownGeometry = new THREE.IcosahedronGeometry(0.72, 1);
    const trunkMaterial = new THREE.MeshStandardMaterial({ color: '#6c4931', roughness: 0.92 });
    const crownMaterial = new THREE.MeshStandardMaterial({
      color: rowIndex % 2 === 0 ? '#3e743c' : '#4d823f',
      roughness: 0.88,
    });
    const count = 3;
    for (let index = 0; index < count; index += 1) {
      const offset = (index - 1) * halfWidth * 0.72;
      const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
      trunk.position.set(x + offset, 0.64, z);
      trunk.castShadow = true;
      const crown = new THREE.Mesh(crownGeometry, crownMaterial);
      crown.position.set(x + offset, 1.62, z);
      crown.scale.set(1, 0.82, 1);
      crown.castShadow = true;
      this.root.add(trunk, crown);
    }
  }

  private createDeliveryZone(): void {
    const funnel = new THREE.Mesh(
      new THREE.CylinderGeometry(2.02, 2.48, 0.16, 48, 1, true),
      new THREE.MeshStandardMaterial({
        color: '#e4c75d',
        emissive: '#6c5410',
        emissiveIntensity: 0.18,
        roughness: 0.8,
        side: THREE.DoubleSide,
      }),
    );
    funnel.position.set(DELIVERY_ZONE.x, 0.02, DELIVERY_ZONE.z);
    this.root.add(funnel);

    const center = new THREE.Mesh(
      new THREE.CircleGeometry(2.02, 48),
      new THREE.MeshStandardMaterial({ color: '#f2dd85', roughness: 0.86 }),
    );
    center.rotation.x = -Math.PI / 2;
    center.position.set(DELIVERY_ZONE.x, 0.025, DELIVERY_ZONE.z);
    center.receiveShadow = true;
    this.root.add(center);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.84, 2.04, 48),
      new THREE.MeshBasicMaterial({ color: '#fff5bd', side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(DELIVERY_ZONE.x, 0.04, DELIVERY_ZONE.z);
    this.root.add(ring);
  }

  private createCharacter(bodyColor: string, accentColor: string, role: 'guard' | 'kid'): CharacterView {
    const root = new THREE.Group();
    const model = new THREE.Group();
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.58 });
    const accentMaterial = new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.5 });
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(role === 'guard' ? 0.38 : 0.32, role === 'guard' ? 0.58 : 0.46, 5, 10),
      bodyMaterial,
    );
    body.position.y = role === 'guard' ? 0.75 : 0.64;
    body.castShadow = true;
    model.add(body);

    const head = new THREE.Mesh(new THREE.SphereGeometry(role === 'guard' ? 0.3 : 0.27, 12, 8), accentMaterial);
    head.position.y = role === 'guard' ? 1.35 : 1.16;
    head.castShadow = true;
    model.add(head);

    const direction = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.48, 5), accentMaterial);
    direction.rotation.x = -Math.PI / 2;
    direction.position.set(0, role === 'guard' ? 0.72 : 0.62, 0.53);
    direction.castShadow = true;
    model.add(direction);

    if (role === 'guard') {
      const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.1, 16), bodyMaterial);
      hat.position.y = 1.58;
      model.add(hat);
    } else {
      const bag = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.48, 0.28), accentMaterial);
      bag.position.set(0, 0.72, -0.35);
      bag.castShadow = true;
      model.add(bag);
    }

    const stateRing = new THREE.Mesh(
      new THREE.TorusGeometry(role === 'guard' ? 0.62 : 0.54, 0.045, 8, 32),
      new THREE.MeshBasicMaterial({ color: accentColor, transparent: true, opacity: 0.85 }),
    );
    stateRing.rotation.x = Math.PI / 2;
    stateRing.position.y = 0.06;
    root.add(model, stateRing);
    this.root.add(root);
    return { root, model, bodyMaterial, stateRing };
  }

  private createApple(id: number): void {
    const root = new THREE.Group();
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: '#d83f2f',
      emissive: '#561008',
      emissiveIntensity: 0.22,
      roughness: 0.48,
    });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.34, 14, 10), bodyMaterial);
    body.scale.y = 0.92;
    body.position.y = 0.38;
    body.castShadow = true;
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.045, 0.22, 6),
      new THREE.MeshStandardMaterial({ color: '#51351e', roughness: 0.9 }),
    );
    stem.position.set(0, 0.75, 0);
    stem.rotation.z = 0.18;
    const leaf = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 8, 5),
      new THREE.MeshStandardMaterial({ color: '#4b7f39', roughness: 0.86 }),
    );
    leaf.scale.set(1.5, 0.3, 0.75);
    leaf.position.set(0.12, 0.78, 0);
    const targetRing = new THREE.Mesh(
      new THREE.RingGeometry(0.48, 0.57, 32),
      new THREE.MeshBasicMaterial({ color: '#fff1a8', side: THREE.DoubleSide }),
    );
    targetRing.rotation.x = -Math.PI / 2;
    targetRing.position.y = 0.025;
    targetRing.visible = false;
    root.add(body, stem, leaf, targetRing);
    this.appleViews.set(id, { root, bodyMaterial, targetRing });
    this.root.add(root);
  }

  private syncGuard(view: CharacterView, guard: GuardSnapshot, time: number, reducedMotion: boolean): void {
    view.root.position.set(guard.position.x, 0, guard.position.z);
    view.root.rotation.y = Math.atan2(guard.facing.x, guard.facing.z);
    view.model.rotation.z = guard.state === 'Recover' ? -Math.PI * 0.38 : 0;
    view.model.rotation.x = guard.state === 'Pounce' ? Math.PI * 0.18 : 0;
    const bob = reducedMotion ? 0 : Math.sin(time * 15 + (guard.id === 'guard1' ? 0 : 1.7)) * 0.03;
    view.model.position.y = guard.state === 'Stunned' ? 0.08 + bob : bob;
    view.stateRing.visible = guard.state !== 'Move' || !guard.pounceReady;
    view.stateRing.material.color.set(
      guard.state === 'Stunned' ? '#ffd45c' : guard.state === 'Recover' ? '#ff8c69' : '#b8d9ff',
    );
    view.stateRing.rotation.z = reducedMotion ? 0 : time * (guard.state === 'Stunned' ? 5 : 1.4);
    view.bodyMaterial.emissive.set(guard.state === 'Pounce' ? '#5ea9ff' : '#000000');
    view.bodyMaterial.emissiveIntensity = guard.state === 'Pounce' ? 0.55 : 0;
  }

  private syncKid(view: CharacterView, kid: KidSnapshot, time: number, reducedMotion: boolean): void {
    view.root.position.set(kid.position.x, 0, kid.position.z);
    view.root.rotation.y = Math.atan2(kid.facing.x, kid.facing.z);
    const bob = reducedMotion ? 0 : Math.sin(time * 12) * 0.025;
    view.model.position.y = bob;
    view.model.rotation.z = kid.state === 'Picking' ? -0.16 : 0;
    view.stateRing.visible = kid.state !== 'Normal';
    view.stateRing.material.color.set(kid.state === 'Picking' ? '#ffd45c' : '#fff7c7');
    view.stateRing.material.opacity = kid.state === 'Invincible'
      ? 0.38 + (reducedMotion ? 0.3 : Math.abs(Math.sin(time * 14)) * 0.55)
      : 0.9;
    view.bodyMaterial.emissive.set(kid.state === 'Invincible' ? '#ffd45c' : '#000000');
    view.bodyMaterial.emissiveIntensity = kid.state === 'Invincible' ? 0.75 : 0;
  }

  private syncApple(
    apple: AppleSnapshot,
    snapshot: GameSnapshot,
    time: number,
    reducedMotion: boolean,
  ): void {
    const view = this.appleViews.get(apple.id);
    if (!view) return;
    view.targetRing.visible = snapshot.kid.pickingTargetId === apple.id;
    if (apple.state === 'Delivered') {
      view.root.visible = false;
      return;
    }
    view.root.visible = true;
    if (apple.state === 'Carried') {
      const index = snapshot.kid.carriedAppleIds.indexOf(apple.id);
      const column = index % 2 === 0 ? -1 : 1;
      const row = Math.floor(index / 2);
      view.root.position.set(
        snapshot.kid.position.x + column * 0.34,
        0.95 + row * 0.42,
        snapshot.kid.position.z - 0.3,
      );
      view.root.rotation.y = reducedMotion ? 0 : time * 1.5 + index;
      view.bodyMaterial.opacity = 1;
      view.bodyMaterial.transparent = false;
      return;
    }
    const bob = reducedMotion ? 0 : Math.sin(time * 3 + apple.id) * 0.07;
    view.root.position.set(apple.position.x, bob, apple.position.z);
    view.root.rotation.y = reducedMotion ? 0 : time * 0.6 + apple.id;
    view.bodyMaterial.transparent = apple.lockTicks > 0;
    view.bodyMaterial.opacity = apple.lockTicks > 0 ? 0.58 : 1;
  }
}
