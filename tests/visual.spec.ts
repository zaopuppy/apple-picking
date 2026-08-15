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
  if (testInfo.project.name === 'desktop-chrome') {
    await expect
      .poll(
        async () => page.evaluate(() => ({
          audio: window.__THREE_GAME_DIAGNOSTICS__?.audio,
          environment: window.__THREE_GAME_DIAGNOSTICS__?.environment,
          characters: window.__THREE_GAME_DIAGNOSTICS__?.characters,
        })),
        { timeout: 15_000 },
      )
      .toMatchObject({
        audio: { fetchedSamples: 10, failedSamples: 0 },
        environment: { treeMode: 'imported', lastFailure: null },
        characters: {
          guard1Mode: 'imported',
          guard2Mode: 'imported',
          kidMode: 'imported',
          lastFailure: null,
        },
      });
  }
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.setState('active-play'));

  await expect
    .poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.frameRate.current ?? 0))
    .toBeGreaterThan(0);
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
    const elements = [...document.querySelectorAll<HTMLElement>('#score-ribbon, #carried-badge')];
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

test('transparent top HUD and arena framing adapt to the viewport', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__THREE_GAME_TEST_HOOKS__));
  await page.evaluate(() => {
    window.__THREE_GAME_TEST_HOOKS__?.setPausedForScreenshot(true);
    window.__THREE_GAME_TEST_HOOKS__?.scenario('heavy-carry');
  });

  await expect(page.locator('#carried-value')).toHaveText('6');
  await expect(page.locator('#state-strip')).toHaveCount(0);
  await expect(page.locator('#status-line')).toHaveCount(0);
  await expect(page.locator('#controls')).toHaveCount(0);
  await expect(page.locator('#fps-value')).toHaveCount(0);

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
    const hudElements = [...document.querySelectorAll<HTMLElement>('#score-ribbon, #carried-badge')];
    const background = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) throw new Error(`Missing HUD element: ${selector}`);
      return getComputedStyle(element).backgroundColor;
    };
    const layer = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) throw new Error(`Missing layered element: ${selector}`);
      return Number(getComputedStyle(element).zIndex);
    };
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      score: rect('#score-ribbon'),
      carried: rect('#carried-badge'),
      backgrounds: {
        score: background('#score-ribbon'),
        carried: background('#carried-badge'),
      },
      layers: {
        canvas: layer('#game-canvas'),
        score: layer('#score-ribbon'),
        carried: layer('#carried-badge'),
      },
      overflow: hudElements.some((element) =>
        element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1),
      camera: window.__THREE_GAME_DIAGNOSTICS__?.camera,
    };
  });

  expect(layout.overflow).toBe(false);
  expect(layout.backgrounds).toEqual({
    score: 'rgba(0, 0, 0, 0)',
    carried: 'rgba(0, 0, 0, 0)',
  });
  expect(layout.layers.score).toBeGreaterThan(layout.layers.canvas);
  expect(layout.layers.carried).toBeGreaterThan(layout.layers.canvas);
  for (const bounds of [layout.score, layout.carried]) {
    expect(bounds.left).toBeGreaterThanOrEqual(-1);
    expect(bounds.right).toBeLessThanOrEqual(layout.viewport.width + 1);
    expect(bounds.top).toBeGreaterThanOrEqual(-1);
    expect(bounds.bottom).toBeLessThanOrEqual(layout.viewport.height + 1);
  }
  expect(layout.score.bottom).toBeLessThanOrEqual(layout.carried.top + 1);

  if (testInfo.project.name === 'narrow-chrome') {
    expect(layout.camera?.portraitLayout).toBe(true);
    expect(layout.camera?.viewWidth).toBeLessThanOrEqual(18.9);
    expect(layout.camera?.verticalOffset).toBeCloseTo(0, 5);
    expect(layout.camera?.positionX).toBeCloseTo(10.5, 5);
    expect(layout.camera?.positionY).toBeCloseTo(34, 5);
    expect(layout.camera?.positionZ).toBeCloseTo(0, 5);
  } else {
    expect(layout.camera?.portraitLayout).toBe(false);
    expect(layout.camera?.viewHeight).toBeCloseTo(18.5, 5);
    expect(layout.camera?.verticalOffset).toBeCloseTo(0, 5);
    expect(layout.camera?.positionX).toBeCloseTo(0, 5);
    expect(layout.camera?.positionZ).toBeCloseTo(19.5, 5);
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

test('CC0 event samples load after audio unlock and retain the procedural fallback', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'Audio loading only needs one installed Chrome run.');
  const audioResponses: Array<{ path: string; status: number }> = [];
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (url.pathname.includes('/assets/audio/kenney/')) {
      audioResponses.push({
        path: url.pathname,
        status: response.status(),
      });
    }
  });
  await page.goto('/?trees=procedural');
  await page.waitForFunction(() => Boolean(window.__THREE_GAME_TEST_HOOKS__));
  await expect.poll(() => audioResponses).toEqual([
    { path: '/assets/audio/kenney/sfx-pack.json', status: 200 },
  ]);
  await page.locator('#game-canvas').click({ position: { x: 20, y: 20 } });

  await expect
    .poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.audio))
    .toMatchObject({
      unlocked: true,
      fetchedSamples: 10,
      decodedSamples: 10,
      failedSamples: 0,
      lastFailure: null,
    });
  const loadedAudio = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.audio);
  expect(loadedAudio).toMatchObject({
    externalEnabled: true,
    unlocked: true,
    sampleFiles: 10,
    fetchedSamples: 10,
    decodedSamples: 10,
    failedSamples: 0,
  });

  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.scenario('delivery'));
  await page.keyboard.press('ShiftRight');
  await expect
    .poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.audio.samplePlays ?? 0))
    .toBeGreaterThan(0);

  await page.goto('/?audio=procedural&trees=procedural');
  await page.waitForFunction(() => Boolean(window.__THREE_GAME_TEST_HOOKS__));
  await page.locator('#game-canvas').click({ position: { x: 20, y: 20 } });
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.scenario('delivery'));
  await page.keyboard.press('ShiftRight');
  await expect
    .poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.audio.fallbackPlays ?? 0))
    .toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.audio)).toMatchObject({
    externalEnabled: false,
    sampleFiles: 10,
    fetchedSamples: 0,
    decodedSamples: 0,
    samplePlays: 0,
  });
});

