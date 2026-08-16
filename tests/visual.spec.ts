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

  await page.goto('/?world=medieval&layout=village');
  await expect(page.locator('#game-canvas')).toBeVisible();
  await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 10);
  if (testInfo.project.name === 'desktop-chrome') {
    await expect(page.locator('[data-testid="debug-panel"]')).toBeVisible();
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
        environment: {
          worldMode: 'medieval',
          worldPreset: 'village',
          worldCatalogAssets: 226,
          lastFailure: null,
        },
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
  await expect(page.locator('#fps-value')).not.toHaveText('0');

  const sample = await sampleCanvas(page);
  expect(sample, JSON.stringify(sample)).toMatchObject({ ok: true });

  const renderer = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.renderer);
  expect(renderer?.calls).toBeGreaterThan(0);
  expect(renderer?.triangles).toBeGreaterThan(0);

  const runtime = await page.evaluate(() => ({
    physics: window.__THREE_GAME_DIAGNOSTICS__?.physics,
    treeInstances: window.__THREE_GAME_DIAGNOSTICS__?.environment.treeInstances,
    landmarks: window.__THREE_GAME_DIAGNOSTICS__?.environment.landmarks,
  }));
  const physics = runtime.physics;
  expect(physics).toMatchObject({
    engine: 'custom-xz-circles',
    timestep: 1 / 60,
    bodies: 9,
    sensors: 1,
    ccdBodies: 0,
  });
  expect(physics?.colliders).toBe((runtime.treeInstances ?? 0) + (runtime.landmarks ?? 0) + 10);

  const before = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.guards[0].position.z ?? 0);
  await page.keyboard.down('KeyE');
  await page.waitForTimeout(450);
  await page.keyboard.up('KeyE');

  await expect
    .poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.guards[0].position.z ?? 0))
    .toBeLessThan(before - 0.3);

  const hudOverflow = await page.evaluate(() => {
    const elements = [...document.querySelectorAll<HTMLElement>('#score-ribbon')];
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
  await page.goto('/?world=classic');
  await page.waitForFunction(() => Boolean(window.__THREE_GAME_TEST_HOOKS__));
  await page.evaluate(() => {
    window.__THREE_GAME_TEST_HOOKS__?.setPausedForScreenshot(true);
    window.__THREE_GAME_TEST_HOOKS__?.scenario('heavy-carry');
  });

  await expect(page.locator('#carried-value')).toHaveText('3');
  await expect(page.locator('#carried-total')).toHaveText('3');
  await expect(page.locator('#carried-badge')).toHaveCount(0);
  await expect(page.locator('#state-strip')).toHaveCount(0);
  await expect(page.locator('#status-line')).toHaveCount(0);
  await expect(page.locator('#controls')).toHaveCount(0);
  await expect(page.locator('#fps-value')).toHaveCount(1);

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
    const hudElements = [...document.querySelectorAll<HTMLElement>('#score-ribbon')];
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
      backgrounds: {
        score: background('#score-ribbon'),
      },
      layers: {
        canvas: layer('#game-canvas'),
        score: layer('#score-ribbon'),
      },
      overflow: hudElements.some((element) =>
        element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1),
      camera: window.__THREE_GAME_DIAGNOSTICS__?.camera,
    };
  });

  expect(layout.overflow).toBe(false);
  expect(layout.camera?.projectionMode).toBe('orthographic');
  expect(layout.camera?.perspectiveFov).toBeNull();
  expect(layout.backgrounds).toEqual({
    score: 'rgba(0, 0, 0, 0)',
  });
  expect(layout.layers.score).toBeGreaterThan(layout.layers.canvas);
  for (const bounds of [layout.score]) {
    expect(bounds.left).toBeGreaterThanOrEqual(-1);
    expect(bounds.right).toBeLessThanOrEqual(layout.viewport.width + 1);
    expect(bounds.top).toBeGreaterThanOrEqual(-1);
    expect(bounds.bottom).toBeLessThanOrEqual(layout.viewport.height + 1);
  }
  if (testInfo.project.name === 'narrow-chrome') {
    expect(layout.camera?.portraitLayout).toBe(true);
    expect(layout.camera?.viewWidth).toBeCloseTo(67.5, 5);
    expect(layout.camera?.viewHeight).toBeCloseTo(114.92307692307693, 5);
    expect(layout.camera?.verticalOffset).toBeCloseTo(0, 5);
    expect(layout.camera?.angleFromGroundNormal).toBeCloseTo(25, 5);
    expect(layout.camera?.positionX).toBeGreaterThan(79);
    expect(layout.camera?.positionY).toBeCloseTo(170, 5);
    expect(layout.camera?.positionZ).toBeCloseTo(0, 5);
    expect(layout.camera?.targetX).toBeCloseTo(0, 5);
    expect(layout.camera?.targetY).toBeCloseTo(0, 5);
    expect(layout.camera?.targetZ).toBeCloseTo(0, 5);
    expect(layout.camera?.directionX).toBeLessThan(0);
    expect(layout.camera?.zoom).toBeCloseTo(1.08, 5);
  } else {
    expect(layout.camera?.portraitLayout).toBe(false);
    expect(layout.camera?.viewWidth).toBeCloseTo(107.52, 5);
    expect(layout.camera?.viewHeight).toBeCloseTo(60.48, 5);
    expect(layout.camera?.verticalOffset).toBeCloseTo(0, 5);
    expect(layout.camera?.positionX).toBeCloseTo(0, 5);
    expect(layout.camera?.positionY).toBeCloseTo(117.5, 5);
    expect(layout.camera?.positionZ).toBeGreaterThan(79);
    expect(layout.camera?.targetX).toBeCloseTo(0, 5);
    expect(layout.camera?.targetY).toBeCloseTo(0, 5);
    expect(layout.camera?.targetZ).toBeCloseTo(0, 5);
    expect(layout.camera?.directionZ).toBeLessThan(0);
    expect(layout.camera?.angleFromGroundNormal).toBeCloseTo(34, 5);
    expect(layout.camera?.zoom).toBeCloseTo(1.08, 5);
  }
});

