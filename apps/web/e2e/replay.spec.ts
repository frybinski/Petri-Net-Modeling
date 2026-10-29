import { readFile, writeFile } from 'node:fs/promises';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

async function openExample(page: Page, id: string): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
  await page.getByTestId('menu-file').click();
  await page.getByTestId(`menu-item-example-${id}`).click();
  await expect(page.getByTestId('place-shape').first()).toBeVisible();
}

async function clockSeconds(page: Page): Promise<number> {
  const text = (await page.getByTestId('sim-clock').textContent()) ?? '';
  const [h = 0, m = 0, s = 0] = text.split(':').map(Number);
  return h * 3600 + m * 60 + s;
}

/**
 * Simulates the parcel center for half an hour at full speed, exports the event log from the
 * trace tab and returns its path. The page is left in edit mode.
 */
async function exportParcelLog(page: Page, testInfo: TestInfo): Promise<string> {
  await openExample(page, 'parcel-center');
  await page.getByTestId('mode-simulate').click();
  await page.getByTestId('sim-speed-max').click();
  await page.getByTestId('sim-play').click();
  await expect.poll(() => clockSeconds(page)).toBeGreaterThan(1800);
  await page.getByTestId('sim-play').click();
  await expect(page.getByTestId('sim-status')).toHaveText('Paused');
  await page.getByTestId('sim-tab-trace').click();
  const download = page.waitForEvent('download');
  await page.getByTestId('export-csv').click();
  const path = testInfo.outputPath('Paketzentrum-events.csv');
  await (await download).saveAs(path);
  await page.getByTestId('mode-edit').click();
  await expect(page.getByTestId('simulation-panel')).toHaveCount(0);
  return path;
}

/** Hands a log file to the page the way File > Replay event log does. */
async function chooseLog(page: Page, path: string): Promise<void> {
  await page.getByTestId('open-log-input').setInputFiles(path);
  await expect(page.getByTestId('log-dialog')).toBeVisible();
}

test('parcel center: the exported log replays with fitness 100 % and the domain view moves', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const path = await exportParcelLog(page, testInfo);

  // File > Replay event log... asks for the file; the dialog maps the activities by name.
  await page.getByTestId('menu-file').click();
  await expect(page.getByTestId('menu-item-replay-log')).toBeVisible();
  await page.keyboard.press('Escape');
  await chooseLog(page, path);
  await expect(page.getByTestId('log-file-name')).toHaveText('Paketzentrum-events.csv');
  await expect(page.getByTestId('log-preview-summary')).toContainText('cases, spanning');
  await expect(page.getByTestId('log-mapping-row')).toHaveCount(9);
  await expect(page.getByTestId('log-unmapped')).toHaveText('Every activity is mapped.');
  await expect(page.getByLabel('Transition: Scannen')).toHaveValue('t_scan');
  await page.getByTestId('log-start').click();

  // The replay is the simulation with another source.
  await expect(page.getByTestId('simulation-panel')).toBeVisible();
  await expect(page.getByTestId('sim-source-log')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('log-source-name')).toHaveText('Paketzentrum-events.csv');
  await expect(page.getByTestId('sim-clock')).toHaveText('00:00:00');
  await expect(page.getByTestId('sim-arrivals')).toHaveCount(0);
  await expect(page.getByTestId('sim-resources')).toHaveCount(0);

  // In the domain view the cases move along the events of the log.
  await page.getByTestId('view-domain').click();
  const canvas = page.getByTestId('domain-canvas');
  await expect(canvas).toHaveAttribute('data-zoom', /\d/);
  await page.getByTestId('domain-speed-60').click();
  await page.getByTestId('domain-play').click();
  await expect
    .poll(async () => Number((await canvas.getAttribute('data-bundles')) ?? 0), { timeout: 15_000 })
    .toBeGreaterThan(5);
  await expect
    .poll(async () => Number((await canvas.getAttribute('data-sprites')) ?? 0))
    .toBeGreaterThan(0);
  await page.getByTestId('domain-play').click();
  expect(Number(await canvas.getAttribute('data-deviations'))).toBe(0);
  await page.getByTestId('view-net').click();

  // Play to the end at full speed: the log fits the net.
  await page.getByTestId('sim-reset').click();
  await expect(page.getByTestId('sim-clock')).toHaveText('00:00:00');
  await page.getByTestId('sim-tab-metrics').click();
  await expect(page.getByTestId('replay-fitness')).toHaveText('–');
  await page.getByTestId('sim-speed-max').click();
  await page.getByTestId('sim-play').click();
  await expect(page.getByTestId('sim-status')).toHaveText('Finished', { timeout: 20_000 });
  await expect(page.getByTestId('replay-fitness')).toHaveText('100 %');
  await expect(page.getByTestId('replay-created')).toHaveText('0');
  await expect(page.getByTestId('replay-left')).toHaveText('0');
  await expect(page.getByTestId('replay-skipped')).toHaveText('0');
  await expect(page.getByTestId('replay-progress')).toContainText(/Event ([\d,]+) of \1$/);
  await expect(page.getByTestId('deviation-ring')).toHaveCount(0);
  // The key figures of the run are there again: the same throughput as the original run.
  await expect(page.getByTestId('metric-throughput')).not.toHaveText('–');

  // Back to the engine and back to the log.
  await page.getByTestId('sim-source-engine').click();
  await expect(page.getByTestId('sim-source-engine')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('replay-card')).toHaveCount(0);
  await page.getByTestId('sim-source-log').click();
  await expect(page.getByTestId('sim-source-log')).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
});

