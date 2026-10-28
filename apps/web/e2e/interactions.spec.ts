import { expect, test, type Locator, type Page } from '@playwright/test';

async function openApp(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
  await expect(page.getByTestId('empty-hint')).toBeVisible();
}

async function openExample(page: Page, id: string): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
  await page.getByTestId('menu-file').click();
  await page.getByTestId(`menu-item-example-${id}`).click();
  await expect(page.getByTestId('place-shape').first()).toBeVisible();
}

async function canvasBox(
  page: Page,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await page.getByTestId('canvas').boundingBox();
  if (!box) throw new Error('canvas not visible');
  return box;
}

/** Center of an element once it has stopped moving (a new node is measured a frame after it appears). */
async function center(locator: Locator): Promise<{ x: number; y: number }> {
  let last = '';
  for (let i = 0; i < 40; i++) {
    const box = await locator.boundingBox();
    if (!box) throw new Error('element not visible');
    const key = `${box.x},${box.y},${box.width}`;
    if (key === last) return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    last = key;
    await locator.page().waitForTimeout(40);
  }
  throw new Error('element keeps moving');
}

/** A point on an arc (in the middle of its path) and the unit normal of the path there, in screen pixels. */
async function pointOnArc(
  page: Page,
  index: number,
): Promise<{ x: number; y: number; nx: number; ny: number }> {
  return page.evaluate((i) => {
    const path = document.querySelectorAll<SVGPathElement>('.react-flow__edge path.arc-line')[i];
    if (!path) throw new Error('no arc');
    const length = path.getTotalLength();
    const at = (t: number): DOMPoint => {
      const p = path.getPointAtLength(t);
      return new DOMPoint(p.x, p.y).matrixTransform(path.getScreenCTM() as DOMMatrix);
    };
    const mid = at(length / 2);
    const before = at(length / 2 - 2);
    const after = at(length / 2 + 2);
    const dx = after.x - before.x;
    const dy = after.y - before.y;
    const norm = Math.hypot(dx, dy) || 1;
    return { x: mid.x, y: mid.y, nx: -dy / norm, ny: dx / norm };
  }, index);
}

async function zoomTo(page: Page, target: number): Promise<void> {
  const box = await canvasBox(page);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const level = async (): Promise<number> =>
    parseInt(await page.getByTestId('zoom-level').innerText(), 10) / 100;
  for (let i = 0; i < 30; i++) {
    const zoom = await level();
    if (Math.abs(zoom - target) / target < 0.05) return;
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, Math.max(-300, Math.min(300, Math.log(zoom / target) * 120)));
    await page.keyboard.up('Control');
    await page.waitForTimeout(80);
  }
}

/** An empty net with a place and a transition connected by one arc. */
async function drawOneArc(page: Page): Promise<void> {
  await openApp(page);
  const box = await canvasBox(page);
  await page.keyboard.press('p');
  await page.mouse.click(box.x + 300, box.y + 300);
  await page.keyboard.press('t');
  await page.mouse.click(box.x + 560, box.y + 300);
  await page.getByTestId('tool-arc').click();
  await page.getByTestId('place-shape').click();
  await page.getByTestId('transition-shape').click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('v');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('arc')).toHaveCount(1);
}

