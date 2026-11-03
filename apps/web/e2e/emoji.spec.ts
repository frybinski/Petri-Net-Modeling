import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const examples = join(import.meta.dirname, '..', '..', '..', 'examples');

interface Stored {
  domainView: Record<string, unknown> & { meta: Record<string, unknown> };
}

/** The stored view of an example: what a model would be asked to write, without hash and provenance. */
function modelView(id: string): Record<string, unknown> {
  const file = JSON.parse(readFileSync(join(examples, `${id}.pn.json`), 'utf8')) as Stored;
  const { netHash: _hash, provenance: _provenance, ...answer } = structuredClone(file.domainView);
  return answer;
}

function completion(content: unknown): string {
  return JSON.stringify({
    model: 'pw-model',
    choices: [{ message: { role: 'assistant', content: JSON.stringify(content) } }],
    usage: { prompt_tokens: 900, completion_tokens: 600 },
  });
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

interface Seen {
  system: string[];
  user: string[];
}

/** Plays the simulated model: `answer` gets the system and the user text of each request. */
async function playModel(
  page: Page,
  answer: (system: string, user: string) => unknown,
): Promise<Seen> {
  const seen: Seen = { system: [], user: [] };
  await page.route('**/chat/completions', async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    const body = request.postDataJSON() as { messages: Array<{ content: string }> };
    const system = body.messages[0]?.content ?? '';
    const user = body.messages[1]?.content ?? '';
    seen.system.push(system);
    seen.user.push(user);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: cors,
      body: completion(answer(system, user)),
    });
  });
  return seen;
}

async function openExample(page: Page, id: string): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
  await page.getByTestId('menu-file').click();
  await page.getByTestId(`menu-item-example-${id}`).click();
  await expect(page.getByTestId('place-shape').first()).toBeVisible();
}

async function configureProvider(page: Page): Promise<void> {
  await page.getByTestId('llm-settings-open').click();
  await expect(page.getByTestId('llm-settings')).toBeVisible();
  await page.getByTestId('llm-model').fill('pw-model');
  await page.getByTestId('llm-settings-save').click();
  await expect(page.getByTestId('llm-settings')).toBeHidden();
}

/** The looks of the resting cases on the domain canvas: `{ place: [look, ...] }`. */
async function looksByElement(page: Page): Promise<Record<string, string[]>> {
  const text = (await page.getByTestId('domain-canvas').getAttribute('data-looks')) ?? '';
  const found: Record<string, string[]> = {};
  for (const entry of text.split(';').filter(Boolean)) {
    const [, rest = ''] = entry.split('@');
    const [at = '', look = ''] = rest.split('=');
    (found[at] ??= []).push(look);
  }
  return found;
}

/** Runs the simulation at top speed and collects the looks of the resting cases, until all of `wanted` were seen. */
async function runUntilSeen(page: Page, wanted: string[], maxHours: number): Promise<Set<string>> {
  const seen = new Set<string>();
  await page.getByTestId('domain-simulate').click();
  await expect(page.getByTestId('domain-clock')).toHaveText('00:00:00');
  await page.getByTestId('domain-speed-max').click();
  await page.getByTestId('domain-play').click();
  await expect
    .poll(
      async () => {
        for (const [at, list] of Object.entries(await looksByElement(page))) {
          for (const look of list) seen.add(`${at}=${look}`);
        }
        const [h = 0] = ((await page.getByTestId('domain-clock').textContent()) ?? '')
          .split(':')
          .map(Number);
        return wanted.every((look) => seen.has(look)) || h >= maxHours
          ? 'done'
          : `${h} h, seen ${[...seen].join(' ')}`;
      },
      { timeout: 25_000, intervals: [30] },
    )
    .toBe('done');
  await page.getByTestId('domain-play').click();
  return seen;
}