test('development tuning panel is live and can be hidden by the visual test hook', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'The development panel only needs one browser target.');
  await page.goto('/?world=classic');
  await page.waitForFunction(() => Boolean(window.__THREE_GAME_TEST_HOOKS__));

  const panel = page.locator('[data-testid="debug-panel"]');
  await expect(panel).toBeVisible();
  await expect(panel.getByText('竖屏倾角（度）')).toHaveCount(0);
  await expect(panel.getByText('横屏倾角（度）')).toBeVisible();
  await expect(panel.getByText('横屏位置', { exact: true })).toBeVisible();
  await expect(panel.getByText('朝向目标', { exact: true })).toBeVisible();
  await expect(panel.getByText('基准速度')).toBeVisible();
  await expect(panel.getByText('Guard 速度系数')).toBeVisible();
  await expect(panel.getByText('Kid 速度系数')).toBeVisible();
  await expect(panel.getByRole('combobox', { name: '投影模式' }))
    .toHaveValue('正交 · 尺寸不随距离变化');
  await expect(panel.getByRole('textbox', { name: '透视视野（度）' })).toBeHidden();

  const landscapeAngle = panel.getByRole('textbox', { name: '横屏倾角（度）' });
  const baseSpeed = panel.getByRole('textbox', { name: '基准速度' });
  const guardMultiplier = panel.getByRole('textbox', { name: 'Guard 速度系数' });
  const kidMultiplier = panel.getByRole('textbox', { name: 'Kid 速度系数' });
  await landscapeAngle.fill('120');
  await landscapeAngle.press('Enter');
  await expect(landscapeAngle).toHaveValue('82');
  await landscapeAngle.fill('10');
  await landscapeAngle.press('Enter');
  await expect(landscapeAngle).toHaveValue('15');
  await landscapeAngle.fill('50');
  await landscapeAngle.press('Enter');
  await panel.getByText('横屏位置', { exact: true }).click();
  await panel.getByText('朝向目标', { exact: true }).click();
  const cameraPositionX = panel.getByRole('textbox', { name: '位置 X' });
  const cameraPositionY = panel.getByRole('textbox', { name: '位置 Y' });
  const cameraPositionZ = panel.getByRole('textbox', { name: '位置 Z' });
  const cameraTargetX = panel.getByRole('textbox', { name: '目标 X' });
  const cameraTargetY = panel.getByRole('textbox', { name: '目标 Y' });
  const cameraTargetZ = panel.getByRole('textbox', { name: '目标 Z' });
  await cameraPositionX.fill('12.5');
  await cameraPositionY.fill('130');
  await cameraPositionZ.fill('80');
  await cameraTargetX.fill('3');
  await cameraTargetY.fill('2');
  await cameraTargetZ.fill('-4');
  await expect.poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.camera))
    .toMatchObject({
      positionX: 12.5,
      positionY: 130,
      positionZ: 80,
      targetX: 3,
      targetY: 2,
      targetZ: -4,
    });
  const tunedCameraState = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.camera);
  expect(Math.hypot(
    tunedCameraState?.directionX ?? 0,
    tunedCameraState?.directionY ?? 0,
    tunedCameraState?.directionZ ?? 0,
  )).toBeCloseTo(1, 5);
  expect(tunedCameraState?.directionY).toBeLessThan(0);
  expect(tunedCameraState?.directionZ).toBeLessThan(0);
  await baseSpeed.fill('3');
  await baseSpeed.press('Enter');
  await expect(baseSpeed).toHaveValue('5');
  await baseSpeed.fill('25');
  await baseSpeed.press('Enter');
  await expect(baseSpeed).toHaveValue('20');
  await baseSpeed.fill('8');
  await expect(baseSpeed).toHaveValue('8');
  await baseSpeed.fill('15');
  await guardMultiplier.fill('0.5');
  await kidMultiplier.fill('1.5');
  await expect.poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.movement))
    .toEqual({ baseSpeed: 15, guardSpeedMultiplier: 0.5, kidSpeedMultiplier: 1.5 });

  const movement = await page.evaluate(() => {
    const hooks = window.__THREE_GAME_TEST_HOOKS__!;
    hooks.setPausedForScreenshot(true);
    hooks.scenario('active-play');
    const before = hooks.getSnapshot();
    const after = hooks.step({
      guard1: { moveX: 1, moveZ: 0, actionPressed: false, dropPressed: false },
      kid: { moveX: 1, moveZ: 0, actionPressed: false, dropPressed: false },
    });
    return {
      guardDistance: after.guards[0].position.x - before.guards[0].position.x,
      kidDistance: after.kid.position.x - before.kid.position.x,
    };
  });
  expect(movement.guardDistance).toBeCloseTo(7.5 / 60, 5);
  expect(movement.kidDistance).toBeCloseTo(22.5 / 60, 5);

  await panel.getByRole('button', { name: '恢复推荐值' }).click();
  await expect.poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.camera))
    .toMatchObject({
      positionX: 0,
      positionY: 117.5,
      targetX: 0,
      targetY: 0,
      targetZ: 0,
      angleFromGroundNormal: 34,
      zoom: 1.08,
    });

  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.hideDebugUi(true));
  await expect(panel).toBeHidden();
});

