import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';

const examples = join(import.meta.dirname, '..', '..', '..', 'examples');

interface View {
  meta: { canvas: { width: number; height: number } };
  transitions: Record<string, { box?: number[]; pos?: number[] }>;
}

/** The domain view of an example as stored in its file. */
function viewOf(example: string): View {
  const file = JSON.parse(readFileSync(join(examples, `${example}.pn.json`), 'utf8')) as {
    domainView: View;
  };
  return file.domainView;
}

async function openExample(page: Page, id: string): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
  await page.getByTestId('menu-file').click();
  await page.getByTestId(`menu-item-example-${id}`).click();
  await expect(page.getByTestId('place-shape').first()).toBeVisible();
}

/** Screen position of a point of the sheet in the domain canvas. */
async function sheetToScreen(canvas: Locator, x: number, y: number): Promise<[number, number]> {
  const box = await canvas.boundingBox();
  if (!box) throw new Error('domain canvas not visible');
  const zoom = Number(await canvas.getAttribute('data-zoom'));
  const panX = Number(await canvas.getAttribute('data-pan-x'));
  const panY = Number(await canvas.getAttribute('data-pan-y'));
  return [box.x + panX + x * zoom, box.y + panY + y * zoom];
}

function transition(page: Page, name: string | RegExp) {
  return page.locator('.react-flow__node-transition').filter({ hasText: name });
}

/** The rules of the diagnostics listed in the domain panel. */
async function listedRules(page: Page): Promise<string[]> {
  const rows = page.getByTestId('domain-diagnostic');
  const count = await rows.count();
  const rules: string[] = [];
  for (let i = 0; i < count; i += 1)
    rules.push((await rows.nth(i).getAttribute('data-rule')) ?? '');
  return rules;
}

