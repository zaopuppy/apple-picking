import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import {
  orthographicFrameOccupancy,
  resolveOrthographicFollowZoom,
} from '../src/systems/CameraFollow';

test.describe('desktop browser multiplayer demo', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chrome', 'The first online slice targets desktop Chrome.');
  });

  test('guard framing zooms out to the safe frame without exceeding the full-map limit', () => {
    const separatedGuards = {
      halfWidth: 53.76,
      halfHeight: 30.24,
      horizontalExtent: 39,
      verticalExtent: 3,
    };
    const separatedZoom = resolveOrthographicFollowZoom(separatedGuards, 0.96, 1.4, 0.78);
    expect(separatedZoom).toBeCloseTo(1.0752, 4);
    expect(orthographicFrameOccupancy(separatedGuards, separatedZoom)).toBeCloseTo(0.78, 5);

    const extremeSeparation = { ...separatedGuards, horizontalExtent: 50 };
    expect(resolveOrthographicFollowZoom(extremeSeparation, 0.96, 1.4, 0.78)).toBe(0.96);
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

  test('remote movement is interpolated and owned input is predicted every render frame', async ({ page, context }, testInfo) => {
    test.setTimeout(45_000);
    const { kidPage } = await createTwoPlayerRoom(page, context);
    await startMatch(page, kidPage);
    await Promise.all([
      page.evaluate(() =>
        window.__THREE_GAME_ONLINE_TEST_HOOKS__?.setSimulatedNetwork(120, 30)),
      kidPage.evaluate(() =>
        window.__THREE_GAME_ONLINE_TEST_HOOKS__?.setSimulatedNetwork(120, 30)),
    ]);
    await page.waitForTimeout(400);

    const inputResponseMs = await measureOwnedInputResponse(page);
    await page.waitForTimeout(250);
    const [remoteSamples, localSamples] = await Promise.all([
      sampleGuardMotion(kidPage, 650),
      sampleGuardMotion(page, 650),
    ]);
    const diagnostics = await page.evaluate(() =>
      window.__THREE_GAME_ONLINE_TEST_HOOKS__?.getDriverDiagnostics(),
    );
    await page.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyF', key: 'f', bubbles: true }));
    });

    const remoteMotion = summarizeMotion(remoteSamples);
    const localMotion = summarizeMotion(localSamples);
    const report = {
      remote: remoteMotion,
      local: localMotion,
      inputResponseMs,
      diagnostics,
    };
    await testInfo.attach('network-smoothing-report', {
      body: JSON.stringify(report, null, 2),
      contentType: 'application/json',
    });
    console.log(`network smoothing: ${JSON.stringify(report)}`);

    expect(remoteSamples.length).toBeGreaterThanOrEqual(12);
    expect(remoteMotion.stationaryRatio, 'interpolation should eliminate repeated 20 Hz positions')
      .toBeLessThan(0.15);
    expect(remoteMotion.p95Speed, 'interpolated movement should preserve stable apparent speed')
      .toBeLessThan(11);
    expect(localMotion.stationaryRatio, 'local prediction should update owned actors every frame')
      .toBeLessThan(0.15);
    expect(localMotion.p95Speed, 'prediction correction should not create visible speed spikes')
      .toBeLessThan(12);
    expect(inputResponseMs, 'owned movement should become visible within the game-feel response budget')
      .toBeLessThan(100);
    expect(diagnostics?.predictionReplayTicks ?? 0, 'owned input should be replayed ahead of authority')
      .toBeGreaterThan(0);
    expect(diagnostics?.predictionMode).toBe('checkpoint-replay');
    expect(diagnostics?.predictionTick ?? 0).toBeGreaterThanOrEqual(diagnostics?.serverTick ?? 0);
    expect(diagnostics?.bufferedStateFrames ?? 0).toBeGreaterThanOrEqual(3);
    expect(diagnostics?.simulatedStateLatencyMs).toBe(120);
    expect(diagnostics?.simulatedStateJitterMs).toBe(30);

    await Promise.all([
      page.evaluate(() =>
        window.__THREE_GAME_ONLINE_TEST_HOOKS__?.setSimulatedNetwork(0, 0)),
      kidPage.evaluate(() =>
        window.__THREE_GAME_ONLINE_TEST_HOOKS__?.setSimulatedNetwork(0, 0)),
    ]);
    await page.waitForTimeout(500);
    await expectSnapshotsToConverge(page, kidPage);
    await kidPage.close();
  });

  test('each online seat follows its owned actors and keeps both guards in a safe frame', async ({ page, context }) => {
    test.setTimeout(45_000);
    const { kidPage } = await createTwoPlayerRoom(page, context);
    await startMatch(page, kidPage);

    const initialGuards = await snapshotOf(page);
    const initialGuardMidpoint = midpointOfGuards(initialGuards);
    const initialGuardCamera = await cameraOf(page);
    const initialKidCamera = await cameraOf(kidPage);
    expect(initialGuardCamera.followSeat).toBe('guards');
    expect(initialGuardCamera.followSubjectCount).toBe(2);
    expect(initialGuardCamera.followActive).toBe(true);
    expect(initialGuardCamera.zoom).toBeCloseTo(1.4, 2);
    expect(initialGuardCamera.targetX).toBeCloseTo(initialGuardMidpoint.x, 1);
    expect(initialGuardCamera.targetZ).toBeCloseTo(initialGuardMidpoint.z, 1);
    expect(initialKidCamera.followSeat).toBe('kid');
    expect(initialKidCamera.followSubjectCount).toBe(1);
    expect(initialKidCamera.followActive).toBe(true);
    expect(initialKidCamera.zoom).toBeCloseTo(1.4, 2);
    expect(initialKidCamera.targetX).toBeCloseTo(initialGuards.kid.position.x, 1);
    expect(initialKidCamera.targetZ).toBeCloseTo(initialGuards.kid.position.z, 1);

    const guardTargetBeforeKidMoves = {
      x: initialGuardCamera.targetX,
      z: initialGuardCamera.targetZ,
    };
    await kidPage.keyboard.down('ArrowRight');
    await kidPage.waitForTimeout(450);
    await kidPage.keyboard.up('ArrowRight');
    await expect.poll(async () => (await cameraOf(kidPage)).targetX)
      .toBeGreaterThan(initialKidCamera.targetX + 0.5);
    const guardCameraAfterKidMoves = await cameraOf(page);
    expect(guardCameraAfterKidMoves.targetX).toBeCloseTo(guardTargetBeforeKidMoves.x, 1);
    expect(guardCameraAfterKidMoves.targetZ).toBeCloseTo(guardTargetBeforeKidMoves.z, 1);

    await page.locator('#camera-mode-toggle').click();
    const freeCamera = await cameraOf(page);
    expect(freeCamera.followActive).toBe(false);
    await page.keyboard.down('f');
    await page.waitForTimeout(450);
    await page.keyboard.up('f');
    const freeCameraAfterMovement = await cameraOf(page);
    expect(freeCameraAfterMovement.targetX).toBeCloseTo(freeCamera.targetX, 2);
    expect(freeCameraAfterMovement.targetZ).toBeCloseTo(freeCamera.targetZ, 2);

    await page.locator('#camera-mode-toggle').click();
    const restoredSnapshot = await snapshotOf(page);
    const restoredMidpoint = midpointOfGuards(restoredSnapshot);
    const restoredCamera = await cameraOf(page);
    expect(restoredCamera.followActive).toBe(true);
    expect(restoredCamera.targetX).toBeCloseTo(restoredMidpoint.x, 1);
    expect(restoredCamera.targetZ).toBeCloseTo(restoredMidpoint.z, 1);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(async () => (await cameraOf(page)).portraitLayout).toBe(true);
    const portraitSnapshot = await snapshotOf(page);
    const portraitMidpoint = midpointOfGuards(portraitSnapshot);
    const portraitCamera = await cameraOf(page);
    expect(portraitCamera.targetX).toBeCloseTo(portraitMidpoint.x, 2);
    expect(portraitCamera.targetZ).toBeCloseTo(portraitMidpoint.z, 2);
    expect(portraitCamera.followFrameOccupancy ?? 1).toBeLessThanOrEqual(0.8);
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

async function cameraOf(page: Page) {
  return page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__!.camera);
}

function midpointOfGuards(snapshot: Awaited<ReturnType<typeof snapshotOf>>): { x: number; z: number } {
  return {
    x: (snapshot.guards[0].position.x + snapshot.guards[1].position.x) / 2,
    z: (snapshot.guards[0].position.z + snapshot.guards[1].position.z) / 2,
  };
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

async function sampleGuardMotion(
  page: Page,
  durationMs: number,
): Promise<Array<{ time: number; x: number; z: number }>> {
  return page.evaluate((duration) => new Promise((resolve) => {
    const samples: Array<{ time: number; x: number; z: number }> = [];
    const startedAt = performance.now();
    const sample = (time: number): void => {
      const snapshot = window.__THREE_GAME_TEST_HOOKS__?.getSnapshot();
      if (snapshot) {
        samples.push({
          time: time - startedAt,
          x: snapshot.guards[0].position.x,
          z: snapshot.guards[0].position.z,
        });
      }
      if (time - startedAt >= duration) resolve(samples);
      else requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }), durationMs);
}

function summarizeMotion(samples: Array<{ time: number; x: number; z: number }>): {
  samples: number;
  stationaryRatio: number;
  p95Speed: number;
  maxSpeed: number;
} {
  const segments = samples.slice(1).map((sample, index) => {
    const previous = samples[index];
    const distance = Math.hypot(sample.x - previous.x, sample.z - previous.z);
    const durationSeconds = Math.max(0.001, (sample.time - previous.time) / 1000);
    return { distance, speed: distance / durationSeconds };
  });
  const sortedSpeeds = segments.map((segment) => segment.speed)
    .sort((first, second) => first - second);
  return {
    samples: samples.length,
    stationaryRatio: segments.filter((segment) => segment.distance < 0.002).length / segments.length,
    p95Speed: sortedSpeeds[Math.floor(sortedSpeeds.length * 0.95)] ?? 0,
    maxSpeed: sortedSpeeds.at(-1) ?? 0,
  };
}

async function measureOwnedInputResponse(page: Page): Promise<number> {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const initialX = window.__THREE_GAME_TEST_HOOKS__?.getSnapshot().guards[0].position.x;
    if (initialX === undefined) {
      reject(new Error('Online snapshot was unavailable before input response measurement.'));
      return;
    }
    const startedAt = performance.now();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF', key: 'f', bubbles: true }));
    const sample = (time: number): void => {
      const x = window.__THREE_GAME_TEST_HOOKS__?.getSnapshot().guards[0].position.x;
      if (x !== undefined && x > initialX + 0.01) {
        resolve(time - startedAt);
        return;
      }
      if (time - startedAt > 500) {
        reject(new Error('Owned actor did not visibly respond within 500ms.'));
        return;
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }));
}