test('gameplay mouse camera zooms, orbits, pans, and stays independent from debug UI', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'Mouse camera controls only need one desktop target.');
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__THREE_GAME_TEST_HOOKS__));

  const panel = page.locator('[data-testid="debug-panel"]');
  const canvas = page.locator('#game-canvas');
  const cameraControl = page.locator('#camera-control');
  const cameraToggle = page.locator('#camera-mode-toggle');
  await expect(cameraToggle).toBeVisible();
  await expect(cameraToggle).toHaveAttribute('aria-pressed', 'false');
  await expect(cameraToggle).toContainText('自由镜头');
  await expect(cameraControl).toHaveAttribute('data-mode', 'fixed');
  const mapLinkBox = await page.locator('#map-editor-link').boundingBox();
  const cameraControlBox = await cameraControl.boundingBox();
  if (!mapLinkBox || !cameraControlBox) throw new Error('Gameplay camera control is unavailable.');
  expect(cameraControlBox.y).toBeGreaterThanOrEqual(mapLinkBox.y + mapLinkBox.height);

  await cameraToggle.click();
  await expect(cameraToggle).toHaveAttribute('aria-pressed', 'true');
  await expect(cameraToggle).toContainText('固定镜头');
  await expect(cameraControl).toHaveAttribute('data-mode', 'mouse');
  await expect(panel).toHaveAttribute('data-camera-control', 'mouse');
  await expect(panel.getByRole('button', { name: '退出鼠标调镜头' })).toBeVisible();
  await expect(panel.getByRole('textbox', { name: '鼠标操作' }))
    .toHaveValue('滚轮缩放 · 左键旋转 · 右键移动');
  await expect(panel.getByText('移动速度', { exact: true })).toBeHidden();
  await expect(panel.getByText('光照', { exact: true })).toBeHidden();
  await expect(panel.getByText('表现', { exact: true })).toBeHidden();
  await expect(panel.getByRole('button', { name: '恢复推荐值' })).toBeHidden();
  await expect(panel.getByRole('textbox', { name: '位置 X' })).toBeDisabled();
  await expect(canvas).toHaveClass(/camera-pointer-mode/);
  await expect.poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.camera.controlMode))
    .toBe('mouse');

  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('Game canvas has no bounds.');
  const centerX = bounds.x + bounds.width * 0.5;
  const centerY = bounds.y + bounds.height * 0.56;
  const initial = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__!.camera);

  await page.mouse.move(centerX, centerY);
  await page.mouse.wheel(0, -420);
  await expect.poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__!.camera.zoom))
    .not.toBeCloseTo(initial.zoom, 3);

  const beforeOrbit = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__!.camera);
  await page.mouse.move(centerX, centerY);
  await page.mouse.down({ button: 'left' });
  await page.mouse.move(centerX + 96, centerY - 46, { steps: 8 });
  await page.mouse.up({ button: 'left' });
  await expect.poll(async () => page.evaluate(() => {
    const camera = window.__THREE_GAME_DIAGNOSTICS__!.camera;
    return Math.hypot(
      camera.positionX - camera.targetX,
      camera.positionZ - camera.targetZ,
    );
  })).not.toBeCloseTo(Math.hypot(
    beforeOrbit.positionX - beforeOrbit.targetX,
    beforeOrbit.positionZ - beforeOrbit.targetZ,
  ), 1);
  const afterOrbit = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__!.camera);
  expect(afterOrbit.targetX).toBeCloseTo(beforeOrbit.targetX, 3);
  expect(afterOrbit.targetY).toBeCloseTo(beforeOrbit.targetY, 3);
  expect(afterOrbit.targetZ).toBeCloseTo(beforeOrbit.targetZ, 3);

  const beforePan = afterOrbit;
  await page.mouse.move(centerX, centerY);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(centerX + 88, centerY + 52, { steps: 8 });
  await page.mouse.up({ button: 'right' });
  await expect.poll(async () => page.evaluate(() => {
    const camera = window.__THREE_GAME_DIAGNOSTICS__!.camera;
    return Math.hypot(camera.targetX, camera.targetY, camera.targetZ);
  })).toBeGreaterThan(1);
  const afterPan = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__!.camera);
  expect(Math.hypot(
    afterPan.targetX - beforePan.targetX,
    afterPan.targetY - beforePan.targetY,
    afterPan.targetZ - beforePan.targetZ,
  )).toBeGreaterThan(1);

  await page.waitForTimeout(700);
  await expect.poll(async () => page.evaluate(async () => {
    const before = window.__THREE_GAME_DIAGNOSTICS__!.camera;
    await new Promise((resolve) => window.setTimeout(resolve, 80));
    const after = window.__THREE_GAME_DIAGNOSTICS__!.camera;
    return Math.hypot(
      after.targetX - before.targetX,
      after.targetY - before.targetY,
      after.targetZ - before.targetZ,
    );
  }), { timeout: 3_000 }).toBeLessThan(0.01);
  const beforeProjectionSwitch = await page.evaluate(
    () => window.__THREE_GAME_DIAGNOSTICS__!.camera,
  );
  const projectionMode = panel.getByRole('combobox', { name: '投影模式' });
  await projectionMode.selectOption({ label: '弱透视 · 轻微近大远小' });
  await expect(panel).toHaveAttribute('data-camera-projection', 'weak-perspective');
  const perspectiveFov = panel.getByRole('textbox', { name: '透视视野（度）' });
  await expect(perspectiveFov).toBeVisible();
  await expect.poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.camera))
    .toMatchObject({
      projectionMode: 'weak-perspective',
      perspectiveFov: 22,
    });
  const weakPerspectiveBeforeZoom = await page.evaluate(
    () => window.__THREE_GAME_DIAGNOSTICS__!.camera,
  );
  expect(Math.hypot(
    weakPerspectiveBeforeZoom.targetX - beforeProjectionSwitch.targetX,
    weakPerspectiveBeforeZoom.targetY - beforeProjectionSwitch.targetY,
    weakPerspectiveBeforeZoom.targetZ - beforeProjectionSwitch.targetZ,
  )).toBeLessThan(0.05);
  await page.mouse.move(centerX, centerY);
  await page.mouse.wheel(0, -360);
  await expect.poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__!.camera.distance))
    .toBeLessThan(weakPerspectiveBeforeZoom.distance);
  await perspectiveFov.fill('18');
  await expect.poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.camera.perspectiveFov))
    .toBe(18);

  await projectionMode.selectOption({ label: '正交 · 尺寸不随距离变化' });
  await expect(perspectiveFov).toBeHidden();
  await expect.poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.camera))
    .toMatchObject({ projectionMode: 'orthographic', perspectiveFov: null });

  await panel.getByRole('button', { name: '退出鼠标调镜头' }).click();
  await expect(panel).toHaveAttribute('data-camera-control', 'manual');
  await expect(panel.getByText('移动速度', { exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: '恢复推荐值' })).toBeVisible();
  await expect(canvas).not.toHaveClass(/camera-pointer-mode/);
  await expect.poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.camera.controlMode))
    .toBe('manual');

  await cameraToggle.click();
  await expect(cameraToggle).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.hideDebugUi(true));
  await expect(panel).toBeHidden();
  await expect(cameraToggle).toBeVisible();
  await expect(canvas).toHaveClass(/camera-pointer-mode/);
  await expect.poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.camera.controlMode))
    .toBe('mouse');

  const guardStart = await page.evaluate(() => {
    window.__THREE_GAME_TEST_HOOKS__!.scenario('active-play');
    return window.__THREE_GAME_TEST_HOOKS__!.getSnapshot().guards[0].position.z;
  });
  await page.keyboard.down('e');
  await page.waitForTimeout(120);
  await page.keyboard.up('e');
  const guardEnd = await page.evaluate(() =>
    window.__THREE_GAME_TEST_HOOKS__!.getSnapshot().guards[0].position.z);
  expect(guardStart - guardEnd).toBeGreaterThan(0.1);

  await page.screenshot({
    path: testInfo.outputPath('desktop-gameplay-camera-control.png'),
    fullPage: true,
  });
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
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