test('parcel center: the domain view is drawn and the panel reports no problems', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openExample(page, 'parcel-center');
  await page.getByTestId('view-domain').click();

  const canvas = page.getByTestId('domain-canvas');
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveAttribute('aria-label', /12 places and 9 transitions/);
  await expect(page.getByTestId('domain-status')).toHaveText('0 problems');
  await expect(page.getByTestId('domain-diagnostic')).toHaveCount(0);
  await expect(page.getByTestId('origin-user')).toHaveText('30 user');
  await expect(page.getByTestId('domain-hash-status')).toHaveAttribute('data-stale', 'false');
  // The sheet is fitted into the view and the zoom is shown in the status bar.
  await expect(canvas).toHaveAttribute('data-zoom', /^0\.\d+$|^1(\.\d+)?$/);
  await expect(page.getByTestId('domain-zoom-level')).toHaveText(/^\d+%$/);
  // The net editor is hidden but keeps its content.
  await expect(page.getByTestId('canvas')).toBeHidden();

  // Something was painted: the canvas is not one flat color.
  const distinct = await canvas.evaluate((element) => {
    const source = element as HTMLCanvasElement;
    const copy = document.createElement('canvas');
    copy.width = 64;
    copy.height = 40;
    const ctx = copy.getContext('2d');
    if (!ctx) return 0;
    ctx.drawImage(source, 0, 0, 64, 40);
    const data = ctx.getImageData(0, 0, 64, 40).data;
    const colors = new Set<string>();
    for (let i = 0; i < data.length; i += 4) colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
    return colors.size;
  });
  expect(distinct).toBeGreaterThan(8);

  // Back to the net: the editor is untouched.
  await page.getByTestId('view-net').click();
  await expect(page.getByTestId('canvas')).toBeVisible();
  await expect(page.getByTestId('domain-canvas')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('hovering links the two views in both directions', async ({ page }) => {
  await openExample(page, 'parcel-center');
  await page.getByTestId('view-both').click();
  const canvas = page.getByTestId('domain-canvas');
  await expect(canvas).toBeVisible();
  await expect(page.getByTestId('canvas')).toBeVisible();
  await expect(canvas).toHaveAttribute('data-zoom', /\d/);

  // Domain to net: the sorter card lights up its transition in the net.
  const sorter = viewOf('parcel-center').transitions['t_sort'];
  if (!sorter?.box) throw new Error('t_sort has no box');
  const [x, y, w, h] = sorter.box as [number, number, number, number];
  const [sx, sy] = await sheetToScreen(canvas, x + w / 2, y + h - 12);
  await page.mouse.move(sx, sy);
  await expect(canvas).toHaveAttribute('data-hover', 't_sort');
  await expect(transition(page, 'Sortieren')).toHaveAttribute('data-linked', 'true');
  const card = page.getByTestId('domain-hover-card');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Sortieren');
  await expect(card).toContainText('t_sort');
  await expect(card).toContainText('machine');
  await expect(card).toContainText('user');

  // Leaving the element clears both.
  await page.mouse.move(sx, sy - 400);
  await expect(canvas).toHaveAttribute('data-hover', '');
  await expect(transition(page, 'Sortieren')).not.toHaveAttribute('data-linked', 'true');

  // Net to domain: hovering a node in the net highlights the element in the domain view.
  await transition(page, 'Scannen').getByTestId('transition-shape').hover();
  await expect(canvas).toHaveAttribute('data-hover', 't_scan');
  await page.mouse.move(5, 5);
  await expect(canvas).toHaveAttribute('data-hover', '');

  // A click selects the element in both views and the panel shows its entry.
  await page.mouse.click(sx, sy);
  await expect(transition(page, 'Sortieren').locator('.pn-node')).toHaveAttribute(
    'data-selected',
    'true',
  );
  await expect(page.getByTestId('domain-entry')).toContainText('"kind": "machine"');
});

test('complaint handling: generate a generic view and keep it in step with the net', async ({
  page,
}) => {
  await openExample(page, 'complaint-handling');
  await page.getByTestId('view-domain').click();
  await expect(page.getByTestId('domain-empty')).toBeVisible();
  await expect(page.getByTestId('domain-empty')).toContainText('No domain view yet');

  await page.getByTestId('domain-generate').click();
  await expect(page.getByTestId('domain-empty')).toHaveCount(0);
  await expect(page.getByTestId('domain-status')).toHaveText('0 problems');
  await expect(page.getByTestId('origin-user')).toHaveText('0 user');
  await expect(page.getByTestId('origin-generic')).not.toHaveText('0 generic');
  await expect(page.getByTestId('domain-canvas')).toHaveAttribute('aria-label', /8 places/);

  // Delete a place in the net: the view now names an element that does not exist (V2) and the
  // structure has changed (V7).
  await page.getByTestId('view-both').click();
  await page.locator('.react-flow__node-place').filter({ hasText: 'Erledigt' }).click();
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('domain-status')).toContainText('error');
  expect(await listedRules(page)).toEqual(expect.arrayContaining(['V2', 'V7']));
  await expect(page.getByTestId('domain-update-hash')).toBeDisabled();

  // Fill missing entries only adds, Remove stale entries drops the stale one; Update hash accepts
  // the new structure.
  await page.getByTestId('domain-fill').click();
  expect(await listedRules(page)).toEqual(expect.arrayContaining(['V2', 'V7']));
  await page.getByTestId('domain-remove-stale').click();
  expect(await listedRules(page)).toEqual(['V7']);
  await expect(page.getByTestId('domain-hash-status')).toHaveAttribute('data-stale', 'true');
  await page.getByTestId('domain-update-hash').click();
  await expect(page.getByTestId('domain-status')).toHaveText('0 problems');

  // A new place has no entry (V3); Fill missing entries draws it generically.
  await page.getByTestId('tool-place').click();
  const net = await page.getByTestId('canvas').boundingBox();
  if (!net) throw new Error('net canvas not visible');
  await page.mouse.click(net.x + 160, net.y + net.height - 90);
  await expect(page.getByTestId('domain-status')).toContainText('error');
  expect(await listedRules(page)).toEqual(expect.arrayContaining(['V3', 'V7']));
  await page.getByTestId('domain-fill').click();
  expect(await listedRules(page)).toEqual(['V7']);
  await page.getByTestId('domain-update-hash').click();
  await expect(page.getByTestId('domain-status')).toHaveText('0 problems');

  // Every step is one undo step.
  await page.getByTestId('undo').click();
  await expect(page.getByTestId('domain-hash-status')).toHaveAttribute('data-stale', 'true');
});

test('simulation: the marking appears in the domain view', async ({ page }) => {
  await openExample(page, 'parcel-center');
  await page.getByTestId('view-both').click();
  const canvas = page.getByTestId('domain-canvas');
  await expect(canvas).toHaveAttribute('data-sprites', '0');

  await page.getByTestId('mode-simulate').click();
  await expect(page.getByTestId('simulation-panel')).toBeVisible();
  await page.getByTestId('sim-speed-60').click();
  await page.getByTestId('sim-play').click();
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-sprites')), { timeout: 15_000 })
    .toBeGreaterThan(2);
  await page.getByTestId('sim-play').click();

  // The panel of the domain view is locked while simulating, the view itself stays readable.
  await page.getByTestId('right-tab-domain').click();
  await expect(page.getByTestId('domain-remove')).toBeDisabled();
  await expect(page.getByTestId('domain-status')).toHaveText('0 problems');

  // Back to editing: the initial marking is drawn again.
  await page.getByTestId('mode-edit').click();
  await expect(canvas).toHaveAttribute('data-sprites', '0');
});

test('the JSON text can be edited and applied', async ({ page }) => {
  await openExample(page, 'parcel-center');
  await page.getByTestId('view-domain').click();
  const editor = page.getByTestId('domain-json');
  await expect(editor).toBeVisible();
  await expect(page.getByTestId('domain-apply')).toBeDisabled();

  // Text that is not JSON is marked and cannot be applied.
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText('x');
  await expect(page.getByTestId('domain-draft-status')).toHaveText('Not valid JSON');
  await expect(page.getByTestId('domain-apply')).toBeDisabled();
  await page.keyboard.press('Backspace');
  await expect(page.getByTestId('domain-apply')).toBeDisabled();
  await expect(page.getByTestId('domain-draft-status')).toHaveText('');

  // A change that breaks the schema (a field that describes behaviour) is marked and refused.
  const view = viewOf('parcel-center') as unknown as { meta: { viewName: string } };
  // The field comes first, so that its marker is in the part of the text that is on screen.
  const broken = { rate: 20, ...structuredClone(view) };
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(JSON.stringify(broken, null, 2));
  await expect(page.getByTestId('domain-draft-status')).toContainText('1 errors');
  await expect(page.getByTestId('domain-apply')).toBeDisabled();
  // The editor shows the end of the inserted text; the marker is at the top.
  await page.keyboard.press('Control+Home');
  await expect(page.locator('.cm-lintRange-error').first()).toBeVisible();

  // A valid change can be applied; the entries stay as they were, so nothing changes origin.
  const renamed = structuredClone(view);
  renamed.meta.viewName = 'Halle 2';
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(JSON.stringify(renamed, null, 2));
  await expect(page.getByTestId('domain-apply')).toBeEnabled();
  await page.getByTestId('domain-apply').click();
  await expect(page.getByLabel('View name')).toHaveValue('Halle 2');
  await expect(page.getByTestId('domain-status')).toHaveText('0 problems');
  await expect(page.getByTestId('origin-user')).toHaveText('30 user');

  // One undo step.
  await page.getByTestId('undo').click();
  await expect(page.getByLabel('View name')).toHaveValue('Halle');
});

test('keys 1, 2 and 3 switch the views and the divider can be dragged', async ({ page }) => {
  await openExample(page, 'smart-office');
  await page.keyboard.press('3');
  await expect(page.getByTestId('domain-canvas')).toBeVisible();
  const separator = page.getByRole('separator');
  await expect(separator).toBeVisible();
  const before = await page.getByTestId('domain-pane').boundingBox();
  const bar = await separator.boundingBox();
  if (!before || !bar) throw new Error('layout not visible');
  await page.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2);
  await page.mouse.down();
  await page.mouse.move(bar.x + bar.width / 2, bar.y - 150, { steps: 6 });
  await page.mouse.up();
  const after = await page.getByTestId('domain-pane').boundingBox();
  expect(after?.height ?? 0).toBeGreaterThan(before.height + 100);
  await page.keyboard.press('2');
  await expect(page.getByTestId('canvas')).toBeHidden();
  await page.keyboard.press('1');
  await expect(page.getByTestId('canvas')).toBeVisible();
  await expect(page.getByTestId('domain-canvas')).toHaveCount(0);
});