test('a log without Scannen shows its deviations: red rings, red trace rows, lower fitness', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const path = await exportParcelLog(page, testInfo);
  const broken = testInfo.outputPath('without-scan.csv');
  const lines = (await readFile(path, 'utf8')).split('\n').filter((l) => !l.includes(',Scannen,'));
  await writeFile(broken, lines.join('\n'));

  await chooseLog(page, broken);
  await expect(page.getByTestId('log-mapping-row')).toHaveCount(8);
  await page.getByTestId('log-start').click();
  await expect(page.getByTestId('sim-source-log')).toHaveAttribute('aria-pressed', 'true');

  // While it plays, the place "Gescannt" lights up red when a token has to be created there.
  await page.getByTestId('sim-speed-30').click();
  await page.getByTestId('sim-play').click();
  const scanned = page.locator('.react-flow__node[data-id="p_scanned"]');
  await expect(scanned.getByTestId('deviation-ring')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('sim-play').click();
  await expect(page.getByTestId('sim-status')).toHaveText('Paused');

  // The pointer on the place tells how many tokens were created there.
  await scanned.getByTestId('place-shape').hover();
  await expect(page.getByTestId('hover-created')).toContainText(/\d+ tokens? created for the log/);
  await page.mouse.move(5, 5);

  // The trace lists them in red, with kind and place.
  await page.getByTestId('sim-tab-trace').click();
  await page.getByTestId('trace-filter-type').selectOption('deviation');
  const row = page.getByTestId('trace-row').first();
  await expect(row).toHaveAttribute('data-type', 'deviation');
  await expect(row).toContainText('Gescannt');
  await expect(row).toContainText('Token created');
  const color = await row.evaluate((element) => getComputedStyle(element).color);
  const normal = await page
    .getByTestId('sim-tab-trace')
    .evaluate((element) => getComputedStyle(element).color);
  expect(color).not.toBe(normal);

  // The figures: tokens created, left behind, and a fitness below 100 %.
  await page.getByTestId('sim-tab-metrics').click();
  await page.getByTestId('sim-speed-max').click();
  await page.getByTestId('sim-play').click();
  await expect(page.getByTestId('sim-status')).toHaveText('Finished', { timeout: 20_000 });
  await expect(page.getByTestId('replay-fitness')).not.toHaveText('100 %');
  await expect(page.getByTestId('replay-fitness')).toHaveText(/^\d\d\.\d %$/);
  expect(Number(await page.getByTestId('replay-created').textContent())).toBeGreaterThan(10);
  expect(Number(await page.getByTestId('replay-left').textContent())).toBeGreaterThan(10);

  // The analysis can check the properties of the net on the replayed log with one click.
  await page.getByTestId('replay-check').click();
  await expect(page.getByTestId('right-tab-analyze')).toHaveAttribute('aria-selected', 'true');
  expect(errors).toEqual([]);
});

test('activities without a transition are skipped and counted; the mapping can be changed', async ({
  page,
}, testInfo) => {
  const path = await exportParcelLog(page, testInfo);
  const renamed = testInfo.outputPath('renamed.csv');
  const text = (await readFile(path, 'utf8')).replace(/,Scannen,/g, ',Barcode lesen,');
  await writeFile(renamed, text);

  await chooseLog(page, renamed);
  await expect(page.getByTestId('log-unmapped')).toContainText('1 activity has no transition');
  const row = page.getByTestId('log-mapping-row').filter({ hasText: 'Barcode lesen' });
  await expect(row).toContainText('No transition: skipped');
  await page.getByTestId('log-start').click();
  await expect(page.getByTestId('log-source-skipped')).toHaveText(
    '1 activity is not mapped and skipped',
  );
  await page.getByTestId('sim-tab-metrics').click();
  await page.getByTestId('sim-speed-max').click();
  await page.getByTestId('sim-play').click();
  await expect(page.getByTestId('sim-status')).toHaveText('Finished', { timeout: 20_000 });
  expect(Number(await page.getByTestId('replay-skipped').textContent())).toBeGreaterThan(100);
  await expect(page.getByTestId('replay-fitness')).not.toHaveText('100 %');

  // Fix the mapping and replay again: now the log fits.
  await page.getByTestId('log-change-mapping').click();
  await expect(page.getByTestId('log-dialog')).toBeVisible();
  await page
    .getByTestId('log-mapping-row')
    .filter({ hasText: 'Barcode lesen' })
    .getByTestId('log-map-select')
    .selectOption('t_scan');
  await expect(page.getByTestId('log-unmapped')).toHaveText('Every activity is mapped.');
  await page.getByTestId('log-start').click();
  await expect(page.getByTestId('log-source-skipped')).toHaveCount(0);
  await page.getByTestId('sim-speed-max').click();
  await page.getByTestId('sim-play').click();
  await expect(page.getByTestId('sim-status')).toHaveText('Finished', { timeout: 20_000 });
  await expect(page.getByTestId('replay-fitness')).toHaveText('100 %');
  await expect(page.getByTestId('replay-skipped')).toHaveText('0');
});

