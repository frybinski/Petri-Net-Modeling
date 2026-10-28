import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

async function openExample(page: Page, id: string): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
  await page.getByTestId('menu-file').click();
  await page.getByTestId(`menu-item-example-${id}`).click();
  await expect(page.getByTestId('place-shape').first()).toBeVisible();
}

/** The simulated seconds shown on the clock. */
async function clockSeconds(page: Page): Promise<number> {
  const text = (await page.getByTestId('sim-clock').textContent()) ?? '';
  const [h = 0, m = 0, s = 0] = text.split(':').map(Number);
  return h * 3600 + m * 60 + s;
}

function transition(page: Page, name: string | RegExp) {
  return page.locator('.react-flow__node-transition').filter({ hasText: name });
}

test('parcel center: play, pause, step, step back, breakpoint and event log export', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openExample(page, 'parcel-center');
  await expect(page.getByTestId('diagnostic-item')).toHaveCount(0);
  await page.getByTestId('mode-simulate').click();
  await expect(page.getByTestId('simulation-panel')).toBeVisible();
  await expect(page.getByTestId('sim-clock')).toHaveText('00:00:00');
  await expect(page.getByTestId('sim-back')).toBeDisabled();

  // Play: after a moment the clock runs and cases have entered.
  await page.getByTestId('sim-speed-60').click();
  await page.getByTestId('sim-play').click();
  await expect(page.getByTestId('sim-status')).toHaveText('Running');
  await expect.poll(() => clockSeconds(page)).toBeGreaterThan(2);
  await expect(page.getByTestId('sim-cases')).not.toHaveText('0');

  // Pause: the clock stands still.
  await page.getByTestId('sim-play').click();
  await expect(page.getByTestId('sim-status')).toHaveText('Paused');
  await expect(page.getByTestId('sim-back')).toBeEnabled();
  const paused = await page.getByTestId('sim-clock').textContent();
  await page.waitForTimeout(400);
  await expect(page.getByTestId('sim-clock')).toHaveText(paused ?? '');

  // Step processes the next event, step back restores the clock.
  const before = await clockSeconds(page);
  await page.getByTestId('sim-step-next').click();
  await expect.poll(() => clockSeconds(page)).toBeGreaterThanOrEqual(before);
  await expect(page.getByTestId('sim-back')).toBeEnabled();
  await page.getByTestId('sim-back').click();
  await expect.poll(() => clockSeconds(page)).toBe(before);

  // A breakpoint at "Scannen" pauses the run when a parcel is scanned.
  await page.getByTestId('sim-reset').click();
  await expect(page.getByTestId('sim-clock')).toHaveText('00:00:00');
  await transition(page, 'Scannen').getByTestId('transition-shape').click({ button: 'right' });
  await page.getByTestId('menu-breakpoint').click();
  await expect(transition(page, 'Scannen').getByTestId('breakpoint-marker')).toBeVisible();
  await page.getByTestId('sim-speed-max').click();
  await page.getByTestId('sim-play').click();
  await expect(page.getByTestId('sim-status')).toHaveText('Paused');
  await expect(transition(page, 'Scannen').locator('.pn-node')).toHaveAttribute(
    'data-selected',
    'true',
  );
  await expect(transition(page, 'Scannen').getByTestId('transition-progress')).toBeVisible();

  // Export the event log from the trace tab.
  await page.getByTestId('sim-tab-trace').click();
  await expect(page.getByTestId('trace-row').first()).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByTestId('export-csv').click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('Paketzentrum-events.csv');
  const path = await file.path();
  const lines = (await readFile(path, 'utf8')).trim().split('\n');
  expect(lines[0]).toBe('case_id,activity,timestamp,lifecycle');
  expect(lines.length).toBeGreaterThan(1);
  for (const line of lines.slice(1)) expect(line.split(',')).toHaveLength(4);
  expect(lines[1]).toMatch(/^P-0001,Anlieferung,2026-01-05T06:/);
  expect(errors).toEqual([]);
});