test('an arc is hit 6 px beside its line', async ({ page }) => {
  await drawOneArc(page);
  const { x, y, nx, ny } = await pointOnArc(page, 0);
  await page.mouse.click(x + nx * 6, y + ny * 6);
  await expect(page.getByTestId('properties-panel')).toContainText('Arc');
  await expect(page.locator('.react-flow__edge.selected')).toHaveCount(1);
  // The same distance on the other side works too, and a click far away selects nothing.
  await page.keyboard.press('Escape');
  await expect(page.locator('.react-flow__edge.selected')).toHaveCount(0);
  await page.mouse.click(x - nx * 6, y - ny * 6);
  await expect(page.locator('.react-flow__edge.selected')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await page.mouse.click(x + nx * 40, y + ny * 40);
  await expect(page.locator('.react-flow__edge.selected')).toHaveCount(0);
});

test('hovering an arc highlights it', async ({ page }) => {
  await drawOneArc(page);
  const { x, y } = await pointOnArc(page, 0);
  await page.mouse.move(x, y);
  await expect(page.locator('.pn-arc[data-hover="true"]')).toHaveCount(1);
  await expect(page.locator('.pn-arc[data-hover="true"] path.arc-line')).toHaveCSS(
    'stroke-width',
    '2.5px',
  );
});

test('double click renames a place; F2 renames a transition; Esc discards', async ({ page }) => {
  await openApp(page);
  const box = await canvasBox(page);
  await page.keyboard.press('p');
  await page.mouse.click(box.x + 300, box.y + 300);
  await page.keyboard.press('t');
  await page.mouse.click(box.x + 520, box.y + 300);
  await page.keyboard.press('Escape');

  await page.getByTestId('place-shape').dblclick();
  await expect(page.getByTestId('rename-input')).toBeFocused();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('Buffer');
  await page.keyboard.press('Enter');
  await expect(page.locator('.react-flow__node-place')).toContainText('Buffer');

  await page.getByTestId('transition-shape').click();
  await page.keyboard.press('F2');
  await expect(page.getByTestId('rename-input')).toBeFocused();
  await page.keyboard.type('discarded');
  await page.keyboard.press('Escape');
  await expect(page.locator('.react-flow__node-transition')).toContainText('T1');

  // Undo takes the rename back in one step.
  await page.getByTestId('place-shape').click();
  await page.keyboard.press('Control+z');
  await expect(page.locator('.react-flow__node-place')).toContainText('P1');
});

test('double click on an arc edits its weight; in a JSON net its inscription', async ({ page }) => {
  await openApp(page);
  const box = await canvasBox(page);
  await page.keyboard.press('p');
  await page.mouse.click(box.x + 300, box.y + 300);
  await page.keyboard.press('t');
  await page.mouse.click(box.x + 520, box.y + 300);
  await page.getByTestId('tool-arc').click();
  await page.getByTestId('place-shape').click();
  await page.getByTestId('transition-shape').click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('v');
  await expect(page.getByTestId('arc')).toHaveCount(1);

  const { x, y } = await pointOnArc(page, 0);
  await page.mouse.dblclick(x, y);
  const input = page.getByTestId('arc-weight-input');
  await expect(input).toBeFocused();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('3');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('arc-weight')).toHaveText('3');

  await page.keyboard.press('Escape'); // nothing selected: the net properties show
  await page.getByTestId('profile-json').click();
  const label = page.getByTestId('arc-weight');
  await label.dblclick();
  const editor = page.locator('.cm-content[data-testid="arc-inscription-input"]');
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.type('$x');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('arc-inscription')).toHaveText('$x');
});

test('the context menu deletes a place and adds nodes on the canvas', async ({ page }) => {
  await openApp(page);
  const box = await canvasBox(page);
  await page.mouse.click(box.x + 200, box.y + 200, { button: 'right' });
  await page.getByTestId('menu-add-place').click();
  await expect(page.getByTestId('place-shape')).toHaveCount(1);
  await expect(page.getByTestId('rename-input')).toBeFocused();
  await page.keyboard.type('Here');
  await page.keyboard.press('Enter');
  await expect(page.locator('.react-flow__node-place')).toContainText('Here');

  await page.mouse.click(box.x + 400, box.y + 300, { button: 'right' });
  await page.getByTestId('menu-add-transition').click();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('transition-shape')).toHaveCount(1);

  await page.getByTestId('place-shape').click({ button: 'right' });
  await expect(page.getByTestId('context-menu')).toBeVisible();
  await page.getByTestId('menu-delete').click();
  await expect(page.getByTestId('place-shape')).toHaveCount(0);
  await expect(page.getByTestId('transition-shape')).toHaveCount(1);
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('place-shape')).toHaveCount(1);
});

test('the context menu of an arc reverses it', async ({ page }) => {
  await openExample(page, 'traffic-light');
  const labels = async (): Promise<string[]> =>
    page
      .locator('.react-flow__edge')
      .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''));
  const before = await labels();
  const { x, y } = await pointOnArc(page, 0);
  await page.mouse.click(x, y, { button: 'right' });
  await page.getByTestId('menu-reverse').click();
  const after = await labels();
  expect(after).toHaveLength(before.length);
  expect(after.filter((label, i) => label !== before[i])).toHaveLength(1);
  await page.keyboard.press('Control+z');
  expect(await labels()).toEqual(before);
});

