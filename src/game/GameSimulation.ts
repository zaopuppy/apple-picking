import { createSeededRandom } from '../utils/random';
import {
  DEFAULT_MOVEMENT_TUNING,
  GAME_CONFIG,
  TICKS_PER_SECOND,
  type MovementTuning,
} from './config';
import { DEFAULT_ORCHARD_MAP } from './maps/MapGenerator';
import {
  resolveCircleAgainstLandmark,
  treeColliderRadius,
  type OrchardMap,
  type OrchardTree,
} from './maps/OrchardMap';
import {
  createEmptyCommands,
  type ActorCommand,
  type AppleSnapshot,
  type AppleState,
  type GameCommands,
  type GameEvent,
  type GameSnapshot,
  type GuardSnapshot,
  type GuardState,
  type KidSnapshot,
  type KidState,
  type MatchState,
  type SimulationStep,
  type Vec2,
} from './types';

type GuardModel = {
  id: 'guard1' | 'guard2';
  position: Vec2;
  previousPosition: Vec2;
  facing: Vec2;
  state: GuardState;
  stateTicks: number;
  cooldownTicks: number;
  pounceStartedTick: number;
};

type KidModel = {
  position: Vec2;
  previousPosition: Vec2;
  facing: Vec2;
  state: KidState;
  stateTicks: number;
  carriedAppleIds: number[];
  pickingTargetId: number | null;
};

type AppleModel = {
  id: number;
  state: AppleState;
  position: Vec2;
  lockTicks: number;
};

const DELIVERY_DROP_OFFSETS: readonly Vec2[] = [
  { x: 0, z: 0 },
  { x: 0.78, z: 0 },
  { x: 0.24, z: 0.74 },
  { x: -0.63, z: 0.46 },
  { x: -0.63, z: -0.46 },
  { x: 0.24, z: -0.74 },
];

export class GameSimulation {
  private tick = 0;
  private playTicks = 0;
  private matchState: MatchState = 'Countdown';
  private countdownTicks = GAME_CONFIG.countdownTicks;
  private catches = 0;
  private guards!: [GuardModel, GuardModel];
  private kid!: KidModel;
  private apples!: AppleModel[];
  private events: GameEvent[] = [];
  private rng = createSeededRandom(1);
  private dropSerial = 0;
  private readonly movementTuning: MovementTuning;

  constructor(
    private readonly map: OrchardMap = DEFAULT_ORCHARD_MAP,
    movementTuning: MovementTuning = DEFAULT_MOVEMENT_TUNING,
  ) {
    this.movementTuning = { ...movementTuning };
    this.restart(false);
  }

  setMovementTuning(movementTuning: MovementTuning): void {
    this.movementTuning.baseSpeed = movementTuning.baseSpeed;
    this.movementTuning.guardSpeedMultiplier = movementTuning.guardSpeedMultiplier;
    this.movementTuning.kidSpeedMultiplier = movementTuning.kidSpeedMultiplier;
  }

  getMovementTuning(): Readonly<MovementTuning> {
    return { ...this.movementTuning };
  }

  restart(skipCountdown = false): void {
    this.tick = 0;
    this.playTicks = 0;
    this.matchState = skipCountdown ? 'Playing' : 'Countdown';
    this.countdownTicks = skipCountdown ? 0 : GAME_CONFIG.countdownTicks;
    this.catches = 0;
    this.dropSerial = 0;
    this.guards = [
      this.createGuard('guard1', this.map.guardStarts[0]),
      this.createGuard('guard2', this.map.guardStarts[1]),
    ];
    this.kid = {
      position: copy(this.map.kidStart),
      previousPosition: copy(this.map.kidStart),
      facing: { x: 1, z: 0 },
      state: 'Normal',
      stateTicks: 0,
      carriedAppleIds: [],
      pickingTargetId: null,
    };
    this.apples = this.map.appleSpawns.map((position, id) => ({
      id,
      state: 'Ground' as const,
      position: copy(position),
      lockTicks: 0,
    }));
    this.events = [];
  }

  seed(value: number): void {
    this.rng = createSeededRandom(value);
  }

