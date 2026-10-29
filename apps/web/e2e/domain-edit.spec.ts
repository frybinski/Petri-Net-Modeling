import { readFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';

type Point = [number, number];

interface Handle {
  kind: string;
  index: number | null;
  at: Point;
}

async function openExample(page: Page, id: string): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
  await page.getByTestId('menu-file').click();
  await page.getByTestId(`menu-item-example-${id}`).click();
  await expect(page.getByTestId('place-shape').first()).toBeVisible();
}

/** Opens the example in the domain view in the mode "Edit layout". */
async function openEditor(page: Page, id = 'parcel-center'): Promise<Locator> {
  await openExample(page, id);
  await page.getByTestId('view-domain').click();
  await page.getByTestId('domain-mode-edit').click();
  const canvas = page.getByTestId('domain-canvas');
  await expect(canvas).toHaveAttribute('data-editing', 'true');
  await expect(canvas).toHaveAttribute('data-zoom', /\d/);
  return canvas;
}

async function sheetToScreen(canvas: Locator, [x, y]: Point): Promise<Point> {
  const box = await canvas.boundingBox();
  if (!box) throw new Error('domain canvas not visible');
  const zoom = Number(await canvas.getAttribute('data-zoom'));
  const panX = Number(await canvas.getAttribute('data-pan-x'));
  const panY = Number(await canvas.getAttribute('data-pan-y'));
  return [box.x + panX + x * zoom, box.y + panY + y * zoom];
}

/** The handles the canvas draws, in sheet pixels. */
async function handles(canvas: Locator): Promise<Handle[]> {
  const text = (await canvas.getAttribute('data-handles')) ?? '';
  return text
    .split(';')
    .filter(Boolean)
    .map((part) => {
      const [name = '', at = ''] = part.split('@');
      const [kind = '', index] = name.split(':');
      const [x = 0, y = 0] = at.split(',').map(Number);
      return { kind, index: index === undefined ? null : Number(index), at: [x, y] };
    });
}

async function handle(canvas: Locator, kind: string, index: number | null = null): Promise<Handle> {
  await expect.poll(async () => (await handles(canvas)).length).toBeGreaterThan(0);
  const found = (await handles(canvas)).find((h) => h.kind === kind && h.index === index);
  if (!found) throw new Error(`no handle ${kind}:${index}`);
  return found;
}

/** The entry of the selection, as shown in the panel. */
async function entry(page: Page): Promise<Record<string, unknown>> {
  const text = await page.getByTestId('domain-entry').textContent();
  return JSON.parse(text ?? '{}') as Record<string, unknown>;
}

async function select(page: Page, canvas: Locator, at: Point): Promise<void> {
  const [x, y] = await sheetToScreen(canvas, at);
  await page.mouse.click(x, y);
}

async function drag(page: Page, canvas: Locator, from: Point, to: Point, steps = 8): Promise<void> {
  const [x1, y1] = await sheetToScreen(canvas, from);
  const [x2, y2] = await sheetToScreen(canvas, to);
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps });
  await page.mouse.up();
}

test('drag a station: preview follows, one undo step, provenance user', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const canvas = await openEditor(page);
  // The generic view of the net is not involved: this one is the hand-made parcel center.
  await select(page, canvas, [540, 280]);
  await expect(page.getByTestId('domain-entry')).toContainText('"kind": "machine"');
  const before = await entry(page);
  expect(before['box']).toEqual([520, 262, 100, 116]);

  // Press, move: the numbers next to the pointer show the preview and the document is untouched.
  const [x1, y1] = await sheetToScreen(canvas, [540, 280]);
  const [x2, y2] = await sheetToScreen(canvas, [640, 330]);
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: 6 });
  await expect(page.getByTestId('domain-readout')).toBeVisible();
  expect((await entry(page))['box']).toEqual([520, 262, 100, 116]);
  await page.mouse.up();
  await expect(page.getByTestId('domain-readout')).toHaveCount(0);

  const after = await entry(page);
  const box = after['box'] as number[];
  expect(box[2]).toBe(100);
  // Snapped to the 8 px grid.
  expect(box[0]! % 8).toBe(0);
  expect(box[1]! % 8).toBe(0);
  expect(Math.abs(box[0]! - 620)).toBeLessThanOrEqual(12);
  expect(Math.abs(box[1]! - 312)).toBeLessThanOrEqual(12);
  // The slot moved with the card and the net did not change.
  const slot = (after['slots'] as number[][])[0]!;
  expect(slot[0]).toBe(box[0]! + 50);
  await expect(page.getByTestId('origin-user')).toHaveText('30 user');
  await expect(page.getByTestId('domain-status')).toHaveText('0 problems');

  // One undo brings the card back.
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await entry(page))['box']).toEqual([520, 262, 100, 116]);
  expect(errors).toEqual([]);
});

