import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';

type CanvasSample = {
  ok: boolean;
  reason: string;
  variance?: number;
  colorBuckets?: number;
};

async function sampleCanvas(page: import('@playwright/test').Page): Promise<CanvasSample> {
  const canvas = page.locator('#game-canvas');
  const box = await canvas.boundingBox();
  if (!box || box.width < 32 || box.height < 32) {
    return { ok: false, reason: 'canvas-too-small' };
  }

  const buffer = await canvas.screenshot();
  const png = PNG.sync.read(buffer);
  let min = 255;
  let max = 0;
  let alphaPixels = 0;
  const buckets = new Set<string>();
  const stride = Math.max(1, Math.floor((png.width * png.height) / 4096));

  for (let pixel = 0; pixel < png.width * png.height; pixel += stride) {
    const offset = pixel * 4;
    const r = png.data[offset];
    const g = png.data[offset + 1];
    const b = png.data[offset + 2];
    const a = png.data[offset + 3];
    min = Math.min(min, r, g, b);
    max = Math.max(max, r, g, b);
    if (a > 0) alphaPixels += 1;
    buckets.add(`${r >> 4},${g >> 4},${b >> 4},${a >> 6}`);
  }

  const variance = max - min;
  return {
    ok: alphaPixels > 256 && (variance > 8 || buckets.size > 3),
    reason: 'sampled',
    variance,
    colorBuckets: buckets.size,
  };
}

test('renders a nonblank interactive game canvas', async ({ page }, testInfo) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');
  await expect(page.locator('#game-canvas')).toBeVisible();
  await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 10);
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.setState('active-play'));

  const fpsValue = page.locator('#fps-value');
  await expect(fpsValue).toBeVisible();
  await expect.poll(async () => Number(await fpsValue.textContent())).toBeGreaterThan(0);
  const frameRate = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.frameRate);
  expect(frameRate?.current).toBeLessThanOrEqual(60);
  expect(frameRate?.cap).toBe(60);

  const sample = await sampleCanvas(page);
  expect(sample, JSON.stringify(sample)).toMatchObject({ ok: true });

  const renderer = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.renderer);
  expect(renderer?.calls).toBeLessThanOrEqual(150);
  expect(renderer?.triangles).toBeLessThanOrEqual(100_000);

  const physics = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.physics);
  expect(physics).toMatchObject({
    engine: 'custom-xz-circle-aabb',
    timestep: 1 / 60,
    bodies: 9,
    colliders: 13,
    sensors: 1,
    ccdBodies: 0,
  });

  const before = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.guards[0].position.z ?? 0);
  await page.keyboard.down('KeyE');
  await page.waitForTimeout(450);
  await page.keyboard.up('KeyE');

  await expect
    .poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.guards[0].position.z ?? 0))
    .toBeLessThan(before - 0.3);

  const hudOverflow = await page.evaluate(() => {
    const elements = [...document.querySelectorAll<HTMLElement>('#score-ribbon, #carried-badge, #controls')];
    return elements.some((element) => element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1);
  });
  expect(hudOverflow).toBe(false);

  const screenshot = await page.screenshot({ fullPage: true });
  await testInfo.attach(`${testInfo.project.name}-game`, {
    body: screenshot,
    contentType: 'image/png',
  });

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('render loop adapts to the available refresh rate and caps at 60 FPS', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'Synthetic refresh timing only needs one browser target.');
  await page.goto('/src/core/Loop.ts');

  const samples = await page.evaluate(async () => {
    const loopModulePath = String('/src/core/Loop.ts');
    const { Loop } = await import(/* @vite-ignore */ loopModulePath);

    const runAtRefreshRate = (refreshRate: number, callbackCount: number) => {
      const originalRequestAnimationFrame = window.requestAnimationFrame;
      const originalCancelAnimationFrame = window.cancelAnimationFrame;
      let scheduled: FrameRequestCallback | undefined;
      let nextFrameId = 1;
      let updates = 0;
      let renders = 0;
      let fps = 0;

      window.requestAnimationFrame = (callback: FrameRequestCallback) => {
        scheduled = callback;
        return nextFrameId++;
      };
      window.cancelAnimationFrame = () => {
        scheduled = undefined;
      };

      try {
        const loop = new Loop(
          (_delta: number, _elapsed: number, measuredFps: number) => {
            updates += 1;
            fps = measuredFps;
          },
          () => {
            renders += 1;
          },
          60,
        );
        loop.start();
        const startedAt = performance.now();

        for (let index = 1; index <= callbackCount; index += 1) {
          const callback = scheduled;
          if (!callback) throw new Error('Loop did not schedule the next animation frame.');
          scheduled = undefined;
          callback(startedAt + index * 1000 / refreshRate);
        }

        loop.stop();
        return { updates, renders, fps };
      } finally {
        window.requestAnimationFrame = originalRequestAnimationFrame;
        window.cancelAnimationFrame = originalCancelAnimationFrame;
      }
    };

    return {
      highRefresh: runAtRefreshRate(120, 240),
      lowRefresh: runAtRefreshRate(30, 60),
    };
  });

  expect(samples.highRefresh.updates).toBeGreaterThanOrEqual(118);
  expect(samples.highRefresh.updates).toBeLessThanOrEqual(121);
  expect(samples.highRefresh.renders).toBe(samples.highRefresh.updates);
  expect(samples.highRefresh.fps).toBe(60);
  expect(samples.lowRefresh.updates).toBe(60);
  expect(samples.lowRefresh.renders).toBe(60);
  expect(samples.lowRefresh.fps).toBeGreaterThanOrEqual(29);
  expect(samples.lowRefresh.fps).toBeLessThanOrEqual(30);
});