test('zoom and pan of the domain view', async ({ page }) => {
  await openExample(page, 'smart-office');
  await page.getByTestId('view-domain').click();
  const canvas = page.getByTestId('domain-canvas');
  await expect(canvas).toHaveAttribute('data-zoom', /\d/);
  const start = Number(await canvas.getAttribute('data-zoom'));
  await page.getByTestId('domain-zoom-in').click();
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-zoom')))
    .toBeGreaterThan(start);
  await page.getByTestId('domain-fit-view').click();
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-zoom')))
    .toBeCloseTo(start, 2);

  // Dragging pans the sheet.
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not visible');
  const panX = Number(await canvas.getAttribute('data-pan-x'));
  await page.mouse.move(box.x + 300, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 380, box.y + 100, { steps: 4 });
  await page.mouse.up();
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-pan-x')))
    .toBeCloseTo(panX + 80, 0);

  // Ctrl+wheel zooms around the pointer.
  const zoomBefore = Number(await canvas.getAttribute('data-zoom'));
  await page.mouse.move(box.x + 400, box.y + 300);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -200);
  await page.keyboard.up('Control');
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-zoom')))
    .toBeGreaterThan(zoomBefore);
  await page.getByTestId('domain-zoom-level').click();
  await expect(canvas).toHaveAttribute('data-zoom', '1');
});

test('dark theme: the domain view follows the theme', async ({ page }) => {
  await openExample(page, 'smart-office');
  await page.getByTestId('view-domain').click();
  const canvas = page.getByTestId('domain-canvas');
  const corner = async (): Promise<number[]> =>
    canvas.evaluate((element) => {
      const source = element as HTMLCanvasElement;
      const ctx = source.getContext('2d');
      return ctx ? [...ctx.getImageData(2, 2, 1, 1).data] : [];
    });
  await expect.poll(async () => (await corner())[0] ?? 0).toBeGreaterThan(200);
  await page.getByTestId('theme-toggle').click();
  await expect.poll(async () => (await corner())[0] ?? 255).toBeLessThan(60);
});