test('right control triggers the full-basket head shake through real input', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'Keyboard pickup rejection is covered once on desktop Chrome.');
  await page.goto('/?world=classic&audio=procedural&trees=procedural');
  await expect
    .poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.characters.kidMode))
    .toBe('imported');
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.scenario('carry-limit'));

  await page.keyboard.press('ControlRight');
  await expect
    .poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.kid.state))
    .toBe('Rejecting');
  await expect
    .poll(async () => page.evaluate(() =>
      Math.abs(window.__THREE_GAME_DIAGNOSTICS__?.characters.kidDetails?.headShakeAngle ?? 0)))
    .toBeGreaterThan(0.05);
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
  await page.goto('/?world=classic&trees=procedural');
  await page.waitForFunction(() => Boolean(window.__THREE_GAME_TEST_HOOKS__));
  await expect.poll(() => audioResponses).toEqual([
    { path: '/assets/audio/kenney/sfx-pack.json', status: 200 },
  ]);
  await page.locator('#game-canvas').click({ position: { x: 400, y: 360 } });

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

  await page.goto('/?world=classic&audio=procedural&trees=procedural');
  await page.waitForFunction(() => Boolean(window.__THREE_GAME_TEST_HOOKS__));
  await page.locator('#game-canvas').click({ position: { x: 400, y: 360 } });
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

test('Nature Pack trees, fruit, and KayKit cottage load within budget and retain procedural fallbacks', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'Environment asset loading only needs one installed Chrome run.');
  const assetResponses: Array<{ path: string; status: number }> = [];
  const houseResponses: Array<{ path: string; status: number }> = [];
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (url.pathname.includes('/assets/models/animal-crossing/')) {
      assetResponses.push({ path: url.pathname, status: response.status() });
    }
    if (url.pathname.includes('/assets/models/kaykit-medieval/')) {
      houseResponses.push({ path: url.pathname, status: response.status() });
    }
  });

  await page.goto('/?world=classic&audio=procedural');
  await expect
    .poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.environment))
    .toMatchObject({
      treeMode: 'imported',
      externalRequested: true,
      treeVariants: 4,
      treeInstances: 55,
      stumpInstances: 51,
      largeTreeInstances: 4,
      treeTriangles: 12816,
      fruitMode: 'imported',
      fruitInstances: 6,
      fruitTriangles: 1152,
      mapName: '果园村口',
      paths: 3,
      clearings: 0,
      landmarks: 2,
      terrainZones: 10,
      landmarkMode: 'imported',
      importedHomesteads: 1,
      landmarkMeshes: 20,
      landmarkTriangles: 2754,
      landmarkAssetMeshes: 5,
      landmarkAssetTriangles: 1666,
      landmarkAssetMaterials: 5,
      landmarkAssetTextures: 0,
      landmarkLastFailure: null,
      arenaWidth: 72,
      arenaDepth: 54,
      lastFailure: null,
    });
  expect(assetResponses).toHaveLength(1);
  expect(assetResponses.every((response) => response.status === 200), JSON.stringify(assetResponses)).toBe(true);
  expect(houseResponses).toEqual([
    { path: '/assets/models/kaykit-medieval/house.glb', status: 200 },
  ]);
  const houseBounds = await page.evaluate(() =>
    window.__THREE_GAME_DIAGNOSTICS__?.environment.landmarkHouseBounds);
  expect(houseBounds?.width).toBeGreaterThanOrEqual(5.5);
  expect(houseBounds?.width).toBeLessThanOrEqual(6.21);
  expect(houseBounds?.height).toBeGreaterThan(2.9);
  expect(houseBounds?.height).toBeLessThan(3.5);
  expect(houseBounds?.depth).toBeGreaterThan(5.3);
  expect(houseBounds?.depth).toBeLessThan(6.3);

  const renderer = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.renderer);
  expect(renderer?.calls).toBeLessThanOrEqual(75);
  expect(renderer?.triangles).toBeLessThanOrEqual(300_000);
  expect(renderer?.textures).toBeLessThanOrEqual(12);

  await page.goto('/?world=classic&audio=procedural&trees=procedural&fruit=procedural&landmarks=procedural');
  await page.waitForFunction(() => Boolean(window.__THREE_GAME_DIAGNOSTICS__));
  expect(await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.environment)).toMatchObject({
    treeMode: 'procedural',
    fruitMode: 'procedural',
    externalRequested: false,
    treeVariants: 0,
    treeInstances: 55,
    stumpInstances: 51,
    largeTreeInstances: 4,
    treeTriangles: 0,
    fruitInstances: 6,
    fruitTriangles: 0,
    landmarks: 2,
    landmarkMode: 'procedural',
    importedHomesteads: 0,
    landmarkMeshes: 24,
    landmarkTriangles: 1208,
    landmarkAssetMeshes: 0,
    landmarkAssetTriangles: 0,
    landmarkAssetMaterials: 0,
    landmarkAssetTextures: 0,
    landmarkHouseBounds: null,
    landmarkLastFailure: null,
    lastFailure: null,
  });
  expect(houseResponses).toHaveLength(1);
});

