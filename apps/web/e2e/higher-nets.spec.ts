import { expect, test, type Page } from '@playwright/test';

async function openExample(page: Page, id: string): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
  await page.getByTestId('menu-file').click();
  await page.getByTestId(`menu-item-example-${id}`).click();
  await expect(page.getByTestId('place-shape').first()).toBeVisible();
}

/** Types into a CodeMirror field and leaves it, which commits the text. */
async function typeInEditor(page: Page, testId: string, text: string): Promise<void> {
  const editor = page.locator(`.cm-content[data-testid="${testId}"]`);
  await editor.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type(text);
  await expect(editor).toHaveText(text);
  // Escape is not pressed here. In these editors Escape reverts the text to the committed one and
  // leaves the field, and only while a completion list is open does it close the list instead.
  // Whether the list is open yet depends on a timer, so a blind Escape sometimes threw away what
  // had just been typed (the cause of a failure on a busy machine). The next step leaves the
  // editor with a click, which commits the text and closes the list.
}

test('order processing: choose a binding and check the invoice', async ({ page }) => {
  await openExample(page, 'order-processing');
  await expect(page.getByTestId('net-name')).toHaveValue('Order processing');
  await expect(page.getByTestId('diagnostic-item')).toHaveCount(0);

  await page.getByTestId('mode-simulate').click();
  await expect(page.getByTestId('enabled-summary')).toContainText('3 enabled transitions');

  // "Approve" has three bindings, so a click opens the list instead of firing.
  const transitions = page.locator('.react-flow__node-transition');
  await transitions.filter({ hasText: 'Approve' }).getByTestId('transition-shape').click();
  const picker = page.getByTestId('binding-picker');
  await expect(picker).toBeVisible();
  await expect(picker.getByTestId('binding-option')).toHaveCount(3);
  await expect(page.getByTestId('sim-step')).toHaveCount(0);

  // The bindings are sorted by canonical JSON: A-1 (12.5), A-4 (40), A-2 (80). Take A-4.
  await picker.getByTestId('binding-option').nth(1).click();
  await expect(picker).toBeHidden();
  await expect(page.getByTestId('sim-step')).toHaveCount(1);
  await expect(page.getByTestId('sim-step')).toContainText('Approve');
  await expect(page.getByTestId('sim-step')).toContainText('A-4');
  const marking = page.getByTestId('sim-marking');
  await expect(marking).toContainText('Approved orders');
  await expect(marking.locator('li', { hasText: 'Approved orders' })).toContainText('3');
  await expect(marking.locator('li', { hasText: 'Incoming orders' })).toContainText('3');

  // "Create invoice" joins an approved order with its customer through the guard.
  const invoice = transitions.filter({ hasText: 'Create invoice' }).getByTestId('transition-shape');
  await invoice.click();
  const options = page.getByTestId('binding-option');
  await expect(options).toHaveCount(3); // A-0 with c1, A-4 with c1, A-9 with c2
  await options.first().click();
  await expect(page.getByTestId('sim-step')).toHaveCount(2);
  const invoices = marking.locator('li', { hasText: 'Invoices' });
  await expect(invoices).toContainText('1');
  // A-0 is an order of 30 for customer c1 = Ada Lovelace.
  await expect(invoices.locator('code')).toHaveAttribute(
    'title',
    '{"order":"A-0","customer":"Ada Lovelace","total":30}',
  );

  // The full binding of a step is available from the history.
  await page.getByTestId('sim-step-toggle').first().click();
  await expect(page.getByTestId('sim-step-binding')).toContainText('"Ada Lovelace"');

  await page.getByTestId('step-random').click();
  await expect(page.getByTestId('sim-step')).toHaveCount(3);
});