  step(commands: GameCommands = createEmptyCommands()): SimulationStep {
    this.events = [];
    if (commands.restartPressed) {
      this.restart(false);
      this.events.push({ type: 'restarted' });
      return this.result();
    }

    this.tick += 1;
    if (this.matchState === 'Countdown') {
      this.countdownTicks = Math.max(0, this.countdownTicks - 1);
      if (this.countdownTicks === 0) {
        this.matchState = 'Playing';
        this.events.push({ type: 'match-started' });
      }
      return this.result();
    }

    if (this.matchState !== 'Playing') {
      return this.result();
    }

    this.playTicks += 1;
    this.decrementAppleLocks();
    this.savePreviousPositions();

    const kidCanUseItems = this.kid.state !== 'Hit';
    const deliveryThrowRequested = kidCanUseItems &&
      commands.kid.dropPressed &&
      this.isKidInDeliveryZone();
    if (kidCanUseItems && commands.kid.dropPressed && !deliveryThrowRequested) this.dropOneApple();
    if (commands.kid.actionPressed) this.tryStartPicking();

    this.updateGuard(this.guards[0], commands.guard1);
    this.updateGuard(this.guards[1], commands.guard2);
    this.updateKidMovement(commands.kid);
    this.checkGuardPounceCollision();

    const captured = this.checkCapture();
    if (!captured) this.advanceKidState();
    this.advanceGuardState(this.guards[0]);
    this.advanceGuardState(this.guards[1]);

    if (!captured && this.matchState === 'Playing' && deliveryThrowRequested) {
      this.deliverOneApple();
    }

    this.resolveActorCollisions();
    this.resolveLooseAppleCollisions();
    this.updateDeliveryZoneMembership();

    return this.result();
  }

  getSnapshot(): GameSnapshot {
    const delivered = this.apples.filter((apple) => apple.state === 'Delivered').length;
    return {
      tick: this.tick,
      playTicks: this.playTicks,
      elapsedSeconds: this.playTicks / TICKS_PER_SECOND,
      matchState: this.matchState,
      countdownTicks: this.countdownTicks,
      catches: this.catches,
      delivered,
      totalApples: this.apples.length,
      guards: [this.guardSnapshot(this.guards[0]), this.guardSnapshot(this.guards[1])],
      kid: this.kidSnapshot(),
      apples: this.apples.map((apple): AppleSnapshot => ({
        id: apple.id,
        state: apple.state,
        position: copy(apple.position),
        lockTicks: apple.lockTicks,
      })),
    };
  }