test('KayKit cottage load failure keeps the procedural house visible', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'Cottage failure handling only needs one installed Chrome run.');
  await page.route('**/assets/models/kaykit-medieval/house.glb', (route) => route.abort('failed'));
  await page.goto('/?world=classic&audio=procedural&trees=procedural&fruit=procedural');

  await expect
    .poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.environment))
    .toMatchObject({
      landmarkMode: 'procedural',
      importedHomesteads: 0,
      landmarkMeshes: 24,
      landmarkTriangles: 1208,
    });
  const environment = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.environment);
  expect(environment?.landmarkLastFailure).toBeTruthy();
  expect(environment?.lastFailure).toBeTruthy();
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

  await page.goto('/?world=classic&audio=procedural&trees=procedural');
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

  const rejection = await page.evaluate(() => {
    const hooks = window.__THREE_GAME_TEST_HOOKS__!;
    hooks.scenario('carry-limit');
    const snapshot = hooks.step({
      kid: { moveX: 0, moveZ: 0, actionPressed: true, dropPressed: false },
    }, 3);
    return {
      snapshot,
      headShakeAngle: window.__THREE_GAME_DIAGNOSTICS__?.characters.kidDetails?.headShakeAngle ?? 0,
    };
  });
  expect(rejection.snapshot.kid.state).toBe('Rejecting');
  expect(Math.abs(rejection.headShakeAngle)).toBeGreaterThan(0.08);
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

  const captureMotion = await page.evaluate(() => {
    const hooks = window.__THREE_GAME_TEST_HOOKS__!;
    hooks.setPausedForScreenshot(true);
    hooks.scenario('pickup-danger');
    const captured = hooks.step({}, 1);
    const captureAnimation = window.__THREE_GAME_DIAGNOSTICS__?.characters.currentAnimations.kid;
    const locked = hooks.step({
      kid: { moveX: 1, moveZ: 0, actionPressed: false, dropPressed: false },
    }, 17);
    const recovered = hooks.step({
      kid: { moveX: 1, moveZ: 0, actionPressed: false, dropPressed: false },
    }, 1);
    const moved = hooks.step({
      kid: { moveX: 1, moveZ: 0, actionPressed: false, dropPressed: false },
    }, 1);
    return {
      captured,
      captureAnimation,
      locked,
      recovered,
      moved,
      movementAnimation: window.__THREE_GAME_DIAGNOSTICS__?.characters.currentAnimations.kid,
      animationPaused: window.__THREE_GAME_DIAGNOSTICS__?.characters.kidDetails?.animationPaused,
    };
  });
  expect(captureMotion.captured.kid.state).toBe('Hit');
  expect(captureMotion.captureAnimation).toBe('Hit_A');
  expect(captureMotion.locked.kid.position).toEqual(captureMotion.captured.kid.position);
  expect(captureMotion.recovered.kid.state).toBe('Invincible');
  expect(captureMotion.recovered.kid.position).toEqual(captureMotion.captured.kid.position);
  expect(captureMotion.moved.kid.state).toBe('Invincible');
  expect(captureMotion.moved.kid.position.x).toBeGreaterThan(captureMotion.recovered.kid.position.x);
  expect(captureMotion.movementAnimation).toBe('Running_A');
  expect(captureMotion.animationPaused).toBe(false);
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.setPausedForScreenshot(false));

  const renderer = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.renderer);
  expect(renderer?.calls).toBeLessThanOrEqual(100);
  expect(renderer?.triangles).toBeLessThanOrEqual(100_000);
  expect(renderer?.textures).toBeLessThanOrEqual(12);
});

test('guard asset failure is surfaced without a procedural fallback', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'Guard failure handling only needs one installed Chrome run.');
  await page.route('**/assets/models/kaykit-adventurers/Knight_Guard.glb', (route) => route.abort('failed'));
  await page.goto('/?world=classic&audio=procedural&trees=procedural');

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
  await page.goto('/?world=classic&audio=procedural&trees=procedural');

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
    { name: 'heavy-carry', kidState: 'Normal', carried: 3 },
    { name: 'guard-pounce', guardState: 'Pounce' },
    { name: 'guard-recover', guardState: 'Recover' },
    { name: 'guard-stunned', guardState: 'Stunned' },
    { name: 'delivery-progress', carried: 2, delivered: 3 },
    { name: 'captured', kidState: 'Hit' },
    { name: 'invincible', kidState: 'Invincible' },
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

