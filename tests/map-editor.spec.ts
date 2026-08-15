import { expect, test } from '@playwright/test';

test('map editor renders a valid dense orchard without viewport overflow', async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/editor.html');
  await expect(page.getByRole('heading', { name: '果园地图工坊' })).toBeVisible();
  await expect(page.getByLabel('果园地图编辑画布')).toBeVisible();
  await expect(page.getByText(/可游玩 · 115 树 · 6 果实/)).toBeVisible();
  await expect(page.getByText('全部 9 个关键目标可达。')).toBeVisible();
  await expect(page.getByRole('button', { name: '使用并游玩' })).toBeEnabled();

  const overflow = await page.evaluate(() => ({
    body: document.documentElement.scrollWidth - window.innerWidth,
    main: document.querySelector('main')?.scrollWidth ?? 0,
    viewport: window.innerWidth,
  }));
  expect(overflow.body).toBeLessThanOrEqual(1);
  expect(overflow.main).toBeGreaterThan(0);
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('map editor candidates, drawing, undo, save and play flow work together', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'Editor mutations only need one installed Chrome run.');
  await page.goto('/editor.html');

  const candidateButtons = page.getByRole('button', { name: /^#\d · \d+ 树$/ });
  await expect(candidateButtons).toHaveCount(4);
  const firstLabels = await candidateButtons.allTextContents();
  await page.getByRole('button', { name: '生成四个候选' }).click();
  await expect(candidateButtons).toHaveCount(4);
  expect(await candidateButtons.allTextContents()).toEqual(firstLabels);

  await candidateButtons.first().click();
  await expect(page.getByRole('button', { name: '撤销' })).toBeEnabled();
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(page.getByText(/可游玩 · 115 树 · 6 果实/)).toBeVisible();

  await page.locator('#density-input').fill('100');
  await page.getByRole('button', { name: '生成四个候选' }).click();
  await candidateButtons.first().click();
  await expect(page.getByText(/可游玩 · \d+ 树 · 6 果实/)).toBeVisible();
  await expect(page.getByRole('button', { name: '使用并游玩' })).toBeEnabled();
  await page.getByRole('button', { name: '撤销' }).click();

  await page.getByRole('button', { name: /小路 3/ }).click();
  const canvas = page.getByLabel('果园地图编辑画布');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (box) {
    await page.mouse.move(box.x + box.width * 0.42, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.58, box.y + box.height * 0.5, { steps: 6 });
    await page.mouse.up();
  }
  await expect(page.getByRole('button', { name: '撤销' })).toBeEnabled();
  await page.getByRole('button', { name: '撤销' }).click();

  await page.getByRole('textbox', { name: '地图名称' }).fill('自动验收果园');
  await page.getByRole('button', { name: '保存地图' }).click();
  await expect(page.getByText('自动验收果园', { exact: true })).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.json$/);

  const importedMap = await page.evaluate(() => {
    const library = JSON.parse(localStorage.getItem('apple-picking.map-library.v1') ?? '[]');
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