test('keyboard: the binding list opens, moves with the arrow keys and fires with Enter', async ({
  page,
}) => {
  await openExample(page, 'order-processing');
  await page.getByTestId('mode-simulate').click();
  // The engine runs in a worker; the transitions can be fired once it has answered.
  await expect(page.getByTestId('enabled-summary')).toContainText('3 enabled transitions');
  await page
    .locator('.react-flow__node-transition')
    .filter({ hasText: 'Approve' })
    .getByTestId('transition-shape')
    .click();
  await expect(page.getByTestId('binding-option').first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('binding-option').nth(1)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('sim-step')).toHaveCount(1);
  await expect(page.getByTestId('binding-picker')).toBeHidden();
});

test('create a type and assign it to a place; undo removes the assignment', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
  await page.getByTestId('profile-json').click();
  await expect(page.getByTestId('type-new')).toBeVisible();

  await page.getByTestId('tool-place').click();
  const box = await page.getByTestId('canvas').boundingBox();
  if (!box) throw new Error('canvas not visible');
  await page.mouse.click(box.x + 300, box.y + 300);
  await expect(page.getByTestId('place-shape')).toHaveCount(1);

  // Nothing is selected after clicking away, so the net panel with the types shows.
  await page.mouse.click(box.x + 600, box.y + 500);
  await page.getByTestId('type-new').click();
  await page.getByTestId('type-name').fill('Count');
  await page.getByTestId('type-template').selectOption('integer');
  await expect(page.getByTestId('type-schema-status')).toContainText('valid');
  await page.getByTestId('type-save').click();
  await expect(page.getByTestId('type-item')).toHaveCount(1);
  await expect(page.getByTestId('type-item')).toContainText('Count');
  await expect(page.getByTestId('type-item')).toContainText('unused');

  await page.getByTestId('place-shape').click();
  await page.getByTestId('prop-type').selectOption('Count');
  await expect(page.getByTestId('prop-type')).toHaveValue('Count');
  await expect(page.getByTestId('edit-type-link')).toBeVisible();

  // A token that does not fit the type is flagged in the list and in the status bar.
  await page.getByTestId('token-add').click();
  await page.getByTestId('token-input').fill('-1.5');
  await expect(page.getByTestId('token-status')).toContainText('Does not match type Count');
  await page.getByTestId('token-save').click();
  await expect(page.getByTestId('token-mismatch')).toBeVisible();
  await expect(page.getByTestId('status-diagnostics')).toContainText('1 error');
  await page.getByTestId('status-diagnostics').click();
  await expect(
    page.locator('[data-testid="diagnostic-item"][data-code="TOKEN_TYPE_MISMATCH"]'),
  ).toContainText('violate the type');

  await page.getByTestId('undo').click();
  await page.getByTestId('undo').click();
  await expect(page.getByTestId('prop-type')).toHaveValue('');
});

test('the type editor reports invalid JSON and invalid schemas', async ({ page }) => {
  await openExample(page, 'order-processing');
  await page.getByRole('button', { name: 'Edit type Order' }).click();
  await expect(page.getByTestId('type-schema-status')).toContainText('valid');

  await typeInEditor(page, 'type-schema', '{ "type": ');
  await expect(page.getByTestId('type-schema-status')).toContainText('Not valid JSON');
  await expect(page.getByTestId('type-save')).toBeDisabled();

  await typeInEditor(page, 'type-schema', '{ "type": "strng" }');
  await expect(page.getByTestId('type-schema-status')).toContainText('Not a valid JSON Schema');
  await expect(page.getByTestId('type-save')).toBeDisabled();

  await typeInEditor(page, 'type-schema', '{ "type": "string" }');
  await expect(page.getByTestId('type-save')).toBeEnabled();
  await typeInEditor(page, 'type-test', '"hello"');
  await expect(page.getByTestId('type-test-result')).toContainText('matches the type');
  await typeInEditor(page, 'type-test', '5');
  await expect(page.getByTestId('type-test-result')).toContainText('does not match');
});