test('Alt drags without the grid and Escape cancels a drag', async ({ page }) => {
  const canvas = await openEditor(page);
  await select(page, canvas, [540, 280]);
  const [x1, y1] = await sheetToScreen(canvas, [540, 280]);
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x1 + 37, y1 + 13, { steps: 5 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect((await entry(page))['box']).toEqual([520, 262, 100, 116]);
  await expect(page.getByTestId('domain-readout')).toHaveCount(0);

  await page.keyboard.down('Alt');
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x1 + 37, y1 + 13, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  const box = (await entry(page))['box'] as number[];
  // Whole pixels, but not on the grid.
  expect(box.every(Number.isInteger)).toBe(true);
  expect(box[0]! % 8 !== 0 || box[1]! % 8 !== 0).toBe(true);
});

test('resize with a corner handle keeps the slot inside and the minimum size', async ({ page }) => {
  const canvas = await openEditor(page);
  await select(page, canvas, [540, 280]);
  const se = await handle(canvas, 'resize-se');
  expect(se.at).toEqual([620, 378]);
  await drag(page, canvas, se.at, [700, 440]);
  const grown = await entry(page);
  const [x, y, w, h] = grown['box'] as number[];
  expect(x).toBe(520);
  expect(y).toBe(262);
  expect(w!).toBeGreaterThan(150);
  expect(h!).toBeGreaterThan(150);
  const slot = (grown['slots'] as number[][])[0]!;
  expect(slot[0]).toBeGreaterThanOrEqual(x!);
  expect(slot[0]).toBeLessThanOrEqual(x! + w!);

  // Shrinking far stops at the minimum size.
  const nw = await handle(canvas, 'resize-nw');
  await drag(page, canvas, nw.at, [x! + w! + 100, y! + h! + 100]);
  const small = (await entry(page))['box'] as number[];
  expect(small[2]).toBe(24);
  expect(small[3]).toBe(24);
  await expect(page.getByTestId('domain-status')).toHaveText('0 problems');
});

test('insert a point into a belt by its segment handle, drag it, remove it by double click', async ({
  page,
}) => {
  const canvas = await openEditor(page);
  // The belt in front of the scanner.
  await select(page, canvas, [150, 320]);
  await expect(page.getByTestId('domain-entry')).toContainText('"conveyor"');
  expect(((await entry(page))['path'] as number[][]).length).toBe(2);
  const segment = await handle(canvas, 'segment', 0);
  await drag(page, canvas, segment.at, [segment.at[0], segment.at[1] + 80]);
  const bent = (await entry(page))['path'] as number[][];
  expect(bent).toHaveLength(3);
  expect(bent[1]![1]).toBeGreaterThan(380);

  // Double click on the new point removes it again.
  const point = await handle(canvas, 'point', 1);
  const [px, py] = await sheetToScreen(canvas, point.at);
  await page.mouse.dblclick(px, py);
  await expect.poll(async () => ((await entry(page))['path'] as number[][]).length).toBe(2);

  // A click on a segment handle without moving adds a point in the middle.
  const middle = await handle(canvas, 'segment', 0);
  const [mx, my] = await sheetToScreen(canvas, middle.at);
  await page.mouse.click(mx, my);
  await expect.poll(async () => ((await entry(page))['path'] as number[][]).length).toBe(3);
  await expect(page.getByTestId('domain-status')).toHaveText('0 problems');
});

test('move a slot inside its station', async ({ page }) => {
  const canvas = await openEditor(page);
  await select(page, canvas, [304, 270]);
  await expect(page.getByTestId('domain-entry')).toContainText('"station"');
  const slot = await handle(canvas, 'slot', 0);
  expect(slot.at).toEqual([304, 304]);
  // Dragged far outside: the slot stops at the border of the card.
  await drag(page, canvas, slot.at, [500, 600]);
  const slots = (await entry(page))['slots'] as number[][];
  const box = (await entry(page))['box'] as number[];
  expect(slots[0]![0]).toBeLessThanOrEqual(box[0]! + box[2]!);
  expect(slots[0]![1]).toBeLessThanOrEqual(box[1]! + box[3]!);
  expect(slots[0]).not.toEqual([304, 304]);
  expect(slots[1]).toEqual([304, 352]);
  await expect(page.getByTestId('domain-status')).toHaveText('0 problems');
});

test('change the kind of an entry from the context menu (station to machine)', async ({ page }) => {
  const canvas = await openEditor(page);
  const [x, y] = await sheetToScreen(canvas, [270, 270]);
  await page.mouse.click(x, y, { button: 'right' });
  await expect(page.getByTestId('context-menu')).toBeVisible();
  await page.getByText('Change kind').click();
  await page.getByTestId('domain-menu-kind-machine').click();
  await expect(page.getByTestId('domain-entry')).toContainText('"kind": "machine"');
  await expect(page.getByTestId('domain-field-kind')).toHaveValue('machine');
  await expect(page.getByTestId('domain-status')).toHaveText('0 problems');
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('domain-entry')).toContainText('"kind": "station"');
});

