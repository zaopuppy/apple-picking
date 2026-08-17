import { expect, test } from '@playwright/test';
import { GameSimulation } from '../src/game/GameSimulation';
import { SWEET_ORCHARD_ISLAND_MAP } from '../src/game/maps/IslandTourMap';
import { cloneOrchardMap } from '../src/game/maps/OrchardMap';
import { createEmptyCommands, type GameCommands, type GameSnapshot } from '../src/game/types';
import { PROTOCOL_VERSION, parseClientInputFrame } from '../src/net/protocol';

test.describe('Node-compatible authoritative simulation', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chrome', 'The headless rule replay only needs one project.');
  });

  test('the same map, seed, and command tape produce the same snapshots in Node', () => {
    const first = replayCommandTape();
    const second = replayCommandTape();

    expect(second).toEqual(first);
    expect(first.at(-1)?.tick).toBe(720);
    expect(first.at(-1)?.totalApples).toBe(SWEET_ORCHARD_ISLAND_MAP.appleSpawns.length);
  });

  test('network input validation rejects invalid values and normalizes movement', () => {
    expect(parseClientInputFrame({
      protocolVersion: PROTOCOL_VERSION,
      matchId: 'match-test',
      seq: 1,
      clientTick: 1,
      actors: {
        kid: {
          moveX: Number.NaN,
          moveZ: 0,
          actionPressed: false,
          dropPressed: false,
        },
      },
    })).toBeNull();

    const parsed = parseClientInputFrame({
      protocolVersion: PROTOCOL_VERSION,
      matchId: 'match-test',
      seq: 2,
      clientTick: 2,
      actors: {
        guard1: {
          moveX: 8,
          moveZ: 8,
          actionPressed: true,
          dropPressed: false,
        },
      },
    });
    expect(parsed).not.toBeNull();
    expect(Math.hypot(parsed?.actors.guard1?.moveX ?? 0, parsed?.actors.guard1?.moveZ ?? 0))
      .toBeCloseTo(1, 8);
  });

  test('a simulation checkpoint restores every deterministic rule state', () => {
    const authority = new GameSimulation(SWEET_ORCHARD_ISLAND_MAP);
    authority.seed(20260817);
    authority.loadScenario('carrying');
    const initialDrop = createEmptyCommands();
    initialDrop.kid.dropPressed = true;
    authority.step(initialDrop);
    for (let tick = 0; tick < 17; tick += 1) {
      const commands = createEmptyCommands();
      commands.guard1.moveX = 1;
      if (tick === 3) commands.guard1.actionPressed = true;
      authority.step(commands);
    }

    const checkpoint = authority.createCheckpoint();
    const replay = new GameSimulation(SWEET_ORCHARD_ISLAND_MAP);
    replay.restoreCheckpoint(checkpoint);
    expect(replay.getSnapshot()).toEqual(authority.getSnapshot());

    for (let tick = 0; tick < 120; tick += 1) {
      const commands = createEmptyCommands();
      commands.guard2.moveZ = tick < 80 ? -1 : 0;
      commands.kid.moveX = tick % 40 < 20 ? 1 : -1;
      if (tick === 12 || tick === 48) commands.kid.dropPressed = true;
      if (tick === 30) commands.guard2.actionPressed = true;
      const expected = authority.step(commands);
      const actual = replay.step(commands);
      expect(actual).toEqual(expected);
      expect(replay.createCheckpoint()).toEqual(authority.createCheckpoint());
    }
  });

  test('checkpoint restore rejects a different authoritative map', () => {
    const authority = new GameSimulation(SWEET_ORCHARD_ISLAND_MAP);
    const otherMap = cloneOrchardMap(SWEET_ORCHARD_ISLAND_MAP);
    otherMap.id = `${otherMap.id}-different`;
    const replay = new GameSimulation(otherMap);
    expect(() => replay.restoreCheckpoint(authority.createCheckpoint()))
      .toThrow(/checkpoint map mismatch/i);
  });
});

function replayCommandTape(): GameSnapshot[] {
  const simulation = new GameSimulation(SWEET_ORCHARD_ISLAND_MAP);
  simulation.seed(20260816);
  const snapshots: GameSnapshot[] = [];

  for (let tick = 0; tick < 720; tick += 1) {
    const commands = createEmptyCommands();
    applyTapeCommands(commands, tick);
    const step = simulation.step(commands);
    if (tick % 30 === 0 || step.events.length > 0 || tick === 719) snapshots.push(step.snapshot);
  }
  return snapshots;
}

function applyTapeCommands(commands: GameCommands, tick: number): void {
  if (tick >= 180 && tick < 360) commands.guard1.moveX = 1;
  if (tick >= 240 && tick < 420) commands.guard2.moveZ = -1;
  if (tick >= 180 && tick < 300) commands.kid.moveZ = -1;
  if (tick === 210) commands.guard1.actionPressed = true;
  if (tick === 270) commands.guard2.actionPressed = true;
  if (tick === 330) commands.kid.actionPressed = true;
  if (tick === 390) commands.kid.dropPressed = true;
}