test('an invalid inscription shows an error and a valid one is applied', async ({ page }) => {
  await openExample(page, 'order-processing');
  const transition = page
    .locator('.react-flow__node-transition')
    .filter({ hasText: 'Approve' })
    .getByTestId('transition-shape');
  await transition.click();
  await expect(page.getByTestId('prop-guard')).toBeVisible();
  await expect(page.getByTestId('bound-variables')).toContainText('$o');

  await typeInEditor(page, 'prop-guard', '$o.amount >');
  await expect(page.getByTestId('prop-guard-error')).toContainText(/end of expression/i);
  await page.getByTestId('prop-name').click(); // leave the editor: the text is committed
  await expect(page.getByTestId('status-diagnostics')).toContainText('1 error');

  await typeInEditor(page, 'prop-guard', '$o.amount > 10');
  await page.getByTestId('prop-name').click();
  await expect(page.getByTestId('prop-guard-error')).toHaveCount(0);
  await expect(page.getByTestId('status-diagnostics')).toContainText('No problems');
  await expect(page.getByTestId('guard-label').first()).toContainText('$o.amount > 10');

  // The guard is part of the simulation: A-1 (12.5) and the others still pass, 0 would not.
  await page.getByTestId('mode-simulate').click();
  await expect(page.getByTestId('enabled-summary')).toContainText('enabled');
});

test('an unbound variable in an output inscription is reported', async ({ page }) => {
  await openExample(page, 'order-processing');
  // Selecting the arc and opening its editor can lose the click on a busy machine: retry both.
  await expect(async () => {
    await page.getByTestId('arc').nth(1).locator('path').first().click({ force: true });
    await expect(page.getByTestId('prop-inscription')).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  await typeInEditor(page, 'prop-inscription', '$o + $missing');
  // The check runs on the text as typed; leave the field first so that the commit is done, then
  // wait for the result with room to spare.
  await page.getByTestId('prop-weight').click();
  await expect(page.getByTestId('prop-inscription-warning')).toContainText('$missing', {
    timeout: 15_000,
  });
  await expect(page.getByTestId('status-diagnostics')).toContainText('1 error', {
    timeout: 15_000,
  });
});

test('switching the net class keeps the data and can be undone', async ({ page }) => {
  await openExample(page, 'order-processing');
  await expect(page.getByTestId('profile-json')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('profile-pt').click();
  await expect(page.getByTestId('profile-pt')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('type-new')).toHaveCount(0);
  await expect(page.getByTestId('profile-ignored-note')).toBeVisible();
  // Types and inscriptions stay in the document but are ignored: the status bar says so.
  await page.getByTestId('status-diagnostics').click();
  await expect(page.getByTestId('diagnostic-item').first()).toHaveAttribute(
    'data-code',
    'INSCRIPTION_ON_PT_NET',
  );
  await page.getByTestId('undo').click();
  await expect(page.getByTestId('profile-json')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('type-item')).toHaveCount(3);
});

for (const id of ['token-ring', 'dining-philosophers-json']) {
  test(`the ${id} example opens without problems and can be simulated`, async ({ page }) => {
    await openExample(page, id);
    await expect(page.getByTestId('status-diagnostics')).toContainText('No problems');
    await page.getByTestId('mode-simulate').click();
    await expect(page.getByTestId('enabled-summary')).toContainText('enabled');
    await page.getByTestId('step-random').click();
    await expect(page.getByTestId('sim-step')).toHaveCount(1);
  });
}

test('inscriptions can be hidden from the view menu', async ({ page }) => {
  await openExample(page, 'order-processing');
  await expect(page.getByTestId('guard-label').first()).toBeVisible();
  await page.getByTestId('menu-view').click();
  await page.getByTestId('menu-item-show-inscriptions').click();
  await expect(page.getByTestId('guard-label')).toHaveCount(0);
  await expect(page.getByTestId('arc-inscription')).toHaveCount(0);
  await page.getByTestId('menu-view').click();
  await page.getByTestId('menu-item-show-inscriptions').click();
  await expect(page.getByTestId('guard-label').first()).toBeVisible();
});
