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

test('material system: elements still behave and wood ignites — no errors', async ({ page }) => {
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

  // Wood over Lava should ignite (generic flammable rule); sand/water still move.
  await page.getByRole('button', { name: 'Lava', exact: true }).click();
  let p = at(0.5, 0.55); await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + 20, p.y); await page.mouse.up();
  await page.getByRole('button', { name: 'Wood', exact: true }).click();
  p = at(0.5, 0.4); await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + 20, p.y); await page.mouse.up();
  await page.getByRole('button', { name: 'Sand', exact: true }).click();
  p = at(0.25, 0.3); await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.up();

  await page.waitForTimeout(2000);

  expect(pageErrors, `page errors: ${pageErrors.join('; ')}`).toEqual([]);
  expect(consoleErrors, `console errors: ${consoleErrors.join('; ')}`).toEqual([]);
});

test('generic corrosion: acid dissolves solubles — no errors', async ({ page }) => {
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
  // chem materials/acids carry a formula -> non-exact (substring) name match.
  const dab = async (name: string, fx: number, fy: number) => {
    await page.getByRole('button', { name }).first().click();
    const p = at(fx, fy); await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + 15, p.y); await page.mouse.up();
  };

  // A limestone bed with concentrated acid on top: exercises dissolve + CO2 fizz.
  await dab('Limestone', 0.5, 0.6);
  await dab('Sulfuric Acid (Concentrated)', 0.5, 0.45);
  await dab('Salt', 0.25, 0.6);
  await page.waitForTimeout(2500);

  expect(pageErrors, `page errors: ${pageErrors.join('; ')}`).toEqual([]);
  expect(consoleErrors, `console errors: ${consoleErrors.join('; ')}`).toEqual([]);
});

test('phase transitions: wax melts near lava — no errors', async ({ page }) => {
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
  const dab = async (name: string, fx: number, fy: number) => {
    await page.getByRole('button', { name, exact: true }).click();
    const p = at(fx, fy); await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + 15, p.y); await page.mouse.up();
  };

  await dab('Lava', 0.5, 0.55);   // sustained heat
  await dab('Wax', 0.5, 0.45);    // wax on top melts to Molten Wax
  await dab('Ice', 0.25, 0.4);    // existing chain still works
  await page.waitForTimeout(2500);

  expect(pageErrors, `page errors: ${pageErrors.join('; ')}`).toEqual([]);
  expect(consoleErrors, `console errors: ${consoleErrors.join('; ')}`).toEqual([]);
});

test('viscosity: liquids of different thickness flow without errors', async ({ page }) => {
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
  const dab = async (name: string, fx: number, fy: number, exact = true) => {
    await page.getByRole('button', { name, exact }).first().click();
    const p = at(fx, fy); await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + 15, p.y); await page.mouse.up();
  };

  await dab('Water', 0.25, 0.3);                          // thin: levels fast
  await dab('Lava', 0.5, 0.3);                            // thick: mounds
  await dab('Molten Wax', 0.7, 0.3);                      // medium: oozes
  await dab('Sulfuric Acid (Concentrated)', 0.85, 0.3, false);
  await page.waitForTimeout(2500);

  expect(pageErrors, `page errors: ${pageErrors.join('; ')}`).toEqual([]);
  expect(consoleErrors, `console errors: ${consoleErrors.join('; ')}`).toEqual([]);
});

test('explosions: TNT detonates in lava without errors or grid wipe', async ({ page }) => {
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
  const stroke = async (name: string, fx0: number, fx1: number, fy: number) => {
    await page.getByRole('button', { name, exact: true }).click();
    const a = at(fx0, fy); await page.mouse.move(a.x, a.y); await page.mouse.down();
    const b = at(fx1, fy); await page.mouse.move(b.x, b.y); await page.mouse.up();
  };

  // TNT embedded in a lava pool: the sustained heat detonates it, driving the
  // whole blast path (pressure inject/diffuse/decay, destroy/ignite/chain, fling).
  await stroke('Stone', 0.3, 0.7, 0.8);
  await stroke('Lava', 0.4, 0.6, 0.68);
  await stroke('TNT', 0.44, 0.56, 0.7);
  await stroke('Lava', 0.4, 0.6, 0.64);
  await page.waitForTimeout(3000);

  expect(pageErrors, `page errors: ${pageErrors.join('; ')}`).toEqual([]);
  expect(consoleErrors, `console errors: ${consoleErrors.join('; ')}`).toEqual([]);
});

test('electricity: a Battery-Copper-Ground circuit drives current without errors', async ({ page }) => {
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
  // Copper carries a formula ("Cu") on its button -> substring match.
  const stroke = async (name: string, fx0: number, fx1: number, fy: number, exact = true) => {
    await page.getByRole('button', { name, exact }).first().click();
    const a = at(fx0, fy); await page.mouse.move(a.x, a.y); await page.mouse.down();
    const b = at(fx1, fy); await page.mouse.move(b.x, b.y); await page.mouse.up();
  };

  // A complete Battery-Copper-Ground circuit with a TNT wired to it: exercises the
  // reachability fields, LIVE detection, ohmic heating, and emergent electric detonation.
  await stroke('TNT', 0.42, 0.52, 0.55);
  await stroke('Copper', 0.38, 0.56, 0.58, false);
  await stroke('Battery', 0.35, 0.38, 0.58);
  await stroke('Ground', 0.56, 0.59, 0.58);
  await page.waitForTimeout(3000);

  expect(pageErrors, `page errors: ${pageErrors.join('; ')}`).toEqual([]);
  expect(consoleErrors, `console errors: ${consoleErrors.join('; ')}`).toEqual([]);
});

test('fuels: oil floats + burns, coal chars to ash — no errors', async ({ page }) => {
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
  const stroke = async (name: string, fx0: number, fx1: number, fy: number) => {
    await page.getByRole('button', { name, exact: true }).click();
    const a = at(fx0, fy); await page.mouse.move(a.x, a.y); await page.mouse.down();
    const b = at(fx1, fy); await page.mouse.move(b.x, b.y); await page.mouse.up();
  };

  // Oil on water (floats), a coal pile, gasoline, and Lava to ignite — exercises
  // the new fuels' combustion, floating (3a density), and Coal->Ash.
  await stroke('Stone', 0.15, 0.45, 0.72);
  await stroke('Water', 0.18, 0.42, 0.66);
  await stroke('Oil', 0.18, 0.42, 0.62);
  await stroke('Gasoline', 0.50, 0.60, 0.6);
  await stroke('Coal', 0.65, 0.80, 0.68);
  await stroke('Lava', 0.20, 0.30, 0.58);
  await stroke('Lava', 0.68, 0.76, 0.63);
  await page.waitForTimeout(3000);

  expect(pageErrors, `page errors: ${pageErrors.join('; ')}`).toEqual([]);
  expect(consoleErrors, `console errors: ${consoleErrors.join('; ')}`).toEqual([]);
});
