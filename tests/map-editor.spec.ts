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
  await expect(page.getByText('可游玩 · 方格 · 2 地标 · 57 木本点缀（4 大树） · 6 果实')).toBeVisible();
  await expect(page.getByText('全部 9 个关键目标可达。')).toBeVisible();
  await expect(page.getByRole('button', { name: '使用并游玩' })).toBeEnabled();
  await expect(page.getByLabel('世界主题')).toHaveValue('village');
  await expect(page.getByLabel('地块形状')).toHaveValue('square');
  await expect(page.getByLabel('建筑模型')).toHaveValue(/.+/);

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
  await page.getByRole('button', { name: '3D 预览' }).click();
  const preview = page.getByLabel('KayKit 地图三维预览');
  await expect(preview).toBeVisible();
  await expect.poll(() => preview.getAttribute('data-ready')).toBe('true');
  await expect(page.locator('#preview-status')).toContainText('3D 已同步');
  await page.getByRole('button', { name: '2D 编辑' }).click();
  await expect(page.getByLabel('果园地图编辑画布')).toBeVisible();
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('manual KayKit building and square world settings persist into the playable map', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'Manual KayKit authoring only needs one installed Chrome run.');
  await page.goto('/editor.html');
  await page.getByRole('button', { name: '保存地图' }).click();
  const editableMap = await page.evaluate(() => {
    const map = JSON.parse(localStorage.getItem('apple-picking.map-library.v5') ?? '[]')[0];
    return {
      ...map,
      id: 'manual-kaykit-test',
      name: '手工 KayKit 验收',
      trees: [],
      landmarks: [],
      paths: [],
    };
  });
  await page.locator('#import-input').setInputFiles({
    name: 'manual-kaykit.orchard.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(editableMap)),
  });

  await page.getByLabel('世界主题').selectOption('fortified');
  await page.getByLabel('地块形状').selectOption('square');
  await page.getByLabel('建筑模型').selectOption('castle');
  await page.getByLabel('建筑朝向').selectOption('1');
  const canvas = page.getByLabel('果园地图编辑画布');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await page.getByRole('button', { name: /铺设宽路 E/ }).click();
  if (box) {
    await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.48);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.68, box.y + box.height * 0.48, { steps: 6 });
    await page.mouse.up();
  }
  await page.getByRole('button', { name: /KayKit 建筑 3/ }).click();
  if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

  await expect(page.getByText(/可游玩 · 方格 · 1 地标/)).toBeVisible();
  await page.getByRole('button', { name: '3D 预览' }).click();
  const preview = page.getByLabel('KayKit 地图三维预览');
  await expect(preview).toBeVisible();
  await expect.poll(() => preview.getAttribute('data-ready')).toBe('true');
  await page.getByRole('button', { name: '保存地图' }).click();
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('apple-picking.map-library.v5') ?? '[]')[0]);
  expect(saved.worldStyle).toEqual({ theme: 'fortified', tileShape: 'square' });
  expect(saved.landmarks).toHaveLength(1);
  expect(saved.paths).toHaveLength(1);
  expect(saved.paths[0].points.length).toBeGreaterThan(1);
  expect(saved.landmarks[0]).toMatchObject({
    kind: 'homestead',
    asset: 'castle',
    rotationY: Math.PI / 2,
  });

  await Promise.all([
    page.waitForURL((url) => url.searchParams.get('world') === 'custom'),
    page.getByRole('button', { name: '使用并游玩' }).click(),
  ]);
  await expect
    .poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.environment))
    .toMatchObject({
      mapName: '手工 KayKit 验收',
      worldMode: 'medieval',
      worldPreset: 'fortified',
      worldTileShape: 'square',
    });
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
  await expect(page.getByText('可游玩 · 方格 · 2 地标 · 57 木本点缀（4 大树） · 6 果实')).toBeVisible();

  await page.locator('#landmark-density-input').fill('20');
  await page.getByRole('button', { name: '从十二张中筛选四张' }).click();
  await candidateButtons.first().click();
  await expect(page.getByText(/可游玩 · 方格 · \d+ 地标 · \d+ 木本点缀（\d+ 大树） · 6 果实/)).toBeVisible();
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
  await page.getByLabel('地块形状').selectOption('hex');
  await expect(page.getByText(/可游玩 · 六边形/)).toBeVisible();
  await page.getByLabel('地块形状').selectOption('square');
  await page.getByLabel('世界主题').selectOption('fortified');
  await expect(page.getByText(/可游玩 · 方格/)).toBeVisible();

  await page.getByRole('textbox', { name: '地图名称' }).fill('自动验收果园');
  await page.getByRole('button', { name: '保存地图' }).click();
  await expect(page.getByText('自动验收果园', { exact: true })).toBeVisible();
  const semanticMap = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('apple-picking.map-library.v5') ?? '[]')[0],
  );
  expect(semanticMap.version).toBe(5);
  expect(semanticMap.worldStyle).toEqual({ theme: 'fortified', tileShape: 'square' });
  expect(semanticMap.landmarks.map((landmark: { kind: string }) => landmark.kind)).toEqual(
    expect.arrayContaining(['homestead', 'pond']),
  );
  expect(semanticMap.terrainZones.some((zone: { kind: string }) => zone.kind === 'meadow')).toBe(true);
  expect(semanticMap.paths.length).toBeGreaterThanOrEqual(2);
  for (const landmark of semanticMap.landmarks.filter((entry: { kind: string }) => entry.kind === 'homestead')) {
    expect(landmark.asset).toBeTruthy();
    expect(landmark.rotationY / (Math.PI / 2)).toBeCloseTo(Math.round(landmark.rotationY / (Math.PI / 2)));
  }

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.json$/);

  const importedMap = await page.evaluate(() => {
    const library = JSON.parse(localStorage.getItem('apple-picking.map-library.v5') ?? '[]');
    return { ...library[0], name: '导入验收果园' };
  });
  await page.locator('#import-input').setInputFiles({
    name: 'orchard-map.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(importedMap)),
  });
  await expect(page.getByRole('textbox', { name: '地图名称' })).toHaveValue('导入验收果园');

  await Promise.all([
    page.waitForURL((url) => url.pathname === '/' && url.searchParams.get('world') === 'custom'),
    page.getByRole('button', { name: '使用并游玩' }).click(),
  ]);
  await page.waitForFunction(() => Boolean(window.__THREE_GAME_DIAGNOSTICS__));
  await expect
    .poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.environment.mapName))
    .toBe('导入验收果园');
  await expect
    .poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.environment))
    .toMatchObject({
      worldMode: 'medieval',
      worldPreset: 'fortified',
      worldTileShape: 'square',
    });
});