test('an arc is dragged from the ring of a node and ends on any part of the other node', async ({
  page,
}) => {
  await openApp(page);
  const box = await canvasBox(page);
  await page.keyboard.press('p');
  await page.mouse.click(box.x + 300, box.y + 300);
  await page.keyboard.press('t');
  await page.mouse.click(box.x + 520, box.y + 300);
  await page.keyboard.press('Escape');

  const place = await page.getByTestId('place-shape').boundingBox();
  const transition = await center(page.getByTestId('transition-shape'));
  if (!place) throw new Error('place not visible');
  // The ring is the band just outside the outline.
  await page.mouse.move(place.x + place.width + 3, place.y + place.height / 2);
  await page.mouse.down();
  await page.mouse.move(place.x + place.width + 60, place.y + place.height / 2, { steps: 5 });
  await page.mouse.move(transition.x, transition.y, { steps: 8 });
  await expect(page.getByTestId('connection-line')).toHaveAttribute('data-invalid', 'false');
  await page.mouse.up();
  await expect(page.getByTestId('arc')).toHaveCount(1);
  // The place did not move: dragging the ring is not dragging the node.
  const after = await page.getByTestId('place-shape').boundingBox();
  expect(after?.x).toBeCloseTo(place.x, 0);
});

test('dragging the inside of a node moves it instead of drawing an arc', async ({ page }) => {
  await openApp(page);
  const box = await canvasBox(page);
  await page.keyboard.press('p');
  await page.mouse.click(box.x + 300, box.y + 300);
  const start = await center(page.getByTestId('place-shape'));
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 100, start.y + 40, { steps: 6 });
  await page.mouse.up();
  const end = await center(page.getByTestId('place-shape'));
  expect(end.x - start.x).toBeGreaterThan(60);
  await expect(page.getByTestId('arc')).toHaveCount(0);
});

test('Alt+drag from the middle of a node draws an arc; a drop on the same kind is refused', async ({
  page,
}) => {
  await openApp(page);
  const box = await canvasBox(page);
  await page.keyboard.press('p');
  await page.mouse.click(box.x + 300, box.y + 300);
  await page.keyboard.press('p');
  await page.mouse.click(box.x + 500, box.y + 300);
  await page.keyboard.press('t');
  await page.mouse.click(box.x + 400, box.y + 450);
  await page.keyboard.press('Escape');

  const first = await center(page.getByTestId('place-shape').first());
  const second = await center(page.getByTestId('place-shape').nth(1));
  const transition = await center(page.getByTestId('transition-shape'));

  await page.keyboard.down('Alt');
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  await page.mouse.move(second.x - 20, second.y, { steps: 6 });
  await page.mouse.move(second.x, second.y, { steps: 3 });
  // A place cannot be connected to a place: the target is marked and nothing is created.
  await expect(page.locator('.pn-node[data-drop="invalid"]')).toHaveCount(1);
  await expect(page.getByTestId('connection-line')).toHaveAttribute('data-invalid', 'true');
  await page.mouse.up();
  await expect(page.getByTestId('arc')).toHaveCount(0);

  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  await page.mouse.move(transition.x, transition.y, { steps: 8 });
  await expect(page.locator('.pn-node[data-drop="valid"]')).toHaveCount(1);
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await expect(page.getByTestId('arc')).toHaveCount(1);
});

test('a net of five nodes is built with the keyboard alone', async ({ page }) => {
  await openApp(page);
  await page.keyboard.press('p');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('rename-input')).toBeFocused();
  await page.keyboard.type('Ready');
  for (const name of ['start', 'Running', 'stop']) {
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('rename-input')).toBeFocused();
    await page.keyboard.type(name);
  }
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('rename-input')).toBeFocused();
  await page.keyboard.type('Done');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('rename-input')).toHaveCount(0);

  await expect(page.getByTestId('place-shape')).toHaveCount(3);
  await expect(page.getByTestId('transition-shape')).toHaveCount(2);
  await expect(page.getByTestId('arc')).toHaveCount(4);
  const names = await page.getByTestId('node-name').allInnerTexts();
  expect(names.sort()).toEqual(['Done', 'Ready', 'Running', 'start', 'stop']);
  await expect(page.getByTestId('status-diagnostics')).toContainText('No problems');

  // Shift+Tab adds a predecessor; one undo per node takes everything back.
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.type('before');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('rename-input')).toHaveCount(0);
  await expect(page.getByTestId('transition-shape')).toHaveCount(3);
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('transition-shape')).toHaveCount(2);
  for (let i = 0; i < 5; i++) await page.keyboard.press('Control+z');
  await expect(page.locator('.react-flow__node')).toHaveCount(0);
});

