import { expect, test, type BrowserContext, type Page } from '@playwright/test';

test.describe('desktop browser multiplayer demo', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chrome', 'The first online slice targets desktop Chrome.');
  });

  test('two tabs share one authoritative match and reject an unowned actor command', async ({ page, context }, testInfo) => {
    test.setTimeout(45_000);
    const { kidPage, roomCode } = await createTwoPlayerRoom(page, context);
    await testInfo.attach('multiplayer-lobby', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    await startMatch(page, kidPage);

    const before = await snapshotOf(page);
    await page.keyboard.down('f');
    await page.waitForTimeout(300);
    await page.keyboard.up('f');

    await expect.poll(async () => (await snapshotOf(page)).guards[0].position.x)
      .toBeGreaterThan(before.guards[0].position.x + 0.4);
    await expectSnapshotsToConverge(page, kidPage);

    await page.waitForTimeout(250);
    const beforeUnauthorized = await snapshotOf(page);
    await page.waitForTimeout(250);
    const stoppedBeforeUnauthorized = await snapshotOf(page);
    expect(stoppedBeforeUnauthorized.guards[0].position.x)
      .toBeCloseTo(beforeUnauthorized.guards[0].position.x, 3);
    expect(stoppedBeforeUnauthorized.guards[0].position.z)
      .toBeCloseTo(beforeUnauthorized.guards[0].position.z, 3);
    await kidPage.evaluate(() => window.__THREE_GAME_ONLINE_TEST_HOOKS__?.sendUnauthorizedGuardInput());
    await page.waitForTimeout(350);
    const afterUnauthorized = await snapshotOf(page);
    expect(afterUnauthorized.guards[0].position.x)
      .toBeCloseTo(stoppedBeforeUnauthorized.guards[0].position.x, 3);
    expect(afterUnauthorized.guards[0].position.z)
      .toBeCloseTo(stoppedBeforeUnauthorized.guards[0].position.z, 3);

    await testInfo.attach('multiplayer-active-room', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    expect(roomCode).toMatch(/^[A-Z2-9]{6}$/);
    await kidPage.close();
  });

  test('a brief transport drop pauses the room and restores the same seat', async ({ page, context }) => {
    test.setTimeout(45_000);
    const { kidPage } = await createTwoPlayerRoom(page, context);
    await startMatch(page, kidPage);
    const playerId = await kidPage.evaluate(() =>
      window.__THREE_GAME_ONLINE_TEST_HOOKS__?.getRoomState()?.players
        .find((player) => player.seat === 'kid')?.playerId,
    );

    await kidPage.evaluate(() => window.__THREE_GAME_ONLINE_TEST_HOOKS__?.disconnectTransport());
    await expect.poll(async () => page.evaluate(() =>
      window.__THREE_GAME_ONLINE_TEST_HOOKS__?.getRoomState()?.phase,
    )).toBe('reconnecting');
    await expect.poll(async () => kidPage.evaluate(() =>
      window.__THREE_GAME_ONLINE_TEST_HOOKS__?.getRoomState()?.phase,
    ), { timeout: 12_000 }).toBe('playing');

    const restoredPlayerId = await kidPage.evaluate(() =>
      window.__THREE_GAME_ONLINE_TEST_HOOKS__?.getRoomState()?.players
        .find((player) => player.seat === 'kid')?.playerId,
    );
    expect(restoredPlayerId).toBe(playerId);
    await expectSnapshotsToConverge(page, kidPage);
    await kidPage.close();
  });
});

async function createTwoPlayerRoom(
  guardsPage: Page,
  context: BrowserContext,
): Promise<{ kidPage: Page; roomCode: string }> {
  await guardsPage.goto('/online.html');
  await expect(guardsPage.locator('#network-status')).toHaveAttribute('data-state', 'online');
  await guardsPage.locator('#create-room-button').click();
  await expect(guardsPage.locator('#lobby-room-view')).toBeVisible();
  const roomCode = (await guardsPage.locator('#room-code-value').textContent())?.trim() ?? '';

  const kidPage = await context.newPage();
  await kidPage.goto('/online.html');
  await expect(kidPage.locator('#network-status')).toHaveAttribute('data-state', 'online');
  await kidPage.locator('[data-seat="kid"]').click();
  await kidPage.locator('#join-room-code').fill(roomCode);
  await kidPage.locator('#join-room-button').click();
  await expect(kidPage.locator('#lobby-room-view')).toBeVisible();
  await expect(guardsPage.locator('#room-seat-kid')).toHaveAttribute('data-state', 'joined');
  return { kidPage, roomCode };
}

async function startMatch(guardsPage: Page, kidPage: Page): Promise<void> {
  await guardsPage.locator('#ready-button').click();
  await kidPage.locator('#ready-button').click();
  await expect(guardsPage.locator('#online-lobby')).not.toHaveClass(/visible/);
  await expect(kidPage.locator('#online-lobby')).not.toHaveClass(/visible/);
  await expect.poll(async () => (await snapshotOf(guardsPage)).matchState, { timeout: 8_000 })
    .toBe('Playing');
  await expect.poll(async () => (await snapshotOf(kidPage)).matchState, { timeout: 8_000 })
    .toBe('Playing');
}

async function snapshotOf(page: Page) {
  return page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.getSnapshot());
}

async function expectSnapshotsToConverge(first: Page, second: Page): Promise<void> {
  await expect.poll(async () => {
    const [firstSnapshot, secondSnapshot] = await Promise.all([snapshotOf(first), snapshotOf(second)]);
    return {
      tickDelta: Math.abs(firstSnapshot.tick - secondSnapshot.tick),
      guardDelta: Math.hypot(
        firstSnapshot.guards[0].position.x - secondSnapshot.guards[0].position.x,
        firstSnapshot.guards[0].position.z - secondSnapshot.guards[0].position.z,
      ),
      catchesEqual: firstSnapshot.catches === secondSnapshot.catches,
      deliveredEqual: firstSnapshot.delivered === secondSnapshot.delivered,
    };
  }).toEqual({
    tickDelta: expect.any(Number),
    guardDelta: 0,
    catchesEqual: true,
    deliveredEqual: true,
  });
  const [firstSnapshot, secondSnapshot] = await Promise.all([snapshotOf(first), snapshotOf(second)]);
  expect(Math.abs(firstSnapshot.tick - secondSnapshot.tick)).toBeLessThanOrEqual(3);
}