test('legacy editor maps keep their layout and gain dense stump fill', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'Storage migration only needs one installed Chrome run.');
  await page.goto('/editor.html');
  await page.getByRole('button', { name: '保存地图' }).click();

  const expectedKidStart = await page.evaluate(() => {
    const current = JSON.parse(localStorage.getItem('apple-picking.map-library.v5') ?? '[]')[0];
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
    localStorage.removeItem('apple-picking.active-map.v5');
    localStorage.removeItem('apple-picking.map-library.v5');
    localStorage.setItem('apple-picking.active-map.v1', JSON.stringify(legacy));
    localStorage.setItem('apple-picking.map-library.v1', JSON.stringify([legacy]));
    return {
      x: current.kidStart.x * 3 / 5,
      z: current.kidStart.z * 3 / 5,
    };
  });

  await page.reload();
  await expect(page.getByRole('textbox', { name: '地图名称' })).toHaveValue('旧版迁移测试 · 扩展版');
  await expect(page.getByText(/可游玩 · 方格 · 0 地标 · [3-9]\d{2} 木本点缀（3 大树） · 6 果实/)).toBeVisible();
  await expect(page.getByText('全部 9 个关键目标可达。')).toBeVisible();
  const migrated = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('apple-picking.active-map.v5') ?? 'null'),
  );
  expect(migrated).toMatchObject({
    version: 5,
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
    const current = JSON.parse(localStorage.getItem('apple-picking.map-library.v5') ?? '[]')[0];
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
    localStorage.removeItem('apple-picking.active-map.v5');
    localStorage.removeItem('apple-picking.map-library.v5');
    localStorage.setItem('apple-picking.active-map.v2', JSON.stringify(fiveTimes));
    localStorage.setItem('apple-picking.map-library.v2', JSON.stringify([fiveTimes]));
    return current.kidStart;
  });

  await page.reload();
  await expect(page.getByRole('textbox', { name: '地图名称' })).toHaveValue('五倍迁移测试 · 三倍版');
  await expect(page.getByText(/可游玩 · 方格 · 0 地标 · [3-9]\d{2} 木本点缀（4 大树） · 6 果实/)).toBeVisible();
  await expect(page.getByText('全部 9 个关键目标可达。')).toBeVisible();
  const migrated = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('apple-picking.active-map.v5') ?? 'null'),
  );
  expect(migrated).toMatchObject({
    version: 5,
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
    const current = JSON.parse(localStorage.getItem('apple-picking.map-library.v5') ?? '[]')[0];
    const legacy = {
      ...current,
      version: 3,
      id: 'version-three-migration-test',
      name: '三版语义迁移测试',
    };
    localStorage.removeItem('apple-picking.active-map.v5');
    localStorage.removeItem('apple-picking.map-library.v5');
    localStorage.setItem('apple-picking.active-map.v3', JSON.stringify(legacy));
  });

  await page.reload();
  await expect(page.getByRole('textbox', { name: '地图名称' })).toHaveValue('三版语义迁移测试');
  const migrated = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('apple-picking.active-map.v5') ?? 'null'),
  );
  expect(migrated).toMatchObject({
    version: 5,
    id: 'version-three-migration-test',
    landmarks: [],
    terrainZones: [],
  });
});

