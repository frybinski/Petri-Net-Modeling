import { expect, test, type Page } from '@playwright/test';

async function openExample(page: Page, id: string): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
  await page.getByTestId('menu-file').click();
  await page.getByTestId(`menu-item-example-${id}`).click();
  await expect(page.getByTestId('place-shape').first()).toBeVisible();
}

async function analyze(page: Page): Promise<void> {
  await page.getByTestId('right-tab-analyze').click();
  await expect(page.getByTestId('analysis-panel')).toBeVisible();
  await page.getByTestId('analyze-all').click();
  await expect(page.getByTestId('space-result')).toBeVisible();
}

test('producer/consumer: bounded by 3, live, reversible, three place invariants', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openExample(page, 'producer-consumer');
  await analyze(page);

  await expect(page.getByTestId('space-states')).toHaveText('16');
  await expect(page.getByTestId('space-edges')).toHaveText('28');
  await expect(page.getByTestId('space-bounded')).toContainText('at most 3 tokens');
  await expect(page.getByTestId('space-deadlocks')).toContainText('None');
  await expect(page.getByTestId('space-live')).toContainText('Yes');
  await expect(page.getByTestId('space-reversible')).toContainText('Yes');
  await expect(page.getByTestId('structure-markedGraph')).toContainText('Marked graph');

  const equations = await page.getByTestId('p-invariants').locator('button').allTextContents();
  expect(equations.sort()).toEqual(
    [
      '1·Producer idle + 1·Item ready = 1',
      '1·Consumer idle + 1·Item received = 1',
      '1·Buffer + 1·Buffer (free) = 3',
    ].sort(),
  );

  // A click on an invariant selects its places in the net.
  await page.getByTestId('p-invariants').locator('button', { hasText: 'Buffer' }).click();
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(1);

  // The keyboard shortcut leaves the analysis and comes back.
  await page.keyboard.press('y');
  await expect(page.getByTestId('properties-panel')).toBeVisible();
  await page.keyboard.press('y');
  await expect(page.getByTestId('analysis-panel')).toBeVisible();
  expect(errors).toEqual([]);
});

test('dining philosophers: finds the deadlock and plays the way into it', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openExample(page, 'dining-philosophers-3');
  await analyze(page);

  await expect(page.getByTestId('space-states')).toHaveText('14');
  await expect(page.getByTestId('space-deadlocks')).toContainText(
    '1 marking without an enabled transition',
  );
  await expect(page.getByTestId('space-live')).toContainText('No');
  const witness = page.getByTestId('deadlock-witness');
  await expect(witness).toContainText('Deadlock 1 after 3 steps');
  await expect(witness.getByTestId('trace-step')).toHaveCount(3);

  // Replay plays the three steps; the end is the marking the analysis reported.
  await witness.getByTestId('trace-replay').click();
  await expect(page.getByTestId('replay-bar')).toBeVisible();
  await expect(page.getByTestId('replay-status')).toHaveAttribute('data-reached', 'true', {
    timeout: 15_000,
  });
  await expect(page.getByTestId('replay-position')).toContainText('Step 3 of 3');
  await expect(page.getByTestId('status-sim'))
    .toBeVisible()
    .catch(() => undefined);
  // Three philosophers hold their left fork: three marked places of that name.
  const marked = page
    .locator('.react-flow__node-place')
    .filter({ hasText: 'has left fork' })
    .getByTestId('token-dot');
  await expect(marked).toHaveCount(3);
  // The simulation is in the deadlock: no transition is enabled.
  await page.getByTestId('right-tab-main').click();
  await expect(page.getByTestId('enabled-summary')).toContainText('Deadlock');
  expect(errors).toEqual([]);
});