test('a wish in the description: the tokens become unicorns, the model says what it could not do', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // The simulated model follows the wish with an emoji and admits that it cannot paint in pink.
  const seen = await playModel(page, () => {
    const answer = modelView('parcel-center') as { meta: Record<string, unknown> };
    answer.meta['entity'] = { singular: 'Einhorn', plural: 'Einhörner', emoji: '🦄' };
    return {
      ...answer,
      notes: ['Rosa ist keine Farbe des Formats; die Einhörner behalten ihre eigenen Farben.'],
    };
  });
  await openExample(page, 'parcel-center');
  await page.getByTestId('view-both').click();
  await configureProvider(page);
  await page.getByTestId('domain-generate-llm').click();
  const dialog = page.getByTestId('llm-dialog');
  await expect(dialog).toHaveAttribute('data-stage', 'form');

  // The guided form is the first tab; the wish is written in the free one.
  await expect(page.getByTestId('llm-tab-guided')).toHaveAttribute('aria-selected', 'true');
  await page.getByTestId('llm-tab-free').click();
  await page
    .getByTestId('llm-description')
    .fill('Die Marken sollen als Einhörner dargestellt werden');
  await page.getByTestId('llm-start').click();
  await expect(dialog).toHaveAttribute('data-stage', 'result', { timeout: 15_000 });

  // The wish was in the request, and the system text asks to follow wishes and to use emoji.
  expect(seen.user[0]).toContain('Die Marken sollen als Einhörner dargestellt werden');
  expect(seen.system[0]).toContain('Wishes and emoji');
  // The result shows the note of the model above the preview.
  const notes = page.getByTestId('llm-model-notes');
  await expect(notes).toBeVisible();
  await expect(page.getByTestId('llm-model-note')).toContainText('Rosa ist keine Farbe');
  const above = await page.evaluate(() => {
    const note = document.querySelector('[data-testid="llm-model-notes"]');
    const preview = document.querySelector('[data-testid="llm-preview"]');
    return !!note && !!preview && !!(note.compareDocumentPosition(preview) & 4);
  });
  expect(above).toBe(true);

  await page.getByTestId('llm-use').click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('domain-status')).toHaveText('0 problems');
  // The note is in the log of the generation, not in the view.
  await page.getByTestId('domain-show-log').click();
  await expect(page.getByTestId('llm-log-model-notes')).toContainText('Rosa ist keine Farbe');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('llm-log')).toBeHidden();

  // The running view carries the unicorns: the entity says so, and every case that rests on the
  // canvas looks like a 🦄.
  await expect(page.getByTestId('domain-canvas')).toHaveAttribute('data-entity', '🦄');
  const looks = await runUntilSeen(page, ['t_scan=🦄', 'p_in=🦄'], 2);
  expect(looks.size).toBeGreaterThan(0);
  for (const look of looks) {
    expect(look.endsWith('=🦄'), look).toBe(true);
  }
  expect(errors).toEqual([]);
});