  loadScenario(name: string): void {
    this.restart(true);
    switch (name) {
      case 'active-play':
        return;
      case 'pickup':
        this.kid.position = copy(this.apples[0].position);
        this.kid.previousPosition = copy(this.kid.position);
        this.moveGuardsAway();
        return;
      case 'picking':
        this.kid.position = copy(this.apples[0].position);
        this.kid.previousPosition = copy(this.kid.position);
        this.moveGuardsAway();
        this.startPicking(this.apples[0]);
        this.kid.stateTicks = Math.floor(GAME_CONFIG.pickingTicks / 2);
        this.events = [];
        return;
      case 'picking-with-carry':
        this.moveGuardsAway();
        this.giveKidApples([0, 1]);
        this.kid.position = copy(this.apples[2].position);
        this.kid.previousPosition = copy(this.kid.position);
        this.startPicking(this.apples[2]);
        this.events = [];
        return;
      case 'pickup-danger':
        this.kid.position = copy(this.apples[0].position);
        this.kid.previousPosition = copy(this.kid.position);
        this.guards[0].position = { x: this.kid.position.x, z: this.kid.position.z + 0.8 };
        this.guards[0].previousPosition = copy(this.guards[0].position);
        this.guards[1].position = { x: 10, z: -7 };
        this.guards[1].previousPosition = copy(this.guards[1].position);
        return;
      case 'carrying':
        this.moveGuardsAway();
        this.kid.position = { x: 0, z: 0 };
        this.kid.previousPosition = copy(this.kid.position);
        this.giveKidApples([0, 1, 2]);
        return;
      case 'heavy-carry':
        this.moveGuardsAway();
        this.kid.position = { x: 0, z: 0 };
        this.kid.facing = { x: 1, z: 0 };
        this.giveKidApples([0, 1, 2]);
        this.kid.previousPosition = {
          x: this.kid.position.x - this.currentKidSpeed() / TICKS_PER_SECOND,
          z: this.kid.position.z,
        };
        return;
      case 'carry-limit':
        this.moveGuardsAway();
        this.giveKidApples([0, 1, 2]);
        this.kid.position = copy(this.apples[3].position);
        this.kid.previousPosition = copy(this.kid.position);
        return;
      case 'guard-pounce':
        this.moveGuardsAway();
        this.guards[0].position = { x: -1.4, z: 0 };
        this.guards[0].previousPosition = { x: -1.4, z: GAME_CONFIG.pounceSpeed / TICKS_PER_SECOND };
        this.guards[0].facing = { x: 0, z: -1 };
        this.guards[0].state = 'Pounce';
        this.guards[0].stateTicks = Math.ceil(GAME_CONFIG.pounceTicks / 2);
        this.kid.position = { x: 1.2, z: -0.7 };
        this.kid.previousPosition = copy(this.kid.position);
        return;
      case 'guard-recover':
        this.moveGuardsAway();
        this.guards[0].position = { x: -1.4, z: 0 };
        this.guards[0].previousPosition = copy(this.guards[0].position);
        this.guards[0].facing = { x: 0, z: -1 };
        this.guards[0].state = 'Recover';
        this.guards[0].stateTicks = Math.ceil(GAME_CONFIG.recoverTicks * 0.72);
        this.kid.position = { x: 1.2, z: -0.7 };
        this.kid.previousPosition = copy(this.kid.position);
        return;
      case 'guard-stunned':
        this.guards[0].position = { x: -0.45, z: 0 };
        this.guards[0].previousPosition = copy(this.guards[0].position);
        this.guards[0].state = 'Stunned';
        this.guards[0].stateTicks = Math.ceil(GAME_CONFIG.stunTicks / 2);
        this.guards[1].position = { x: 0.45, z: 0 };
        this.guards[1].previousPosition = copy(this.guards[1].position);
        this.guards[1].state = 'Stunned';
        this.guards[1].stateTicks = Math.ceil(GAME_CONFIG.stunTicks / 2);
        this.kid.position = { x: 0, z: 3.2 };
        this.kid.previousPosition = copy(this.kid.position);
        return;
      case 'guard-on-apple':
        this.moveGuardsAway();
        this.guards[0].position = copy(this.apples[0].position);
        this.guards[0].previousPosition = copy(this.guards[0].position);
        return;
      case 'delivery':
        this.moveGuardsAway();
        this.kid.position = copy(this.map.deliveryZone);
        this.kid.previousPosition = copy(this.kid.position);
        this.giveKidApples([0, 1]);
        return;
      case 'delivery-progress':
        this.moveGuardsAway();
        this.placeDeliveredApples([0, 1, 2]);
        this.kid.position = copy(this.map.deliveryZone);
        this.kid.previousPosition = copy(this.kid.position);
        this.giveKidApples([3, 4]);
        return;
      case 'delivery-edge':
        this.moveGuardsAway();
        this.placeDeliveredApples([0]);
        this.apples[0].position = {
          x: this.map.deliveryZone.x + GAME_CONFIG.deliveryRadius - 0.08,
          z: this.map.deliveryZone.z,
        };
        this.guards[0].position = {
          x: this.apples[0].position.x - 0.7,
          z: this.apples[0].position.z,
        };
        this.guards[0].previousPosition = copy(this.guards[0].position);
        return;
      case 'delivery-final':
        this.moveGuardsAway();
        this.placeDeliveredApples([0, 1, 2, 3, 4]);
        this.giveKidApples([5]);
        this.kid.position = copy(this.map.deliveryZone);
        this.kid.previousPosition = copy(this.kid.position);
        return;
      case 'captured':
        this.moveGuardsAway();
        this.kid.position = { x: 0, z: 0 };
        this.kid.previousPosition = copy(this.kid.position);
        this.kid.state = 'Hit';
        this.kid.stateTicks = Math.ceil(GAME_CONFIG.kidHitStunTicks / 2);
        return;
      case 'invincible':
        this.moveGuardsAway();
        this.kid.position = { x: 0, z: 0 };
        this.kid.previousPosition = copy(this.kid.position);
        this.kid.state = 'Invincible';
        this.kid.stateTicks = Math.ceil(GAME_CONFIG.invincibleTicks / 2);
        return;
      case 'capture-priority':
        this.catches = GAME_CONFIG.catchTarget - 1;
        this.placeDeliveredApples(this.apples.map((apple) => apple.id));
        this.apples[0].state = 'Carried';
        this.kid.carriedAppleIds = [0];
        this.kid.position = copy(this.map.deliveryZone);
        this.kid.previousPosition = copy(this.kid.position);
        this.guards[0].position = copy(this.map.deliveryZone);
        this.guards[0].previousPosition = copy(this.map.deliveryZone);
        this.guards[1].position = { x: -10, z: -7 };
        this.guards[1].previousPosition = copy(this.guards[1].position);
        return;
      case 'kid-win':
        this.placeDeliveredApples(this.apples.map((apple) => apple.id));
        this.kid.carriedAppleIds = [];
        this.matchState = 'KidWin';
        return;
      case 'guard-win':
        this.catches = GAME_CONFIG.catchTarget;
        this.matchState = 'GuardWin';
        return;
      default:
        throw new Error(`Unknown simulation scenario: ${name}`);
    }
  }

