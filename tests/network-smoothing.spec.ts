import { expect, test } from '@playwright/test';
import { GameSimulation } from '../src/game/GameSimulation';
import { SWEET_ORCHARD_ISLAND_MAP } from '../src/game/maps/IslandTourMap';
import { createEmptyCommands } from '../src/game/types';
import {
  applyOwnedPrediction,
  createPredictionSimulation,
  replayFromAuthoritativeFrame,
  type LocalInputSample,
} from '../src/net/CheckpointPrediction';
import {
  BUILD_VERSION,
  PROTOCOL_VERSION,
  type ServerStateFrame,
} from '../src/net/protocol';
import {
  SnapshotTimeline,
  cloneSnapshot,
  interpolateSnapshots,
} from '../src/net/SnapshotInterpolation';

test.describe('online presentation smoothing', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chrome', 'Pure network presentation tests only need one project.');
  });

  test('the snapshot timeline creates intermediate positions between 20 Hz frames', () => {
    const simulation = new GameSimulation(SWEET_ORCHARD_ISLAND_MAP);
    simulation.loadScenario('active-play');
    const from = simulation.getSnapshot();
    const commands = createEmptyCommands();
    commands.guard1.moveX = 1;
    simulation.step(commands);
    simulation.step(commands);
    const to = simulation.step(commands).snapshot;

    const timeline = new SnapshotTimeline(from, 0, 3);
    timeline.push(to, 50);
    const start = timeline.sample(50);
    const midpoint = timeline.sample(75);
    const end = timeline.sample(100);

    const startX = from.guards[0].position.x;
    const endX = to.guards[0].position.x;
    expect(start.snapshot.guards[0].position.x).toBeCloseTo(startX, 6);
    expect(midpoint.snapshot.guards[0].position.x).toBeCloseTo((startX + endX) / 2, 6);
    expect(end.snapshot.guards[0].position.x).toBeCloseTo(endX, 6);
    expect(start.renderTick).toBeLessThan(midpoint.renderTick);
    expect(midpoint.renderTick).toBeLessThan(end.renderTick);
  });

  test('guard state ticks do not interpolate across a discrete recovery transition', () => {
    const simulation = new GameSimulation(SWEET_ORCHARD_ISLAND_MAP);
    simulation.loadScenario('active-play');
    const from = simulation.getSnapshot();
    from.guards[0].state = 'Pounce';
    from.guards[0].stateTicks = 1;
    const to = cloneSnapshot(from);
    to.tick += 3;
    to.guards[0].state = 'Recover';
    to.guards[0].stateTicks = 42;

    const midpoint = interpolateSnapshots(from, to, 0.5);
    const transitioned = interpolateSnapshots(from, to, 1);

    expect(midpoint.guards[0].state).toBe('Pounce');
    expect(midpoint.guards[0].stateTicks).toBe(1);
    expect(transitioned.guards[0].state).toBe('Recover');
    expect(transitioned.guards[0].stateTicks).toBe(42);
  });

  test('owned actors replay unacknowledged input from a full simulation checkpoint', () => {
    const simulation = new GameSimulation(SWEET_ORCHARD_ISLAND_MAP);
    simulation.loadScenario('active-play');
    const authority = simulation.getSnapshot();
    const frame: ServerStateFrame = {
      protocolVersion: PROTOCOL_VERSION,
      buildVersion: BUILD_VERSION,
      roomCode: 'ABC234',
      matchId: 'match-checkpoint-test',
      serverTick: authority.tick,
      sentAtMs: 0,
      lastProcessedInputSeqByPlayer: {},
      lastAppliedClientTickByPlayer: {},
      appliedCommands: createEmptyCommands(),
      checkpoint: simulation.createCheckpoint(),
      snapshot: authority,
      events: [],
    };
    const history: LocalInputSample[] = Array.from({ length: 3 }, (_, index) => ({
      clientTick: index + 1,
      actors: {
        guard1: {
          moveX: 1,
          moveZ: 0,
          actionPressed: false,
          dropPressed: false,
        },
        guard2: {
          moveX: 0,
          moveZ: 0,
          actionPressed: false,
          dropPressed: false,
        },
      },
    }));

    const predictionSimulation = createPredictionSimulation(SWEET_ORCHARD_ISLAND_MAP, frame);
    const result = replayFromAuthoritativeFrame(
      predictionSimulation,
      frame,
      'guards',
      history,
      0,
    );
    const rendered = applyOwnedPrediction(
      cloneSnapshot(authority),
      result.snapshot,
      'guards',
    );

    expect(result.replayedTicks).toBe(3);
    expect(rendered.guards[0].position.x - authority.guards[0].position.x).toBeCloseTo(0.42, 6);
    expect(rendered.guards[1].position).toEqual(authority.guards[1].position);
  });
});
