import { expect, test, type Locator, type Page } from '@playwright/test';

async function openExample(page: Page, id: string): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
  await page.getByTestId('menu-file').click();
  await page.getByTestId(`menu-item-example-${id}`).click();
  await expect(page.getByTestId('place-shape').first()).toBeVisible();
}

/** Opens an example in the domain view and starts its simulation from the bar of the view. */
async function simulateInDomain(page: Page, id: string, speed: string): Promise<Locator> {
  await openExample(page, id);
  await page.getByTestId('view-domain').click();
  const canvas = page.getByTestId('domain-canvas');
  await expect(canvas).toHaveAttribute('data-zoom', /\d/);
  await page.getByTestId('domain-simulate').click();
  await expect(page.getByTestId('domain-clock')).toHaveText('00:00:00');
  await page.getByTestId(`domain-speed-${speed}`).click();
  return canvas;
}

const seconds = async (page: Page): Promise<number> => {
  const text = (await page.getByTestId('domain-clock').textContent()) ?? '';
  const [h, m, s] = text.split(':').map(Number);
  return (h ?? 0) * 3600 + (m ?? 0) * 60 + (s ?? 0);
};

/** Screen position of a point of the sheet in the domain canvas. */
async function sheetToScreen(canvas: Locator, x: number, y: number): Promise<[number, number]> {
  const box = await canvas.boundingBox();
  if (!box) throw new Error('domain canvas not visible');
  const zoom = Number(await canvas.getAttribute('data-zoom'));
  const panX = Number(await canvas.getAttribute('data-pan-x'));
  const panY = Number(await canvas.getAttribute('data-pan-y'));
  return [box.x + panX + x * zoom, box.y + panY + y * zoom];
}

test('parcel center: the clock runs, the picture changes, pause freezes it', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const canvas = await simulateInDomain(page, 'parcel-center', '10');
  const before = await canvas.screenshot();
  await page.getByTestId('domain-play').click();
  await expect(page.getByTestId('domain-play')).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(3000);

  // After three seconds at 10x the clock shows about half a minute and the canvas has changed.
  expect(await seconds(page)).toBeGreaterThan(0);
  const during = await canvas.screenshot();
  expect(during.equals(before)).toBe(false);
  // Bundles that carry events reach the animation, in the order of their arrival.
  expect(Number(await canvas.getAttribute('data-bundles'))).toBeGreaterThan(0);

  // Pause: the clock stands and, once the last motions are over, so does the picture.
  await page.getByTestId('domain-play').click();
  await expect(page.getByTestId('domain-play')).toHaveAttribute('aria-pressed', 'false');
  await page.waitForTimeout(1200);
  const frozenAt = await page.getByTestId('domain-clock').textContent();
  const frozen = await canvas.screenshot();
  const frames = await canvas.getAttribute('data-frames');
  await page.waitForTimeout(800);
  expect(await page.getByTestId('domain-clock').textContent()).toBe(frozenAt);
  expect((await canvas.screenshot()).equals(frozen)).toBe(true);
  // The loop rests: no frame is drawn while nothing changes.
  expect(await canvas.getAttribute('data-frames')).toBe(frames);

  // The clock of the bar and of the panel are the same.
  await expect(page.getByTestId('sim-clock')).toHaveText(frozenAt ?? '');
  expect(errors).toEqual([]);
});

test('a click on a case follows it and shows its steps', async ({ page }) => {
  const canvas = await simulateInDomain(page, 'parcel-center', '60');
  await page.getByTestId('domain-play').click();
  await expect
    .poll(async () => (await canvas.getAttribute('data-cases')) ?? '', { timeout: 20_000 })
    .not.toBe('');
  await page.getByTestId('domain-play').click();
  await page.waitForTimeout(1000);
  const [id, xy] = ((await canvas.getAttribute('data-cases')) ?? '').split(';')[0]!.split('@');
  const [x, y] = xy!.split(',').map(Number);
  const [sx, sy] = await sheetToScreen(canvas, x!, y!);
  await page.mouse.click(sx, sy);

  const card = page.getByTestId('domain-case-card');
  await expect(card).toBeVisible();
  await expect(page.getByTestId('domain-case-title')).toHaveText(`Case ${id}`);
  await expect(page.getByTestId('domain-case-step').first()).toBeVisible();
  // The card does not cover the picture: the sheet makes room for it.
  await expect
    .poll(
      async () => {
        const cardBox = await card.boundingBox();
        const [left, top] = await sheetToScreen(canvas, 0, 0);
        const [right, bottom] = await sheetToScreen(canvas, 1200, 640);
        if (!cardBox) return false;
        return (
          cardBox.x >= right ||
          cardBox.x + cardBox.width <= left ||
          cardBox.y >= bottom ||
          cardBox.y + cardBox.height <= top
        );
      },
      { timeout: 5000 },
    )
    .toBe(true);

  // The followed case moves with the run: its steps grow.
  const steps = await page.getByTestId('domain-case-step').count();
  await page.getByTestId('domain-play').click();
  await expect
    .poll(async () => page.getByTestId('domain-case-step').count(), { timeout: 20_000 })
    .toBeGreaterThan(steps);
  await page.getByTestId('domain-play').click();

  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
  // Follow another case, found where the cases rest now, and let go with the button.
  await page.waitForTimeout(1000);
  const [next, where] = ((await canvas.getAttribute('data-cases')) ?? '').split(';')[0]!.split('@');
  const [nx, ny] = where!.split(',').map(Number);
  const [cx, cy] = await sheetToScreen(canvas, nx!, ny!);
  await page.mouse.click(cx, cy);
  await expect(page.getByTestId('domain-case-title')).toHaveText(`Case ${next}`);
  await page.getByTestId('domain-case-stop').click();
  await expect(card).toHaveCount(0);
});