test('Tab chains three nodes from the mouse as well', async ({ page }) => {
  await openApp(page);
  const box = await canvasBox(page);
  await page.keyboard.press('p');
  await page.mouse.click(box.x + 200, box.y + 300);
  await page.keyboard.press('Tab');
  await page.keyboard.type('go');
  await page.keyboard.press('Tab');
  // Typing right away is safe: letters never act as tool shortcuts while a name is awaited.
  await page.keyboard.type('Next');
  await page.keyboard.press('Enter');
  await expect(page.locator('.react-flow__node')).toHaveCount(3);
  await expect(page.getByTestId('arc')).toHaveCount(2);
  await expect(page.getByTestId('prop-name')).toHaveValue('Next');
});

test('a sticky tool stays active until Escape', async ({ page }) => {
  await openApp(page);
  const box = await canvasBox(page);
  await page.getByTestId('tool-place').dblclick();
  await expect(page.getByTestId('tool-sticky-place')).toBeVisible();
  for (let i = 0; i < 3; i++) await page.mouse.click(box.x + 200 + i * 150, box.y + 300);
  await expect(page.getByTestId('place-shape')).toHaveCount(3);
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-tool', 'place');
  await expect(page.getByTestId('tool-hint')).toContainText('Esc or V');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-tool', 'select');
  await expect(page.getByTestId('tool-sticky-place')).toHaveCount(0);
  await expect(page.getByTestId('tool-hint')).toHaveCount(0);
});

test('tooltips show the name and the shortcut after a short delay', async ({ page }) => {
  await openApp(page);
  const hover = async (testId: string): Promise<void> => {
    // Leave the previous control first, so that the next tooltip starts from a closed state.
    const away = await canvasBox(page);
    await page.mouse.move(away.x + 400, away.y + 400, { steps: 4 });
    await expect(page.getByTestId('tooltip')).toHaveCount(0);
    const { x, y } = await center(page.getByTestId(testId));
    await page.mouse.move(x, y, { steps: 10 });
  };
  await hover('tool-transition');
  const tip = page.getByTestId('tooltip');
  await expect(tip).toBeVisible();
  await expect(tip).toContainText('Transition');
  await expect(tip).toContainText('T');
  await hover('help');
  await expect(page.getByTestId('tooltip')).toContainText('Keyboard shortcuts');
  await expect(page.getByTestId('tooltip')).toContainText('?');
  await hover('theme-toggle');
  await expect(page.getByTestId('tooltip')).toContainText('dark theme');
});

test('zooming out hides details, then names; the hover card still shows everything', async ({
  page,
}) => {
  await openExample(page, 'order-processing');
  const canvas = page.getByTestId('canvas');
  const guard = page.getByTestId('guard-label').first();
  await expect(canvas).toHaveAttribute('data-zoom-level', 'detail');
  await expect(guard).toHaveCSS('opacity', '1');

  await zoomTo(page, 0.55);
  await expect(canvas).toHaveAttribute('data-zoom-level', 'mid');
  await expect(page.locator('.react-flow.zoom-mid')).toHaveCount(1);
  await expect(guard).toHaveCSS('opacity', '0');
  await expect(page.getByTestId('node-name').first()).toHaveCSS('opacity', '1');

  await zoomTo(page, 0.3);
  await expect(canvas).toHaveAttribute('data-zoom-level', 'far');
  await expect(page.getByTestId('node-name').first()).toHaveCSS('opacity', '0');
  await expect(page.getByTestId('place-shape').first()).toBeVisible();

  // The card with all details appears after a short pause on a node, independent of the zoom.
  const place = page.locator('.react-flow__node-place').filter({ hasText: 'Approved' });
  const point = await center(place.getByTestId('place-shape'));
  await page.mouse.move(point.x, point.y, { steps: 3 });
  const card = page.getByTestId('hover-card');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Approved orders');
  await expect(page.getByTestId('hover-tokens').locator('li')).toHaveCount(2);
});

