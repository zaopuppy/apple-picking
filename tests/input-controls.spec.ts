import { expect, test } from '@playwright/test';

test.describe('keyboard controls', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chrome', 'Keyboard controls run once on desktop.');
    await page.goto('/');
    await page.waitForFunction(() => Boolean(window.__THREE_GAME_TEST_HOOKS__));
  });

  test('guard1 moves with ESDF', async ({ page }) => {
    const directions = [
      { key: 'e', axis: 'z' as const, sign: -1 },
      { key: 's', axis: 'x' as const, sign: -1 },
      { key: 'd', axis: 'z' as const, sign: 1 },
      { key: 'f', axis: 'x' as const, sign: 1 },
    ];

    for (const { key, axis, sign } of directions) {
      const start = await page.evaluate(() => {
        window.__THREE_GAME_TEST_HOOKS__!.scenario('active-play');
        return window.__THREE_GAME_TEST_HOOKS__!.getSnapshot().guards[0].position;
      });
      await page.keyboard.down(key);
      await page.waitForTimeout(120);
      await page.keyboard.up(key);
      const end = await page.evaluate(() =>
        window.__THREE_GAME_TEST_HOOKS__!.getSnapshot().guards[0].position,
      );

      expect((end[axis] - start[axis]) * sign).toBeGreaterThan(0.1);
    }
  });

  test('guard1 uses A and guard2 uses semicolon to pounce', async ({ page }) => {
    await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.scenario('active-play'));
    await page.keyboard.press('a');
    await expect.poll(async () => page.evaluate(() =>
      window.__THREE_GAME_TEST_HOOKS__!.getSnapshot().guards[0].state,
    )).toBe('Pounce');

    await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.scenario('active-play'));
    await page.keyboard.press(';');
    await expect.poll(async () => page.evaluate(() =>
      window.__THREE_GAME_TEST_HOOKS__!.getSnapshot().guards[1].state,
    )).toBe('Pounce');
  });
});