test('a click on an enabled station fires its transition', async ({ page }) => {
  const canvas = await simulateInDomain(page, 'parcel-center', '1');
  await expect(page.getByTestId('domain-cases')).toHaveText('0');
  // The door of the arrivals is the only transition that can fire at the start.
  const [sx, sy] = await sheetToScreen(canvas, 52, 320);
  await page.mouse.click(sx, sy);
  await expect(page.getByTestId('domain-cases')).toHaveText('1');
  await expect(page.getByTestId('sim-cases')).toHaveText('1');
  await expect(canvas).toHaveAttribute('data-sprites', '1');
});

test('smart office runs for 30 seconds at 60x without errors', async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  const canvas = await simulateInDomain(page, 'smart-office', '60');
  await page.getByTestId('domain-play').click();
  let last = 0;
  for (let i = 0; i < 6; i += 1) {
    await page.waitForTimeout(5000);
    const now = await seconds(page);
    expect(now).toBeGreaterThan(last);
    last = now;
  }
  // Half an hour of simulated time have passed, people are in the picture.
  expect(last).toBeGreaterThan(20 * 60);
  expect(Number(await canvas.getAttribute('data-bundles'))).toBeGreaterThan(20);
  await page.getByTestId('domain-play').click();
  expect(errors).toEqual([]);
});

test('reduced motion: cases jump, the clock runs all the same', async ({ page }) => {
  // The test configuration asks for reduced motion.
  const canvas = await simulateInDomain(page, 'parcel-center', '60');
  await page.getByTestId('domain-play').click();
  let moved = 0;
  for (let i = 0; i < 25; i += 1) {
    await page.waitForTimeout(150);
    moved += Number(await canvas.getAttribute('data-moving'));
  }
  expect(moved).toBe(0);
  expect(await seconds(page)).toBeGreaterThan(60);
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-sprites')), { timeout: 20_000 })
    .toBeGreaterThan(0);
});

test('with motion allowed, cases are seen under way', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const canvas = await simulateInDomain(page, 'parcel-center', '60');
  await page.getByTestId('domain-play').click();
  let moving = 0;
  for (let i = 0; i < 80 && moving === 0; i += 1) {
    await page.waitForTimeout(100);
    moving = Number(await canvas.getAttribute('data-moving'));
  }
  expect(moving).toBeGreaterThan(0);
  // Speed "max": the top speed jumps again.
  await page.getByTestId('domain-speed-max').click();
  await page.waitForTimeout(600);
  let after = 0;
  for (let i = 0; i < 10; i += 1) {
    await page.waitForTimeout(100);
    after += Number(await canvas.getAttribute('data-moving'));
  }
  expect(after).toBe(0);
});

test('the controls leave the picture free and hide on request', async ({ page }) => {
  const canvas = await simulateInDomain(page, 'parcel-center', '10');
  await page.getByTestId('domain-play').click();
  await page.waitForTimeout(1500);
  await page.getByTestId('domain-play').click();
  const bar = await page.getByTestId('domain-controls').boundingBox();
  const kpis = await page.getByTestId('domain-kpis').boundingBox();
  const area = await canvas.boundingBox();
  if (!bar || !kpis || !area) throw new Error('controls not visible');
  // The sheet of the hall, in screen pixels.
  const [left, top] = await sheetToScreen(canvas, 0, 0);
  const [right, bottom] = await sheetToScreen(canvas, 1200, 640);
  const overlaps = (a: { x: number; y: number; width: number; height: number }): boolean =>
    a.x < right && a.x + a.width > left && a.y < bottom && a.y + a.height > top;
  expect(overlaps(bar)).toBe(false);
  expect(overlaps(kpis)).toBe(false);

  await page.getByTestId('domain-controls-hide').click();
  await expect(page.getByTestId('domain-controls')).toHaveCount(0);
  await expect(page.getByTestId('domain-kpis')).toHaveCount(0);
  await page.getByTestId('domain-controls-show').click();
  await expect(page.getByTestId('domain-controls')).toBeVisible();
});

test('hover cards show how a station and a queue are doing', async ({ page }) => {
  const canvas = await simulateInDomain(page, 'parcel-center', '60');
  await page.getByTestId('domain-play').click();
  await page.waitForTimeout(4000);
  await page.getByTestId('domain-play').click();
  const [sx, sy] = await sheetToScreen(canvas, 304, 262);
  await page.mouse.move(sx, sy);
  const card = page.getByTestId('domain-hover-card');
  await expect(card).toBeVisible();
  await expect(page.getByTestId('domain-card-status')).toBeVisible();
  await expect(page.getByTestId('domain-card-slots')).toContainText(/\d of 2/);
  await expect(page.getByTestId('domain-card-waiting')).toBeVisible();
});