  private createGuard(id: GuardModel['id'], position: Vec2): GuardModel {
    return {
      id,
      position: copy(position),
      previousPosition: copy(position),
      facing: { x: 0, z: 1 },
      state: 'Move',
      stateTicks: 0,
      cooldownTicks: 0,
      pounceStartedTick: -1000,
    };
  }

  private result(): SimulationStep {
    return {
      snapshot: this.getSnapshot(),
      events: [...this.events],
    };
  }

  private savePreviousPositions(): void {
    for (const guard of this.guards) guard.previousPosition = copy(guard.position);
    this.kid.previousPosition = copy(this.kid.position);
  }

  private decrementAppleLocks(): void {
    for (const apple of this.apples) {
      apple.lockTicks = Math.max(0, apple.lockTicks - 1);
    }
  }

  private updateGuard(guard: GuardModel, command: ActorCommand): void {
    const direction = normalized({ x: command.moveX, z: command.moveZ });
    if (guard.state === 'Move' && command.actionPressed && guard.cooldownTicks === 0) {
      if (lengthSquared(direction) > 0) guard.facing = direction;
      guard.state = 'Pounce';
      guard.stateTicks = GAME_CONFIG.pounceTicks;
      guard.pounceStartedTick = this.tick;
      this.events.push({ type: 'pounce', guardId: guard.id });
    }

    if (guard.state === 'Move') {
      if (lengthSquared(direction) > 0) guard.facing = direction;
      this.moveWithCollisions(guard.position, direction, this.currentGuardSpeed(), GAME_CONFIG.guardRadius);
    } else if (guard.state === 'Pounce') {
      this.moveWithCollisions(
        guard.position,
        guard.facing,
        GAME_CONFIG.pounceSpeed,
        GAME_CONFIG.guardRadius,
      );
    }
  }

  private updateKidMovement(command: ActorCommand): void {
    if (this.kid.state === 'Picking' || this.kid.state === 'Hit') return;
    const direction = normalized({ x: command.moveX, z: command.moveZ });
    if (lengthSquared(direction) > 0) this.kid.facing = direction;
    this.moveWithCollisions(
      this.kid.position,
      direction,
      this.currentKidSpeed(),
      GAME_CONFIG.kidRadius,
    );
  }

  private moveWithCollisions(position: Vec2, direction: Vec2, speed: number, radius: number): void {
    position.x += direction.x * speed / TICKS_PER_SECOND;
    position.z += direction.z * speed / TICKS_PER_SECOND;
    this.constrainPosition(position, radius);
  }

  private resolveActorCollisions(): void {
    const [guard1, guard2] = this.guards;
    for (let iteration = 0; iteration < 3; iteration += 1) {
      resolveCirclePair(
        guard1.position,
        GAME_CONFIG.guardRadius,
        guard2.position,
        GAME_CONFIG.guardRadius,
        0.5,
      );
      resolveCirclePair(
        guard1.position,
        GAME_CONFIG.guardRadius,
        this.kid.position,
        GAME_CONFIG.kidRadius,
        0.5,
      );
      resolveCirclePair(
        guard2.position,
        GAME_CONFIG.guardRadius,
        this.kid.position,
        GAME_CONFIG.kidRadius,
        0.5,
      );
      this.constrainPosition(guard1.position, GAME_CONFIG.guardRadius);
      this.constrainPosition(guard2.position, GAME_CONFIG.guardRadius);
      this.constrainPosition(this.kid.position, GAME_CONFIG.kidRadius);
    }
  }