test('version-four maps migrate to v5 without invented island semantics', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'Storage migration only needs one installed Chrome run.');
  await page.goto('/editor.html');
  await page.getByRole('button', { name: '保存地图' }).click();
  await page.evaluate(() => {
    const current = JSON.parse(localStorage.getItem('apple-picking.map-library.v5') ?? '[]')[0];
    const legacy = {
      ...current,
      version: 4,
      id: 'version-four-migration-test',
      name: '四版岛屿语义迁移测试',
    };
    delete legacy.islandLayout;
    localStorage.removeItem('apple-picking.active-map.v5');
    localStorage.removeItem('apple-picking.map-library.v5');
    localStorage.setItem('apple-picking.active-map.v4', JSON.stringify(legacy));
  });

  await page.reload();
  await expect(page.getByRole('textbox', { name: '地图名称' })).toHaveValue('四版岛屿语义迁移测试');
  const migrated = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('apple-picking.active-map.v5') ?? 'null'),
  );
  expect(migrated).toMatchObject({
    version: 5,
    id: 'version-four-migration-test',
  });
  expect(migrated.islandLayout).toBeUndefined();
});

test('island v5 semantics roundtrip and clone without shared nested state', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'Map schema regression only needs one installed Chrome run.');
  await page.goto('/?world=island');
  const result = await page.evaluate(async () => {
    const islandPath = String('/src/game/maps/IslandTourMap.ts');
    const orchardMapPath = String('/src/game/maps/OrchardMap.ts');
    const island = await import(/* @vite-ignore */ islandPath);
    const orchardMaps = await import(/* @vite-ignore */ orchardMapPath);
    const parsed = orchardMaps.parseOrchardMap(
      JSON.parse(JSON.stringify(island.SWEET_ORCHARD_ISLAND_MAP)),
    );
    if (!parsed?.islandLayout) throw new Error('Island layout did not survive parsing.');
    const clone = orchardMaps.cloneOrchardMap(parsed);
    if (!clone.islandLayout) throw new Error('Island layout did not survive cloning.');
    const original = {
      outlineX: parsed.islandLayout.outline[0].x,
      regionX: parsed.islandLayout.regions[0].x,
      routeX: parsed.islandLayout.routeBlocks[0].x,
      waterX: parsed.islandLayout.waterSegments[0].x,
      bridgeX: parsed.islandLayout.bridges[0].x,
    };
    clone.islandLayout.outline[0].x += 1;
    clone.islandLayout.regions[0].x += 1;
    clone.islandLayout.routeBlocks[0].x += 1;
    clone.islandLayout.waterSegments[0].x += 1;
    clone.islandLayout.bridges[0].x += 1;
    const malformed = JSON.parse(JSON.stringify(island.SWEET_ORCHARD_ISLAND_MAP));
    malformed.islandLayout.outline = [{ x: 0, z: 0 }, { x: 1, z: 1 }];
    const validation = orchardMaps.validateOrchardMap(parsed);
    return {
      version: parsed.version,
      valid: validation.valid,
      counts: {
        outline: parsed.islandLayout.outline.length,
        regions: parsed.islandLayout.regions.length,
        routeBlocks: parsed.islandLayout.routeBlocks.length,
        waterSegments: parsed.islandLayout.waterSegments.length,
        waterBlocks: parsed.islandLayout.waterBlocks.length,
        bridges: parsed.islandLayout.bridges.length,
      },
      original,
      parsedAfterCloneMutation: {
        outlineX: parsed.islandLayout.outline[0].x,
        regionX: parsed.islandLayout.regions[0].x,
        routeX: parsed.islandLayout.routeBlocks[0].x,
        waterX: parsed.islandLayout.waterSegments[0].x,
        bridgeX: parsed.islandLayout.bridges[0].x,
      },
      malformedRejected: orchardMaps.parseOrchardMap(malformed) === null,
    };
  });

  expect(result.version).toBe(5);
  expect(result.valid).toBe(true);
  expect(result.counts).toEqual({
    outline: 16,
    regions: 5,
    routeBlocks: 7,
    waterSegments: 3,
    waterBlocks: 5,
    bridges: 2,
  });
  expect(result.parsedAfterCloneMutation).toEqual(result.original);
  expect(result.malformedRejected).toBe(true);
});

