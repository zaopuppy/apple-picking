import { expect, test } from '@playwright/test';

test('map editor renders a valid open orchard without viewport overflow', async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/editor.html');
  await expect(page.getByRole('heading', { name: '果园地图工坊' })).toBeVisible();
  await expect(page.getByLabel('果园地图编辑画布')).toBeVisible();
  await expect(page.getByText('可游玩 · 2 地标 · 93 木本点缀（7 大树） · 6 果实')).toBeVisible();
  await expect(page.getByText('全部 9 个关键目标可达。')).toBeVisible();
  await expect(page.getByRole('button', { name: '使用并游玩' })).toBeEnabled();

  const overflow = await page.evaluate(() => ({
    body: document.documentElement.scrollWidth - window.innerWidth,
    main: document.querySelector('main')?.scrollWidth ?? 0,
    viewport: window.innerWidth,
  }));
  const canvasMetrics = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('#map-editor-canvas');
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const context = canvas.getContext('2d');
    const buckets = new Set<string>();
    if (context) {
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const stride = Math.max(4, Math.floor(pixels.length / 4096 / 4) * 4);
      for (let offset = 0; offset < pixels.length; offset += stride) {
        buckets.add(`${pixels[offset] >> 4},${pixels[offset + 1] >> 4},${pixels[offset + 2] >> 4}`);
      }
    }
    return {
      cssHeight: rect.height,
      viewportHeight: window.innerHeight,
      colorBuckets: buckets.size,
    };
  });
  expect(overflow.body).toBeLessThanOrEqual(1);
  expect(overflow.main).toBeGreaterThan(0);
  expect(canvasMetrics?.cssHeight).toBeLessThanOrEqual((canvasMetrics?.viewportHeight ?? 0) + 1);
  expect(canvasMetrics?.colorBuckets).toBeGreaterThan(8);
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('map editor candidates, drawing, undo, save and play flow work together', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'Editor mutations only need one installed Chrome run.');
  await page.goto('/editor.html');

  const candidateButtons = page.getByRole('button', { name: /^#\d · \d+ 地标 · \d+ 桩 \/ \d+ 树$/ });
  await expect(candidateButtons).toHaveCount(4);
  const firstLabels = await candidateButtons.allTextContents();
  await page.getByRole('button', { name: '从十二张中筛选四张' }).click();
  await expect(candidateButtons).toHaveCount(4);
  expect(await candidateButtons.allTextContents()).toEqual(firstLabels);

  await candidateButtons.first().click();
  await expect(page.getByRole('button', { name: '撤销' })).toBeEnabled();
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(page.getByText('可游玩 · 2 地标 · 93 木本点缀（7 大树） · 6 果实')).toBeVisible();

  await page.locator('#landmark-density-input').fill('20');
  await page.getByRole('button', { name: '从十二张中筛选四张' }).click();
  await candidateButtons.first().click();
  await expect(page.getByText(/可游玩 · \d+ 地标 · \d+ 木本点缀（\d+ 大树） · 6 果实/)).toBeVisible();
  await expect(page.getByRole('button', { name: '使用并游玩' })).toBeEnabled();
  await page.getByRole('button', { name: '撤销' }).click();

  await page.getByRole('button', { name: /草地空场 6/ }).click();
  const canvas = page.getByLabel('果园地图编辑画布');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (box) {
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
  }
  await expect(page.getByRole('button', { name: '撤销' })).toBeEnabled();
  await page.getByRole('button', { name: '撤销' }).click();
  await page.getByRole('button', { name: '重做' }).click();

  await page.getByRole('textbox', { name: '地图名称' }).fill('自动验收果园');
  await page.getByRole('button', { name: '保存地图' }).click();
  await expect(page.getByText('自动验收果园', { exact: true })).toBeVisible();
  const semanticMap = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('apple-picking.map-library.v4') ?? '[]')[0],
  );
  expect(semanticMap.version).toBe(4);
  expect(semanticMap.landmarks.map((landmark: { kind: string }) => landmark.kind)).toEqual(
    expect.arrayContaining(['homestead', 'pond']),
  );
  expect(semanticMap.terrainZones.some((zone: { kind: string }) => zone.kind === 'meadow')).toBe(true);

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.json$/);

  const importedMap = await page.evaluate(() => {
    const library = JSON.parse(localStorage.getItem('apple-picking.map-library.v4') ?? '[]');
    return { ...library[0], name: '导入验收果园' };
  });
  await page.locator('#import-input').setInputFiles({
    name: 'orchard-map.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(importedMap)),
  });
  await expect(page.getByRole('textbox', { name: '地图名称' })).toHaveValue('导入验收果园');

  await Promise.all([
    page.waitForURL((url) => url.pathname === '/'),
    page.getByRole('button', { name: '使用并游玩' }).click(),
  ]);
  await page.waitForFunction(() => Boolean(window.__THREE_GAME_DIAGNOSTICS__));
  await expect
    .poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.environment.mapName))
    .toBe('导入验收果园');
});