  private resolveLooseAppleCollisions(): void {
    const [guard1, guard2] = this.guards;
    const pickingTargetId = this.kid.state === 'Picking' ? this.kid.pickingTargetId : null;
    for (let iteration = 0; iteration < 4; iteration += 1) {
      for (const apple of this.apples) {
        if (apple.state === 'Carried') continue;
        resolveCirclePair(
          guard1.position,
          GAME_CONFIG.guardRadius,
          apple.position,
          GAME_CONFIG.appleRadius,
          0,
        );
        resolveCirclePair(
          guard2.position,
          GAME_CONFIG.guardRadius,
          apple.position,
          GAME_CONFIG.appleRadius,
          0,
        );
        if (apple.id !== pickingTargetId) {
          resolveCirclePair(
            this.kid.position,
            GAME_CONFIG.kidRadius,
            apple.position,
            GAME_CONFIG.appleRadius,
            0,
          );
        }
        this.constrainPosition(apple.position, GAME_CONFIG.appleRadius);
      }

      for (let firstIndex = 0; firstIndex < this.apples.length; firstIndex += 1) {
        const first = this.apples[firstIndex];
        if (first.state === 'Carried') continue;
        for (let secondIndex = firstIndex + 1; secondIndex < this.apples.length; secondIndex += 1) {
          const second = this.apples[secondIndex];
          if (second.state === 'Carried') continue;
          resolveCirclePair(
            first.position,
            GAME_CONFIG.appleRadius,
            second.position,
            GAME_CONFIG.appleRadius,
            0.5,
          );
        }
      }
      for (const apple of this.apples) {
        if (apple.state !== 'Carried') {
          this.constrainPosition(apple.position, GAME_CONFIG.appleRadius);
        }
      }
    }
  }

  private updateDeliveryZoneMembership(): void {
    if (this.matchState !== 'Playing') return;
    const deliveryRadiusSquared = GAME_CONFIG.deliveryRadius ** 2;
    for (const apple of this.apples) {
      if (apple.state === 'Carried') continue;
      const inside = distanceSquared(apple.position, this.map.deliveryZone) <= deliveryRadiusSquared;
      if (inside && apple.state === 'Ground') {
        apple.state = 'Delivered';
        const total = this.deliveredAppleCount();
        this.events.push({ type: 'delivered', appleId: apple.id, count: 1, total });
      } else if (!inside && apple.state === 'Delivered') {
        apple.state = 'Ground';
        this.events.push({ type: 'delivery-lost', appleId: apple.id, total: this.deliveredAppleCount() });
      }
    }

    if (this.deliveredAppleCount() === this.apples.length) {
      this.matchState = 'KidWin';
      this.events.push({ type: 'match-ended', winner: 'kid' });
    }
  }

  private constrainPosition(position: Vec2, radius: number): void {
    position.x = clamp(
      position.x,
      -GAME_CONFIG.arenaHalfWidth + radius,
      GAME_CONFIG.arenaHalfWidth - radius,
    );
    position.z = clamp(
      position.z,
      -GAME_CONFIG.arenaHalfDepth + radius,
      GAME_CONFIG.arenaHalfDepth - radius,
    );
    for (const tree of this.map.trees) {
      resolveCircleAgainstTree(position, radius, tree);
    }
    for (const landmark of this.map.landmarks) {
      resolveCircleAgainstLandmark(position, radius, landmark);
    }
    position.x = clamp(
      position.x,
      -GAME_CONFIG.arenaHalfWidth + radius,
      GAME_CONFIG.arenaHalfWidth - radius,
    );
    position.z = clamp(
      position.z,
      -GAME_CONFIG.arenaHalfDepth + radius,
      GAME_CONFIG.arenaHalfDepth - radius,
    );
  }

  private checkGuardPounceCollision(): void {
    const [guard1, guard2] = this.guards;
    if (guard1.state !== 'Pounce' || guard2.state !== 'Pounce') return;
    if (Math.abs(guard1.pounceStartedTick - guard2.pounceStartedTick) > GAME_CONFIG.simultaneousPounceTicks) {
      return;
    }
    if (!movingCirclesOverlap(guard1, guard2, GAME_CONFIG.guardRadius * 2)) return;
    guard1.state = 'Stunned';
    guard2.state = 'Stunned';
    guard1.stateTicks = GAME_CONFIG.stunTicks;
    guard2.stateTicks = GAME_CONFIG.stunTicks;
    this.events.push({ type: 'guards-stunned' });
  }

  private checkCapture(): boolean {
    if (this.kid.state === 'Hit' || this.kid.state === 'Invincible') return false;
    const captureRadius = GAME_CONFIG.guardRadius + GAME_CONFIG.kidRadius;
    const captor = this.guards.find((guard) =>
      (guard.state === 'Move' || guard.state === 'Pounce') &&
      movingPointDistanceSquared(guard, this.kid) <= captureRadius * captureRadius,
    );
    if (!captor) return false;

    this.catches += 1;
    this.cancelPicking();
    this.dropAllCarriedApples();
    this.knockKidAwayFrom(captor);
    this.kid.state = 'Hit';
    this.kid.stateTicks = GAME_CONFIG.kidHitStunTicks;
    this.events.push({ type: 'captured', catches: this.catches });
    if (this.catches >= GAME_CONFIG.catchTarget) {
      this.matchState = 'GuardWin';
      this.events.push({ type: 'match-ended', winner: 'guards' });
    }
    return true;
  }