test('island v5 editor displays and selects semantic layout with matching 3D preview', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'Island editor work is desktop-first.');
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/');
  await page.evaluate(async () => {
    const islandPath = String('/src/game/maps/IslandTourMap.ts');
    const island = await import(/* @vite-ignore */ islandPath);
    localStorage.setItem(
      'apple-picking.active-map.v5',
      JSON.stringify(island.SWEET_ORCHARD_ISLAND_MAP),
    );
  });
  await page.goto('/editor.html');

  const canvas = page.getByLabel('果园地图编辑画布');
  await expect(canvas).toHaveAttribute('data-layout-mode', 'island-v5');
  await expect(canvas).toHaveAttribute('data-island-regions', '5');
  await expect(page.locator('#map-status')).toContainText('岛屿 v5 · 5 区域');
  await expect(page.locator('#island-selection')).toContainText('使用“岛屿结构”选择查看');

  await page.getByRole('button', { name: /岛屿结构/ }).click();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (box) {
    const padding = Math.min(24, Math.max(10, Math.min(box.width, box.height) * 0.04));
    const scale = Math.min((box.width - padding * 2) / 72, (box.height - padding * 2) / 54);
    await page.mouse.click(
      box.x + box.width / 2 - 22 * scale,
      box.y + box.height / 2 - 5.8 * scale,
    );
  }
  await expect(canvas).toHaveAttribute('data-selected-island-kind', 'bridge');
  await expect(canvas).toHaveAttribute('data-selected-island-id', 'island-bridge-west');
  await expect(page.locator('#island-selection')).toContainText('桥梁 · island-bridge-west');
  await page.screenshot({
    path: testInfo.outputPath('island-v5-editor-2d.png'),
    fullPage: true,
  });

  await page.getByRole('button', { name: '3D 预览' }).click();
  const preview = page.getByLabel('KayKit 地图三维预览');
  await expect(preview).toBeVisible();
  await expect.poll(() => preview.getAttribute('data-ready')).toBe('true');
  await expect(preview).toHaveAttribute('data-world-mode', 'island-v5');
  await expect(preview).toHaveAttribute('data-island-regions', '5');
  await expect(page.locator('#preview-status')).toContainText('岛屿 v5 已同步 · 5 区域');
  await page.screenshot({
    path: testInfo.outputPath('island-v5-editor-3d.png'),
    fullPage: true,
  });
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