test('an event log dropped on the simulation panel opens the dialog', async ({
  page,
}, testInfo) => {
  const path = await exportParcelLog(page, testInfo);
  const csv = await readFile(path, 'utf8');
  await page.getByTestId('mode-simulate').click();
  await expect(page.getByTestId('simulation-panel')).toBeVisible();
  await page.evaluate((text) => {
    const panel = document.querySelector('[data-testid="simulation-panel"]');
    if (!panel) throw new Error('no panel');
    const transfer = new DataTransfer();
    transfer.items.add(new File([text], 'dropped.csv', { type: 'text/csv' }));
    panel.dispatchEvent(
      new DragEvent('dragover', { dataTransfer: transfer, bubbles: true, cancelable: true }),
    );
    panel.dispatchEvent(
      new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }),
    );
  }, csv);
  await expect(page.getByTestId('log-dialog')).toBeVisible();
  await expect(page.getByTestId('log-file-name')).toHaveText('dropped.csv');
  await page.getByTestId('log-cancel').click();
  await expect(page.getByTestId('log-dialog')).toHaveCount(0);
  await expect(page.getByTestId('sim-source-engine')).toHaveAttribute('aria-pressed', 'true');
});

interface LiveWindow {
  pnm?: { live?: { push(events: unknown[]): Promise<void>; close(): Promise<void> } };
}

test('live: pasted events and the console API put tokens on the net as they arrive', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openExample(page, 'parcel-center');
  await page.getByTestId('mode-simulate').click();
  // window.pnm.live exists only while the live source is active.
  expect(await page.evaluate(() => (window as unknown as LiveWindow).pnm?.live)).toBeUndefined();
  await page.getByTestId('sim-source-live').click();
  await expect(page.getByTestId('sim-source-live')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('live-source')).toContainText('window.pnm.live.push');
  await page.waitForFunction(
    () => typeof (window as unknown as LiveWindow).pnm?.live?.push === 'function',
  );

  const dots = (id: string) =>
    page.locator(`.react-flow__node[data-id="${id}"]`).getByTestId('token-dot');
  await page
    .getByTestId('live-paste')
    .fill('X-1,Anlieferung,complete\nX-2,Anlieferung,complete\nX-1,Scannen,start');
  await page.getByTestId('live-add').click();
  // Two parcels arrived, one is being scanned: one waits, a scanner is taken.
  await expect(dots('p_in')).toHaveCount(1);
  await expect(dots('p_scanner')).toHaveCount(1);
  await expect(page.getByTestId('live-paste')).toHaveValue('');

  // The console API takes events without a time: they happen now.
  await page.evaluate(() =>
    (window as unknown as LiveWindow).pnm?.live?.push([
      { case: 'X-3', activity: 'Anlieferung' },
      { case: 'X-1', activity: 'Scannen', lifecycle: 'complete' },
    ]),
  );
  await expect(dots('p_in')).toHaveCount(2);
  await expect(dots('p_scanner')).toHaveCount(2);
  await expect(dots('p_scanned')).toHaveCount(1);
  await expect(page.getByTestId('sim-status')).toHaveText('Waiting');

  // A skipped activity is a deviation in the trace.
  await page.evaluate(() =>
    (window as unknown as LiveWindow).pnm?.live?.push([{ case: 'X-3', activity: 'Gossip' }]),
  );
  await page.getByTestId('sim-tab-trace').click();
  await page.getByTestId('trace-filter-type').selectOption('deviation');
  await expect(page.getByTestId('trace-row')).toHaveCount(1);

  // Closing the feed ends it; the console API goes with the source.
  await page.getByTestId('live-close').click();
  await expect(page.getByTestId('live-closed')).toBeVisible();
  await page.getByTestId('sim-source-engine').click();
  await expect(page.getByTestId('sim-source-engine')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => (window as unknown as LiveWindow).pnm?.live)).toBeUndefined();
  expect(errors).toEqual([]);
});
