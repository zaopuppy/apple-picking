import { expect, test } from '@playwright/test';

const distance = (first: { x: number; z: number }, second: { x: number; z: number }) =>
  Math.hypot(first.x - second.x, first.z - second.z);

test.describe('deterministic apple-picking rules', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chrome', 'Rules run once in the desktop simulation.');
    await page.goto('/');
    await page.waitForFunction(() => Boolean(window.__THREE_GAME_TEST_HOOKS__));
    await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.setPausedForScreenshot(true));
  });

  test('picking holds kid for 24 ticks before carrying the apple', async ({ page }) => {
    const result = await page.evaluate(() => {
      const hooks = window.__THREE_GAME_TEST_HOOKS__!;
      hooks.scenario('pickup');
      const start = hooks.getSnapshot();
      const began = hooks.step({ kid: { moveX: 0, moveZ: 0, actionPressed: true, dropPressed: false } }, 1);
      const beforeComplete = hooks.step({ kid: { moveX: 1, moveZ: 0, actionPressed: false, dropPressed: false } }, 22);
      const completed = hooks.step({}, 1);
      return { start, began, beforeComplete, completed };
    });

    expect(result.began.kid.state).toBe('Picking');
    expect(result.began.apples[0].state).toBe('Ground');
    expect(result.beforeComplete.kid.state).toBe('Picking');
    expect(result.beforeComplete.kid.position).toEqual(result.start.kid.position);
    expect(result.beforeComplete.apples[0].state).toBe('Ground');
    expect(result.completed.kid.state).toBe('Normal');
    expect(result.completed.apples[0].state).toBe('Carried');
  });

  test('capture wins the same tick and cancels an attempted pickup', async ({ page }) => {
    const snapshot = await page.evaluate(() => {
      const hooks = window.__THREE_GAME_TEST_HOOKS__!;
      hooks.scenario('pickup-danger');
      return hooks.step({ kid: { moveX: 0, moveZ: 0, actionPressed: true, dropPressed: false } }, 1);
    });
    expect(snapshot.catches).toBe(1);
    expect(snapshot.kid.state).toBe('Hit');
    expect(snapshot.kid.pickingTargetId).toBeNull();
    expect(snapshot.apples[0].state).toBe('Ground');
  });

  test('capture locks movement briefly, then grants a mobile invincibility window', async ({ page }) => {
    const result = await page.evaluate(() => {
      const hooks = window.__THREE_GAME_TEST_HOOKS__!;
      hooks.scenario('pickup-danger');
      const captured = hooks.step({}, 1);
      const locked = hooks.step({
        kid: { moveX: 1, moveZ: 0, actionPressed: true, dropPressed: false },
      }, 17);
      const recovered = hooks.step({
        kid: { moveX: 1, moveZ: 0, actionPressed: false, dropPressed: false },
      }, 1);
      const moving = hooks.step({
        kid: { moveX: 1, moveZ: 0, actionPressed: false, dropPressed: false },
      }, 1);
      const almostVulnerable = hooks.step({}, 70);
      const vulnerable = hooks.step({}, 1);
      return { captured, locked, recovered, moving, almostVulnerable, vulnerable };
    });

    expect(result.captured.kid.state).toBe('Hit');
    expect(result.captured.kid.stateTicks).toBe(18);
    expect(result.locked.kid.state).toBe('Hit');
    expect(result.locked.kid.stateTicks).toBe(1);
    expect(result.locked.kid.position).toEqual(result.captured.kid.position);
    expect(result.locked.kid.pickingTargetId).toBeNull();
    expect(result.recovered.kid.state).toBe('Invincible');
    expect(result.recovered.kid.stateTicks).toBe(72);
    expect(result.recovered.kid.position).toEqual(result.captured.kid.position);
    expect(result.moving.kid.state).toBe('Invincible');
    expect(result.moving.kid.position.x).toBeGreaterThan(result.recovered.kid.position.x);
    expect(result.almostVulnerable.kid.state).toBe('Invincible');
    expect(result.almostVulnerable.kid.stateTicks).toBe(1);
    expect(result.vulnerable.kid.state).toBe('Normal');
    expect(result.vulnerable.catches).toBe(1);
  });

  test('actors separate while light ground apples yield without changing ownership', async ({ page }) => {
    const result = await page.evaluate(() => {
      const hooks = window.__THREE_GAME_TEST_HOOKS__!;
      hooks.scenario('guard-stunned');
      const separatedGuards = hooks.step({}, 1);

      hooks.scenario('guard-on-apple');
      const beforeApplePush = hooks.getSnapshot();
      const afterApplePush = hooks.step({}, 1);
      const restarted = hooks.step({ restartPressed: true }, 1);
      return { separatedGuards, beforeApplePush, afterApplePush, restarted };
    });

    expect(distance(result.separatedGuards.guards[0].position, result.separatedGuards.guards[1].position))
      .toBeGreaterThanOrEqual(1.1 - 0.00001);
    expect(result.afterApplePush.apples[0].state).toBe('Ground');
    expect(result.afterApplePush.guards[0].position).toEqual(result.beforeApplePush.guards[0].position);
    expect(result.afterApplePush.apples[0].position).not.toEqual(result.beforeApplePush.apples[0].position);
    expect(distance(result.afterApplePush.guards[0].position, result.afterApplePush.apples[0].position))
      .toBeGreaterThanOrEqual(0.89 - 0.00001);
    expect(result.restarted.apples[0].position).toEqual(result.beforeApplePush.apples[0].position);
  });

  test('a completed pounce enters a get-up recovery instead of a stun', async ({ page }) => {
    const result = await page.evaluate(() => {
      const hooks = window.__THREE_GAME_TEST_HOOKS__!;
      hooks.scenario('active-play');
      const pounce = hooks.step({
        guard1: { moveX: 0, moveZ: 0, actionPressed: true, dropPressed: false },
      }, 1);
      const getUp = hooks.step({}, 12);
      const almostStanding = hooks.step({}, 41);
      const standing = hooks.step({}, 1);
      return { pounce, getUp, almostStanding, standing };
    });

    expect(result.pounce.guards[0].state).toBe('Pounce');
    expect(result.getUp.guards[0].state).toBe('Recover');
    expect(result.almostStanding.guards[0].state).toBe('Recover');
    expect(result.standing.guards[0].state).toBe('Move');
  });

  test('dropping is immediate and can repeat without entering Picking', async ({ page }) => {
    const snapshots = await page.evaluate(() => {
      const hooks = window.__THREE_GAME_TEST_HOOKS__!;
      hooks.scenario('carrying');
      const first = hooks.step({ kid: { moveX: 0, moveZ: 0, actionPressed: false, dropPressed: true } }, 1);
      const second = hooks.step({ kid: { moveX: 0, moveZ: 0, actionPressed: false, dropPressed: true } }, 1);
      const third = hooks.step({ kid: { moveX: 0, moveZ: 0, actionPressed: false, dropPressed: true } }, 1);
      return [first, second, third];
    });
    expect(snapshots.map((snapshot) => snapshot.kid.carriedAppleIds.length)).toEqual([2, 1, 0]);
    expect(snapshots.every((snapshot) => snapshot.kid.state === 'Normal')).toBe(true);
  });

  test('dropping during Picking does not reset the pickup timer', async ({ page }) => {
    const result = await page.evaluate(() => {
      const hooks = window.__THREE_GAME_TEST_HOOKS__!;
      hooks.scenario('picking-with-carry');
      const began = hooks.getSnapshot();
      const afterDropInput = hooks.step({ kid: { moveX: 0, moveZ: 0, actionPressed: false, dropPressed: true } }, 1);
      return { began, afterDropInput };
    });
    expect(result.began.kid.carriedAppleIds.length).toBe(2);
    expect(result.afterDropInput.kid.carriedAppleIds.length).toBe(1);
    expect(result.afterDropInput.kid.state).toBe('Picking');
    expect(result.afterDropInput.kid.stateTicks).toBe(result.began.kid.stateTicks - 1);
  });

  test('kid cannot pick up a fourth apple', async ({ page }) => {
    const result = await page.evaluate(() => {
      const hooks = window.__THREE_GAME_TEST_HOOKS__!;
      hooks.scenario('carry-limit');
      const before = hooks.getSnapshot();
      const after = hooks.step({
        kid: { moveX: 0, moveZ: 0, actionPressed: true, dropPressed: false },
      }, 30);
      return { before, after };
    });

    expect(result.before.kid.carriedAppleIds).toHaveLength(3);
    expect(result.after.kid.carriedAppleIds).toHaveLength(3);
    expect(result.after.kid.state).toBe('Normal');
    expect(result.after.apples[3].state).toBe('Ground');
  });

  test('delivery requires one active throw per apple', async ({ page }) => {
    const result = await page.evaluate(() => {
      const hooks = window.__THREE_GAME_TEST_HOOKS__!;
      hooks.scenario('delivery');
      const arrived = hooks.step({}, 1);
      const firstThrow = hooks.step({ kid: { moveX: 0, moveZ: 0, actionPressed: false, dropPressed: true } }, 1);
      const secondThrow = hooks.step({ kid: { moveX: 0, moveZ: 0, actionPressed: false, dropPressed: true } }, 1);
      return { arrived, firstThrow, secondThrow };
    });
    expect(result.arrived.delivered).toBe(0);
    expect(result.arrived.kid.carriedAppleIds.length).toBe(2);
    expect(result.firstThrow.delivered).toBe(1);
    expect(result.firstThrow.kid.carriedAppleIds.length).toBe(1);
    expect(result.secondThrow.delivered).toBe(2);
    expect(result.secondThrow.kid.carriedAppleIds.length).toBe(0);
    expect(result.secondThrow.apples[0].state).toBe('Delivered');
    expect(result.secondThrow.apples[2].state).toBe('Ground');
    expect(result.secondThrow.kid.state).toBe('Normal');
  });

  test('a scored apple remains physical and stops counting when pushed outside the circle', async ({ page }) => {
    const result = await page.evaluate(() => {
      const hooks = window.__THREE_GAME_TEST_HOOKS__!;
      hooks.scenario('delivery-edge');
      const before = hooks.getSnapshot();
      const after = hooks.step({}, 1);
      return { before, after };
    });

    expect(result.before.delivered).toBe(1);
    expect(result.before.apples[0].state).toBe('Delivered');
    expect(result.after.delivered).toBe(0);
    expect(result.after.apples[0].state).toBe('Ground');
    expect(distance(result.after.apples[0].position, { x: 8.1, z: 5.35 })).toBeGreaterThan(2);
  });

  test('the sixth apple wins only after collision resolution leaves every apple in the circle', async ({ page }) => {
    const snapshot = await page.evaluate(() => {
      const hooks = window.__THREE_GAME_TEST_HOOKS__!;
      hooks.scenario('delivery-final');
      return hooks.step({
        kid: { moveX: 0, moveZ: 0, actionPressed: false, dropPressed: true },
      }, 1);
    });

    expect(snapshot.delivered).toBe(6);
    expect(snapshot.apples.every((apple) => apple.state === 'Delivered')).toBe(true);
    expect(snapshot.matchState).toBe('KidWin');
  });

  test('third capture takes priority over final delivery', async ({ page }) => {
    const snapshot = await page.evaluate(() => {
      const hooks = window.__THREE_GAME_TEST_HOOKS__!;
      hooks.scenario('capture-priority');
      return hooks.step({ kid: { moveX: 0, moveZ: 0, actionPressed: false, dropPressed: true } }, 1);
    });
    expect(snapshot.matchState).toBe('GuardWin');
    expect(snapshot.catches).toBe(3);
    expect(snapshot.delivered).toBe(5);
    expect(snapshot.apples[0].state).toBe('Ground');
    expect(distance(snapshot.guards[0].position, snapshot.kid.position))
      .toBeGreaterThanOrEqual(1.03 - 0.00001);
  });

  test('elapsed time counts up without a timeout or tie state', async ({ page }) => {
    const snapshot = await page.evaluate(() => {
      const hooks = window.__THREE_GAME_TEST_HOOKS__!;
      hooks.scenario('active-play');
      return hooks.step({}, 18_000);
    });
    expect(snapshot.elapsedSeconds).toBe(300);
    expect(snapshot.matchState).toBe('Playing');
  });
});