  private advanceGuardState(guard: GuardModel): void {
    if (guard.state === 'Move') {
      guard.cooldownTicks = Math.max(0, guard.cooldownTicks - 1);
      return;
    }
    guard.stateTicks = Math.max(0, guard.stateTicks - 1);
    if (guard.stateTicks > 0) return;
    if (guard.state === 'Pounce') {
      guard.state = 'Recover';
      guard.stateTicks = GAME_CONFIG.recoverTicks;
      return;
    }
    guard.state = 'Move';
    guard.cooldownTicks = GAME_CONFIG.pounceCooldownTicks;
  }

  private advanceKidState(): void {
    if (this.kid.state === 'Normal') return;
    this.kid.stateTicks = Math.max(0, this.kid.stateTicks - 1);
    if (this.kid.stateTicks > 0) return;
    if (this.kid.state === 'Hit') {
      this.kid.state = 'Invincible';
      this.kid.stateTicks = GAME_CONFIG.invincibleTicks;
      return;
    }
    if (this.kid.state === 'Invincible') {
      this.kid.state = 'Normal';
      return;
    }
    if (this.kid.state === 'Rejecting') {
      this.kid.state = 'Normal';
      return;
    }

    const targetId = this.kid.pickingTargetId;
    this.kid.pickingTargetId = null;
    this.kid.state = 'Normal';
    if (targetId === null) return;
    const apple = this.apples[targetId];
    if (
      !apple ||
      apple.state !== 'Ground' ||
      apple.lockTicks > 0 ||
      this.kid.carriedAppleIds.length >= GAME_CONFIG.maxCarriedApples
    ) return;
    apple.state = 'Carried';
    this.kid.carriedAppleIds.push(apple.id);
    this.events.push({ type: 'picked', appleId: apple.id });
  }

  private knockKidAwayFrom(captor: GuardModel): void {
    let direction = normalized({
      x: this.kid.position.x - captor.position.x,
      z: this.kid.position.z - captor.position.z,
    });
    if (lengthSquared(direction) === 0) direction = copy(captor.facing);
    this.kid.position.x += direction.x * GAME_CONFIG.kidHitKnockback;
    this.kid.position.z += direction.z * GAME_CONFIG.kidHitKnockback;
    this.constrainPosition(this.kid.position, GAME_CONFIG.kidRadius);
  }

  private tryStartPicking(): void {
    if (this.kid.state !== 'Normal') return;
    const candidates = this.apples
      .filter((apple) => apple.state === 'Ground' && apple.lockTicks === 0)
      .map((apple) => ({ apple, distanceSq: distanceSquared(this.kid.position, apple.position) }))
      .filter(({ distanceSq }) => distanceSq <= GAME_CONFIG.pickupRadius * GAME_CONFIG.pickupRadius)
      .sort((a, b) => a.distanceSq - b.distanceSq || a.apple.id - b.apple.id);
    const target = candidates[0]?.apple;
    if (!target) return;
    if (this.kid.carriedAppleIds.length >= GAME_CONFIG.maxCarriedApples) {
      this.kid.state = 'Rejecting';
      this.kid.stateTicks = GAME_CONFIG.pickupRejectTicks;
      return;
    }
    this.startPicking(target);
  }

  private startPicking(apple: AppleModel): void {
    this.kid.state = 'Picking';
    this.kid.stateTicks = GAME_CONFIG.pickingTicks;
    this.kid.pickingTargetId = apple.id;
    this.events.push({ type: 'pick-started', appleId: apple.id });
  }

  private cancelPicking(): void {
    if (this.kid.state !== 'Picking') return;
    const appleId = this.kid.pickingTargetId;
    this.kid.pickingTargetId = null;
    if (appleId !== null) this.events.push({ type: 'pick-cancelled', appleId });
  }

