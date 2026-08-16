import { expect, test } from '@playwright/test';
import { GameSimulation } from '../src/game/GameSimulation';
import { DEFAULT_MOVEMENT_TUNING } from '../src/game/config';
import { SWEET_ORCHARD_ISLAND_MAP } from '../src/game/maps/IslandTourMap';
import { createEmptyCommands } from '../src/game/types';
import {
  applyLocalActorPrediction,
  type LocalInputSample,
} from '../src/net/LocalActorPrediction';
import { SnapshotTimeline, cloneSnapshot } from '../src/net/SnapshotInterpolation';

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

  test('owned actors replay unacknowledged local input ahead of authority', () => {
    const simulation = new GameSimulation(SWEET_ORCHARD_ISLAND_MAP);
    simulation.loadScenario('active-play');
    const authority = simulation.getSnapshot();
    const rendered = cloneSnapshot(authority);
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

    const result = applyLocalActorPrediction(
      rendered,
      authority,
      'guards',
      SWEET_ORCHARD_ISLAND_MAP,
      DEFAULT_MOVEMENT_TUNING,
      history,
      0,
    );

    expect(result.replayedTicks).toBe(3);
    expect(rendered.guards[0].position.x - authority.guards[0].position.x).toBeCloseTo(0.42, 6);
    expect(rendered.guards[1].position).toEqual(authority.guards[1].position);
  });
});
