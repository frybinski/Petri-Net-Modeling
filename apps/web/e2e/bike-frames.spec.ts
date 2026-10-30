import { expect, test, type Locator, type Page } from '@playwright/test';

async function openExample(page: Page, id: string): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
  await page.getByTestId('menu-file').click();
  await page.getByTestId(`menu-item-example-${id}`).click();
  await expect(page.getByTestId('place-shape').first()).toBeVisible();
}

const place = (page: Page, name: string | RegExp): Locator =>
  page.locator('.react-flow__node-place').filter({ hasText: name });

/** Tokens now on a place, as the Metrics tab lists them. */
async function now(page: Page, placeId: string): Promise<number> {
  const row = page.locator(`[data-testid="metrics-place-row"][data-place-id="${placeId}"]`);
  return Number(await row.getByTestId('metrics-place-now').textContent());
}

/** Pauses the run when the place holds at least `count` tokens (tab Enabled of the panel). */
async function breakWhen(page: Page, placeName: string, count: number): Promise<void> {
  await page.getByTestId('sim-tab-enabled').click();
  await page.getByTestId('place-breakpoint-place').selectOption({ label: placeName });
  await page.getByTestId('place-breakpoint-count').fill(String(count));
  await page.getByTestId('place-breakpoint-add').click();
}

test('bicycle frames: the CO2 counter rises, the tube store sinks and is filled up again', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openExample(page, 'bike-frames');
  await expect(page.getByTestId('diagnostic-item')).toHaveCount(0);
  await page.getByTestId('mode-simulate').click();
  await expect(page.getByTestId('simulation-panel')).toBeVisible();

  // The first frames are welded: the run stops as soon as 3 kg of CO2e have been counted.
  await breakWhen(page, 'CO₂e (kg)', 3);
  await page.getByTestId('sim-speed-max').click();
  await page.getByTestId('sim-play').click();
  await expect(page.getByTestId('sim-status')).toHaveText('Paused');
  await page.getByTestId('sim-tab-metrics').click();
  const co2Early = await now(page, 'p_co2');
  const tubesEarly = await now(page, 'p_tubes');
  expect(co2Early).toBeGreaterThanOrEqual(3);
  // The saw has taken 3 kg of tube for each frame it started: the store sank below its 120 kg.
  expect(tubesEarly).toBeLessThan(120);

  // The run goes on until the store holds 150 kg: a delivery of 40 kg has arrived (twice).
  await breakWhen(page, 'Rohrlager (kg)', 150);
  await page.getByTestId('sim-play').click();
  await expect(page.getByTestId('sim-status')).toHaveText('Paused');
  await page.getByTestId('sim-tab-metrics').click();
  expect(await now(page, 'p_tubes')).toBeGreaterThanOrEqual(150);
  // Each delivery of primary steel costs 80 kg of CO2e: the counter rose by at least that.
  expect(await now(page, 'p_co2')).toBeGreaterThanOrEqual(co2Early + 80);

  // An amount belongs to no case: the table lists it without a waiting time and not as a queue.
  const row = page.locator('[data-testid="metrics-place-row"][data-place-id="p_tubes"]');
  await expect(row).toHaveAttribute('data-role', 'quantity');
  await expect(row.getByRole('cell').last()).toHaveText('–');
  expect(errors).toEqual([]);
});

test('bicycle frames: the Metrics tab shows the indicators with values', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openExample(page, 'bike-frames');
  await page.getByTestId('mode-simulate').click();
  await page.getByTestId('sim-speed-max').click();
  await page.getByTestId('sim-play').click();
  // The warm-up of one hour is over, and several frames have been shipped.
  await expect
    .poll(async () => {
      const text = (await page.getByTestId('sim-clock').textContent()) ?? '';
      const [h = 0] = text.split(':').map(Number);
      return h;
    })
    .toBeGreaterThan(3);
  await page.getByTestId('sim-play').click();
  await expect(page.getByTestId('sim-status')).toHaveText('Paused');
  await page.getByTestId('sim-tab-metrics').click();
  const rows = page.getByTestId('metrics-indicator-row');
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText('CO₂e je Rahmen');
  await expect(rows.nth(1)).toContainText('Material je Rahmen');
  await expect(rows.nth(2)).toContainText('Recyclinganteil');
  await expect(rows.nth(3)).toContainText('Restabfall je Rahmen');
  const value = async (index: number): Promise<number> =>
    Number(await rows.nth(index).getByTestId('metrics-indicator-value').textContent());
  expect(await value(0)).toBeGreaterThan(8);
  expect(await value(0)).toBeLessThan(25);
  expect(await value(1)).toBeGreaterThan(2.5);
  expect(await value(1)).toBeLessThan(4.5);
  expect(await value(2)).toBeGreaterThan(10);
  expect(await value(2)).toBeLessThan(50);
  expect(await value(3)).toBeGreaterThan(0.05);
  await expect(rows.nth(0)).toContainText('kg');
  await expect(rows.nth(2)).toContainText('%');
  expect(errors).toEqual([]);
});