  private dropOneApple(): void {
    const appleId = this.kid.carriedAppleIds.pop();
    if (appleId === undefined) return;
    const apple = this.apples[appleId];
    const side = this.dropSerial % 2 === 0 ? -1 : 1;
    const lateral = side * (0.22 + this.rng() * 0.16);
    this.dropSerial += 1;
    const right = { x: -this.kid.facing.z, z: this.kid.facing.x };
    apple.position = {
      x: this.kid.position.x - this.kid.facing.x * 1.25 + right.x * lateral,
      z: this.kid.position.z - this.kid.facing.z * 1.25 + right.z * lateral,
    };
    this.clampApplePosition(apple.position);
    apple.state = 'Ground';
    apple.lockTicks = GAME_CONFIG.manualDropLockTicks;
    this.events.push({ type: 'dropped', appleId, reason: 'manual' });
  }

  private dropAllCarriedApples(): void {
    const carried = [...this.kid.carriedAppleIds];
    this.kid.carriedAppleIds = [];
    carried.forEach((appleId, index) => {
      const apple = this.apples[appleId];
      const angle = (index / Math.max(1, carried.length)) * Math.PI * 2 + (this.rng() - 0.5) * 0.18;
      const distance = 1.05 + (index % 2) * 0.28;
      apple.position = {
        x: this.kid.position.x + Math.cos(angle) * distance,
        z: this.kid.position.z + Math.sin(angle) * distance,
      };
      this.clampApplePosition(apple.position);
      apple.state = 'Ground';
      apple.lockTicks = GAME_CONFIG.captureDropLockTicks;
      this.events.push({ type: 'dropped', appleId, reason: 'capture' });
    });
  }

  private isKidInDeliveryZone(): boolean {
    return distanceSquared(this.kid.position, this.map.deliveryZone) <= GAME_CONFIG.deliveryRadius ** 2;
  }

  private deliverOneApple(): void {
    if (this.kid.carriedAppleIds.length === 0) return;
    const appleId = this.kid.carriedAppleIds.pop();
    if (appleId === undefined) return;
    const apple = this.apples[appleId];
    const deliveryIndex = this.deliveredAppleCount();
    const offset = DELIVERY_DROP_OFFSETS[deliveryIndex % DELIVERY_DROP_OFFSETS.length];
    apple.position = {
      x: this.map.deliveryZone.x + offset.x,
      z: this.map.deliveryZone.z + offset.z,
    };
    apple.state = 'Delivered';
    apple.lockTicks = 0;
    const total = this.deliveredAppleCount();
    this.events.push({ type: 'delivered', appleId, count: 1, total });
  }

  private deliveredAppleCount(): number {
    return this.apples.filter((apple) => apple.state === 'Delivered').length;
  }

  private currentKidSpeed(): number {
    const carryMultiplier = Math.max(
      GAME_CONFIG.minimumCarryMultiplier,
      1 - this.kid.carriedAppleIds.length * GAME_CONFIG.slowdownPerApple,
    );
    const invincibleMultiplier = this.kid.state === 'Invincible' ? GAME_CONFIG.invincibleSpeedMultiplier : 1;
    return this.movementTuning.baseSpeed *
      this.movementTuning.kidSpeedMultiplier *
      carryMultiplier *
      invincibleMultiplier;
  }

  private currentGuardSpeed(): number {
    return this.movementTuning.baseSpeed * this.movementTuning.guardSpeedMultiplier;
  }

  private clampApplePosition(position: Vec2): void {
    this.constrainPosition(position, GAME_CONFIG.appleRadius);
  }

  private guardSnapshot(guard: GuardModel): GuardSnapshot {
    const moved = Math.sqrt(distanceSquared(guard.position, guard.previousPosition));
    const speed = this.currentGuardSpeed();
    return {
      id: guard.id,
      position: copy(guard.position),
      facing: copy(guard.facing),
      state: guard.state,
      stateTicks: guard.stateTicks,
      cooldownTicks: guard.cooldownTicks,
      pounceReady: guard.state === 'Move' && guard.cooldownTicks === 0,
      movementAmount: clamp(moved * TICKS_PER_SECOND / Math.max(speed, 0.001), 0, 1),
    };
  }

  private kidSnapshot(): KidSnapshot {
    const progress = this.kid.state === 'Picking'
      ? 1 - this.kid.stateTicks / GAME_CONFIG.pickingTicks
      : 0;
    const speed = this.currentKidSpeed();
    const moved = Math.sqrt(distanceSquared(this.kid.position, this.kid.previousPosition));
    return {
      position: copy(this.kid.position),
      facing: copy(this.kid.facing),
      state: this.kid.state,
      stateTicks: this.kid.stateTicks,
      carriedAppleIds: [...this.kid.carriedAppleIds],
      pickingTargetId: this.kid.pickingTargetId,
      pickingProgress: clamp(progress, 0, 1),
      speed,
      movementAmount: clamp(moved * TICKS_PER_SECOND / Math.max(speed, 0.001), 0, 1),
    };
  }

