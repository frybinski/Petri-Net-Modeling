import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page, type Route } from '@playwright/test';

const examples = join(import.meta.dirname, '..', '..', '..', 'examples');

type Entry = { kind: string; box?: number[]; pos?: number[]; of?: string };
interface View {
  meta: { canvas: { width: number; height: number } };
  places: Record<string, Entry>;
  transitions: Record<string, Entry>;
  netHash?: string;
  provenance?: unknown;
}

/** The stored view of the parcel center: what a model would be asked to write. */
function storedView(): View {
  const file = JSON.parse(readFileSync(join(examples, 'parcel-center.pn.json'), 'utf8')) as {
    domainView: View;
  };
  return file.domainView;
}

/** The view as a model writes it: no hash, no provenance. */
function modelAnswer(mistake: boolean): Record<string, unknown> {
  const { netHash: _hash, provenance: _provenance, ...answer } = structuredClone(storedView());
  if (mistake) answer.places['p_scanned'] = { kind: 'slots', of: 't_scan' };
  return answer as unknown as Record<string, unknown>;
}

function completion(content: unknown, model = 'pw-model'): string {
  return JSON.stringify({
    model,
    choices: [{ message: { role: 'assistant', content: JSON.stringify(content) } }],
    usage: { prompt_tokens: 1200, completion_tokens: 800 },
  });
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

interface Seen {
  bodies: Array<{ messages: Array<{ content: string }>; response_format?: { type: string } }>;
  authorization: Array<string | undefined>;
}

/** Plays the provider: the first answer has a mistake (V4), the repair fixes it. */
async function playProvider(
  page: Page,
  onRequest?: (route: Route) => Promise<boolean>,
): Promise<Seen> {
  const seen: Seen = { bodies: [], authorization: [] };
  await page.route('**/chat/completions', async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    if (onRequest && (await onRequest(route))) return;
    const body = request.postDataJSON() as Seen['bodies'][number];
    seen.bodies.push(body);
    seen.authorization.push(request.headers()['authorization']);
    const repair = body.messages[1]?.content.includes('## Findings of the checking program');
    const content = repair
      ? { places: { p_scanned: storedView().places['p_scanned'] } }
      : modelAnswer(true);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: cors,
      body: completion(content),
    });
  });
  return seen;
}

async function openParcelCenter(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-item-example-parcel-center').click();
  await expect(page.getByTestId('place-shape').first()).toBeVisible();
}

async function configureProvider(page: Page, key = ''): Promise<void> {
  await page.getByTestId('llm-settings-open').click();
  await expect(page.getByTestId('llm-settings')).toBeVisible();
  await page.getByTestId('llm-model').fill('pw-model');
  if (key) await page.getByTestId('llm-api-key').fill(key);
  await page.getByTestId('llm-settings-save').click();
  await expect(page.getByTestId('llm-settings')).toBeHidden();
}

async function sheetToScreen(canvas: Locator, x: number, y: number): Promise<[number, number]> {
  const box = await canvas.boundingBox();
  if (!box) throw new Error('domain canvas not visible');
  const zoom = Number(await canvas.getAttribute('data-zoom'));
  const panX = Number(await canvas.getAttribute('data-pan-x'));
  const panY = Number(await canvas.getAttribute('data-pan-y'));
  return [box.x + panX + x * zoom, box.y + panY + y * zoom];
}

test('a model repairs its view in round 2, the person uses it and sees where it came from', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const seen = await playProvider(page);
  await openParcelCenter(page);
  await page.getByTestId('view-both').click();
  await expect(page.getByTestId('domain-canvas')).toBeVisible();
  await expect(page.getByTestId('origin-user')).toHaveText('30 user');

  await configureProvider(page);
  await page.getByTestId('domain-generate-llm').click();
  const dialog = page.getByTestId('llm-dialog');
  await expect(dialog).toHaveAttribute('data-stage', 'form');
  await expect(page.getByTestId('llm-replace-note')).toBeVisible();
  await expect(page.getByTestId('llm-provider-line')).toContainText('pw-model');
  await page.getByTestId('llm-description').fill('Parcel center, hall 2, three loading gates');
  await page.getByTestId('llm-start').click();

  await expect(dialog).toHaveAttribute('data-stage', 'result', { timeout: 15_000 });
  await expect(page.getByTestId('llm-outcome')).toContainText('after 2 rounds');
  await expect(page.getByTestId('llm-no-findings')).toBeVisible();

  // The log shows both rounds; the first one found the wrong kind.
  await page.getByTestId('llm-rounds-details').locator('summary').click();
  const rounds = page.getByTestId('llm-round');
  await expect(rounds).toHaveCount(2);
  await expect(rounds.nth(0).getByTestId('llm-finding').first()).toHaveAttribute('data-rule', 'V4');
  await expect(rounds.nth(1)).toContainText('no findings');
  // The preview was painted.
  const painted = await page.getByTestId('llm-preview').evaluate((element) => {
    const source = element as HTMLCanvasElement;
    const ctx = source.getContext('2d');
    if (!ctx) return 0;
    const data = ctx.getImageData(0, 0, source.width, source.height).data;
    const colors = new Set<number>();
    for (let i = 0; i < data.length; i += 4 * 97) {
      colors.add(((data[i] ?? 0) << 16) | ((data[i + 1] ?? 0) << 8) | (data[i + 2] ?? 0));
    }
    return colors.size;
  });
  expect(painted).toBeGreaterThan(4);
  // The prompt that was sent can be read.
  await page.getByTestId('llm-prompt-details').locator('summary').click();
  await expect(page.getByTestId('llm-prompt')).toContainText(
    'Parcel center, hall 2, three loading gates',
  );

  expect(seen.bodies).toHaveLength(2);
  expect(seen.bodies[0]?.response_format?.type).toBe('json_schema');
  await page.getByTestId('llm-use').click();
  await expect(dialog).toBeHidden();

  // The panel: origin llm, no problems, who generated it.
  await expect(page.getByTestId('origin-llm')).toHaveText(/^[1-9]\d* LLM$/);
  await expect(page.getByTestId('origin-user')).toHaveText('0 user');
  await expect(page.getByTestId('domain-status')).toHaveText('0 problems');
  await expect(page.getByTestId('domain-generated-by')).toContainText('Generated by pw-model on');
  await page.getByTestId('domain-show-log').click();
  await expect(page.getByTestId('llm-log')).toContainText('pw-model');
  // The rounds are folded away until the person opens them.
  const logRounds = page.getByTestId('llm-log').getByTestId('llm-round');
  await expect(logRounds.first()).toBeHidden();
  await page.getByTestId('llm-log').locator('summary').first().click();
  await expect(logRounds).toHaveCount(2);
  await expect(logRounds.first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('llm-log')).toBeHidden();

  // The hover card shows the model.
  const canvas = page.getByTestId('domain-canvas');
  const sorter = storedView().transitions['t_sort'];
  if (!sorter?.box) throw new Error('t_sort has no box');
  const [x, y, w, h] = sorter.box as [number, number, number, number];
  const [sx, sy] = await sheetToScreen(canvas, x + w / 2, y + h - 12);
  await page.mouse.move(sx, sy);
  await expect(canvas).toHaveAttribute('data-hover', 't_sort');
  await expect(page.getByTestId('domain-hover-card')).toContainText('LLM (pw-model)');

  // One undo brings the hand-made view back.
  await page.mouse.move(5, 5);
  await page.getByTestId('undo').click();
  await expect(page.getByTestId('origin-user')).toHaveText('30 user');
  await expect(page.getByTestId('origin-llm')).toHaveText('0 LLM');
  await expect(page.getByTestId('domain-generated-by')).toBeHidden();
  expect(errors).toEqual([]);
});