test('Sweet Orchard Island keeps its authored composition playable and within budget', async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop-chrome',
    'Island desktop development is still in progress; mobile QA is deferred.',
  );
  await page.goto('/');
  await expect
    .poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.environment.worldMode))
    .toBe('island');
  await expect
    .poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.environment.fruitMode))
    .toBe('imported');
  await expect
    .poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.characters.importedCharacters))
    .toBe(3);
  await page.evaluate(() => {
    window.__THREE_GAME_TEST_HOOKS__?.setState('active-play');
    window.__THREE_GAME_TEST_HOOKS__?.hideDebugUi(true);
  });

  const diagnostics = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__);
  expect(diagnostics?.environment).toMatchObject({
    mapId: 'sweet-orchard-island-p1',
    mapName: '甜日果园岛 · P3b',
    worldMode: 'island',
    worldPreset: null,
    worldTileInstances: 3,
    paths: 6,
    landmarks: 19,
    deliveryZones: 4,
    groundMaterialMode: 'grass-texture',
    deliveryMarkerMode: 'parcel-sign',
    deliveryMarkerLabels: 4,
    islandLayoutSource: 'map-v5',
    islandOutlinePoints: 16,
    islandRegions: 5,
    waterSegments: 3,
    waterCollisionBlocks: 5,
    bridges: 2,
    waterfalls: 2,
    appleGroups: 3,
    regionPropClusters: 5,
    regionPropInstancedMeshes: 7,
    natureMaterialProfile: 'island-matte',
    visualScaleProfile: 'island-toy-scale',
    contactShadowInstances: 34,
    ambientMotionGroups: 9,
    worldAssetRequests: 0,
    worldLastFailure: null,
  });
  expect(diagnostics?.environment.worldPropInstances).toBeGreaterThanOrEqual(70);
  expect(diagnostics?.environment.regionPropInstances).toBeGreaterThanOrEqual(80);
  expect(diagnostics?.environment.worldMeshes).toBeGreaterThanOrEqual(60);
  expect(diagnostics?.physics.sensors).toBe(4);
  expect(diagnostics?.environment.treeMode).toBe('imported');
  expect(diagnostics?.renderer.calls).toBeLessThanOrEqual(300);
  expect(diagnostics?.renderer.triangles).toBeLessThanOrEqual(750_000);
  expect(diagnostics?.renderer).toMatchObject({
    toneMapping: 'ACESFilmic',
    exposure: 1.01,
    shadowMapEnabled: true,
    shadowMapType: 'PCF',
    shadowMapSize: 2048,
    shadowCastingLights: 1,
    postPasses: 0,
  });
  const semanticDataSource = await page.evaluate(async () => {
    const islandPath = String('/src/game/maps/IslandTourMap.ts');
    const orchardMapPath = String('/src/game/maps/OrchardMap.ts');
    const islandViewPath = String('/src/render/IslandWorldView.ts');
    const island = await import(/* @vite-ignore */ islandPath);
    const orchardMaps = await import(/* @vite-ignore */ orchardMapPath);
    const islandView = await import(/* @vite-ignore */ islandViewPath);
    const map = orchardMaps.cloneOrchardMap(island.SWEET_ORCHARD_ISLAND_MAP);
    if (!map.islandLayout) throw new Error('Missing island layout.');
    map.islandLayout.outline = [
      { x: -10, z: -8 },
      { x: 10, z: -8 },
      { x: 10, z: 8 },
      { x: -10, z: 8 },
    ];
    map.islandLayout.routeBlocks = map.islandLayout.routeBlocks.slice(0, 1);
    map.islandLayout.waterSegments = map.islandLayout.waterSegments.slice(0, 1);
    map.islandLayout.waterBlocks = map.islandLayout.waterBlocks.slice(0, 2);
    map.islandLayout.bridges = map.islandLayout.bridges.slice(0, 1);
    const visual = islandView.createIslandWorldVisual(map);
    const body = visual.root.getObjectByName('island-stepped-main-body');
    const geometry = (body as { geometry?: { computeBoundingBox(): void; boundingBox: {
      min: { x: number; y: number };
      max: { x: number; y: number };
    } | null } } | undefined)?.geometry;
    geometry?.computeBoundingBox();
    return {
      waterSegments: visual.waterSegments,
      waterBlocks: visual.waterCollisionBlocks,
      bridges: visual.bridges,
      bodyWidth: geometry?.boundingBox
        ? geometry.boundingBox.max.x - geometry.boundingBox.min.x
        : 0,
      bodyDepth: geometry?.boundingBox
        ? geometry.boundingBox.max.y - geometry.boundingBox.min.y
        : 0,
    };
  });
  expect(semanticDataSource).toMatchObject({
    waterSegments: 1,
    waterBlocks: 2,
    bridges: 1,
    bodyWidth: 21.5,
    bodyDepth: 17.5,
  });
  await expect(page.locator('[data-world-layout="island"]')).toHaveAttribute('aria-current', 'page');

  const routeSelection = await page.evaluate(async () => {
    const islandPath = String('/src/game/maps/IslandTourMap.ts');
    const island = await import(/* @vite-ignore */ islandPath);
    return {
      defaultMap: island.resolveIslandTourMap('')?.id ?? null,
      islandAlias: island.resolveIslandTourMap('?world=island')?.id ?? null,
      classicMap: island.resolveIslandTourMap('?world=classic')?.id ?? null,
      customMap: island.resolveIslandTourMap('?world=custom')?.id ?? null,
      medievalMap: island.resolveIslandTourMap('?world=medieval&layout=village')?.id ?? null,
    };
  });
  expect(routeSelection).toEqual({
    defaultMap: 'sweet-orchard-island-p1',
    islandAlias: 'sweet-orchard-island-p1',
    classicMap: null,
    customMap: null,
    medievalMap: null,
  });

  const sample = await sampleCanvas(page);
  expect(sample, `${testInfo.project.name}: ${JSON.stringify(sample)}`).toMatchObject({ ok: true });

  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.setReducedMotion(true));
  await expect
    .poll(async () => page.evaluate(() =>
      window.__THREE_GAME_DIAGNOSTICS__?.environment.ambientMotionAmplitude))
    .toBe(0);
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.setReducedMotion(false));
  await expect
    .poll(async () => page.evaluate(() =>
      Math.abs(window.__THREE_GAME_DIAGNOSTICS__?.environment.ambientMotionAmplitude ?? 0) > 0.001))
    .toBe(true);

  const validation = await page.evaluate(async () => {
    const islandPath = String('/src/game/maps/IslandTourMap.ts');
    const orchardMapPath = String('/src/game/maps/OrchardMap.ts');
    const island = await import(/* @vite-ignore */ islandPath);
    const orchardMaps = await import(/* @vite-ignore */ orchardMapPath);
    return orchardMaps.validateOrchardMap(island.SWEET_ORCHARD_ISLAND_MAP);
  });
  expect(validation.valid, validation.errors.join('\n')).toBe(true);
  expect(validation.reachableTargets).toBe(validation.totalTargets);
  expect(validation.totalTargets).toBe(12);

  const regionalTopology = await page.evaluate(async () => {
    const islandPath = String('/src/game/maps/IslandTourMap.ts');
    const orchardMapPath = String('/src/game/maps/OrchardMap.ts');
    const island = await import(/* @vite-ignore */ islandPath);
    const orchardMaps = await import(/* @vite-ignore */ orchardMapPath);
    const bridgeFallbacks = island.ISLAND_BRIDGES.map((bridge: {
      id: string;
      x: number;
      z: number;
      width: number;
      depth: number;
    }) => {
      const map = orchardMaps.cloneOrchardMap(island.SWEET_ORCHARD_ISLAND_MAP);
      map.landmarks.push({
        id: `test-blocked-${bridge.id}`,
        kind: 'homestead',
        x: bridge.x,
        z: bridge.z,
        rotationY: 0,
        radiusX: bridge.width / 2,
        radiusZ: bridge.depth / 2,
      });
      const result = orchardMaps.validateOrchardMap(map);
      return {
        blockedBridgeId: bridge.id,
        reachableTargets: result.reachableTargets,
        totalTargets: result.totalTargets,
      };
    });
    return {
      groups: island.ISLAND_APPLE_GROUPS,
      groupedSpawns: island.ISLAND_APPLE_GROUPS.flatMap(
        (group: { spawns: Array<{ x: number; z: number }> }) => group.spawns,
      ),
      mapSpawns: island.SWEET_ORCHARD_ISLAND_MAP.appleSpawns,
      bridgeFallbacks,
    };
  });
  expect(regionalTopology.groups).toHaveLength(3);
  expect(regionalTopology.groups.map((group: { spawns: unknown[] }) => group.spawns.length))
    .toEqual([2, 2, 2]);
  expect(regionalTopology.groupedSpawns).toEqual(regionalTopology.mapSpawns);
  regionalTopology.bridgeFallbacks.forEach((fallback: {
    blockedBridgeId: string;
    reachableTargets: number;
    totalTargets: number;
  }) => {
    expect(fallback.totalTargets).toBe(12);
    expect(fallback.reachableTargets, fallback.blockedBridgeId).toBe(fallback.totalTargets);
  });

  const collisionAndBridgeRoutes = await page.evaluate(async () => {
    const islandPath = String('/src/game/maps/IslandTourMap.ts');
    const orchardMapPath = String('/src/game/maps/OrchardMap.ts');
    const simulationPath = String('/src/game/GameSimulation.ts');
    const configPath = String('/src/game/config.ts');
    const typesPath = String('/src/game/types.ts');
    const island = await import(/* @vite-ignore */ islandPath);
    const orchardMaps = await import(/* @vite-ignore */ orchardMapPath);
    const simulationModule = await import(/* @vite-ignore */ simulationPath);
    const config = await import(/* @vite-ignore */ configPath);
    const types = await import(/* @vite-ignore */ typesPath);
    const routeBlock = island.ISLAND_ROUTE_BLOCKS.find(
      (candidate: { id: string }) => candidate.id === 'island-route-west-hill',
    );
    const waterBlock = island.ISLAND_WATER_BLOCKS.find(
      (candidate: { id: string }) => candidate.id === 'island-water-block-center',
    );
    if (!routeBlock) throw new Error('Missing west route block.');
    if (!waterBlock) throw new Error('Missing center water block.');

    const simulateKid = (
      start: { x: number; z: number },
      movement: { moveX: number; moveZ: number },
      ticks: number,
    ) => {
      const map = orchardMaps.cloneOrchardMap(island.SWEET_ORCHARD_ISLAND_MAP);
      map.kidStart = start;
      map.guardStarts = [
        { x: 28, z: -16 },
        { x: 28, z: 18 },
      ];
      const simulation = new simulationModule.GameSimulation(map);
      simulation.loadScenario('active-play');
      const commands = types.createEmptyCommands();
      commands.kid.moveX = movement.moveX;
      commands.kid.moveZ = movement.moveZ;
      let snapshot = simulation.getSnapshot();
      for (let tick = 0; tick < ticks; tick += 1) {
        snapshot = simulation.step(commands).snapshot;
      }
      return snapshot.kid.position;
    };

    const routeBlockPosition = simulateKid(
      { x: routeBlock.x - routeBlock.radiusX - 2, z: routeBlock.z },
      { moveX: 1, moveZ: 0 },
      120,
    );
    const waterBlockPosition = simulateKid(
      { x: waterBlock.x, z: waterBlock.z + waterBlock.radiusZ + 2.4 },
      { moveX: 0, moveZ: -1 },
      120,
    );
    const bridgePositions = island.ISLAND_BRIDGES.map((bridge: { x: number; z: number }) =>
      simulateKid(
        { x: bridge.x, z: bridge.z + 4 },
        { moveX: 0, moveZ: -1 },
        90,
      ));
    return {
      routeBlockKidX: routeBlockPosition.x,
      routeBlockMaximumX:
        routeBlock.x - routeBlock.radiusX - config.GAME_CONFIG.kidRadius,
      waterBlockKidZ: waterBlockPosition.z,
      waterBlockMinimumZ:
        waterBlock.z + waterBlock.radiusZ + config.GAME_CONFIG.kidRadius,
      bridgePositions,
      bridges: island.ISLAND_BRIDGES,
    };
  });
  expect(collisionAndBridgeRoutes.routeBlockKidX)
    .toBeLessThanOrEqual(collisionAndBridgeRoutes.routeBlockMaximumX + 0.0001);
  expect(collisionAndBridgeRoutes.routeBlockKidX)
    .toBeCloseTo(collisionAndBridgeRoutes.routeBlockMaximumX, 4);
  expect(collisionAndBridgeRoutes.waterBlockKidZ)
    .toBeGreaterThanOrEqual(collisionAndBridgeRoutes.waterBlockMinimumZ - 0.0001);
  expect(collisionAndBridgeRoutes.waterBlockKidZ)
    .toBeCloseTo(collisionAndBridgeRoutes.waterBlockMinimumZ, 4);
  collisionAndBridgeRoutes.bridgePositions.forEach((position: { z: number }, index: number) => {
    expect(position.z).toBeLessThan(collisionAndBridgeRoutes.bridges[index].z - 3);
  });
});