test('responsive HUD keeps objective and inventory clear of the playfield', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__THREE_GAME_TEST_HOOKS__));
  await page.evaluate(() => {
    window.__THREE_GAME_TEST_HOOKS__?.setPausedForScreenshot(true);
    window.__THREE_GAME_TEST_HOOKS__?.scenario('heavy-carry');
  });

  await expect(page.locator('#carried-value')).toHaveText('6');
  await expect(page.locator('#state-strip')).toHaveCount(0);
  await expect(page.locator('#status-line')).toHaveCount(0);

  const layout = await page.evaluate(() => {
    const rect = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) throw new Error(`Missing HUD element: ${selector}`);
      const bounds = element.getBoundingClientRect();
      return {
        top: bounds.top,
        right: bounds.right,
        bottom: bounds.bottom,
        left: bounds.left,
        width: bounds.width,
        height: bounds.height,
      };
    };
    const hudElements = [...document.querySelectorAll<HTMLElement>(
      '#score-ribbon, #carried-badge, #controls',
    )];
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      score: rect('#score-ribbon'),
      carried: rect('#carried-badge'),
      controls: rect('#controls'),
      overflow: hudElements.some((element) =>
        element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1),
      camera: window.__THREE_GAME_DIAGNOSTICS__?.camera,
    };
  });

  expect(layout.overflow).toBe(false);
  for (const bounds of [layout.score, layout.carried, layout.controls]) {
    expect(bounds.left).toBeGreaterThanOrEqual(-1);
    expect(bounds.right).toBeLessThanOrEqual(layout.viewport.width + 1);
    expect(bounds.top).toBeGreaterThanOrEqual(-1);
    expect(bounds.bottom).toBeLessThanOrEqual(layout.viewport.height + 1);
  }
  expect(layout.score.bottom).toBeLessThanOrEqual(layout.carried.top - 4);

  if (testInfo.project.name === 'narrow-chrome') {
    expect(layout.camera?.viewWidth).toBeLessThanOrEqual(25.1);
    expect(layout.camera?.verticalOffset).toBeGreaterThan(0.6);
    expect(layout.camera?.positionY).toBeCloseTo(29, 5);
    expect(layout.camera?.positionZ).toBeCloseTo(13, 5);
  } else {
    expect(layout.camera?.viewHeight).toBeCloseTo(23, 5);
    expect(layout.camera?.verticalOffset).toBeCloseTo(0, 5);
  }
});

test('right shift delivers exactly one apple through the real input path', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'Keyboard delivery is covered once on desktop Chrome.');
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__THREE_GAME_TEST_HOOKS__));
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.scenario('delivery'));

  await expect.poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.delivered ?? -1)).toBe(0);
  await page.keyboard.press('ShiftRight');
  await expect.poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.delivered ?? -1)).toBe(1);
  await expect.poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.kid.carriedAppleIds.length ?? -1)).toBe(1);
});

test('character state presentation stays readable across key gameplay moments', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'The presentation state matrix only needs one browser target.');
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__THREE_GAME_TEST_HOOKS__));
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.setPausedForScreenshot(true));

  const scenarios = [
    { name: 'heavy-carry', kidState: 'Normal', carried: 6 },
    { name: 'guard-pounce', guardState: 'Pounce' },
    { name: 'guard-recover', guardState: 'Recover' },
    { name: 'guard-stunned', guardState: 'Stunned' },
    { name: 'delivery-progress', carried: 2, delivered: 3 },
    { name: 'captured', kidState: 'Invincible' },
  ] as const;

  for (const scenario of scenarios) {
    await page.evaluate((name) => window.__THREE_GAME_TEST_HOOKS__?.scenario(name), scenario.name);
    await page.waitForTimeout(34);

    const diagnostics = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__);
    expect(diagnostics, scenario.name).toBeDefined();
    if ('kidState' in scenario) expect(diagnostics?.kid.state).toBe(scenario.kidState);
    if ('guardState' in scenario) expect(diagnostics?.guards[0].state).toBe(scenario.guardState);
    if ('carried' in scenario) expect(diagnostics?.kid.carriedAppleIds.length).toBe(scenario.carried);
    if ('delivered' in scenario) expect(diagnostics?.delivered).toBe(scenario.delivered);

    const sample = await sampleCanvas(page);
    expect(sample, `${scenario.name}: ${JSON.stringify(sample)}`).toMatchObject({ ok: true });
  }

  await page.evaluate(() => {
    window.__THREE_GAME_TEST_HOOKS__?.setReducedMotion(true);
    window.__THREE_GAME_TEST_HOOKS__?.scenario('heavy-carry');
  });
  await page.waitForTimeout(34);
  const reducedMotionSample = await sampleCanvas(page);
  expect(reducedMotionSample, JSON.stringify(reducedMotionSample)).toMatchObject({ ok: true });
});
