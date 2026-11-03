#!/usr/bin/env node
// Review pictures of N4 (emoji, wishes, guided and free way of the generate dialog), from a running
// app, in the light and the dark theme: docs/images/review/n4_<name>_<theme>.png.
//
//   PNM_CHROMIUM_PATH=/path/to/chromium node scripts/review-n4.mjs [--url http://localhost:5173]
//       [--out docs/images/review] [--themes light,dark]
//
// The language model is simulated in the page (the request to /chat/completions is answered with
// concepts or with the stored view of the example), so no model is needed.

import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'apps', 'web', 'package.json'));
const { chromium } = require('@playwright/test');

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? (args[at + 1] ?? fallback) : fallback;
};
const url = option('url', 'http://localhost:5173').replace(/\/$/, '');
const out = resolve(option('out', join(root, 'docs', 'images', 'review')));
const themes = option('themes', 'light,dark').split(',');
mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function modelView(id) {
  const file = JSON.parse(readFileSync(join(root, 'examples', `${id}.pn.json`), 'utf8'));
  const answer = structuredClone(file.domainView);
  delete answer.netHash;
  delete answer.provenance;
  return answer;
}

const concept = {
  title: 'Fairy workshop',
  idea: 'The frames are unicorns, and the welding glows.',
  setting: 'A workshop for fairy tales',
  entity: { singular: 'Unicorn', plural: 'Unicorns', emoji: '🦄' },
  stages: [
    { place: 'p_welded', emoji: '🔥' },
    { place: 'p_coated', sprite: 'frame', tint: 'ok' },
    { place: 'p_ready', emoji: '🎁' },
  ],
  counters: [
    { place: 'p_co2', style: 'pictogram', per: 50, emoji: '🌳', history: true },
    { place: 'p_shipped', style: 'pictogram', per: 5, emoji: '🎁' },
    { place: 'p_tubes', style: 'fill', max: 200, icon: 'material' },
  ],
  layout: 'left-to-right',
  equipment: 'zones',
};
const concepts = [
  concept,
  {
    title: 'Plain frames',
    idea: 'Keep the bicycle frames and add colors for the stages.',
    setting: 'A bicycle frame factory',
    entity: { singular: 'Frame', plural: 'Frames', sprite: 'frame' },
    stages: [{ place: 'p_coated', sprite: 'frame', tint: 'accent' }],
    counters: [{ place: 'p_co2', style: 'pictogram', per: 50, icon: 'co2' }],
    layout: 'left-to-right',
    equipment: 'plain',
  },
  {
    title: 'Mixed',
    idea: 'An emoji that does not exist as a single character is left out.',
    setting: 'A workshop',
    entity: { singular: 'Frame', plural: 'Frames', emoji: 'ab' },
    stages: [{ place: 'p_welded', emoji: '🔧' }],
  },
];

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

async function playModel(page, answer) {
  await page.route('**/chat/completions', async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    const body = request.postDataJSON();
    const content = answer(body.messages[0]?.content ?? '', body.messages[1]?.content ?? '');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: cors,
      body: JSON.stringify({
        model: 'review-model',
        choices: [{ message: { role: 'assistant', content: JSON.stringify(content) } }],
        usage: { prompt_tokens: 900, completion_tokens: 600 },
      }),
    });
  });
}

async function openExample(page, id) {
  await page.goto(`${url}/`);
  await page.getByTestId('canvas').waitFor();
  await page.getByTestId('menu-file').click();
  await page.getByTestId(`menu-item-example-${id}`).click();
  await page.getByTestId('place-shape').first().waitFor();
}

async function configure(page) {
  await page.getByTestId('llm-settings-open').click();
  await page.getByTestId('llm-model').fill('review-model');
  await page.getByTestId('llm-settings-save').click();
  await page.getByTestId('llm-settings').waitFor({ state: 'hidden' });
}

async function openDialog(page) {
  await page.getByTestId('view-both').click();
  await page.getByTestId('domain-canvas').waitFor();
  await page.getByTestId('domain-generate-llm').click();
  await page.getByTestId('llm-guided').waitFor();
}

/** Takes the whole dialog (its scroll area is made tall for the picture). */
async function dialogPicture(page, file) {
  const dialog = page.getByRole('dialog');
  await dialog.screenshot({ path: file });
  console.log(file);
}