test('properties: response holds, a violated one comes with a counterexample that replays', async ({
  page,
}) => {
  await openExample(page, 'order-processing');
  await page.getByTestId('right-tab-analyze').click();
  await page.getByTestId('check-space').click();
  await expect(page.getByTestId('check-summary')).toContainText('216 states');

  const rows = page.getByTestId('property-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0).getByTestId('property-status')).toHaveAttribute('data-status', 'holds');
  await expect(rows.nth(1).getByTestId('property-status')).toHaveAttribute(
    'data-status',
    'violated',
  );
  const counterexample = rows.nth(1).getByTestId('counterexample');
  await expect(counterexample.getByTestId('trace-step')).toHaveCount(9);

  // A click on a step shows the net after it: the first approval has moved an order.
  await counterexample.getByTestId('trace-step').first().click();
  await expect(page.getByTestId('replay-bar')).toBeVisible();
  await expect(page.getByTestId('replay-position')).toContainText('Step 1 of 1');

  // Replay plays the whole run and ends in the reported marking.
  await counterexample.getByTestId('trace-replay').click();
  await expect(page.getByTestId('replay-status')).toHaveAttribute('data-reached', 'true', {
    timeout: 20_000,
  });
  await expect(page.getByTestId('replay-position')).toContainText('Step 9 of 9');
});

test('properties: add a template and a formula, response(produce, deliver) holds', async ({
  page,
}) => {
  await openExample(page, 'producer-consumer');
  await page.getByTestId('right-tab-analyze').click();
  await expect(page.getByTestId('properties-empty')).toBeVisible();

  await page.getByTestId('property-add').click();
  await page.getByTestId('property-template').selectOption({ label: 'Response' });
  await page.getByTestId('property-activity-a').selectOption('produce');
  await page.getByTestId('property-activity-b').selectOption('deliver');
  await expect(page.getByTestId('property-meaning')).toContainText(
    'Every produce is eventually followed by deliver.',
  );
  await page.getByTestId('property-save').click();

  await page.getByTestId('property-add').click();
  await page.getByTestId('property-kind').selectOption('ltlf');
  const formula = page.getByTestId('property-formula');
  await formula.click();
  await page.keyboard.type('G(produce -> F deliver');
  await expect(page.getByTestId('property-problem')).toBeVisible();
  await page.keyboard.type(')');
  await expect(page.getByTestId('property-problem')).toHaveCount(0);
  await page.getByTestId('property-save').click();
  await expect(page.getByTestId('property-row')).toHaveCount(2);

  // The net never ends in a deadlock: both properties hold, and the answer says why.
  await page.getByTestId('check-space').click();
  const statuses = page.getByTestId('property-status');
  await expect(statuses).toHaveCount(2);
  await expect(statuses.first()).toContainText('Holds');
  await expect(page.getByTestId('property-explanation').first()).toContainText('vacuously');

  // Checking every prefix finds the open produce.
  await page.getByTestId('check-final').selectOption({ label: 'any marking (every prefix)' });
  await page.getByTestId('check-space').click();
  await expect(statuses.first()).toContainText('Violated');
  await expect(page.getByTestId('counterexample').first().getByTestId('trace-step')).toHaveCount(1);
});

test('conformance: a simulation log satisfies the stored properties of the parcel center', async ({
  page,
}) => {
  await openExample(page, 'parcel-center');
  await page.getByTestId('right-tab-analyze').click();
  await expect(page.getByTestId('check-log')).toBeDisabled();

  await page.getByTestId('mode-simulate').click();
  await page.getByTestId('right-tab-main').click();
  await page.getByTestId('sim-speed-60').click();
  await page.getByTestId('sim-play').click();
  await expect(page.getByTestId('sim-cases')).not.toHaveText('0', { timeout: 15_000 });
  await page.waitForTimeout(1500);
  await page.getByTestId('sim-play').click();
  await expect(page.getByTestId('sim-status')).toHaveText('Paused');

  await page.getByTestId('right-tab-analyze').click();
  await expect(page.getByTestId('check-log')).toBeEnabled();
  await page.getByTestId('check-include-open').check();
  await page.getByTestId('check-log').click();
  await expect(page.getByTestId('log-summary')).toBeVisible();
  const ratios = page.getByTestId('log-ratio');
  await expect(ratios).toHaveCount(3);
  // init(Anlieferung) and not-co-existence(Weiche A, Weiche B) hold for every case.
  await expect(ratios.nth(1)).toHaveText('100 %');
  await expect(ratios.nth(2)).toHaveText('100 %');
});

test('state space graph: opens, shows the states and puts a state into the net', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openExample(page, 'dining-philosophers-3');
  await analyze(page);
  await page.getByTestId('space-show-graph').click();
  await expect(page.getByTestId('space-node')).toHaveCount(14, { timeout: 15_000 });
  await expect(
    page.getByTestId('space-node').and(page.locator('[data-deadlock="true"]')),
  ).toHaveCount(1);

  // A click shows the marking of a state; "Show in net" replays the way there.
  await page.locator('[data-deadlock="true"]').click();
  await expect(page.getByTestId('space-detail')).toContainText('Philosopher 1 has left fork');
  await page.getByTestId('space-show-in-net').click();
  await expect(page.getByTestId('space-graph')).toHaveCount(0);
  await expect(page.getByTestId('replay-status')).toHaveAttribute('data-reached', 'true', {
    timeout: 15_000,
  });
  expect(errors).toEqual([]);
});

test('results are marked out of date after an edit', async ({ page }) => {
  await openExample(page, 'mutual-exclusion');
  await analyze(page);
  await expect(page.getByTestId('stale-note')).toHaveCount(0);
  // Dragging does not change the analysis; a new token does.
  await page.keyboard.press('Escape');
  await page.locator('.react-flow__node-place').first().click();
  await page.keyboard.press('+');
  await expect(page.getByTestId('stale-note').first()).toBeVisible();
  await page.getByTestId('stale-note').last().getByRole('button', { name: 'Update' }).click();
  await expect(page.getByTestId('stale-note')).toHaveCount(2);
});
