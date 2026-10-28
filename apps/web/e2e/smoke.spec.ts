import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

async function clickCanvas(page: Page, dx: number, dy: number): Promise<void> {
  const box = await page.getByTestId('canvas').boundingBox();
  if (!box) throw new Error('canvas not visible');
  await page.mouse.click(box.x + dx, box.y + dy);
}

async function openApp(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
  await expect(page.getByTestId('empty-hint')).toBeVisible();
}

test('draw, save, open an example and simulate', async ({ page }) => {
  await openApp(page);

  // Place and transition.
  await page.getByTestId('tool-place').click();
  await clickCanvas(page, 300, 300);
  await expect(page.getByTestId('place-shape')).toHaveCount(1);
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-tool', 'select');

  await page.getByTestId('tool-transition').click();
  await clickCanvas(page, 520, 300);
  await expect(page.getByTestId('transition-shape')).toHaveCount(1);

  // Connect them with the arc tool.
  await page.getByTestId('tool-arc').click();
  await page.getByTestId('place-shape').click();
  await page.getByTestId('transition-shape').click();
  await expect(page.getByTestId('arc')).toHaveCount(1);

  // Give the place two tokens through the properties panel.
  await page.keyboard.press('Escape');
  await page.keyboard.press('v');
  await page.getByTestId('place-shape').click();
  await page.getByTestId('prop-tokens').fill('2');
  await page.getByTestId('prop-tokens').press('Enter');
  await expect(page.getByTestId('token-dot')).toHaveCount(2);

  // Rename the net and save: this triggers a download.
  await page.getByTestId('net-name').fill('Smoke test');
  await page.getByTestId('net-name').press('Enter');
  await expect(page.getByTestId('dirty-indicator')).toBeVisible();
  await page.getByTestId('menu-file').click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('menu-item-save').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('Smoke-test.pn.json');
  const path = await download.path();
  const saved = JSON.parse(await readFile(path, 'utf8')) as {
    name: string;
    places: unknown[];
    transitions: unknown[];
    arcs: unknown[];
    marking: Record<string, number[]>;
  };
  expect(saved.name).toBe('Smoke test');
  expect(saved.places).toHaveLength(1);
  expect(saved.transitions).toHaveLength(1);
  expect(saved.arcs).toHaveLength(1);
  expect(Object.values(saved.marking)[0]).toEqual([1, 1]);
  await expect(page.getByTestId('dirty-indicator')).toBeHidden();

  // Open an example from the menu.
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-item-example-producer-consumer').click();
  await expect(page.getByTestId('net-name')).toHaveValue('Producer/consumer');
  await expect(page.getByTestId('place-shape')).toHaveCount(5);
  await expect(page.getByTestId('transition-shape')).toHaveCount(4);

  // Simulate: the producer's first transition is enabled and fires.
  await page.getByTestId('mode-simulate').click();
  await expect(page.getByTestId('simulation-panel')).toBeVisible();
  const enabled = page.locator('[data-testid="transition-shape"][data-enabled="true"]');
  await expect(enabled).toHaveCount(1);
  await enabled.click();
  await expect(page.getByTestId('sim-step')).toHaveCount(1);
  await expect(page.getByTestId('sim-step')).toContainText('produce');
  await expect(page.locator('[data-testid="transition-shape"][data-enabled="true"]')).toHaveCount(
    1,
  );
  await page.getByTestId('step-random').click();
  await expect(page.getByTestId('sim-step')).toHaveCount(2);
  await page.getByTestId('sim-reset').click();
  await expect(page.getByTestId('sim-step')).toHaveCount(0);
});

test('invalid files are rejected with a message', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('open-file-input').setInputFiles({
    name: 'broken.pn.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{ "not": "a net" }'),
  });
  const toast = page.getByTestId('toast-error');
  await expect(toast).toContainText('Could not open broken.pn.json');
  await expect(page.getByTestId('empty-hint')).toBeVisible();
});

test('undo and redo with the keyboard', async ({ page }) => {
  await openApp(page);
  await page.keyboard.press('p');
  await clickCanvas(page, 400, 300);
  await expect(page.getByTestId('place-shape')).toHaveCount(1);
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('place-shape')).toHaveCount(0);
  await page.keyboard.press('Control+Shift+z');
  await expect(page.getByTestId('place-shape')).toHaveCount(1);
});

