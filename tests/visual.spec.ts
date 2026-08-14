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

  const before = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.guards[0].position.z ?? 0);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(450);
  await page.keyboard.up('KeyW');

  await expect
    .poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.guards[0].position.z ?? 0))
    .toBeLessThan(before - 0.3);

  const hudOverflow = await page.evaluate(() => {
    const elements = [...document.querySelectorAll<HTMLElement>('#score-ribbon, #state-strip, #controls')];
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

test('restart announcement stays horizontally centered during its animation', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__THREE_GAME_TEST_HOOKS__));
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.setState('active-play'));

  const statusLine = page.locator('#status-line');
  const centerOffset = async () => statusLine.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return Math.abs(rect.left + rect.width / 2 - window.innerWidth / 2);
  });

  expect(await centerOffset()).toBeLessThanOrEqual(1);
  await page.keyboard.press('KeyR');
  await expect(statusLine).toHaveText('重新开局');
  await page.waitForTimeout(40);
  expect(await centerOffset()).toBeLessThanOrEqual(1);
  await page.waitForTimeout(180);
  expect(await centerOffset()).toBeLessThanOrEqual(1);
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