  private moveGuardsAway(): void {
    this.guards[0].position = copy(this.map.guardStarts[0]);
    this.guards[0].previousPosition = copy(this.guards[0].position);
    this.guards[1].position = copy(this.map.guardStarts[1]);
    this.guards[1].previousPosition = copy(this.guards[1].position);
  }

  private giveKidApples(ids: number[]): void {
    if (ids.length > GAME_CONFIG.maxCarriedApples) {
      throw new Error(`Cannot carry more than ${GAME_CONFIG.maxCarriedApples} apples.`);
    }
    this.kid.carriedAppleIds = [...ids];
    for (const id of ids) this.apples[id].state = 'Carried';
  }

  private placeDeliveredApples(ids: number[]): void {
    ids.forEach((id, index) => {
      const apple = this.apples[id];
      const offset = DELIVERY_DROP_OFFSETS[index % DELIVERY_DROP_OFFSETS.length];
      apple.state = 'Delivered';
      apple.position = {
        x: this.map.deliveryZone.x + offset.x,
        z: this.map.deliveryZone.z + offset.z,
      };
      apple.lockTicks = 0;
    });
  }
}

function copy(vector: Vec2): Vec2 {
  return { x: vector.x, z: vector.z };
}

function normalized(vector: Vec2): Vec2 {
  const length = Math.hypot(vector.x, vector.z);
  if (length <= 0.00001) return { x: 0, z: 0 };
  return { x: vector.x / length, z: vector.z / length };
}

function lengthSquared(vector: Vec2): number {
  return vector.x * vector.x + vector.z * vector.z;
}

function distanceSquared(a: Vec2, b: Vec2): number {
  const x = a.x - b.x;
  const z = a.z - b.z;
  return x * x + z * z;
}

function movingPointDistanceSquared(
  first: { previousPosition: Vec2; position: Vec2 },
  second: { previousPosition: Vec2; position: Vec2 },
): number {
  const start = {
    x: first.previousPosition.x - second.previousPosition.x,
    z: first.previousPosition.z - second.previousPosition.z,
  };
  const end = {
    x: first.position.x - second.position.x,
    z: first.position.z - second.position.z,
  };
  const delta = { x: end.x - start.x, z: end.z - start.z };
  const denominator = lengthSquared(delta);
  const t = denominator <= 0.000001
    ? 0
    : clamp(-(start.x * delta.x + start.z * delta.z) / denominator, 0, 1);
  const x = start.x + delta.x * t;
  const z = start.z + delta.z * t;
  return x * x + z * z;
}

function movingCirclesOverlap(first: GuardModel, second: GuardModel, radius: number): boolean {
  return movingPointDistanceSquared(first, second) <= radius * radius;
}

function resolveCirclePair(
  first: Vec2,
  firstRadius: number,
  second: Vec2,
  secondRadius: number,
  firstShare: number,
): boolean {
  const deltaX = second.x - first.x;
  const deltaZ = second.z - first.z;
  const minimumDistance = firstRadius + secondRadius;
  const distanceSq = deltaX * deltaX + deltaZ * deltaZ;
  if (distanceSq >= minimumDistance * minimumDistance) return false;

  const distance = Math.sqrt(distanceSq);
  const normalX = distance > 0.000001 ? deltaX / distance : 1;
  const normalZ = distance > 0.000001 ? deltaZ / distance : 0;
  const overlap = minimumDistance - distance;
  first.x -= normalX * overlap * firstShare;
  first.z -= normalZ * overlap * firstShare;
  second.x += normalX * overlap * (1 - firstShare);
  second.z += normalZ * overlap * (1 - firstShare);
  return true;
}

function resolveCircleAgainstTree(position: Vec2, radius: number, tree: OrchardTree): void {
  const deltaX = position.x - tree.x;
  const deltaZ = position.z - tree.z;
  const minimumDistance = radius + treeColliderRadius(tree);
  const distanceSq = deltaX * deltaX + deltaZ * deltaZ;
  if (distanceSq >= minimumDistance * minimumDistance) return;

  if (distanceSq > 0.000001) {
    const distance = Math.sqrt(distanceSq);
    const push = minimumDistance - distance;
    position.x += deltaX / distance * push;
    position.z += deltaZ / distance * push;
    return;
  }
  position.x = tree.x + minimumDistance;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