test('KayKit medieval world candidates remain readable and playable', async ({ page }, testInfo) => {
  const presets = ['village', 'riverside', 'fortified'] as const;
  for (const preset of presets) {
    await page.goto(`/?world=medieval&layout=${preset}`);
    await expect
      .poll(
        async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.environment.worldMode),
        { timeout: 15_000 },
      )
      .toBe('medieval');
    await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.setState('active-play'));

    const diagnostics = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__);
    expect(diagnostics?.environment).toMatchObject({
      mapId: `medieval-experiment-${preset}`,
      worldMode: 'medieval',
      worldPreset: preset,
      worldTileShape: 'square',
      worldLastFailure: null,
    });
    expect(diagnostics?.environment.worldTileInstances).toBeGreaterThan(300);
    expect(diagnostics?.environment.worldPropInstances).toBeGreaterThanOrEqual(10);
    expect(diagnostics?.environment.worldAssetRequests).toBeGreaterThanOrEqual(12);
    expect(diagnostics?.environment.worldCatalogAssets).toBe(226);
    expect(diagnostics?.renderer.calls).toBeGreaterThan(0);
    expect(diagnostics?.renderer.triangles).toBeGreaterThan(0);
    await expect(page.locator(`[data-world-layout="${preset}"]`)).toHaveAttribute('aria-current', 'page');

    const sample = await sampleCanvas(page);
    expect(sample, `${testInfo.project.name}/${preset}: ${JSON.stringify(sample)}`).toMatchObject({ ok: true });
  }

  if (testInfo.project.name === 'desktop-chrome') {
    const validation = await page.evaluate(async () => {
      const experimentsPath = String('/src/game/maps/MedievalWorldExperiments.ts');
      const orchardMapPath = String('/src/game/maps/OrchardMap.ts');
      const experiments = await import(/* @vite-ignore */ experimentsPath);
      const orchardMaps = await import(/* @vite-ignore */ orchardMapPath);
      return experiments.getMedievalExperimentMaps().map((map: unknown) =>
        orchardMaps.validateOrchardMap(map));
    });
    expect(validation).toHaveLength(3);
    for (const result of validation) {
      expect(result.valid, result.errors.join('\n')).toBe(true);
      expect(result.reachableTargets).toBe(result.totalTargets);
    }
  }
});