test('the wheel pans, Ctrl+wheel zooms, a click on the percentage resets, double click fits', async ({
  page,
}) => {
  await openExample(page, 'traffic-light');
  const box = await canvasBox(page);
  const first = page.locator('.react-flow__node-place').first();
  const zoomLabel = page.getByTestId('zoom-level');
  const before = await first.boundingBox();
  const zoom = await zoomLabel.innerText();

  await page.mouse.move(box.x + 400, box.y + 300);
  await page.mouse.wheel(0, 120);
  await expect.poll(async () => (await first.boundingBox())?.y).toBeLessThan((before?.y ?? 0) - 40);
  await expect(zoomLabel).toHaveText(zoom);

  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -200);
  await page.keyboard.up('Control');
  await expect(zoomLabel).not.toHaveText(zoom);

  await zoomLabel.click();
  await expect(zoomLabel).toHaveText('100%');
  await page.getByTestId('fit-view').click();
  await expect(zoomLabel).not.toHaveText('100%');
  await page.keyboard.press('Control+0');
  await expect(zoomLabel).toHaveText('100%');

  // Double click on the empty canvas fits the view.
  await page.mouse.dblclick(box.x + box.width - 60, box.y + 60);
  await expect(zoomLabel).not.toHaveText('100%');
});

test('the net is refitted when the window changes size, unless the user zoomed', async ({
  page,
}) => {
  await openExample(page, 'producer-consumer');
  const canvas = page.getByTestId('canvas');
  const offset = async (): Promise<number> => {
    const box = await canvasBox(page);
    const node = await center(page.locator('.react-flow__node-transition').first());
    return node.x - (box.x + box.width / 2);
  };
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.waitForTimeout(700);
  const small = await canvas.boundingBox();
  expect(small?.width ?? 0).toBeLessThan(800);
  const refit = await offset();
  await page.setViewportSize({ width: 1500, height: 800 });
  await page.waitForTimeout(700);
  const wide = await canvasBox(page);
  // After a refit the net is centered again: the first transition lies left of the middle.
  expect(Math.abs((await offset()) - refit)).toBeLessThan(wide.width / 2);
  const zoomAfterRefit = await page.getByTestId('zoom-level').innerText();

  // After a manual zoom the zoom is kept.
  await page.keyboard.press('Control+0');
  await expect(page.getByTestId('zoom-level')).toHaveText('100%');
  await page.setViewportSize({ width: 1100, height: 700 });
  await page.waitForTimeout(700);
  await expect(page.getByTestId('zoom-level')).toHaveText('100%');
  expect(zoomAfterRefit).not.toBe('100%');
});

test('toasts: saving shows one that is replaced by the next, opening an example shows none', async ({
  page,
}) => {
  await openApp(page);
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-item-example-traffic-light').click();
  await expect(page.getByTestId('place-shape').first()).toBeVisible();
  await expect(page.getByTestId('toast-success')).toHaveCount(0);
  await expect(page.getByTestId('toast-info')).toHaveCount(0);

  const downloads = page.waitForEvent('download');
  await page.keyboard.press('Control+s');
  await downloads;
  const toast = page.getByTestId('toast-success');
  await expect(toast).toContainText('Saved');
  const box = await toast.boundingBox();
  const viewport = page.viewportSize();
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeGreaterThan((viewport?.width ?? 0) - 40);
  await page.keyboard.press('Control+Shift+e');
  await expect(page.getByTestId('toast-success')).toHaveCount(1);
  await expect(page.getByTestId('toast-success')).toContainText('.svg');
  // Gone after about 2.5 s.
  await expect(page.getByTestId('toast-success')).toHaveCount(0, { timeout: 5000 });
});

test('deleting five or more elements asks first; the trash icon is in the panel heading', async ({
  page,
}) => {
  await openExample(page, 'producer-consumer');
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('elements?');
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(page.locator('.react-flow__node')).not.toHaveCount(0);

  // One element: the icon in the heading deletes it at once.
  await page.getByTestId('place-shape').first().click();
  const count = await page.getByTestId('place-shape').count();
  await page.getByTestId('delete-selection').click();
  await expect(page.getByTestId('place-shape')).toHaveCount(count - 1);
});

test('the status bar explains the active tool', async ({ page }) => {
  await openApp(page);
  await expect(page.getByTestId('tool-hint')).toHaveCount(0);
  await page.keyboard.press('a');
  await expect(page.getByTestId('tool-hint')).toContainText('source node');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('tool-hint')).toHaveCount(0);
});
