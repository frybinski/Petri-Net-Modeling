import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';

/**
 * The app against the real server (apps/server/dist/server.js, started by e2e/server/start-server.mjs)
 * with the stand-in for the language model server behind it: the same files and headers as in the
 * container, the content security policy included.
 */

/** The key of the stand-in, as start-server.mjs sets it. A placeholder; it must never reach a page. */
const LLM_KEY = 'e2e-placeholder-key-not-a-secret';

const examples = join(import.meta.dirname, '..', '..', '..', '..', 'examples');
const unique = (label: string): string =>
  `${label} ${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

/** A new browser context: another person with an empty browser. */
async function person(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL ?? '' });
  const page = await context.newPage();
  return { context, page };
}

/** Collects what the browser complains about: script errors and refused resources. */
function watchProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error' || /Content Security Policy|Refused to/i.test(message.text())) {
      problems.push(`console: ${message.text()}`);
    }
  });
  return problems;
}

async function openApp(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
  await expect(page.getByTestId('status-server')).toBeVisible();
}

async function openExample(page: Page, id: string): Promise<void> {
  await page.getByTestId('menu-file').click();
  await page.getByTestId(`menu-item-example-${id}`).click();
  await expect(page.getByTestId('place-shape').first()).toBeVisible();
}

async function rename(page: Page, name: string): Promise<void> {
  await page.getByTestId('net-name').fill(name);
  await page.getByTestId('net-name').press('Enter');
}

/** Saves the document as a new project through Ctrl+S and the name dialog. */
async function saveAsProject(page: Page, name: string): Promise<void> {
  await page.getByTestId('canvas').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+s');
  const input = page.getByTestId('server-project-name-input');
  await expect(input).toBeVisible();
  await input.fill(name);
  await page.getByTestId('server-save-confirm').click();
  await expect(page.getByTestId('status-server-project')).toContainText(`${name} · version 1`);
}

async function projectsNamed(request: APIRequestContext, name: string) {
  const response = await request.get('/api/v1/projects');
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as {
    projects: Array<{ id: string; name: string; version: number }>;
  };
  return body.projects.filter((p) => p.name === name);
}

test.describe('the app on a server', () => {
  test('finds the server, loads without a violation of the content security policy and offers its functions', async ({
    page,
  }) => {
    const problems = watchProblems(page);
    const response = await page.goto('/');
    expect(response?.headers()['content-security-policy']).toContain("default-src 'self'");
    await expect(page.getByTestId('canvas')).toBeVisible();
    await expect(page.getByTestId('status-server')).toHaveText(/Server: e2e-server/);

    await page.getByTestId('menu-file').click();
    await expect(page.getByTestId('menu-item-server-open')).toBeVisible();
    await expect(page.getByTestId('menu-item-server-save')).toContainText('Save to server…');
    await expect(page.getByTestId('menu-item-server-versions')).toBeDisabled();
    await expect(page.getByTestId('menu-item-save')).toContainText('Save to file');
    await page.keyboard.press('Escape');

    // The editor works as before: a net can be drawn and simulated under the policy.
    await openExample(page, 'producer-consumer');
    await page.getByTestId('mode-simulate').click();
    const enabled = page.locator('[data-testid="transition-shape"][data-enabled="true"]');
    await expect(enabled).toHaveCount(1);
    await enabled.click();
    await expect(page.getByTestId('sim-step')).toHaveCount(1);
    // The analysis, loaded on demand with its worker, runs too.
    await page.getByTestId('mode-edit').click();
    await page.getByTestId('right-tab-analyze').click();
    await expect(page.getByTestId('analysis-panel')).toBeVisible();
    await page.getByTestId('analyze-all').click();
    await expect(page.getByTestId('space-states')).toHaveText('16');
    expect(problems).toEqual([]);
  });

  test('saves a project, keeps the link over a reload, and saves the next version with Ctrl+S', async ({
    page,
    request,
  }) => {
    const name = unique('Crossing');
    await openApp(page);
    await openExample(page, 'traffic-light');
    await rename(page, name);
    await saveAsProject(page, name);
    await expect(page.getByTestId('dirty-indicator')).toBeHidden();
    const [created] = await projectsNamed(request, name);
    expect(created?.version).toBe(1);

    // Change the net and save again: version 2, no dialog.
    await page.getByTestId('tool-place').click();
    const box = await page.getByTestId('canvas').boundingBox();
    if (!box) throw new Error('canvas not visible');
    await page.mouse.click(box.x + 600, box.y + 400);
    await expect(page.getByTestId('dirty-indicator')).toBeVisible();
    await page.keyboard.press('Control+s');
    await expect(page.getByTestId('status-server-project')).toContainText(`${name} · version 2`);
    await expect(page.getByTestId('dirty-indicator')).toBeHidden();
    expect(
      await (await request.get(`/api/v1/projects/${created?.id}/versions`)).json(),
    ).toMatchObject({
      versions: [{ version: 2 }, { version: 1 }],
    });

    // A change that is not saved yet survives a reload together with the project it belongs to.
    await page.getByTestId('tool-place').click();
    await page.mouse.click(box.x + 700, box.y + 450);
    await page.waitForTimeout(900); // the autosave waits half a second
    await page.reload();
    await expect(page.getByTestId('status-server-project')).toContainText(name);
    await page.keyboard.press('Control+s');
    await expect(page.getByTestId('status-server-project')).toContainText(`${name} · version 3`);
  });

  test('opens a project in another browser, and asks before it replaces unsaved changes', async ({
    page,
    browser,
    request,
  }) => {
    const name = unique('Shared office');
    await openApp(page);
    await openExample(page, 'producer-consumer');
    await rename(page, name);
    await saveAsProject(page, name);

    const other = await person(browser);
    try {
      await openApp(other.page);
      // Their own, unsaved work first.
      await other.page.getByTestId('tool-place').click();
      const box = await other.page.getByTestId('canvas').boundingBox();
      if (!box) throw new Error('canvas not visible');
      await other.page.mouse.click(box.x + 300, box.y + 300);
      await other.page.getByTestId('menu-file').click();
      await other.page.getByTestId('menu-item-server-open').click();
      await other.page.getByTestId('server-search').fill(name);
      const row = other.page.getByTestId('server-project').filter({ hasText: name });
      await expect(row).toHaveCount(1);
      await expect(row).toContainText('version 1');
      await expect(row).toContainText('5 places, 4 transitions');
      await row.getByRole('button', { name: `Open ${name}` }).click();
      await other.page.getByTestId('confirm-accept').click();
      await expect(other.page.getByTestId('net-name')).toHaveValue(name);
      await expect(other.page.getByTestId('place-shape')).toHaveCount(5);
      await expect(other.page.getByTestId('status-server-project')).toContainText(
        `${name} · version 1`,
      );
    } finally {
      await other.context.close();
    }
    expect((await projectsNamed(request, name))[0]?.version).toBe(1);
  });

  test('shows the versions with the element counts, and opens an older one', async ({ page }) => {
    const name = unique('Versions');
    await openApp(page);
    await openExample(page, 'producer-consumer');
    await rename(page, name);
    await saveAsProject(page, name);
    await page.getByTestId('tool-place').click();
    const box = await page.getByTestId('canvas').boundingBox();
    if (!box) throw new Error('canvas not visible');
    await page.mouse.click(box.x + 650, box.y + 420);
    await page.keyboard.press('Control+s');
    await expect(page.getByTestId('status-server-project')).toContainText('version 2');

    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-item-server-versions').click();
    const rows = page.getByTestId('server-version');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('newest');
    await expect(rows.nth(0).getByTestId('server-version-counts')).toContainText('6 P, 4 T');
    await expect(rows.nth(1).getByTestId('server-version-counts')).toContainText('5 P (−1), 4 T');
    await rows.nth(1).getByRole('button', { name: 'Open version 1' }).click();
    await expect(page.getByTestId('place-shape')).toHaveCount(5);
    await expect(page.getByTestId('dirty-indicator')).toBeVisible();
    // Saving puts the old version on top of the newest.
    await page.keyboard.press('Control+s');
    await expect(page.getByTestId('status-server-project')).toContainText('version 3');
  });

  test('shows a conflict when two people save, and resolves it by reloading or by a copy', async ({
    page,
    browser,
    request,
  }) => {
    const name = unique('Conflict');
    await openApp(page);
    await openExample(page, 'traffic-light');
    await rename(page, name);
    await saveAsProject(page, name);

    const other = await person(browser);
    try {
      await openApp(other.page);
      await other.page.getByTestId('menu-file').click();
      await other.page.getByTestId('menu-item-server-open').click();
      await other.page.getByTestId('server-search').fill(name);
      await other.page.getByRole('button', { name: `Open ${name}` }).click();
      await expect(other.page.getByTestId('status-server-project')).toContainText('version 1');
      await rename(other.page, `${name} (theirs)`);
      await other.page.keyboard.press('Control+s');
      await expect(other.page.getByTestId('status-server-project')).toContainText('version 2');

      // The first person has version 1 and changes it.
      await rename(page, `${name} (mine)`);
      await page.getByTestId('canvas').click({ position: { x: 5, y: 5 } });
      await page.keyboard.press('Control+s');
      const dialog = page.getByTestId('server-conflict-dialog');
      await expect(dialog).toContainText('Version 2 was saved while you were editing version 1');
      // Nothing was overwritten.
      expect((await projectsNamed(request, `${name} (theirs)`))[0]?.version).toBe(2);

      // As a copy: the changes become a project of their own.
      await page.getByTestId('conflict-copy').click();
      await expect(page.getByTestId('server-project-name-input')).toHaveValue(`${name} (copy)`);
      await page.getByTestId('server-project-name-input').fill(`${name} copy`);
      await page.getByTestId('server-save-confirm').click();
      await expect(page.getByTestId('status-server-project')).toContainText(
        `${name} copy · version 1`,
      );
      expect(await projectsNamed(request, `${name} copy`)).toHaveLength(1);
    } finally {
      await other.context.close();
    }
  });

  test('reloads the version of the other person after a conflict', async ({ page, browser }) => {
    const name = unique('Reload');
    await openApp(page);
    await openExample(page, 'traffic-light');
    await rename(page, name);
    await saveAsProject(page, name);

    const other = await person(browser);
    try {
      await openApp(other.page);
      await other.page.getByTestId('menu-file').click();
      await other.page.getByTestId('menu-item-server-open').click();
      await other.page.getByTestId('server-search').fill(name);
      await other.page.getByRole('button', { name: `Open ${name}` }).click();
      await rename(other.page, `${name} (theirs)`);
      await other.page.keyboard.press('Control+s');
      await expect(other.page.getByTestId('status-server-project')).toContainText('version 2');
    } finally {
      await other.context.close();
    }

    await rename(page, `${name} (mine)`);
    await page.getByTestId('canvas').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Control+s');
    await expect(page.getByTestId('server-conflict-dialog')).toBeVisible();
    await page.getByTestId('conflict-reload').click();
    await expect(page.getByTestId('net-name')).toHaveValue(`${name} (theirs)`);
    await expect(page.getByTestId('status-server-project')).toContainText('version 2');
    await expect(page.getByTestId('dirty-indicator')).toBeHidden();
  });

  test('moves a project to the trash and brings it back', async ({ page, request }) => {
    const name = unique('Trash');
    await openApp(page);
    await openExample(page, 'mutual-exclusion');
    await rename(page, name);
    await saveAsProject(page, name);
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-item-server-open').click();
    await page.getByTestId('server-search').fill(name);
    await page.getByRole('button', { name: `Move ${name} to the trash` }).click();
    await page.getByTestId('confirm-accept').click();
    await expect(page.getByTestId('server-project')).toHaveCount(0);
    expect(await projectsNamed(request, name)).toHaveLength(0);
    await page.getByTestId('server-trash-toggle').click();
    await page.getByRole('button', { name: `Restore ${name}` }).click();
    await page.getByTestId('server-trash-toggle').click();
    await page.getByTestId('server-search').fill(name);
    await expect(page.getByTestId('server-project')).toHaveCount(1);
  });
});

test.describe('share links', () => {
  test('a read-only link shows the net, lets people simulate and refuses to save', async ({
    page,
    browser,
    request,
  }) => {
    const name = unique('Shared read');
    await openApp(page);
    await openExample(page, 'producer-consumer');
    await rename(page, name);
    await saveAsProject(page, name);
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-item-server-share').click();
    await page.getByTestId('share-read-create').click();
    const url = await page.getByTestId('share-read-url').inputValue();
    expect(url).toMatch(/\/s\/[A-Za-z0-9_-]{43}$/);
    const [project] = await projectsNamed(request, name);

    const guest = await person(browser);
    try {
      const problems = watchProblems(guest.page);
      await guest.page.goto(url);
      const banner = guest.page.getByTestId('shared-banner');
      await expect(banner).toHaveAttribute('data-mode', 'read');
      await expect(banner).toContainText('read-only link');
      await expect(guest.page.getByTestId('net-name')).toHaveValue(name);
      await expect(guest.page.getByTestId('place-shape')).toHaveCount(5);
      await expect(guest.page.getByTestId('status-server-project')).toContainText('read-only link');

      // Simulation works.
      await guest.page.getByTestId('mode-simulate').click();
      const enabled = guest.page.locator('[data-testid="transition-shape"][data-enabled="true"]');
      await expect(enabled).toHaveCount(1);
      await enabled.click();
      await expect(guest.page.getByTestId('sim-step')).toHaveCount(1);
      await guest.page.getByTestId('mode-edit').click();

      // Saving to the project is not possible: Ctrl+S offers a copy.
      await guest.page.getByTestId('canvas').click({ position: { x: 5, y: 5 } });
      await guest.page.keyboard.press('Control+s');
      await expect(guest.page.getByTestId('server-save-dialog')).toContainText(
        'cannot be changed through this link',
      );
      await expect(guest.page.getByTestId('server-project-name-input')).toHaveValue(
        `${name} (copy)`,
      );
      await guest.page.keyboard.press('Escape');
      expect((await projectsNamed(request, name))[0]?.version).toBe(1);

      // The own autosave of the guest is not touched by the shared page.
      expect(problems).toEqual([]);
    } finally {
      await guest.context.close();
    }

    // Writing to the shared project through the API is refused as well.
    const token = url.split('/s/')[1]!;
    const put = await request.put(`/api/v1/shared/${token}`, {
      headers: { 'If-Match': '"1"' },
      data: JSON.parse(readFileSync(join(examples, 'traffic-light.pn.json'), 'utf8')) as object,
    });
    expect([400, 403]).toContain(put.status());
    expect(project?.version).toBe(1);
  });

  test('a link that can edit saves versions, and removing the link ends it', async ({
    page,
    browser,
    request,
  }) => {
    const name = unique('Shared write');
    await openApp(page);
    await openExample(page, 'traffic-light');
    await rename(page, name);
    await saveAsProject(page, name);
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-item-server-share').click();
    await page.getByTestId('share-write-create').click();
    const url = await page.getByTestId('share-write-url').inputValue();

    const guest = await person(browser);
    try {
      await guest.page.goto(url);
      await expect(guest.page.getByTestId('shared-banner')).toHaveAttribute('data-mode', 'write');
      await rename(guest.page, `${name} edited`);
      await guest.page.getByTestId('canvas').click({ position: { x: 5, y: 5 } });
      await guest.page.keyboard.press('Control+s');
      await expect(guest.page.getByTestId('status-server-project')).toContainText(
        `${name} edited · version 2`,
      );
    } finally {
      await guest.context.close();
    }
    expect((await projectsNamed(request, `${name} edited`))[0]?.version).toBe(2);

    // Remove the link: the page of the link no longer opens the project.
    await page.getByTestId('share-write-remove').click();
    await expect(page.getByTestId('share-write-create')).toBeVisible();
    const late = await person(browser);
    try {
      await late.page.goto(url);
      await expect(late.page.getByTestId('toast-error')).toContainText('share link does not work');
      await expect(late.page.getByTestId('shared-banner')).toHaveCount(0);
    } finally {
      await late.context.close();
    }
  });
});

test.describe('the language model of the server', () => {
  test('is the preset without a key field, answers through the proxy and never shows the key', async ({
    page,
  }) => {
    const authorized: string[] = [];
    const llmRequests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/llm/')) {
        llmRequests.push(`${request.method()} ${new URL(request.url()).pathname}`);
        authorized.push(request.headers()['authorization'] ?? '');
      }
    });
    await openApp(page);
    await openExample(page, 'traffic-light');
    await page.getByTestId('llm-settings-open').click();
    await expect(page.getByTestId('llm-settings')).toBeVisible();
    await expect(page.getByTestId('llm-preset')).toHaveValue('server');
    await expect(page.getByTestId('llm-base-url')).toHaveValue('/llm/v1');
    await expect(page.getByTestId('llm-api-key')).toHaveCount(0);
    await expect(page.getByTestId('llm-model')).toHaveValue('fake-model');
    await expect(page.getByTestId('llm-models-note')).toContainText('2 models found');
    await page.getByTestId('llm-test').click();
    await expect(page.getByTestId('llm-test-result')).toHaveAttribute('data-state', 'ok');
    await expect(page.getByTestId('llm-test-result')).toContainText('Connected to fake-model');
    await page.getByTestId('llm-settings-save').click();
    await expect(page.getByTestId('llm-settings')).toBeHidden();

    // Generate a domain view: the stand-in answers with text, so the generic view is used.
    await page.getByTestId('view-domain').click();
    await page.getByTestId('domain-generate-llm').click();
    await expect(page.getByTestId('llm-dialog')).toHaveAttribute('data-stage', 'form');
    await expect(page.getByTestId('llm-provider-line')).toContainText(
      'fake-model · Server (Ollama)',
    );
    await page.getByTestId('llm-start').click();
    await expect(page.getByTestId('llm-dialog')).toHaveAttribute('data-stage', 'result', {
      timeout: 30_000,
    });
    await expect(page.getByTestId('llm-dialog')).toContainText('generic');

    expect(llmRequests.some((r) => r.startsWith('POST /llm/v1/chat/completions'))).toBe(true);
    expect(llmRequests).toContain('GET /llm/v1/models');
    // The browser sends no key, and the key is nowhere in the page or its storage.
    expect(authorized.every((value) => value === '')).toBe(true);
    const stored = await page.evaluate(() =>
      JSON.stringify({ local: { ...localStorage }, html: document.documentElement.outerHTML }),
    );
    expect(stored).not.toContain(LLM_KEY);
    expect(stored).not.toContain('e2e-placeholder');
  });
});

test.describe('the interface of the server', () => {
  test('answers the tool calls and describes itself', async ({ request }) => {
    const net = JSON.parse(
      readFileSync(join(examples, 'producer-consumer.pn.json'), 'utf8'),
    ) as object;
    const validate = await request.post('/api/v1/validate', { data: { net } });
    expect(validate.status()).toBe(200);
    expect(await validate.json()).toMatchObject({ ok: true });
    const analyze = await request.post('/api/v1/analyze', { data: { net, states: 500 } });
    expect(analyze.status()).toBe(200);
    expect(await analyze.json()).toMatchObject({ stateSpace: { states: expect.any(Number) } });
    const description = await request.get('/api/v1/openapi.json');
    expect(((await description.json()) as { openapi: string }).openapi).toBe('3.1.0');
    const models = await request.get('/llm/v1/models');
    expect(JSON.stringify(await models.json())).not.toContain(LLM_KEY);
    // The paths of the model server that are not meant for users are closed.
    expect((await request.get('/llm/v1/embeddings')).status()).toBe(404);
    expect(
      (
        await request.post('/api/v1/validate', {
          data: 'x',
          headers: { 'Content-Type': 'text/plain' },
        })
      ).status(),
    ).toBe(415);
  });
});