test('maximum speed stays responsive and the metrics appear after the warm-up', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openExample(page, 'parcel-center');
  await page.getByTestId('mode-simulate').click();
  await page.getByTestId('sim-speed-max').click();
  await page.getByTestId('sim-play').click();
  // The interface answers while the engine runs flat out: pausing takes effect at once.
  await expect.poll(() => clockSeconds(page)).toBeGreaterThan(1500);
  const started = Date.now();
  await page.getByTestId('sim-play').click();
  await expect(page.getByTestId('sim-status')).toHaveText('Paused', { timeout: 2000 });
  expect(Date.now() - started).toBeLessThan(2000);

  await page.getByTestId('sim-tab-metrics').click();
  await expect(page.getByTestId('metric-throughput')).not.toHaveText('–');
  await expect(page.getByTestId('metric-cycle')).not.toHaveText('–');
  await expect(page.getByTestId('metrics-resource-row')).toHaveCount(5);
  await expect(page.getByTestId('metrics-place-row')).toHaveCount(6);
  expect(errors).toEqual([]);
});

test('order processing: a duration on Approve shows a progress bar and completes on a step', async ({
  page,
}) => {
  await openExample(page, 'order-processing');
  // Give "Approve" a duration of one minute.
  await transition(page, 'Approve').getByTestId('transition-shape').click();
  await page.getByTestId('prop-timing-kind').selectOption('fixed');
  await page.getByTestId('prop-timing-value').fill('60');
  await page.getByTestId('prop-timing-value').press('Enter');
  await expect(transition(page, 'Approve').getByTestId('timing-icon')).toBeVisible();

  await page.getByTestId('mode-simulate').click();
  await expect(page.getByTestId('enabled-summary')).toContainText('3 enabled transitions');
  await expect(page.getByTestId('sim-step-next')).toBeVisible();
  await transition(page, 'Approve').getByTestId('transition-shape').click();
  const picker = page.getByTestId('binding-picker');
  await expect(picker.getByTestId('binding-option')).toHaveCount(3);
  await picker.getByTestId('binding-option').nth(1).click();

  // The firing is under way: the order has left "Incoming" and has not arrived at "Approved".
  // (Two orders were approved from the start.)
  const bar = transition(page, 'Approve').getByTestId('transition-progress');
  await expect(bar).toBeVisible();
  await expect(bar).toHaveAttribute('aria-valuenow', '0');
  const marking = page.getByTestId('sim-marking');
  const incoming = marking.locator('li', { hasText: 'Incoming orders' });
  const approved = marking.locator('li', { hasText: 'Approved orders' });
  await expect(incoming).toContainText('3');
  await expect(approved).toContainText('2');
  await expect(page.getByTestId('sim-step')).toHaveCount(1);

  // The first step starts what else is enabled at this moment (the other two orders are approved
  // as well); the next one reaches the end of the firings, one minute later.
  await page.getByTestId('sim-step-next').click();
  await expect(page.getByTestId('sim-clock')).toHaveText('00:00:00');
  await expect(page.getByTestId('running-count')).toHaveText('3');
  await page.getByTestId('sim-step-next').click();
  await expect(page.getByTestId('sim-clock')).toHaveText('00:01:00');
  await expect(bar).toBeHidden();
  // The orders that were approved are invoiced at once ("Create invoice" takes no time).
  await expect(marking.locator('li', { hasText: 'Invoices' })).toBeVisible();
  await page.getByTestId('sim-back').click();
  await expect(page.getByTestId('sim-clock')).toHaveText('00:00:00');
  await expect(bar).toBeVisible();
});