test('legacy editor maps keep their layout and gain dense stump fill', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'Storage migration only needs one installed Chrome run.');
  await page.goto('/editor.html');
  await page.getByRole('button', { name: '保存地图' }).click();

  const expectedKidStart = await page.evaluate(() => {
    const current = JSON.parse(localStorage.getItem('apple-picking.map-library.v4') ?? '[]')[0];
    const shrink = (point: { x: number; z: number }) => ({ x: point.x / 5, z: point.z / 5 });
    const legacy = {
      ...current,
      version: 1,
      id: 'legacy-migration-test',
      name: '旧版迁移测试',
      trees: current.trees.slice(0, 115).map((tree: { x: number; z: number }) => ({
        ...tree,
        ...shrink(tree),
        variant: 'broadleaf',
      })),
      paths: current.paths.map((path: { width: number; points: Array<{ x: number; z: number }> }) => ({
        ...path,
        width: path.width / 5,
        points: path.points.map(shrink),
      })),
      clearings: current.clearings.map((clearing: { x: number; z: number; radius: number }) => ({
        ...clearing,
        ...shrink(clearing),
        radius: clearing.radius / 5,
      })),
      appleSpawns: current.appleSpawns.map(shrink),
      kidStart: shrink(current.kidStart),
      guardStarts: current.guardStarts.map(shrink),
      deliveryZone: shrink(current.deliveryZone),
    };
    localStorage.removeItem('apple-picking.active-map.v4');
    localStorage.removeItem('apple-picking.map-library.v4');
    localStorage.setItem('apple-picking.active-map.v1', JSON.stringify(legacy));
    localStorage.setItem('apple-picking.map-library.v1', JSON.stringify([legacy]));
    return {
      x: current.kidStart.x * 3 / 5,
      z: current.kidStart.z * 3 / 5,
    };
  });

  await page.reload();
  await expect(page.getByRole('textbox', { name: '地图名称' })).toHaveValue('旧版迁移测试 · 扩展版');
  await expect(page.getByText(/可游玩 · 0 地标 · [3-9]\d{2} 木本点缀（5 大树） · 6 果实/)).toBeVisible();
  await expect(page.getByText('全部 9 个关键目标可达。')).toBeVisible();
  const migrated = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('apple-picking.active-map.v4') ?? 'null'),
  );
  expect(migrated).toMatchObject({
    version: 4,
    id: 'legacy-migration-test-expanded',
    landmarks: [],
    terrainZones: [],
  });
  expect(migrated.kidStart.x).toBeCloseTo(expectedKidStart.x);
  expect(migrated.kidStart.z).toBeCloseTo(expectedKidStart.z);
  expect(migrated.trees.length).toBeGreaterThan(300);
});

test('five-times maps compact to the three-times arena without drifting key points', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'Storage migration only needs one installed Chrome run.');
  await page.goto('/editor.html');
  await page.getByRole('button', { name: '保存地图' }).click();

  const originalKidStart = await page.evaluate(() => {
    const current = JSON.parse(localStorage.getItem('apple-picking.map-library.v4') ?? '[]')[0];
    const expand = (point: { x: number; z: number }) => ({ x: point.x * 5 / 3, z: point.z * 5 / 3 });
    const fiveTimes = {
      ...current,
      version: 2,
      id: 'five-times-migration-test',
      name: '五倍迁移测试',
      trees: current.trees.map((tree: { x: number; z: number }) => ({ ...tree, ...expand(tree) })),
      paths: current.paths.map((path: { width: number; points: Array<{ x: number; z: number }> }) => ({
        ...path,
        width: path.width * 5 / 3,
        points: path.points.map(expand),
      })),
      clearings: current.clearings.map((clearing: { x: number; z: number; radius: number }) => ({
        ...clearing,
        ...expand(clearing),
        radius: clearing.radius * 5 / 3,
      })),
      appleSpawns: current.appleSpawns.map(expand),
      kidStart: expand(current.kidStart),
      guardStarts: current.guardStarts.map(expand),
      deliveryZone: expand(current.deliveryZone),
    };
    localStorage.removeItem('apple-picking.active-map.v4');
    localStorage.removeItem('apple-picking.map-library.v4');
    localStorage.setItem('apple-picking.active-map.v2', JSON.stringify(fiveTimes));
    localStorage.setItem('apple-picking.map-library.v2', JSON.stringify([fiveTimes]));
    return current.kidStart;
  });

  await page.reload();
  await expect(page.getByRole('textbox', { name: '地图名称' })).toHaveValue('五倍迁移测试 · 三倍版');
  await expect(page.getByText(/可游玩 · 0 地标 · [3-9]\d{2} 木本点缀（7 大树） · 6 果实/)).toBeVisible();
  await expect(page.getByText('全部 9 个关键目标可达。')).toBeVisible();
  const migrated = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('apple-picking.active-map.v4') ?? 'null'),
  );
  expect(migrated).toMatchObject({
    version: 4,
    id: 'five-times-migration-test-compact',
    landmarks: [],
    terrainZones: [],
  });
  expect(migrated.kidStart.x).toBeCloseTo(originalKidStart.x);
  expect(migrated.kidStart.z).toBeCloseTo(originalKidStart.z);
  expect(migrated.trees.length).toBeGreaterThan(300);
  expect(migrated.trees.length).toBeLessThan(1000);
});

test('version-three maps migrate to semantic schema without invented landmarks', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'Storage migration only needs one installed Chrome run.');
  await page.goto('/editor.html');
  await page.getByRole('button', { name: '保存地图' }).click();
  await page.evaluate(() => {
    const current = JSON.parse(localStorage.getItem('apple-picking.map-library.v4') ?? '[]')[0];
    const legacy = {
      ...current,
      version: 3,
      id: 'version-three-migration-test',
      name: '三版语义迁移测试',
    };
    localStorage.removeItem('apple-picking.active-map.v4');
    localStorage.removeItem('apple-picking.map-library.v4');
    localStorage.setItem('apple-picking.active-map.v3', JSON.stringify(legacy));
  });

  await page.reload();
  await expect(page.getByRole('textbox', { name: '地图名称' })).toHaveValue('三版语义迁移测试');
  const migrated = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('apple-picking.active-map.v4') ?? 'null'),
  );
  expect(migrated).toMatchObject({
    version: 4,
    id: 'version-three-migration-test',
    landmarks: [],
    terrainZones: [],
  });
});