test('Delete hides the entry in the view, the net keeps the element; Show brings it back', async ({
  page,
}) => {
  const canvas = await openEditor(page);
  await select(page, canvas, [540, 280]);
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('domain-entry')).toContainText('"kind": "hidden"');
  await expect(page.getByTestId('domain-entry')).toContainText('hidden by user');
  await expect(page.getByTestId('toast-info')).toContainText('stays in the net');
  // The net editor still has the transition.
  await page.getByTestId('view-both').click();
  await expect(
    page.locator('.react-flow__node-transition').filter({ hasText: 'Sortieren' }),
  ).toHaveCount(1);
  await page.getByTestId('view-domain').click();
  // A dashed placeholder stands where a generic view would draw it; the context menu shows it.
  await expect(canvas).toHaveAttribute('data-placeholders', /^t_sort@/);
  const [px, py, pw, ph] = ((await canvas.getAttribute('data-placeholders')) ?? '')
    .split('@')[1]!
    .split(',')
    .map(Number) as [number, number, number, number];
  const [x, y] = await sheetToScreen(canvas, [px + pw / 2, py + ph / 2]);
  await page.mouse.click(x, y, { button: 'right' });
  await page.getByTestId('domain-menu-show').click();
  await expect(page.getByTestId('domain-entry')).not.toContainText('hidden');
  await expect(page.getByTestId('domain-status')).toHaveText('0 problems');
});

test('add decor from the menu of the empty sheet, delete it, undo restores everything', async ({
  page,
}) => {
  const canvas = await openEditor(page);
  const [x, y] = await sheetToScreen(canvas, [560, 520]);
  await page.mouse.click(x, y, { button: 'right' });
  await page.getByTestId('domain-menu-add-room').click();
  await expect(page.getByTestId('domain-entry-ref')).toContainText('decor[');
  await expect(page.getByTestId('domain-entry')).toContainText('"kind": "room"');
  // Decor can be moved like everything else.
  const move = await handle(canvas, 'resize-se');
  expect(move.at[0]).toBeGreaterThan(560);
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('domain-entry-ref')).toHaveCount(0);
  // Undo twice: the room is back, then gone.
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('domain-entry-ref')).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('domain-status')).toHaveText('0 problems');
});

test('arrow keys nudge the selection by 1 px, Shift by 8 px', async ({ page }) => {
  const canvas = await openEditor(page);
  await select(page, canvas, [540, 280]);
  await page.keyboard.press('ArrowRight');
  expect(((await entry(page))['box'] as number[])[0]).toBe(521);
  await page.keyboard.press('Shift+ArrowDown');
  expect(((await entry(page))['box'] as number[])[1]).toBe(270);
  await page.keyboard.press('ArrowLeft');
  expect(((await entry(page))['box'] as number[])[0]).toBe(520);
});

test('double click edits the label in place', async ({ page }) => {
  const canvas = await openEditor(page);
  const [x, y] = await sheetToScreen(canvas, [540, 280]);
  await page.mouse.dblclick(x, y);
  const input = page.getByTestId('domain-label-input');
  await expect(input).toBeVisible();
  await expect(input).toHaveValue('Sortierer');
  await input.fill('Hochleistungssortierer');
  await input.press('Enter');
  await expect(input).toHaveCount(0);
  expect((await entry(page))['label']).toBe('Hochleistungssortierer');
  // Escape drops what was typed.
  await page.mouse.dblclick(x, y);
  await page.getByTestId('domain-label-input').fill('Nope');
  await page.getByTestId('domain-label-input').press('Escape');
  expect((await entry(page))['label']).toBe('Hochleistungssortierer');
});

test('the panel fields move the same entry and the origin becomes user', async ({ page }) => {
  await openExample(page, 'complaint-handling');
  await page.getByTestId('view-domain').click();
  await page.getByTestId('domain-generate').click();
  await page.getByTestId('domain-mode-edit').click();
  const canvas = page.getByTestId('domain-canvas');
  await expect(canvas).toHaveAttribute('data-editing', 'true');
  await expect(page.getByTestId('origin-user')).toHaveText('0 user');
  await page.getByTestId('view-both').click();
  await page.locator('.react-flow__node-transition').first().click();
  await expect(page.getByTestId('domain-field-label')).toBeVisible();
  await page.getByTestId('domain-field-label').fill('Prüfen');
  await page.getByTestId('domain-field-label').press('Enter');
  await expect(page.getByTestId('origin-user')).toHaveText('1 user');
  await expect(page.getByTestId('domain-entry')).toContainText('Prüfen');
});