test('autosave restores the net after a reload', async ({ page }) => {
  await openApp(page);
  await page.keyboard.press('t');
  await clickCanvas(page, 400, 300);
  await expect(page.getByTestId('transition-shape')).toHaveCount(1);
  await page.waitForTimeout(1200); // autosave is debounced by 500 ms
  await page.reload();
  await expect(page.getByTestId('transition-shape')).toHaveCount(1);
  await expect(page.getByTestId('toast-info')).toContainText('Restored');
});

test('drag snaps to the grid and is one undo step; rename and copy/paste work', async ({
  page,
}) => {
  await openApp(page);
  await page.getByTestId('tool-place').click();
  await clickCanvas(page, 300, 300);
  const shape = page.getByTestId('place-shape');
  const start = await shape.boundingBox();
  if (!start) throw new Error('place not visible');

  await page.mouse.move(start.x + 20, start.y + 20);
  await page.mouse.down();
  await page.mouse.move(start.x + 133, start.y + 77, { steps: 8 });
  await page.mouse.up();
  const moved = await shape.boundingBox();
  if (!moved) throw new Error('place not visible');
  // The place center snaps to the 20 px grid at 100 % zoom.
  expect((moved.x + 20 - (start.x + 20)) % 20).toBeCloseTo(0, 0);
  expect(moved.x).toBeGreaterThanOrEqual(start.x + 80);
  await page.keyboard.press('Control+z');
  // The undo shows up with the next render, which can take a moment on a busy machine.
  await expect.poll(async () => (await shape.boundingBox())?.x).toBeCloseTo(start.x, 0);
  await page.keyboard.press('Control+Shift+z');

  // Rename in place; Escape cancels, Enter commits.
  await shape.dblclick();
  await page.keyboard.type('Dropped');
  await page.keyboard.press('Escape');
  await expect(page.locator('.react-flow__node-place')).toContainText('P1');
  await shape.dblclick();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('Buffer');
  await page.keyboard.press('Enter');
  await expect(page.locator('.react-flow__node-place')).toContainText('Buffer');

  // Copy and paste yields a second place with a unique name.
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');
  await expect(page.getByTestId('place-shape')).toHaveCount(2);
  await expect(page.locator('.react-flow__node-place').nth(1)).toContainText('Buffer 2');

  // Delete the pasted copy again.
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('place-shape')).toHaveCount(1);
});

test('auto layout is undoable and the theme can be switched', async ({ page }) => {
  await openApp(page);
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-item-example-traffic-light').click();
  await expect(page.getByTestId('place-shape')).toHaveCount(8);
  const first = page.locator('.react-flow__node-place').first();
  // Compare positions on screen with the same fitted view before and after.
  const fitted = async (): Promise<number | undefined> => {
    await page.keyboard.press('f');
    await page.waitForTimeout(450); // the fit animation takes 250 ms
    return (await first.boundingBox())?.x;
  };
  const before = await fitted();

  await page.getByTestId('menu-layout').click();
  await page.getByTestId('menu-item-layout-down').click();
  await expect(page.getByTestId('undo')).toBeEnabled();
  await page.waitForTimeout(500);
  expect(await fitted()).not.toBeCloseTo(before ?? 0, 0);
  await page.keyboard.press('Control+z');
  expect(await fitted()).toBeCloseTo(before ?? 0, 0);

  await page.getByTestId('theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', /dark|light/);
  const theme = await page.locator('html').getAttribute('data-theme');
  await page.getByTestId('theme-toggle').click();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', theme ?? '');
});

test('drawing an invalid connection is refused', async ({ page }) => {
  await openApp(page);
  await page.getByTestId('tool-place').click();
  await clickCanvas(page, 300, 300);
  await page.getByTestId('tool-place').click();
  await clickCanvas(page, 500, 300);
  await page.getByTestId('tool-arc').click();
  await page.getByTestId('place-shape').first().click();
  await page.getByTestId('place-shape').nth(1).click();
  await expect(page.getByTestId('toast-error')).toContainText(
    'place cannot be connected to a place',
  );
  await expect(page.getByTestId('arc')).toHaveCount(0);
});
