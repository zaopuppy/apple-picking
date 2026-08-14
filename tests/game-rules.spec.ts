import { expect, test } from '@playwright/test';

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
    expect(snapshot.kid.state).toBe('Invincible');
    expect(snapshot.kid.pickingTargetId).toBeNull();
    expect(snapshot.apples[0].state).toBe('Ground');
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

  test('guards never change apples and delivery requires one active throw per apple', async ({ page }) => {
    const result = await page.evaluate(() => {
      const hooks = window.__THREE_GAME_TEST_HOOKS__!;
      hooks.scenario('guard-on-apple');
      const guardOverlap = hooks.step({}, 2);
      hooks.scenario('delivery');
      const arrived = hooks.step({}, 1);
      const firstThrow = hooks.step({ kid: { moveX: 0, moveZ: 0, actionPressed: false, dropPressed: true } }, 1);
      const secondThrow = hooks.step({ kid: { moveX: 0, moveZ: 0, actionPressed: false, dropPressed: true } }, 1);
      return { guardOverlap, arrived, firstThrow, secondThrow };
    });
    expect(result.guardOverlap.apples[0].state).toBe('Ground');
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