test('A7: a new place makes the view out of date; Fill adds only its entry', async ({ page }) => {
  await openExample(page, 'parcel-center');
  await page.getByTestId('view-both').click();
  await expect(page.getByTestId('domain-status')).toHaveText('0 problems');
  await expect(page.getByTestId('domain-stale-card')).toHaveCount(0);

  // The JSON of the view before the change.
  const jsonBefore = await viewJson(page);

  // Add a place and connect it to an existing transition.
  const edgesBefore = await page.locator('.react-flow__edge').count();
  await page.getByTestId('tool-place').click();
  const net = await page.getByTestId('canvas').boundingBox();
  if (!net) throw new Error('net canvas not visible');
  await page.mouse.click(net.x + 160, net.y + net.height - 70);
  await page.getByTestId('tool-arc').click();
  const sorter = page.locator('.react-flow__node-transition').filter({ hasText: 'Sortieren' });
  await sorter.getByTestId('transition-shape').click();
  await page.locator('.react-flow__node-place').last().getByTestId('place-shape').click();
  await expect(page.locator('.react-flow__edge')).toHaveCount(edgesBefore + 1);

  // V3 names exactly the new place, V7 says the view is out of date.
  const rules = page.getByTestId('domain-diagnostic');
  await expect(page.getByTestId('domain-stale-card')).toBeVisible();
  await expect(page.getByTestId('domain-status')).toContainText('error');
  const list = await rules.evaluateAll((rows) =>
    rows.map((row) => `${row.getAttribute('data-rule')}`),
  );
  expect(list.filter((rule) => rule === 'V3')).toHaveLength(1);
  expect(list).toContain('V7');
  await expect(page.getByTestId('domain-hash-status')).toHaveAttribute('data-stale', 'true');
  await expect(page.getByTestId('domain-stale-list')).toContainText('1 element without an entry');

  // Fill missing entries: one new place entry (generic), everything else unchanged.
  await page.getByTestId('stale-fill').click();
  const jsonAfter = await viewJson(page);
  const created = Object.keys(jsonAfter.places).filter((id) => !(id in jsonBefore.places));
  expect(created).toHaveLength(1);
  const key = created[0]!;
  expect(jsonAfter.provenance[`places.${key}`]?.source).toBe('generic');
  for (const id of Object.keys(jsonBefore.places)) {
    expect(jsonAfter.places[id]).toEqual(jsonBefore.places[id]);
  }
  expect(jsonAfter.transitions).toEqual(jsonBefore.transitions);
  expect(jsonAfter.decor).toEqual(jsonBefore.decor);
  expect(jsonAfter.meta).toEqual(jsonBefore.meta);
  for (const [name, value] of Object.entries(jsonBefore.arcs)) {
    expect(jsonAfter.arcs[name]).toEqual(value);
  }
  for (const [name, value] of Object.entries(jsonBefore.provenance)) {
    expect(jsonAfter.provenance[name]).toEqual(value);
  }
  // Only the new arc(s) next to the new place were added; all of them generic.
  for (const name of Object.keys(jsonAfter.arcs).filter((n) => !(n in jsonBefore.arcs))) {
    expect(name).toContain(key);
    expect(jsonAfter.provenance[`arcs.${name}`]?.source).toBe('generic');
  }
  await expect(page.getByTestId('domain-status')).toContainText('1 warning');
  await expect(page.getByTestId('domain-hash-status')).toHaveAttribute('data-stale', 'true');

  // Update hash accepts the new structure.
  await page.getByTestId('stale-update-hash').click();
  await expect(page.getByTestId('domain-status')).toHaveText('0 problems');
  await expect(page.getByTestId('domain-stale-card')).toHaveCount(0);
});

interface ViewJson {
  meta: unknown;
  places: Record<string, unknown>;
  transitions: Record<string, unknown>;
  arcs: Record<string, unknown>;
  decor: unknown;
  provenance: Record<string, { source: string }>;
}

/** The domain view of the document, read from the file that File > Save writes. */
async function viewJson(page: Page): Promise<ViewJson> {
  await page.getByTestId('menu-file').click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('menu-item-save').click();
  const download = await downloadPromise;
  const path = await download.path();
  const saved = JSON.parse(await readFile(path, 'utf8')) as { domainView: ViewJson };
  return saved.domainView;
}