test('CC0 orchard trees load within the mobile render budget and retain the procedural fallback', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'Tree asset loading only needs one installed Chrome run.');
  const assetResponses: Array<{ path: string; status: number }> = [];
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (url.pathname.includes('/assets/models/kaykit-forest/')) {
      assetResponses.push({ path: url.pathname, status: response.status() });
    }
  });

  await page.goto('/?audio=procedural');
  await expect
    .poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.environment))
    .toMatchObject({
      treeMode: 'imported',
      externalRequested: true,
      treeVariants: 3,
      treeInstances: 9,
      treeTriangles: 9750,
      lastFailure: null,
    });
  expect(assetResponses).toHaveLength(3);
  expect(assetResponses.every((response) => response.status === 200), JSON.stringify(assetResponses)).toBe(true);

  const renderer = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.renderer);
  expect(renderer?.calls).toBeLessThanOrEqual(75);
  expect(renderer?.triangles).toBeLessThanOrEqual(80_000);
  expect(renderer?.textures).toBeLessThanOrEqual(12);

  await page.goto('/?audio=procedural&trees=procedural');
  await page.waitForFunction(() => Boolean(window.__THREE_GAME_DIAGNOSTICS__));
  expect(await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.environment)).toMatchObject({
    treeMode: 'procedural',
    externalRequested: false,
    treeVariants: 0,
    treeInstances: 9,
    treeTriangles: 0,
    lastFailure: null,
  });
});