test('keyboard: Space plays and pauses, period steps, comma steps back, R resets', async ({
  page,
}) => {
  await openExample(page, 'smart-office');
  await page.getByTestId('mode-simulate').click();
  await expect(page.getByTestId('sim-clock')).toHaveText('00:00:00');
  await page.getByTestId('canvas').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Space');
  await expect(page.getByTestId('sim-status')).toHaveText('Running');
  await expect.poll(() => clockSeconds(page)).toBeGreaterThan(1);
  await page.keyboard.press('Space');
  await expect(page.getByTestId('sim-status')).toHaveText('Paused');
  const t = await clockSeconds(page);
  await page.keyboard.press('.');
  await expect.poll(() => clockSeconds(page)).toBeGreaterThanOrEqual(t);
  await page.keyboard.press(',');
  await expect.poll(() => clockSeconds(page)).toBe(t);
  await page.keyboard.press('r');
  await expect(page.getByTestId('sim-clock')).toHaveText('00:00:00');
  // B sets a breakpoint on the selected transition.
  const meeting = transition(page, /^Meeting$/);
  await meeting.getByTestId('transition-shape').click();
  await page.keyboard.press('b');
  await expect(meeting.getByTestId('breakpoint-marker')).toBeVisible();
  await page.keyboard.press('b');
  await expect(page.getByTestId('breakpoint-marker')).toHaveCount(0);
});

test('arrival rate and resources of the smart office can be changed while running', async ({
  page,
}) => {
  await openExample(page, 'smart-office');
  await page.getByTestId('mode-simulate').click();
  await expect(page.getByTestId('arrival-value')).toHaveText('40 per hour');
  await page.getByTestId('arrival-slider').fill('0');
  await expect(page.getByTestId('arrival-value')).toHaveText('off');
  const desks = page.getByTestId('resource-state').nth(1);
  await expect(desks).toHaveText('8 free, 0 busy');
  await page.getByTestId('resource-plus').nth(1).click();
  await expect(desks).toHaveText('9 free, 0 busy');
  await page.getByTestId('resource-minus').nth(1).click();
  await expect(desks).toHaveText('8 free, 0 busy');
});

test('tokens move along the arcs unless reduced motion is requested', async ({ page }) => {
  const watch = async (): Promise<void> => {
    await page.evaluate(() => {
      const w = window as unknown as { flights: number };
      w.flights = 0;
      new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (node instanceof Element && node.classList.contains('pn-flight')) w.flights += 1;
          }
        }
      }).observe(document.body, { childList: true, subtree: true });
    });
  };
  const flights = (): Promise<number> =>
    page.evaluate(() => (window as unknown as { flights: number }).flights);

  // The test configuration asks for reduced motion: tokens just appear.
  await openExample(page, 'producer-consumer');
  await page.getByTestId('mode-simulate').click();
  await watch();
  await page.locator('[data-testid="transition-shape"][data-enabled="true"]').click();
  await expect(page.getByTestId('sim-step')).toHaveCount(1);
  await page.waitForTimeout(400);
  expect(await flights()).toBe(0);

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.getByTestId('sim-reset').click();
  await expect(page.getByTestId('sim-step')).toHaveCount(0);
  await page.locator('[data-testid="transition-shape"][data-enabled="true"]').click();
  await expect(page.getByTestId('sim-step')).toHaveCount(1);
  await expect.poll(flights).toBeGreaterThan(1);
  await expect(page.locator('.pn-flight')).toHaveCount(0); // they are gone after 250 ms
});

test('the timing fields of an example appear in the properties panel', async ({ page }) => {
  await openExample(page, 'complaint-handling');
  await expect(page.getByTestId('diagnostic-item')).toHaveCount(0);
  await transition(page, 'Reklamation eingehend').getByTestId('transition-shape').click();
  await expect(page.getByTestId('prop-rate')).toHaveValue('300');
  await transition(page, 'Ware prüfen').getByTestId('transition-shape').click();
  await expect(page.getByTestId('prop-timing-kind')).toHaveValue('uniform');
  await expect(page.getByTestId('prop-timing-min')).toHaveValue('5');
  await expect(page.getByTestId('prop-timing-max')).toHaveValue('11');
  await expect(page.getByTestId('prop-rate')).toHaveCount(0);
  // The place "Eingang" is fed by the arrival transition: its role is computed.
  await page.locator('.react-flow__node-place').filter({ hasText: 'Eingang' }).click();
  await expect(page.getByTestId('prop-role')).toContainText('Automatic (Case)');
  // Nothing selected: the settings of the net.
  await page.getByTestId('canvas').click({ position: { x: 5, y: 5 } });
  await expect(page.getByTestId('prop-case-prefix')).toHaveValue('R-');
  await expect(page.getByTestId('prop-seed')).toHaveValue('1');
});
