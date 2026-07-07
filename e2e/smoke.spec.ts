import { expect, test } from '@playwright/test';

test('app loads, and either runs the WebGPU simulation or degrades gracefully', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');

  const canvas = page.locator('canvas#grid');
  const unsupported = page.locator('.unsupported');
  await expect(canvas.or(unsupported)).toBeVisible();

  if (await canvas.isVisible()) {
    const box = await canvas.boundingBox();
    expect(box?.width).toBeGreaterThan(0);
    expect(box?.height).toBeGreaterThan(0);
    await expect(page.getByRole('button', { name: 'Lava' })).toBeVisible();
  } else {
    await expect(unsupported).toHaveText(/WebGPU/i);
  }

  expect(pageErrors, `unexpected page errors: ${pageErrors.join('; ')}`).toEqual([]);
  expect(consoleErrors, `unexpected console errors: ${consoleErrors.join('; ')}`).toEqual([]);
});

test('backtick toggles the profiler overlay', async ({ page }) => {
  await page.goto('/');

  const canvas = page.locator('canvas#grid');
  const unsupported = page.locator('.unsupported');
  await expect(canvas.or(unsupported)).toBeVisible();
  if (!(await canvas.isVisible())) {
    test.skip();
  }

  const overlay = page.locator('.profiler-overlay');
  await expect(overlay).toBeHidden();

  await page.keyboard.press('`');
  await expect(overlay).toBeVisible();

  await page.keyboard.press('`');
  await expect(overlay).toBeHidden();
});