test('bicycle frames: the domain view runs, shows the indicators and keeps the strip inside the window', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openExample(page, 'bike-frames');
  await page.getByTestId('view-domain').click();
  const canvas = page.getByTestId('domain-canvas');
  await expect(canvas).toHaveAttribute('data-zoom', /\d/);
  await page.getByTestId('domain-simulate').click();
  await expect(page.getByTestId('domain-clock')).toHaveText('00:00:00');
  await page.getByTestId('domain-speed-max').click();
  await page.getByTestId('domain-play').click();
  await expect
    .poll(async () => {
      const text = (await page.getByTestId('domain-clock').textContent()) ?? '';
      const [h = 0] = text.split(':').map(Number);
      return h;
    })
    .toBeGreaterThan(3);
  await page.getByTestId('domain-play').click();
  await expect(page.getByTestId('domain-play')).toHaveAttribute('aria-pressed', 'false');

  // The fixed figures and the four indicators of the net.
  const kpis = page.getByTestId('domain-kpis');
  await expect(kpis).toBeVisible();
  for (const id of ['co2-per-frame', 'material', 'recycled-share', 'waste']) {
    const figure = page.getByTestId(`domain-kpi-indicator-${id}`);
    await expect(figure).toBeVisible();
    await expect(figure).not.toHaveText('–');
  }
  await expect(page.getByTestId('domain-kpi-more')).toHaveCount(0);
  const co2 = Number(await page.getByTestId('domain-kpi-indicator-co2-per-frame').textContent());
  expect(co2).toBeGreaterThan(8);
  expect(co2).toBeLessThan(25);

  // At 1360 px the strip fits next to the sheet and the page does not scroll sideways.
  const strip = await kpis.boundingBox();
  const area = await canvas.boundingBox();
  if (!strip || !area) throw new Error('strip or canvas not visible');
  expect(strip.x).toBeGreaterThanOrEqual(area.x);
  expect(strip.x + strip.width).toBeLessThanOrEqual(area.x + area.width + 1);
  expect(strip.y + strip.height).toBeLessThanOrEqual(area.y + area.height + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1360);
  // It does not cover the hall.
  const zoom = Number(await canvas.getAttribute('data-zoom'));
  const panX = Number(await canvas.getAttribute('data-pan-x'));
  const panY = Number(await canvas.getAttribute('data-pan-y'));
  const sheet = {
    left: area.x + panX,
    top: area.y + panY,
    right: area.x + panX + 1200 * zoom,
    bottom: area.y + panY + 640 * zoom,
  };
  const overlaps =
    strip.x < sheet.right &&
    strip.x + strip.width > sheet.left &&
    strip.y < sheet.bottom &&
    strip.y + strip.height > sheet.top;
  expect(overlaps).toBe(false);
  expect(errors).toEqual([]);
});

test('bicycle frames: the domain view is valid and the amounts are counters', async ({ page }) => {
  await openExample(page, 'bike-frames');
  await page.getByTestId('view-domain').click();
  await expect(page.getByTestId('domain-canvas')).toHaveAttribute('data-zoom', /\d/);
  await page.getByTestId('right-tab-domain').click();
  await expect(page.getByTestId('domain-status')).toContainText('0 problems');
  await expect(page.getByTestId('domain-diagnostic')).toHaveCount(0);
});

test('bicycle frames: the analysis finds the invariant tube store + free space = 200 kg', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openExample(page, 'bike-frames');
  await page.getByTestId('right-tab-analyze').click();
  await expect(page.getByTestId('analysis-panel')).toBeVisible();
  await page.getByTestId('invariants-run').click();
  await expect(page.getByTestId('p-invariants')).toContainText('Rohrlager (kg)');
  const equations = await page.getByTestId('p-invariants').locator('button').allTextContents();
  expect(equations).toContain('1·Rohrlager (kg) + 1·Lagerplatz frei (kg) = 200');
  expect(equations).toContain('1·Schweißroboter = 2');
  // A click selects the two places in the net.
  await page.getByTestId('p-invariants').locator('button', { hasText: 'Rohrlager' }).click();
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(2);
  expect(errors).toEqual([]);
});

test('bicycle frames: the quantity role is in the inspector, and indicators are edited in the net properties', async ({
  page,
}) => {
  await openExample(page, 'bike-frames');
  // The role of a place.
  await place(page, 'Rohrlager').getByTestId('place-shape').click();
  await expect(page.getByTestId('prop-role')).toHaveValue('quantity');
  await expect(page.getByText(/neither starts nor ends a case/)).toBeVisible();
  // CO2 is a sink by its arcs; the role wins over that, and the inspector says what it is.
  await place(page, 'CO₂e').getByTestId('place-shape').click();
  await expect(page.getByTestId('prop-role-quantity')).toHaveValue('quantity');
  await expect(page.getByTestId('prop-role-fixed')).toHaveCount(0);

  // Nothing selected: the net properties list the four indicators.
  await page.keyboard.press('Escape');
  await page.getByTestId('canvas').click({ position: { x: 5, y: 5 } });
  const items = page.getByTestId('indicator-item');
  await expect(items).toHaveCount(4);
  await expect(items.first()).toContainText('CO₂e je Rahmen');
  await expect(items.first()).toContainText('put on CO₂e (kg) · per completed case');

  // Add one; the error of a missing element stands at its field.
  await page.getByTestId('indicator-add').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByTestId('indicator-save')).toBeDisabled();
  await page.getByTestId('indicator-label').fill('Cuts per hour');
  await page.getByTestId('indicator-label').press('Enter');
  await page.getByTestId('indicator-measure-kind').selectOption('firings');
  await page.getByTestId('indicator-measure-of').selectOption({ label: 'Zuschneiden' });
  await page.getByTestId('indicator-per').selectOption('hour');
  await expect(page.getByTestId('indicator-summary')).toContainText(
    'firings of Zuschneiden · per hour',
  );
  await page.getByTestId('indicator-save').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(items).toHaveCount(5);
  // One undo step takes it away again.
  await page.keyboard.press('Control+z');
  await expect(items).toHaveCount(4);
});