async function runUntil(page, seconds) {
  await page.getByTestId('domain-simulate').click();
  await page.getByTestId('domain-speed-max').click();
  await page.getByTestId('domain-play').click();
  const clock = page.getByTestId('domain-clock');
  for (let i = 0; i < 4800; i += 1) {
    const [h, m, s] = ((await clock.textContent()) ?? '0:0:0').split(':').map(Number);
    if (h * 3600 + m * 60 + s >= seconds) break;
    await sleep(25);
  }
  await page.getByTestId('domain-play').click();
  await sleep(500);
}

const executablePath = process.env.PNM_CHROMIUM_PATH;
const browser = await chromium.launch({
  ...(executablePath ? { executablePath } : {}),
  args: ['--no-sandbox'],
});
try {
  for (const theme of themes) {
    const context = await browser.newContext({
      viewport: { width: 1360, height: 1500 },
      reducedMotion: 'reduce',
      colorScheme: theme,
    });
    const page = await context.newPage();
    await page.addInitScript((value) => {
      try {
        localStorage.setItem('pnm:theme', value);
      } catch {
        // The page works without it.
      }
    }, theme);
    await playModel(page, (system) => {
      if (system.startsWith('You help a user decide')) return { concepts };
      const view = modelView('bike-frames');
      view.notes = [
        'The color pink is not available; the tint "danger" was used for the rework stage instead.',
      ];
      return view;
    });

    // 1. The guided form with concepts.
    await openExample(page, 'bike-frames');
    await configure(page);
    await openDialog(page);
    await page.getByTestId('guided-suggest').click();
    await page.getByTestId('guided-concept').first().waitFor();
    await sleep(300);
    await dialogPicture(page, join(out, `n4_generate-guided-concepts_${theme}.png`));
    await page.getByTestId('guided-concept-use').first().click();
    await sleep(300);
    await dialogPicture(page, join(out, `n4_generate-guided-form_${theme}.png`));

    // 2. The result with the choices applied and the notes of the model.
    await page.getByTestId('llm-start').click();
    await page.getByTestId('llm-result').waitFor({ timeout: 15000 });
    await sleep(500);
    await dialogPicture(page, join(out, `n4_generate-result_${theme}.png`));

    // 3. The running view with the chosen symbols, and a closer look at the emoji.
    await page.getByTestId('llm-use').click();
    await page.getByTestId('llm-dialog').waitFor({ state: 'hidden' });
    await page.setViewportSize({ width: 1440, height: 860 });
    await page.getByTestId('view-domain').click();
    await page.getByTestId('domain-canvas').waitFor();
    await sleep(500);
    await runUntil(page, 7000);
    await page.mouse.move(700, 840);
    const view = join(out, `n4_emoji-view_${theme}.png`);
    await page.screenshot({ path: view });
    console.log(view);
    for (let i = 0; i < 3; i += 1) await page.getByTestId('domain-zoom-in').click();
    await sleep(500);
    const zoom = join(out, `n4_emoji-view-zoom_${theme}.png`);
    await page.getByTestId('domain-canvas').screenshot({ path: zoom });
    console.log(zoom);
    await context.close();

    // 4. The free way, with a wish and the placeholder.
    const free = await browser.newContext({
      viewport: { width: 1360, height: 900 },
      reducedMotion: 'reduce',
      colorScheme: theme,
    });
    const freePage = await free.newPage();
    await freePage.addInitScript((value) => {
      try {
        localStorage.setItem('pnm:theme', value);
      } catch {
        // The page works without it.
      }
    }, theme);
    await playModel(freePage, () => modelView('parcel-center'));
    await openExample(freePage, 'parcel-center');
    await configure(freePage);
    await freePage.getByTestId('view-both').click();
    await freePage.getByTestId('domain-generate-llm').click();
    await freePage.getByTestId('llm-tab-free').click();
    await freePage.getByTestId('llm-description').fill('');
    await sleep(300);
    await dialogPicture(freePage, join(out, `n4_generate-free-empty_${theme}.png`));
    await freePage
      .getByTestId('llm-description')
      .fill('Die Marken sollen als Einhörner dargestellt werden. Die Pakete sind rosa.');
    await sleep(300);
    await dialogPicture(freePage, join(out, `n4_generate-free_${theme}.png`));
    await free.close();
  }
} finally {
  await browser.close();
}
