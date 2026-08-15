export type Vec2 = {
  x: number;
  z: number;
};

export type MatchState = 'Countdown' | 'Playing' | 'KidWin' | 'GuardWin';
export type GuardState = 'Move' | 'Pounce' | 'Recover' | 'Stunned';
export type KidState = 'Normal' | 'Picking' | 'Invincible';
export type AppleState = 'Ground' | 'Carried' | 'Delivered';

export type ActorCommand = {
  moveX: number;
  moveZ: number;
  actionPressed: boolean;
  dropPressed: boolean;
};

export type GameCommands = {
  guard1: ActorCommand;
  guard2: ActorCommand;
  kid: ActorCommand;
  restartPressed: boolean;
};

export type GuardSnapshot = {
  id: 'guard1' | 'guard2';
  position: Vec2;
  facing: Vec2;
  state: GuardState;
  stateTicks: number;
  cooldownTicks: number;
  pounceReady: boolean;
  movementAmount: number;
};

export type KidSnapshot = {
  position: Vec2;
  facing: Vec2;
  state: KidState;
  stateTicks: number;
  carriedAppleIds: number[];
  pickingTargetId: number | null;
  pickingProgress: number;
  speed: number;
  movementAmount: number;
};

export type AppleSnapshot = {
  id: number;
  state: AppleState;
  position: Vec2;
  lockTicks: number;
};

export type GameSnapshot = {
  tick: number;
  playTicks: number;
  elapsedSeconds: number;
  matchState: MatchState;
  countdownTicks: number;
  catches: number;
  delivered: number;
  totalApples: number;
  guards: [GuardSnapshot, GuardSnapshot];
  kid: KidSnapshot;
  apples: AppleSnapshot[];
};

export type GameEvent =
  | { type: 'match-started' }
  | { type: 'restarted' }
  | { type: 'pounce'; guardId: 'guard1' | 'guard2' }
  | { type: 'guards-stunned' }
  | { type: 'pick-started'; appleId: number }
  | { type: 'pick-cancelled'; appleId: number }
  | { type: 'picked'; appleId: number }
  | { type: 'dropped'; appleId: number; reason: 'manual' | 'capture' }
  | { type: 'captured'; catches: number }
  | { type: 'delivered'; appleId: number; count: number; total: number }
  | { type: 'match-ended'; winner: 'kid' | 'guards' };

export type SimulationStep = {
  snapshot: GameSnapshot;
  events: GameEvent[];
};

export function createEmptyCommands(): GameCommands {
  return {
    guard1: createEmptyActorCommand(),
    guard2: createEmptyActorCommand(),
    kid: createEmptyActorCommand(),
    restartPressed: false,
  };
}

export function commandsWithoutEdges(commands: GameCommands): GameCommands {
  return {
    guard1: { ...commands.guard1, actionPressed: false, dropPressed: false },
    guard2: { ...commands.guard2, actionPressed: false, dropPressed: false },
    kid: { ...commands.kid, actionPressed: false, dropPressed: false },
    restartPressed: false,
  };
}

function createEmptyActorCommand(): ActorCommand {
  return {
    moveX: 0,
    moveZ: 0,
    actionPressed: false,
    dropPressed: false,
  };
}
