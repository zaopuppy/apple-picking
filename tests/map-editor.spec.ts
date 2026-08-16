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
  await expect(page.getByText('可游玩 · 方格 · 2 地标 · 55 木本点缀（4 大树） · 6 果实')).toBeVisible();
  await expect(page.getByText('全部 9 个关键目标可达。')).toBeVisible();
  await expect(page.getByRole('button', { name: '使用并游玩' })).toBeEnabled();
  await expect(page.getByLabel('世界主题')).toHaveValue('village');
  await expect(page.getByLabel('地块形状')).toHaveValue('square');
  await expect(page.getByLabel('建筑模型')).toHaveValue(/.+/);
  await expect(page.locator('#world-style-controls')).toBeVisible();
  await expect(page.locator('#tree-controls')).toBeVisible();
  await expect(page.locator('#brush-controls')).toBeVisible();
  await expect(page.locator('#building-controls')).toBeHidden();
  await page.getByRole('button', { name: /KayKit 建筑/ }).click();
  await expect(page.locator('#building-controls')).toBeVisible();
  await expect(page.locator('#tree-controls')).toBeHidden();
  await page.getByRole('button', { name: /岛屿结构/ }).click();
  await expect(page.locator('#world-style-controls')).toBeHidden();
  await expect(page.locator('#building-controls')).toBeHidden();
  await expect(page.locator('#tree-controls')).toBeHidden();
  await expect(page.locator('#brush-controls')).toBeHidden();
  await page.getByRole('button', { name: /种树/ }).click();

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
  await page.getByRole('button', { name: /KayKit 建筑 3/ }).click();
  await page.getByLabel('建筑模型').selectOption('castle');
  await expect(page.getByText('建筑统一使用 0° 朝向，以保持岛屿风格一致。')).toBeVisible();
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
    rotationY: 0,
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
  await expect(page.getByText('可游玩 · 方格 · 2 地标 · 55 木本点缀（4 大树） · 6 果实')).toBeVisible();

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
    expect(landmark.rotationY).toBe(0);
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
    const serialized = JSON.parse(JSON.stringify(island.SWEET_ORCHARD_ISLAND_MAP));
    const serializedBuilding = serialized.landmarks.find(
      (landmark: { asset?: string }) => Boolean(landmark.asset),
    );
    serializedBuilding.rotationY = Math.PI / 2;
    const serializedCoastProxy = serialized.landmarks.find(
      (landmark: { asset?: string; rotationY: number }) => !landmark.asset && landmark.rotationY !== 0,
    );
    const coastProxyBeforeParse = serializedCoastProxy.rotationY;
    const parsed = orchardMaps.parseOrchardMap(serialized);
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
    const desynchronized = orchardMaps.cloneOrchardMap(parsed);
    desynchronized.islandLayout.routeBlocks[0].x += 1;
    const validation = orchardMaps.validateOrchardMap(parsed);
    const desynchronizedValidation = orchardMaps.validateOrchardMap(desynchronized);
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
      buildingRotation: parsed.landmarks.find((landmark: { asset?: string }) => Boolean(landmark.asset))?.rotationY,
      coastProxyRotationPreserved: parsed.landmarks.find(
        (landmark: { id: string }) => landmark.id === serializedCoastProxy.id,
      )?.rotationY === coastProxyBeforeParse,
      desynchronizedRejected: !desynchronizedValidation.valid &&
        desynchronizedValidation.errors.includes('岛屿通路或水域碰撞代理与语义结构不同步。'),
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
  expect(result.buildingRotation).toBe(0);
  expect(result.coastProxyRotationPreserved).toBe(true);
  expect(result.desynchronizedRejected).toBe(true);
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
    const map = structuredClone(island.SWEET_ORCHARD_ISLAND_MAP);
    const house = map.landmarks.find((landmark: { id: string }) =>
      landmark.id === 'island-main-house');
    const pond = map.landmarks.find((landmark: { id: string }) => landmark.id === 'island-pond');
    if (!house || !pond) throw new Error('Island editable landmarks are missing.');
    house.x = 21;
    house.z = -17;
    pond.x = 19.5;
    pond.z = 11;
    localStorage.setItem(
      'apple-picking.active-map.v5',
      JSON.stringify(map),
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
  await expect(preview).toHaveAttribute('data-editor-proxies', '23');
  await expect(preview).toHaveAttribute('data-selected-kind', 'bridge');
  await expect(preview).toHaveAttribute('data-selected-id', 'island-bridge-west');
  await expect(page.locator('#island-geometry-panel')).toBeVisible();
  await expect(preview).toHaveAttribute(
    'data-island-landmark-signature',
    /island-main-house:21\.00:-17\.00\|island-pond:19\.50:11\.00/,
  );
  await expect(page.locator('#preview-status')).toContainText('岛屿 v5 已同步 · 5 区域');
  const dragBridge = async () => {
    const previewBox = await preview.boundingBox();
    const screens = JSON.parse(await preview.getAttribute('data-editor-proxy-screens') ?? '[]') as Array<{
      id: string;
      x: number;
      y: number;
    }>;
    const bridgeScreen = screens.find((entry) => entry.id === 'island-bridge-west');
    if (!previewBox || !bridgeScreen) throw new Error('3D bridge projection is unavailable.');
    const startX = previewBox.x + bridgeScreen.x;
    const startY = previewBox.y + bridgeScreen.y;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 24, startY, { steps: 5 });
    await page.mouse.up();
  };
  await dragBridge();
  await expect(page.getByText('桥梁已沿水面移动，碰撞缺口已同步。')).toBeVisible();
  await expect(page.getByRole('button', { name: '撤销' })).toBeEnabled();
  await expect(page.locator('#island-geometry-x')).not.toHaveValue('-22');
  await page.getByRole('button', { name: '撤销' }).click();
  await expect.poll(() => preview.getAttribute('data-ready')).toBe('true');
  const restoredBox = await preview.boundingBox();
  const restoredScreens = JSON.parse(await preview.getAttribute('data-editor-proxy-screens') ?? '[]') as Array<{
    id: string;
    x: number;
    y: number;
  }>;
  const restoredBridge = restoredScreens.find((entry) => entry.id === 'island-bridge-west');
  if (!restoredBox || !restoredBridge) throw new Error('Restored 3D bridge projection is unavailable.');
  await page.mouse.click(restoredBox.x + restoredBridge.x, restoredBox.y + restoredBridge.y);
  await expect(page.locator('#island-geometry-x')).toHaveValue('-22');
  await page.getByLabel('新结构').selectOption('region');
  await page.getByRole('button', { name: '放置新结构' }).click();
  await expect(preview).toHaveAttribute('data-placement-kind', 'region');
  await page.mouse.click(restoredBox.x + restoredBox.width / 2, restoredBox.y + restoredBox.height / 2);
  await expect.poll(() => preview.getAttribute('data-ready')).toBe('true');
  await expect(preview).toHaveAttribute('data-selected-kind', 'region');
  await expect(preview).toHaveAttribute('data-editor-proxies', '24');
  await page.getByRole('button', { name: '删除选中结构' }).click();
  await expect.poll(() => preview.getAttribute('data-ready')).toBe('true');
  await expect(preview).toHaveAttribute('data-editor-proxies', '23');
  await page.screenshot({
    path: testInfo.outputPath('island-v5-editor-3d.png'),
    fullPage: true,
  });
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('3D editor places, duplicates and deletes buildings through real pointer input', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', '3D editor authoring is desktop-first.');
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/editor.html');
  await page.getByRole('button', { name: '保存地图' }).click();
  await page.evaluate(() => {
    const map = JSON.parse(localStorage.getItem('apple-picking.map-library.v5') ?? '[]')[0];
    localStorage.setItem('apple-picking.active-map.v5', JSON.stringify({
      ...map,
      id: '3d-authoring-test',
      name: '3D 建筑验收',
      trees: [],
      landmarks: [],
      terrainZones: [],
      paths: [],
    }));
  });
  await page.reload();
  await page.getByRole('button', { name: '3D 预览' }).click();
  const preview = page.getByLabel('KayKit 地图三维预览');
  await expect.poll(() => preview.getAttribute('data-ready')).toBe('true');
  const clickPreviewAt = async (xRatio: number, yRatio: number) => {
    await preview.scrollIntoViewIfNeeded();
    const box = await preview.boundingBox();
    if (!box) throw new Error('3D editor preview is unavailable.');
    await page.mouse.click(box.x + box.width * xRatio, box.y + box.height * yRatio);
  };
  const stampPoints = [{ x: 0.22, y: 0.34 }, { x: 0.78, y: 0.68 }];
  await page.getByRole('button', { name: /种树 1/ }).click();
  for (const point of stampPoints) await clickPreviewAt(point.x, point.y);
  await expect(page.locator('#map-status')).toContainText(/[1-9]\d* 木本点缀/);
  await page.locator('#brush-size').fill('11');
  await page.getByRole('button', { name: /擦除 2/ }).click();
  for (const point of stampPoints) await clickPreviewAt(point.x, point.y);
  await expect(page.locator('#map-status')).toContainText('0 木本点缀');
  await page.locator('#brush-size').fill('4.5');
  await page.getByRole('button', { name: /铺设宽路 E/ }).click();
  await clickPreviewAt(0.34, 0.62);
  await expect(page.getByText('道路起点已确定；继续点击 3D 地面添加路段。')).toBeVisible();
  await clickPreviewAt(0.58, 0.62);

  await page.getByRole('button', { name: /KayKit 建筑 3/ }).click();
  await page.getByLabel('建筑模型').selectOption('market');
  await expect(preview).toHaveAttribute('data-placement-kind', 'homestead');
  await clickPreviewAt(0.5, 0.5);
  await expect.poll(() => preview.getAttribute('data-ready')).toBe('true');
  await expect(preview).toHaveAttribute('data-selected-kind', 'landmark');
  await expect(page.locator('#preview-object-panel')).toBeVisible();
  await expect(page.locator('#preview-object-title')).toContainText('集市');

  await page.getByRole('button', { name: /岛屿结构 R/ }).click();
  await expect(preview).toHaveAttribute('data-placement-kind', '');
  await page.locator('#preview-object-x').fill('1');
  await page.getByRole('button', { name: '应用位置' }).click();
  await expect(page.getByText('3D 位置已应用，并写入一条撤销记录。')).toBeVisible();
  await page.getByRole('button', { name: '复制 Ctrl+D' }).click();
  await expect.poll(() => preview.getAttribute('data-ready')).toBe('true');
  await page.getByRole('button', { name: '保存地图' }).click();
  let buildings = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('apple-picking.map-library.v5') ?? '[]')[0].landmarks);
  expect(buildings).toHaveLength(2);
  expect(buildings.every((landmark: { asset?: string; rotationY: number }) =>
    landmark.asset === 'market' && landmark.rotationY === 0)).toBe(true);
  const paths = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('apple-picking.map-library.v5') ?? '[]')[0].paths);
  expect(paths).toHaveLength(1);
  expect(paths[0].points.length).toBeGreaterThanOrEqual(2);

  await page.getByRole('button', { name: '删除 Delete' }).click();
  await expect.poll(() => preview.getAttribute('data-ready')).toBe('true');
  await page.getByRole('button', { name: '保存地图' }).click();
  buildings = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('apple-picking.map-library.v5') ?? '[]')[0].landmarks);
  expect(buildings).toHaveLength(1);
  await page.getByRole('button', { name: '撤销' }).click();
  await page.getByRole('button', { name: '保存地图' }).click();
  buildings = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('apple-picking.map-library.v5') ?? '[]')[0].landmarks);
  expect(buildings).toHaveLength(2);

  await page.getByRole('button', { name: /投递区 W/ }).click();
  await page.getByRole('button', { name: '添加新点' }).click();
  await expect(preview).toHaveAttribute('data-placement-kind', 'delivery');
  await clickPreviewAt(0.28, 0.72);
  await expect.poll(() => preview.getAttribute('data-ready')).toBe('true');
  await expect(preview).toHaveAttribute('data-selected-kind', 'delivery-zone');
  await page.getByRole('button', { name: '保存地图' }).click();
  const deliveryZones = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('apple-picking.map-library.v5') ?? '[]')[0].deliveryZones);
  expect(deliveryZones).toHaveLength(2);
  await page.screenshot({
    path: testInfo.outputPath('desktop-3d-authoring.png'),
    fullPage: true,
  });
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('island geometry editor keeps route and bridge collision proxies synchronized', async ({ page }, testInfo) => {
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
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  const clickWorld = async (x: number, z: number) => {
    await canvas.scrollIntoViewIfNeeded();
    const currentBox = await canvas.boundingBox();
    if (!currentBox) throw new Error('Island editor canvas is not visible.');
    const padding = Math.min(24, Math.max(10, Math.min(currentBox.width, currentBox.height) * 0.04));
    const scale = Math.min(
      (currentBox.width - padding * 2) / 72,
      (currentBox.height - padding * 2) / 54,
    );
    await page.mouse.click(
      currentBox.x + currentBox.width / 2 + x * scale,
      currentBox.y + currentBox.height / 2 + z * scale,
    );
  };

  await page.getByRole('button', { name: /岛屿结构/ }).click();
  await clickWorld(-21, -13);
  await expect(canvas).toHaveAttribute('data-selected-island-id', 'island-region-orchard');
  await page.getByLabel('中心 X').fill('-20.5');
  await page.getByLabel('中心 Z').fill('-12.5');
  await page.getByLabel('半径 X').fill('11');
  await page.getByLabel('半径 Z').fill('6');
  await page.getByRole('button', { name: '应用结构修改' }).click();
  await expect(page.getByText('岛屿区域已更新。')).toBeVisible();

  await clickWorld(-8, -10);
  await expect(canvas).toHaveAttribute('data-selected-island-id', 'island-route-orchard-hedge');
  await expect(page.locator('#island-geometry-panel')).toHaveAttribute('data-editable', 'true');
  await page.getByLabel('中心 X').fill('-7.2');
  await page.getByLabel('中心 Z').fill('-9.4');
  await page.getByLabel('半宽 X').fill('4.6');
  await page.getByLabel('半深 Z').fill('2.4');
  await page.getByRole('button', { name: '应用结构修改' }).click();
  await expect(page.getByText('矩形通路块与碰撞代理已同步。')).toBeVisible();
  await page.getByRole('button', { name: '撤销' }).click();
  await page.getByRole('button', { name: '重做' }).click();

  await page.getByRole('button', { name: /岛屿结构/ }).click();
  await clickWorld(-22, -5.8);
  await expect(canvas).toHaveAttribute('data-selected-island-id', 'island-bridge-west');
  await expect(page.getByLabel('中心 Z')).toBeDisabled();
  await page.getByLabel('中心 X').fill('-18.5');
  await page.getByLabel('桥梁宽度').fill('4.4');
  await page.getByLabel('桥梁深度').fill('5.8');
  await page.getByRole('button', { name: '应用结构修改' }).click();
  await expect(page.getByText('桥梁与水域碰撞缺口已同步。')).toBeVisible();
  await page.getByRole('button', { name: '保存地图' }).click();

  const result = await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('apple-picking.map-library.v5') ?? '[]')[0];
    const route = saved.islandLayout.routeBlocks.find(
      (entry: { id: string }) => entry.id === 'island-route-orchard-hedge',
    );
    const region = saved.islandLayout.regions.find(
      (entry: { id: string }) => entry.id === 'island-region-orchard',
    );
    const routeProxy = saved.landmarks.find((entry: { id: string }) => entry.id === route.id);
    const bridge = saved.islandLayout.bridges.find(
      (entry: { id: string }) => entry.id === 'island-bridge-west',
    );
    const westBlocks = saved.islandLayout.waterBlocks
      .filter((entry: { z: number }) => Math.abs(entry.z + 5.8) < 0.001)
      .sort((first: { x: number }, second: { x: number }) => first.x - second.x);
    const waterProxies = westBlocks.map((block: { id: string }) =>
      saved.landmarks.find((entry: { id: string }) => entry.id === block.id));
    return { region, route, routeProxy, bridge, westBlocks, waterProxies };
  });
  expect(result.region).toMatchObject({ x: -20.5, z: -12.5, radiusX: 11, radiusZ: 6 });
  expect(result.route).toMatchObject({ x: -7.2, z: -9.4, radiusX: 4.6, radiusZ: 2.4 });
  expect(result.routeProxy).toMatchObject({
    id: result.route.id,
    x: result.route.x,
    z: result.route.z,
    radiusX: result.route.radiusX,
    radiusZ: result.route.radiusZ,
    kind: 'homestead',
  });
  expect(result.bridge).toMatchObject({ x: -18.5, z: -5.8, width: 4.4, depth: 5.8 });
  expect(result.westBlocks).toHaveLength(2);
  for (const block of result.westBlocks) {
    const blockStart = block.x - block.radiusX;
    const blockEnd = block.x + block.radiusX;
    const bridgeStart = result.bridge.x - result.bridge.width / 2;
    const bridgeEnd = result.bridge.x + result.bridge.width / 2;
    expect(blockEnd <= bridgeStart || blockStart >= bridgeEnd).toBe(true);
  }
  expect(result.waterProxies).toEqual(result.westBlocks.map((block: object) => ({
    ...block,
    kind: 'homestead',
    rotationY: 0,
  })));
  await page.getByRole('button', { name: '3D 预览' }).click();
  const preview = page.getByLabel('KayKit 地图三维预览');
  await expect.poll(() => preview.getAttribute('data-ready')).toBe('true');
  await expect(preview).toHaveAttribute('data-island-region-prop-clusters', '5');
  await expect(preview).toHaveAttribute(
    'data-island-region-patch-signature',
    /island-region-orchard:-20\.50:-12\.50:11\.00:6\.00/,
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: testInfo.outputPath('island-semantic-regions-3d.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: '2D 编辑' }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: testInfo.outputPath('island-v5-geometry-editor.png'),
    fullPage: true,
  });
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('delivery zone manager adds, moves, removes and reorders stable zones', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'Delivery editor work is desktop-first.');
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
  const clickWorld = async (x: number, z: number) => {
    await canvas.scrollIntoViewIfNeeded();
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Delivery editor canvas is not visible.');
    const padding = Math.min(24, Math.max(10, Math.min(box.width, box.height) * 0.04));
    const scale = Math.min((box.width - padding * 2) / 72, (box.height - padding * 2) / 54);
    await page.mouse.click(
      box.x + box.width / 2 + x * scale,
      box.y + box.height / 2 + z * scale,
    );
  };

  await page.getByRole('button', { name: /投递区 W/ }).click();
  const panel = page.getByLabel('多投递点管理');
  await expect(panel).toBeVisible();
  await expect(page.locator('#delivery-zone-count')).toHaveText('4 / 4');
  await expect(page.getByRole('button', { name: '添加新点' })).toBeDisabled();
  await expect(canvas).toHaveAttribute('data-delivery-zones', '4');

  await page.getByRole('button', {
    name: '选择投递点 4 island-delivery-garden',
  }).click();
  await expect(canvas).toHaveAttribute('data-selected-delivery-zone-id', 'island-delivery-garden');
  await clickWorld(24, 15);
  await expect(page.getByText('选中投递点已移动。')).toBeVisible();
  await expect(page.getByRole('button', {
    name: '选择投递点 4 island-delivery-garden',
  })).toContainText('X 24 · Z 15');

  await page.getByRole('button', { name: '上移选中投递点' }).click();
  await expect(page.getByRole('button', {
    name: '选择投递点 3 island-delivery-garden',
  })).toBeVisible();
  await page.getByRole('button', { name: '删除选中' }).click();
  await expect(page.locator('#delivery-zone-count')).toHaveText('3 / 4');
  await expect(page.getByRole('button', { name: '添加新点' })).toBeEnabled();

  await page.getByRole('button', { name: '添加新点' }).click();
  await expect(page.getByRole('button', { name: '取消添加' })).toHaveAttribute('data-placing', 'true');
  await clickWorld(-4, 20);
  await expect(canvas).toHaveAttribute('data-selected-delivery-zone-id', 'delivery-custom-1');
  await expect(page.locator('#delivery-zone-count')).toHaveText('4 / 4');
  await expect(page.getByRole('button', { name: '添加新点' })).toBeDisabled();

  const moveUp = page.getByRole('button', { name: '上移选中投递点' });
  await moveUp.click();
  await moveUp.click();
  await moveUp.click();
  await expect(page.getByRole('button', {
    name: '选择投递点 1 delivery-custom-1',
  })).toContainText('主点');
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(page.getByRole('button', {
    name: '选择投递点 2 delivery-custom-1',
  })).toBeVisible();
  await page.getByRole('button', { name: '重做' }).click();
  await expect(page.getByRole('button', {
    name: '选择投递点 1 delivery-custom-1',
  })).toContainText('主点');

  await page.getByRole('button', { name: '保存地图' }).click();
  const result = await page.evaluate(async () => {
    const saved = JSON.parse(localStorage.getItem('apple-picking.map-library.v5') ?? '[]')[0];
    const orchardMapPath = String('/src/game/maps/OrchardMap.ts');
    const deliveryEditingPath = String('/src/game/maps/DeliveryZoneEditing.ts');
    const orchardMaps = await import(/* @vite-ignore */ orchardMapPath);
    const deliveryEditing = await import(/* @vite-ignore */ deliveryEditingPath);
    const mismatched = orchardMaps.cloneOrchardMap(saved);
    mismatched.deliveryZone.x += 1;
    const mismatchValidation = orchardMaps.validateOrchardMap(mismatched);
    const legacy = orchardMaps.cloneOrchardMap(saved);
    delete legacy.deliveryZones;
    const addedLegacyZone = deliveryEditing.addDeliveryZone(legacy, { x: 3, z: 4 });
    const promotedIds = legacy.deliveryZones.map((zone: { id: string }) => zone.id);
    deliveryEditing.removeDeliveryZone(legacy, 'delivery-primary');
    const lastZoneRemovalRejected = !deliveryEditing.removeDeliveryZone(
      legacy,
      addedLegacyZone?.id ?? '',
    );
    return {
      ids: saved.deliveryZones.map((zone: { id: string }) => zone.id),
      primary: saved.deliveryZone,
      first: saved.deliveryZones[0],
      mismatchRejected: !mismatchValidation.valid && mismatchValidation.errors.includes(
        '主投递区兼容字段必须与投递区列表第一项一致。',
      ),
      legacyPromotion: {
        promotedIds,
        remaining: legacy.deliveryZones,
        primary: legacy.deliveryZone,
        lastZoneRemovalRejected,
      },
    };
  });
  expect(result.ids).toEqual([
    'delivery-custom-1',
    'island-delivery-homestead',
    'island-delivery-orchard-market',
    'island-delivery-beach-dock',
  ]);
  expect(result.first.id).toBe('delivery-custom-1');
  expect(result.first.x).toBeCloseTo(-4);
  expect(result.first.z).toBeCloseTo(20);
  expect(result.primary).toEqual({ x: result.first.x, z: result.first.z });
  expect(result.mismatchRejected).toBe(true);
  expect(result.legacyPromotion).toEqual({
    promotedIds: ['delivery-primary', 'delivery-custom-1'],
    remaining: [{ id: 'delivery-custom-1', x: 3, z: 4 }],
    primary: { x: 3, z: 4 },
    lastZoneRemovalRejected: true,
  });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: testInfo.outputPath('delivery-zone-manager.png'),
    fullPage: true,
  });
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('coast editor safely moves, inserts and removes outline nodes with collision sync', async ({ page }, testInfo) => {
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
  const worldToScreen = async (x: number, z: number) => {
    await canvas.scrollIntoViewIfNeeded();
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Island editor canvas is not visible.');
    const padding = Math.min(24, Math.max(10, Math.min(box.width, box.height) * 0.04));
    const scale = Math.min((box.width - padding * 2) / 72, (box.height - padding * 2) / 54);
    return {
      x: box.x + box.width / 2 + x * scale,
      y: box.y + box.height / 2 + z * scale,
    };
  };

  await page.getByRole('button', { name: /岛屿结构/ }).click();
  const firstNode = await worldToScreen(-31, -23);
  await page.mouse.click(firstNode.x, firstNode.y);
  await expect(canvas).toHaveAttribute('data-selected-island-kind', 'outline');
  await expect(canvas).toHaveAttribute('data-selected-island-id', 'island-outline-node-0');
  await expect(page.locator('#island-selection')).toContainText('海岸节点 1/16');
  await expect(page.getByRole('button', { name: '在此后插入节点' })).toBeVisible();
  await expect(page.getByRole('button', { name: '删除海岸节点' })).toBeVisible();

  await page.getByLabel('中心 X').fill('-30.5');
  await page.getByLabel('中心 Z').fill('-22.5');
  await page.getByRole('button', { name: '应用结构修改' }).click();
  await expect(page.locator('#editor-toast')).toHaveText('海岸节点与沿岸碰撞已同步。');
  await page.getByRole('button', { name: '在此后插入节点' }).click();
  await expect(page.locator('#island-selection')).toContainText('海岸节点 2/17');
  await page.getByRole('button', { name: '删除海岸节点' }).click();
  await expect(page.locator('#island-selection')).toContainText('海岸节点 2/16');

  await canvas.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  const dragBox = await canvas.boundingBox();
  if (!dragBox) throw new Error('Island editor canvas is not visible.');
  const dragPadding = Math.min(
    24,
    Math.max(10, Math.min(dragBox.width, dragBox.height) * 0.04),
  );
  const dragScale = Math.min(
    (dragBox.width - dragPadding * 2) / 72,
    (dragBox.height - dragPadding * 2) / 54,
  );
  const dragScreen = (x: number, z: number) => ({
    x: dragBox.x + dragBox.width / 2 + x * dragScale,
    y: dragBox.y + dragBox.height / 2 + z * dragScale,
  });
  const selectedNode = dragScreen(-18, -25);
  const draggedNode = dragScreen(-17.4, -24.4);
  await page.mouse.move(selectedNode.x, selectedNode.y);
  await page.mouse.down();
  await page.mouse.move(draggedNode.x, draggedNode.y, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByText('海岸节点与沿岸碰撞已同步。')).toBeVisible();
  await page.getByRole('button', { name: '撤销' }).click();
  await page.getByRole('button', { name: '重做' }).click();
  await page.getByRole('button', { name: '保存地图' }).click();

  const result = await page.evaluate(async () => {
    const saved = JSON.parse(localStorage.getItem('apple-picking.map-library.v5') ?? '[]')[0];
    const islandPath = String('/src/game/maps/IslandTourMap.ts');
    const orchardMapPath = String('/src/game/maps/OrchardMap.ts');
    const editingPath = String('/src/game/maps/IslandLayoutEditing.ts');
    const island = await import(/* @vite-ignore */ islandPath);
    const orchardMaps = await import(/* @vite-ignore */ orchardMapPath);
    const editing = await import(/* @vite-ignore */ editingPath);
    const invalid = orchardMaps.cloneOrchardMap(island.SWEET_ORCHARD_ISLAND_MAP);
    const invalidResult = editing.moveIslandOutlinePoint(invalid, 0, { x: 0, z: 0 });
    const malformed = orchardMaps.cloneOrchardMap(island.SWEET_ORCHARD_ISLAND_MAP);
    malformed.islandLayout.outline = [
      { x: -20, z: -20 },
      { x: 20, z: 20 },
      { x: -20, z: 20 },
      { x: 20, z: -20 },
    ];
    return {
      outline: saved.islandLayout.outline,
      coastProxies: saved.landmarks.filter(
        (landmark: { id: string }) => landmark.id.startsWith('island-coast-edge-'),
      ),
      legacyBoundaries: saved.landmarks.filter(
        (landmark: { id: string }) => landmark.id.startsWith('island-boundary-'),
      ),
      valid: orchardMaps.validateOrchardMap(saved).valid,
      invalidResult,
      invalidFirstNode: invalid.islandLayout.outline[0],
      malformedErrors: orchardMaps.validateOrchardMap(malformed).errors,
    };
  });
  expect(result.outline).toHaveLength(16);
  expect(result.outline[0]).toEqual({ x: -30.5, z: -22.5 });
  expect(result.outline[1].x).toBeCloseTo(-17.4, 1);
  expect(result.outline[1].z).toBeCloseTo(-24.4, 1);
  expect(result.coastProxies).toHaveLength(16);
  expect(result.legacyBoundaries).toHaveLength(0);
  expect(result.valid).toBe(true);
  expect(result.invalidResult.ok).toBe(false);
  expect(result.invalidFirstNode).toEqual({ x: -31, z: -23 });
  expect(result.malformedErrors).toContain('岛屿轮廓不能自相交。');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: testInfo.outputPath('island-coast-editor.png'),
    fullPage: true,
  });
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('island object builder completes region, obstacle, water and bridge CRUD', async ({ page }, testInfo) => {
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
  const clickWorld = async (x: number, z: number) => {
    await canvas.scrollIntoViewIfNeeded();
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Island editor canvas is not visible.');
    const padding = Math.min(24, Math.max(10, Math.min(box.width, box.height) * 0.04));
    const scale = Math.min((box.width - padding * 2) / 72, (box.height - padding * 2) / 54);
    await page.mouse.click(
      box.x + box.width / 2 + x * scale,
      box.y + box.height / 2 + z * scale,
    );
  };
  const addKind = page.getByLabel('新结构');
  const addButton = page.getByRole('button', { name: '放置新结构' });

  await page.getByRole('button', { name: /岛屿结构/ }).click();
  await addKind.selectOption('region');
  await addButton.click();
  await expect(page.getByRole('button', { name: '取消放置' })).toBeVisible();
  await clickWorld(4, 19);
  await expect(canvas).toHaveAttribute('data-selected-island-id', 'island-region-custom-1');
  await expect(canvas).toHaveAttribute('data-island-regions', '6');
  await page.getByLabel('区域类型').selectOption('beach');
  await page.getByLabel('旋转角度').fill('15');
  await page.getByRole('button', { name: '应用结构修改' }).click();
  await page.getByRole('button', { name: '删除选中结构' }).click();
  await expect(canvas).toHaveAttribute('data-island-regions', '5');

  await addKind.selectOption('route-block');
  await addButton.click();
  await clickWorld(-3, 20);
  await expect(canvas).toHaveAttribute('data-selected-island-id', 'island-route-custom-1');
  await expect(canvas).toHaveAttribute('data-island-route-blocks', '8');
  await page.getByLabel('障碍类型').selectOption('shrine');
  await page.getByRole('button', { name: '应用结构修改' }).click();
  await page.getByRole('button', { name: '删除选中结构' }).click();
  await expect(canvas).toHaveAttribute('data-island-route-blocks', '7');

  await addKind.selectOption('water-segment');
  await addButton.click();
  await clickWorld(0, 20);
  await expect(canvas).toHaveAttribute('data-selected-island-id', 'island-water-custom-1');
  await expect(canvas).toHaveAttribute('data-island-water-segments', '4');
  await page.getByLabel('中心 Z').fill('19');
  await page.getByLabel('水面长度').fill('12');
  await page.getByLabel('水面宽度').fill('3');
  await page.getByRole('button', { name: '应用结构修改' }).click();
  await expect(page.locator('#editor-toast')).toHaveText('水面、所属桥梁与派生碰撞已同步。');

  await addKind.selectOption('bridge');
  await addButton.click();
  await clickWorld(0, 19);
  await expect(canvas).toHaveAttribute('data-selected-island-id', 'island-bridge-custom-1');
  await expect(canvas).toHaveAttribute('data-island-bridges', '3');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: testInfo.outputPath('island-object-builder-2d.png'),
    fullPage: true,
  });

  await page.getByRole('button', { name: '3D 预览' }).click();
  const preview = page.getByLabel('KayKit 地图三维预览');
  await expect.poll(() => preview.getAttribute('data-ready')).toBe('true');
  await expect(preview).toHaveAttribute('data-island-water-segments', '4');
  await expect(preview).toHaveAttribute('data-island-bridges', '3');
  await expect(preview).toHaveAttribute('data-island-region-prop-clusters', '5');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: testInfo.outputPath('island-object-builder-3d.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: '2D 编辑' }).click();
  await page.getByRole('button', { name: '删除选中结构' }).click();
  await expect(canvas).toHaveAttribute('data-island-bridges', '2');
  await clickWorld(0, 19);
  await expect(canvas).toHaveAttribute('data-selected-island-id', 'island-water-custom-1');
  await page.getByRole('button', { name: '删除选中结构' }).click();
  await expect(canvas).toHaveAttribute('data-island-water-segments', '3');
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(canvas).toHaveAttribute('data-island-water-segments', '4');
  await page.getByRole('button', { name: '重做' }).click();
  await expect(canvas).toHaveAttribute('data-island-water-segments', '3');
  await page.getByRole('button', { name: '保存地图' }).click();

  const result = await page.evaluate(async () => {
    const islandPath = String('/src/game/maps/IslandTourMap.ts');
    const orchardMapPath = String('/src/game/maps/OrchardMap.ts');
    const editingPath = String('/src/game/maps/IslandLayoutEditing.ts');
    const island = await import(/* @vite-ignore */ islandPath);
    const orchardMaps = await import(/* @vite-ignore */ orchardMapPath);
    const editing = await import(/* @vite-ignore */ editingPath);
    const draft = orchardMaps.cloneOrchardMap(island.SWEET_ORCHARD_ISLAND_MAP);
    const region = editing.addIslandObject(draft, 'region', { x: 4, z: 19 });
    const route = editing.addIslandObject(draft, 'route-block', { x: -3, z: 20 });
    const water = editing.addIslandObject(draft, 'water-segment', { x: 0, z: 20 });
    const bridge = editing.addIslandObject(draft, 'bridge', { x: 0, z: 20 });
    if (!water.id || !bridge.id || !route.id || !region.id) throw new Error('CRUD setup failed.');
    const waterUpdated = editing.applyIslandGeometryUpdate(draft, 'water-segment', water.id, {
      x: 2,
      z: 18,
      sizeX: 10,
      sizeZ: 4,
    });
    const updatedBridge = draft.islandLayout.bridges.find(
      (entry: { id: string }) => entry.id === bridge.id,
    );
    const routeProxy = draft.landmarks.find((entry: { id: string }) => entry.id === route.id);
    const validationBeforeDelete = orchardMaps.validateOrchardMap(draft);
    editing.removeIslandObject(draft, 'water-segment', water.id);
    editing.removeIslandObject(draft, 'route-block', route.id);
    editing.removeIslandObject(draft, 'region', region.id);
    const malformed = orchardMaps.cloneOrchardMap(island.SWEET_ORCHARD_ISLAND_MAP);
    malformed.islandLayout.waterBlocks[0].x += 1;
    return {
      ids: { region: region.id, route: route.id, water: water.id, bridge: bridge.id },
      waterUpdated,
      updatedBridge,
      routeProxy,
      validBeforeDelete: validationBeforeDelete.valid,
      bridgeRemovedWithWater: !draft.islandLayout.bridges.some(
        (entry: { id: string }) => entry.id === bridge.id,
      ),
      routeProxyRemoved: !draft.landmarks.some((entry: { id: string }) => entry.id === route.id),
      countsAfterDelete: {
        regions: draft.islandLayout.regions.length,
        routeBlocks: draft.islandLayout.routeBlocks.length,
        waterSegments: draft.islandLayout.waterSegments.length,
        bridges: draft.islandLayout.bridges.length,
      },
      malformedErrors: orchardMaps.validateOrchardMap(malformed).errors,
    };
  });
  expect(result.ids).toEqual({
    region: 'island-region-custom-1',
    route: 'island-route-custom-1',
    water: 'island-water-custom-1',
    bridge: 'island-bridge-custom-1',
  });
  expect(result.waterUpdated).toBe(true);
  expect(result.updatedBridge).toMatchObject({ z: 18 });
  expect(result.routeProxy).toMatchObject({ id: result.ids.route, kind: 'homestead' });
  expect(result.validBeforeDelete).toBe(true);
  expect(result.bridgeRemovedWithWater).toBe(true);
  expect(result.routeProxyRemoved).toBe(true);
  expect(result.countsAfterDelete).toEqual({ regions: 5, routeBlocks: 7, waterSegments: 3, bridges: 2 });
  expect(result.malformedErrors).toContain('水域碰撞块必须由水面与桥梁自动派生。');
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