test('KayKit Knight guards and Rogue kid load once and map key states independently', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'Character asset loading only needs one installed Chrome run.');
  const modelResponses: Array<{ path: string; status: number }> = [];
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (url.pathname.includes('/assets/models/kaykit-adventurers/')) {
      modelResponses.push({ path: url.pathname, status: response.status() });
    }
  });

  await page.goto('/?audio=procedural&trees=procedural');
  await expect
    .poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.characters))
    .toMatchObject({
      guard1Mode: 'imported',
      guard2Mode: 'imported',
      kidMode: 'imported',
      importedGuards: 2,
      importedCharacters: 3,
      meshes: 25,
      triangles: 19_162,
      materials: 5,
      textures: 2,
      animations: ['Idle_A', 'Running_A', 'Jump_Full_Short', 'Jump_Land', 'Hit_A'],
      kidAnimations: ['Idle_A', 'Running_A', 'PickUp', 'Hit_A'],
      currentAnimations: { guard1: 'Idle_A', guard2: 'Idle_A', kid: 'Idle_A' },
      sockets: ['head', 'left-hand', 'right-hand', 'back'],
      kidSockets: ['head', 'left-hand', 'right-hand', 'back'],
      lastFailure: null,
      lastFailures: { guard1: null, guard2: null, kid: null },
    });
  expect(modelResponses.sort((a, b) => a.path.localeCompare(b.path))).toEqual([
    { path: '/assets/models/kaykit-adventurers/Knight_Guard.glb', status: 200 },
    { path: '/assets/models/kaykit-adventurers/Rogue_Kid.glb', status: 200 },
  ]);

  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.scenario('active-play'));
  await page.keyboard.down('KeyE');
  await expect
    .poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.characters.currentAnimations.guard1))
    .toBe('Running_A');
  await page.keyboard.up('KeyE');
  await expect
    .poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.characters.currentAnimations.guard1))
    .toBe('Idle_A');
  await page.keyboard.down('KeyI');
  await expect
    .poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.characters.currentAnimations.guard2))
    .toBe('Running_A');
  await page.keyboard.up('KeyI');
  await expect
    .poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.characters.currentAnimations.guard2))
    .toBe('Idle_A');
  await page.keyboard.down('ArrowUp');
  await expect
    .poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.characters.currentAnimations.kid))
    .toBe('Running_A');
  await page.keyboard.up('ArrowUp');
  await expect
    .poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.characters.currentAnimations.kid))
    .toBe('Idle_A');
  await expect
    .poll(async () => page.evaluate(() => {
      const scale = window.__THREE_GAME_DIAGNOSTICS__?.characters.kidDetails?.breathScaleY ?? 1;
      return Math.abs(scale - 1);
    }))
    .toBeGreaterThan(0.001);

  await page.evaluate(() => {
    window.__THREE_GAME_TEST_HOOKS__?.setPausedForScreenshot(true);
    window.__THREE_GAME_TEST_HOOKS__?.scenario('heavy-carry');
  });
  await expect
    .poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.characters.kidDetails?.sweatDrops))
    .toBe(4);
  const loadDetails = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.characters.kidDetails);
  expect(loadDetails?.backpackScaleZ).toBeGreaterThan(1.25);
  expect(loadDetails?.postureLean).toBeGreaterThan(0.15);
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.setPausedForScreenshot(false));

  const stateAnimations = [
    { scenario: 'guard-pounce', animation: 'Jump_Full_Short' },
    { scenario: 'guard-recover', animation: 'Jump_Land' },
    { scenario: 'guard-stunned', animation: 'Hit_A' },
  ];
  for (const state of stateAnimations) {
    await page.evaluate((scenario) => window.__THREE_GAME_TEST_HOOKS__?.scenario(scenario), state.scenario);
    await expect
      .poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.characters.currentAnimations.guard1))
      .toBe(state.animation);
  }
  await expect
    .poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.characters.currentAnimations.guard2))
    .toBe('Hit_A');

  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.scenario('picking'));
  await expect
    .poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.characters.currentAnimations.kid))
    .toBe('PickUp');
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.scenario('captured'));
  await expect
    .poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.characters.currentAnimations.kid))
    .toBe('Hit_A');

  const renderer = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.renderer);
  expect(renderer?.calls).toBeLessThanOrEqual(100);
  expect(renderer?.triangles).toBeLessThanOrEqual(80_000);
  expect(renderer?.textures).toBeLessThanOrEqual(12);
});

test('guard asset failure is surfaced without a procedural fallback', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'Guard failure handling only needs one installed Chrome run.');
  await page.route('**/assets/models/kaykit-adventurers/Knight_Guard.glb', (route) => route.abort('failed'));
  await page.goto('/?audio=procedural&trees=procedural');

  await expect
    .poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.characters))
    .toMatchObject({
      guard1Mode: 'failed',
      guard2Mode: 'failed',
      kidMode: 'imported',
      importedGuards: 0,
      importedCharacters: 1,
      meshes: 7,
      triangles: 7_562,
      materials: 1,
      textures: 1,
      animations: [],
      kidAnimations: ['Idle_A', 'Running_A', 'PickUp', 'Hit_A'],
      currentAnimations: { guard1: null, guard2: null, kid: 'Idle_A' },
      sockets: [],
      kidSockets: ['head', 'left-hand', 'right-hand', 'back'],
    });
  const failures = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.characters.lastFailures);
  expect(failures?.guard1).toBeTruthy();
  expect(failures?.guard2).toBeTruthy();
  expect(failures?.kid).toBeNull();
});

test('kid asset failure is surfaced without the old procedural model', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'Kid failure handling only needs one installed Chrome run.');
  await page.route('**/assets/models/kaykit-adventurers/Rogue_Kid.glb', (route) => route.abort('failed'));
  await page.goto('/?audio=procedural&trees=procedural');

  await expect
    .poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.characters))
    .toMatchObject({
      guard1Mode: 'imported',
      guard2Mode: 'imported',
      kidMode: 'failed',
      importedGuards: 2,
      importedCharacters: 2,
      meshes: 18,
      triangles: 11_600,
      materials: 4,
      textures: 1,
      animations: ['Idle_A', 'Running_A', 'Jump_Full_Short', 'Jump_Land', 'Hit_A'],
      kidAnimations: [],
      currentAnimations: { guard1: 'Idle_A', guard2: 'Idle_A', kid: null },
      sockets: ['head', 'left-hand', 'right-hand', 'back'],
      kidSockets: [],
      kidDetails: null,
    });
  const failures = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.characters.lastFailures);
  expect(failures?.guard1).toBeNull();
  expect(failures?.guard2).toBeNull();
  expect(failures?.kid).toBeTruthy();
});

test('character state presentation stays readable across key gameplay moments', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'The presentation state matrix only needs one browser target.');
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__THREE_GAME_TEST_HOOKS__));
  await expect
    .poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.characters.kidMode))
    .toBe('imported');
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
