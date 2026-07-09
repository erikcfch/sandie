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

test('water levels, sand sinks, sand soaks — no errors', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await page.goto('/');
  const canvas = page.locator('canvas#grid');
  const unsupported = page.locator('.unsupported');
  await expect(canvas.or(unsupported)).toBeVisible();
  if (!(await canvas.isVisible())) test.skip();

  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas box');
  const at = (fx: number, fy: number) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy });

  // Sand mound, then water poured on top: exercises fall, sink, and soak paths.
  await page.getByRole('button', { name: 'Sand', exact: true }).click();
  let p = at(0.5, 0.5); await page.mouse.move(p.x, p.y); await page.mouse.down();
  for (let f = 0.45; f <= 0.55; f += 0.02) { const q = at(f, 0.5); await page.mouse.move(q.x, q.y); }
  await page.mouse.up();

  await page.getByRole('button', { name: 'Water', exact: true }).click();
  p = at(0.5, 0.25); await page.mouse.move(p.x, p.y); await page.mouse.down();
  await page.mouse.move(p.x + 15, p.y); await page.mouse.up();

  await page.waitForTimeout(2000); // let it fall, level, sink, and soak

  expect(pageErrors, `page errors: ${pageErrors.join('; ')}`).toEqual([]);
  expect(consoleErrors, `console errors: ${consoleErrors.join('; ')}`).toEqual([]);
});