test('complete KayKit catalog is published and every source asset is available', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'The complete catalog only needs one installed Chrome run.');
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const response = await fetch('/assets/models/kaykit-medieval/catalog.json');
    const catalog = await response.json() as {
      total: number;
      basePath: string;
      groups: Record<string, string[]>;
    };
    const files = Object.values(catalog.groups).flat();
    const statuses = await Promise.all(files.map(async (file) => {
      const assetResponse = await fetch(`/${catalog.basePath}${file}`);
      return assetResponse.status;
    }));
    return {
      catalogStatus: response.status,
      total: catalog.total,
      groupCounts: Object.fromEntries(
        Object.entries(catalog.groups).map(([group, entries]) => [group, entries.length]),
      ),
      fileCount: files.length,
      uniqueCount: new Set(files).size,
      failed: statuses.filter((status) => status !== 200).length,
    };
  });
  expect(result).toEqual({
    catalogStatus: 200,
    total: 226,
    groupCounts: { objects: 30, hex: 128, square: 68 },
    fileCount: 226,
    uniqueCount: 226,
    failed: 0,
  });
});

test('KayKit world asset failure keeps the complete procedural fallback', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'World fallback only needs one installed Chrome run.');
  await page.route('**/world-kit/square_forest.gltf.glb', (route) => route.abort('failed'));
  await page.goto('/?world=medieval&layout=village&audio=procedural&trees=procedural');

  await expect
    .poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.environment.worldMode))
    .toBe('procedural');
  const environment = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.environment);
  expect(environment?.worldPreset).toBe('village');
  expect(environment?.worldLastFailure).toBeTruthy();
  expect(environment?.paths).toBe(2);
  expect(environment?.landmarks).toBeGreaterThan(0);

  const sample = await sampleCanvas(page);
  expect(sample, JSON.stringify(sample)).toMatchObject({ ok: true });
});