test('the guided way: pick a concept, generate, and the view carries the chosen symbols and displays', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const concept = {
    title: 'Fairy workshop',
    idea: 'Frames are unicorns that glow while they are welded.',
    setting: 'A workshop for fairy tales',
    entity: { singular: 'Unicorn', plural: 'Unicorns', emoji: '🦄' },
    stages: [
      { place: 'p_welded', emoji: '🔥' },
      { place: 'p_coated', sprite: 'frame', tint: 'ok' },
    ],
    counters: [
      { place: 'p_co2', style: 'pictogram', per: 50, emoji: '🌳', history: true },
      { place: 'p_tubes', style: 'fill', max: 200, icon: 'material' },
      { place: 'p_nope', style: 'number' },
    ],
    layout: 'left-to-right',
    equipment: 'zones',
  };
  // The concept request gets concepts; the request for the view gets the stored view of the
  // example, which looks different from what was chosen: the tool has to put the choice there.
  const seen = await playModel(page, (system) =>
    system.startsWith('You help a user decide')
      ? { concepts: [concept] }
      : (modelView('bike-frames') as unknown),
  );
  await openExample(page, 'bike-frames');
  await page.getByTestId('view-both').click();
  await configureProvider(page);
  await page.getByTestId('domain-generate-llm').click();
  const dialog = page.getByTestId('llm-dialog');
  await expect(dialog).toHaveAttribute('data-stage', 'form');
  await expect(page.getByTestId('llm-guided')).toBeVisible();

  // The form starts from the view of the net.
  await expect(page.getByTestId('guided-stage-p_welded-symbol')).toHaveValue('frame');
  await expect(page.getByTestId('guided-counter-p_tubes-max')).toHaveValue('200');

  await page.getByTestId('guided-suggest').click();
  const card = page.getByTestId('guided-concept');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('Fairy workshop');
  // The part with the unknown place was left out and noted on the card.
  await expect(card.getByTestId('guided-concept-dropped')).toContainText('1 invalid part left out');
  expect(seen.system[0]).toContain('You help a user decide');
  await card.getByTestId('guided-concept-use').click();
  await expect(page.getByTestId('guided-setting')).toHaveValue('A workshop for fairy tales');
  await expect(page.getByTestId('guided-entity-emoji')).toHaveValue('🦄');
  await expect(page.getByTestId('guided-stage-p_welded-emoji')).toHaveValue('🔥');
  await expect(page.getByTestId('guided-counter-p_co2-emoji')).toHaveValue('🌳');

  await page.getByTestId('llm-start').click();
  await expect(dialog).toHaveAttribute('data-stage', 'result', { timeout: 15_000 });
  expect(seen.user[1]).toContain('## Binding choices');
  expect(seen.user[1]).toContain('"emoji" "🦄"');
  // The model did not follow the choices; each replacement is told.
  const notes = page.getByTestId('llm-notes');
  await expect(notes).toContainText('Choice applied');
  await expect(notes).toContainText('🔥');
  await page.getByTestId('llm-use').click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('domain-status')).toHaveText('0 problems');

  // The view carries the chosen displays: read them from the entries of the places.
  const entryOf = async (name: RegExp): Promise<Record<string, unknown>> => {
    await page.locator('.react-flow__node-place').filter({ hasText: name }).click();
    const text = await page.getByTestId('domain-entry').textContent();
    return JSON.parse(text ?? '{}') as Record<string, unknown>;
  };
  expect((await entryOf(/CO₂e/))['display']).toMatchObject({
    style: 'pictogram',
    per: 50,
    emoji: '🌳',
    history: true,
  });
  expect((await entryOf(/Geschweißt/))['appearance']).toEqual({ emoji: '🔥' });
  expect((await entryOf(/Beschichtet/))['appearance']).toEqual({ sprite: 'frame', tint: 'ok' });

  // And the running view shows the stages as chosen.
  await page.getByTestId('view-domain').click();
  await expect(page.getByTestId('domain-canvas')).toHaveAttribute('data-entity', '🦄');
  const looks = await runUntilSeen(page, ['t_cut=🦄', 't_coat=🔥', 't_check=frame/ok'], 24);
  // A frame in the coating station still looks like the place it came from, a welded one: 🔥.
  expect(looks).toContain('t_coat=🔥');
  // One that is checked came from the coated stage, in the chosen color.
  expect(looks).toContain('t_check=frame/ok');
  // The first stage had a document in the stored view; the choice is "like the entity", and a
  // case in the saw station looks like the place it came from.
  expect(looks).toContain('t_cut=🦄');
  expect([...looks].some((look) => look.startsWith('t_cut=document'))).toBe(false);
  // Nothing of the stored view's frames in grey is left where a choice was made.
  expect([...looks].some((look) => look.startsWith('t_coat=frame'))).toBe(false);
  expect(errors).toEqual([]);
});

test('apply without LLM: the symbols change, the layout stays, and one undo takes it back', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openExample(page, 'bike-frames');
  await page.getByTestId('view-both').click();
  await expect(page.getByTestId('domain-canvas')).toHaveAttribute('data-zoom', /\d/);
  await page.getByTestId('domain-generate-llm').click();
  // No model is set up, and the form still works.
  await expect(page.getByTestId('llm-not-configured')).toBeVisible();
  await expect(page.getByTestId('llm-start')).toBeDisabled();
  await page.getByTestId('guided-entity-symbol').selectOption('__emoji');
  await page.getByTestId('guided-entity-emoji').fill('🦄');
  await page.getByTestId('guided-entity-emoji').press('Enter');
  await page.getByTestId('guided-apply').click();
  await expect(page.getByTestId('llm-dialog')).toBeHidden();
  await expect(page.getByTestId('domain-canvas')).toHaveAttribute('data-entity', '🦄');
  await expect(page.getByTestId('domain-status')).toHaveText('0 problems');
  await page.getByTestId('undo').click();
  await expect(page.getByTestId('domain-canvas')).toHaveAttribute('data-entity', 'frame');
  expect(errors).toEqual([]);
});