test('the API key goes to the server as a bearer token and stays out of saved nets', async ({
  page,
}) => {
  const key = 'sk-e2e-secret-4711';
  const seen = await playProvider(page);
  await openParcelCenter(page);
  await page.getByTestId('view-domain').click();
  await configureProvider(page, key);
  await page.getByTestId('domain-generate-llm').click();
  await page.getByTestId('llm-start').click();
  await expect(page.getByTestId('llm-dialog')).toHaveAttribute('data-stage', 'result', {
    timeout: 15_000,
  });
  await page.getByTestId('llm-use').click();
  await expect(page.getByTestId('origin-llm')).toHaveText(/^[1-9]\d* LLM$/);
  expect(seen.authorization.every((value) => value === `Bearer ${key}`)).toBe(true);

  // The key is kept in its own entry of this browser and nowhere in the document.
  const stored = await page.evaluate(() => ({
    key: localStorage.getItem('pnm:llm-key'),
    settings: localStorage.getItem('pnm:llm'),
  }));
  expect(stored.key).toBe(key);
  expect(stored.settings).not.toContain(key);
  const download = page.waitForEvent('download');
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-item-save').click();
  const file = await download;
  const text = readFileSync((await file.path()) ?? '', 'utf8');
  expect(text).toContain('domainViewGeneration');
  expect(text).toContain('"rounds"');
  expect(text).not.toContain(key);
  expect(text).not.toContain('Bearer');
});

test('a refused request is explained and the form comes back', async ({ page }) => {
  await playProvider(page, async (route) => {
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      headers: cors,
      body: JSON.stringify({ error: { message: 'Incorrect API key provided' } }),
    });
    return true;
  });
  await openParcelCenter(page);
  await page.getByTestId('view-domain').click();
  await configureProvider(page);
  await page.getByTestId('domain-generate-llm').click();
  await page.getByTestId('llm-start').click();
  const dialog = page.getByTestId('llm-dialog');
  await expect(dialog).toHaveAttribute('data-stage', 'error', { timeout: 15_000 });
  await expect(page.getByTestId('llm-failure')).toContainText('Incorrect API key');
  await expect(page.getByTestId('llm-failure')).toContainText('Check it in the provider settings');
  await page.getByTestId('llm-retry').click();
  await expect(dialog).toHaveAttribute('data-stage', 'form');
  // The document is untouched.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('origin-user')).toHaveText('30 user');
});

test('the settings dialog tests the connection and lists the models', async ({ page }) => {
  await page.route('**/v1/models', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: cors,
      body: JSON.stringify({ data: [{ id: 'model-b' }, { id: 'model-a' }] }),
    });
  });
  await playProvider(page, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: cors,
      body: completion('OK', 'pw-model'),
    });
    return true;
  });
  await page.goto('/');
  await page.getByTestId('llm-settings-open').click();
  await expect(page.getByTestId('llm-ollama-hint')).toContainText('OLLAMA_ORIGINS');
  await expect(page.getByTestId('llm-test')).toBeDisabled();
  await page.getByTestId('llm-load-models').click();
  await expect(page.getByTestId('llm-models-note')).toContainText('2 models found');
  await page.getByTestId('llm-model').fill('model-a');
  await page.getByTestId('llm-test').click();
  await expect(page.getByTestId('llm-test-result')).toHaveAttribute('data-state', 'ok');
  await expect(page.getByTestId('llm-test-result')).toContainText('Connected to pw-model');
  await page.getByTestId('llm-settings-save').click();
  await page.reload();
  await page.getByTestId('llm-settings-open').click();
  await expect(page.getByTestId('llm-model')).toHaveValue('model-a');
});
