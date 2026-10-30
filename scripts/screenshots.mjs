#!/usr/bin/env node
// Makes the screenshots of the README (docs/images/<name>-light.png and -dark.png) from a running
// app. Start the app first (`pnpm dev`, or `pnpm --filter @pnm/web preview` after a build), then:
//
//   PNM_CHROMIUM_PATH=/path/to/chromium node scripts/screenshots.mjs [--url http://localhost:5173]
//       [--out docs/images] [--only editor,analysis] [--themes light,dark]
//   node scripts/screenshots.mjs --review [--out docs/images/review] [--themes light]
//
// With `--review` it makes the review pictures instead: every example at three zoom levels
// (detail 100 %, mid 55 %, far 30 %) and two window widths (`<example>_<theme>_<width>_<level>.png`);
// `--only bike-frames` makes them for one example. An example with a domain view gets pictures of
// the running view as well: `_domain` (a moment of the run), `_domain-busy` (more arrivals, so that
// the stages of the cases show) and `_domain-flow` (the canvas frozen on a frame with a marker of
// an amount on its way, which lasts 300 ms and is hard to catch otherwise).
//
// Without PNM_CHROMIUM_PATH the browser that Playwright installed is used. The simulations are
// seeded, so the pictures only differ by the moment at which they are taken.

import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// Playwright is a dependency of the web app, not of the root.
const require = createRequire(join(root, 'apps', 'web', 'package.json'));
const { chromium } = require('@playwright/test');

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? (args[at + 1] ?? fallback) : fallback;
};
const url = option('url', 'http://localhost:5173').replace(/\/$/, '');
const review = args.includes('--review');
const out = resolve(option('out', join(root, 'docs', 'images', ...(review ? ['review'] : []))));
const only = option('only', '').split(',').filter(Boolean);
const themes = option('themes', review ? 'light' : 'light,dark').split(',');
mkdirSync(out, { recursive: true });

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function openExample(page, id) {
  await page.goto(`${url}/`);
  await page.getByTestId('canvas').waitFor();
  await page.getByTestId('menu-file').click();
  await page.getByTestId(`menu-item-example-${id}`).click();
  await page.getByTestId('place-shape').first().waitFor();
}

/** Lets the simulation run until its clock shows at least `seconds` of model time, then pauses. */
async function runUntil(page, clockId, playId, seconds) {
  await page.getByTestId(playId).click();
  const clock = page.getByTestId(clockId);
  for (let i = 0; i < 4800; i += 1) {
    const [h, m, s] = ((await clock.textContent()) ?? '0:0:0').split(':').map(Number);
    if (h * 3600 + m * 60 + s >= seconds) break;
    await sleep(25);
  }
  await page.getByTestId(playId).click();
  await sleep(500);
}

/** A case that rests on the picture of the domain view, as screen coordinates. */
async function caseOnScreen(page) {
  const canvas = page.getByTestId('domain-canvas');
  const box = await canvas.boundingBox();
  const cases = ((await canvas.getAttribute('data-cases')) ?? '').split(';').filter(Boolean);
  const zoom = Number(await canvas.getAttribute('data-zoom'));
  const panX = Number(await canvas.getAttribute('data-pan-x'));
  const panY = Number(await canvas.getAttribute('data-pan-y'));
  for (const entry of cases) {
    const [, at] = entry.split('@');
    const [x, y] = at.split(',').map(Number);
    const sx = box.x + panX + x * zoom;
    const sy = box.y + panY + y * zoom;
    if (sy > box.y + 80 && sy < box.y + box.height - 120) return [sx, sy];
  }
  return null;
}

const shots = {
  // The editor while simulating the traffic light: two steps are in the history.
  async editor(page) {
    await openExample(page, 'traffic-light');
    await page.getByTestId('mode-simulate').click();
    for (const name of ['A to yellow', 'A to red']) {
      await page.locator('.react-flow__node-transition').filter({ hasText: name }).click();
      await sleep(300);
    }
    await page.getByTestId('canvas').click({ position: { x: 40, y: 500 } });
    await page.mouse.move(700, 780);
  },

  // A JSON net: order processing with the list of bindings of Approve open.
  async 'json-net'(page) {
    await openExample(page, 'order-processing');
    await page.getByTestId('mode-simulate').click();
    await page.locator('.react-flow__node-transition').filter({ hasText: 'Approve' }).click();
    await page.getByTestId('binding-picker').waitFor();
  },

  // The timed simulation of the parcel center in the net editor, with the trace.
  async simulation(page) {
    await openExample(page, 'parcel-center');
    await page.getByTestId('mode-simulate').click();
    await page.getByTestId('sim-speed-max').click();
    await runUntil(page, 'sim-clock', 'sim-play', 6800);
    await page.getByTestId('sim-tab-trace').click();
  },

  // The running domain view of the parcel center, with a followed parcel.
  async 'domain-hall'(page) {
    await openExample(page, 'parcel-center');
    await page.getByTestId('view-domain').click();
    await page.getByTestId('domain-canvas').waitFor();
    await sleep(800);
    await page.getByTestId('domain-simulate').click();
    await page.getByTestId('domain-speed-max').click();
    await runUntil(page, 'domain-clock', 'domain-play', 4150);
    await page.getByTestId('domain-speed-10').click();
    const at = await caseOnScreen(page);
    if (at) await page.mouse.click(at[0], at[1]);
    await sleep(500);
    await page.mouse.move(700, 760);
  },

  // The smart office as a floor plan, with a followed person.
  async 'domain-office'(page) {
    await openExample(page, 'smart-office');
    await page.getByTestId('view-domain').click();
    await page.getByTestId('domain-canvas').waitFor();
    await sleep(800);
    await page.getByTestId('domain-simulate').click();
    await page.getByTestId('domain-speed-max').click();
    await runUntil(page, 'domain-clock', 'domain-play', 3000);
    await page.getByTestId('domain-speed-60').click();
    const at = await caseOnScreen(page);
    if (at) await page.mouse.click(at[0], at[1]);
    await sleep(500);
    await page.mouse.move(700, 760);
  },

  // The mode Edit layout with the scanner selected (twice the pixels, as it is a close view).
  async 'domain-edit'(page) {
    await openExample(page, 'parcel-center');
    await page.getByTestId('view-domain').click();
    await page.getByTestId('domain-mode-edit').click();
    const canvas = page.getByTestId('domain-canvas');
    await page.waitForFunction(() =>
      document.querySelector('[data-testid="domain-canvas"]')?.getAttribute('data-zoom'),
    );
    await sleep(600);
    const box = await canvas.boundingBox();
    const zoom = Number(await canvas.getAttribute('data-zoom'));
    const panX = Number(await canvas.getAttribute('data-pan-x'));
    const panY = Number(await canvas.getAttribute('data-pan-y'));
    await page.mouse.click(box.x + panX + 304 * zoom, box.y + panY + 262 * zoom);
    await sleep(400);
    await page.getByTestId('domain-entry-section').evaluate((el) => {
      el.scrollIntoView({ block: 'start' });
    });
    await page.mouse.move(700, 900);
  },

  // The dialog that generates a view with a language model, here a scripted one.
  async 'llm-generate'(page) {
    const examples = join(root, 'examples');
    const stored = JSON.parse(
      readFileSync(join(examples, 'parcel-center.pn.json'), 'utf8'),
    ).domainView;
    const answer = structuredClone(stored);
    delete answer.netHash;
    delete answer.provenance;
    const wrong = structuredClone(answer);
    wrong.places.p_scanned = { kind: 'slots', of: 't_scan' };
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    };
    await page.route('**/chat/completions', async (route) => {
      if (route.request().method() === 'OPTIONS')
        return route.fulfill({ status: 204, headers: cors });
      const body = route.request().postDataJSON();
      const repair = body.messages[1]?.content.includes('## Findings of the checking program');
      const content = repair ? { places: { p_scanned: stored.places.p_scanned } } : wrong;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: cors,
        body: JSON.stringify({
          model: 'example-model',
          choices: [{ message: { role: 'assistant', content: JSON.stringify(content) } }],
          usage: { prompt_tokens: 5200, completion_tokens: 2300 },
        }),
      });
    });
    await openExample(page, 'parcel-center');
    await page.getByTestId('view-domain').click();
    await page.getByTestId('domain-canvas').waitFor();
    await page.getByTestId('llm-settings-open').click();
    await page.getByTestId('llm-model').fill('example-model');
    await page.getByTestId('llm-settings-save').click();
    await page.getByTestId('domain-generate-llm').click();
    await page.getByTestId('llm-description').fill('Parcel center, hall 2, three loading gates');
    await page.getByTestId('llm-start').click();
    await page
      .locator('[data-testid="llm-dialog"][data-stage="result"]')
      .waitFor({ timeout: 20_000 });
    await page.getByTestId('llm-rounds-details').locator('summary').click();
    // The toast of the saved settings goes away.
    await sleep(3500);
  },

  // The Analyze tab: two properties of the order processing net, one of them violated.
  async analysis(page) {
    await openExample(page, 'order-processing');
    await page.getByTestId('right-tab-analyze').click();
    await page.getByTestId('analysis-panel').waitFor();
    await page.getByTestId('check-space').click();
    await page.getByTestId('counterexample').waitFor();
    await page.getByTestId('properties-card').evaluate((el) => {
      el.scrollIntoView({ block: 'start' });
    });
    await sleep(500);
  },
};

// The size of each picture: the window and the density of pixels.
const sizes = {
  'domain-edit': { width: 1360, height: 820, scale: 2 },
  'llm-generate': { width: 1440, height: 1020, scale: 1 },
};

/** Zooms the net editor to about `target` percent with the buttons of the view. */
async function zoomTo(page, target) {
  const label = page.getByTestId('zoom-level');
  const percent = async () =>
    Number.parseInt(((await label.textContent()) ?? '100').replace('%', ''), 10);
  await page.keyboard.press('Control+0');
  for (let i = 0; i < 30 && (await percent()) > target; i += 1) {
    await page.getByTestId('zoom-out').click();
    await sleep(120);
  }
}

const LEVELS = { detail: 100, mid: 55, far: 30 };
/** Simulated seconds after which the picture of the running domain view is taken. */
const DOMAIN_SECONDS = { 'parcel-center': 4150, 'smart-office': 3000, 'bike-frames': 14400 };
/** The examples that also get the busy and the flow picture, with the arrivals per hour of the first. */
const BUSY_RATE = { 'bike-frames': 8 };
/**
 * The looks of the stages (`sprite` or `sprite/tint`) that the pictures of an example wait for, so
 * that they show a case in each: an order, tubes, a raw frame, a coated frame and a parcel.
 */
const STAGES = { 'bike-frames': ['document', 'bars', 'frame/neutral', 'frame/accent', 'parcel'] };

/** Sets the first slider of the simulation panel (the arrival rate) to `value`. */
async function setArrivalRate(page, value) {
  await page
    .locator('input[type=range]')
    .first()
    .evaluate((el, v) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
}

/** Opens the domain view of the example in the simulation, runs it to `seconds` and pauses. */
async function runDomain(page, seconds, rate) {
  await page.getByTestId('view-domain').click();
  await page.getByTestId('domain-canvas').waitFor();
  await sleep(800);
  await page.getByTestId('domain-simulate').click();
  await page.getByTestId('domain-speed-max').click();
  if (rate !== undefined) await setArrivalRate(page, rate);
  await runUntil(page, 'domain-clock', 'domain-play', seconds);
  await page.mouse.move(700, 4);
  await sleep(400);
}

/**
 * Plays the simulation at 10 times until the canvas shows a case in each of the `wanted` looks
 * (`data-looks` of the canvas), then pauses. Gives up after `timeout` milliseconds.
 */
async function playUntilLooks(page, wanted, timeout = 60_000) {
  const canvas = page.getByTestId('domain-canvas');
  await page.getByTestId('domain-speed-10').click();
  await page.getByTestId('domain-play').click();
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const looks = ((await canvas.getAttribute('data-looks')) ?? '')
      .split(';')
      .filter(Boolean)
      .map((entry) => entry.split('=')[1]);
    if (wanted.every((look) => looks.includes(look))) break;
    await sleep(30);
  }
  await page.getByTestId('domain-play').click();
  await sleep(400);
}

/**
 * Lets the simulation play at 30 times and freezes the canvas on the first frame that has
 * something of the kind `what` (`flows`: a marker of an amount, `blending`: a case that changes
 * its look), so that a picture can show it.
 */
async function freezeOn(page, what) {
  await page.evaluate((attr) => {
    const canvas = document.querySelector('[data-testid="domain-canvas"]');
    window.__frozen = false;
    const watch = new MutationObserver(() => {
      if (Number(canvas.getAttribute(`data-${attr}`)) > 0) {
        window.requestAnimationFrame = () => 0;
        window.__frozen = true;
        watch.disconnect();
      }
    });
    watch.observe(canvas, { attributes: true, attributeFilter: [`data-${attr}`] });
  }, what);
  await page.getByTestId('domain-speed-30').click();
  await page.getByTestId('domain-play').click();
  await page.waitForFunction(() => window.__frozen === true, null, { timeout: 60_000 });
}
const WIDTHS = { 1280: 800, 1920: 1080 };

const executablePath = process.env.PNM_CHROMIUM_PATH;
const browser = await chromium.launch({
  ...(executablePath ? { executablePath } : {}),
  args: ['--no-sandbox'],
});
try {
  if (review) {
    const { readdirSync } = await import('node:fs');
    const ids = readdirSync(join(root, 'examples'))
      .filter((file) => file.endsWith('.pn.json'))
      .map((file) => file.replace(/\.pn\.json$/, ''))
      .filter((id) => only.length === 0 || only.includes(id));
    for (const theme of themes) {
      for (const [width, height] of Object.entries(WIDTHS)) {
        for (const id of ids) {
          // A context of its own: the autosave of the last example would ask before it is replaced.
          const context = await browser.newContext({
            viewport: { width: Number(width), height },
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
          await openExample(page, id);
          for (const [level, target] of Object.entries(LEVELS)) {
            await zoomTo(page, target);
            await page.mouse.move(Number(width) * 0.62, 12);
            await sleep(500);
            const file = join(out, `${id}_${theme}_${width}_${level}.png`);
            await page.screenshot({ path: file });
            console.log(file);
          }
          const seconds = DOMAIN_SECONDS[id];
          if (seconds !== undefined) {
            await runDomain(page, seconds);
            const file = join(out, `${id}_${theme}_${width}_domain.png`);
            await page.screenshot({ path: file });
            console.log(file);
          }
          await context.close();
          const rate = BUSY_RATE[id];
          if (seconds === undefined || rate === undefined) continue;
          // More arrivals: cases on every belt, in the look of their stage.
          const busy = await browser.newContext({
            viewport: { width: Number(width), height },
            reducedMotion: 'reduce',
            colorScheme: theme,
          });
          const busyPage = await busy.newPage();
          await busyPage.addInitScript((value) => {
            try {
              localStorage.setItem('pnm:theme', value);
            } catch {
              // The page works without it.
            }
          }, theme);
          await openExample(busyPage, id);
          await runDomain(busyPage, 3600, rate);
          await playUntilLooks(busyPage, STAGES[id] ?? []);
          const busyFile = join(out, `${id}_${theme}_${width}_domain-busy.png`);
          await busyPage.screenshot({ path: busyFile });
          console.log(busyFile);
          await busy.close();
          // Motion on: the canvas stops on a frame with a marker of an amount.
          const moving = await browser.newContext({
            viewport: { width: Number(width), height },
            reducedMotion: 'no-preference',
            colorScheme: theme,
          });
          const movingPage = await moving.newPage();
          await movingPage.addInitScript((value) => {
            try {
              localStorage.setItem('pnm:theme', value);
            } catch {
              // The page works without it.
            }
          }, theme);
          await openExample(movingPage, id);
          await runDomain(movingPage, 3600, rate);
          await freezeOn(movingPage, 'flows');
          const flowFile = join(out, `${id}_${theme}_${width}_domain-flow.png`);
          await movingPage.screenshot({ path: flowFile });
          console.log(flowFile);
          await moving.close();
        }
      }
    }
    process.exitCode = 0;
    await browser.close();
    process.exit(0);
  }
  for (const [name, shoot] of Object.entries(shots)) {
    if (only.length > 0 && !only.includes(name)) continue;
    for (const theme of themes) {
      const size = sizes[name] ?? { width: 1440, height: 860, scale: 1 };
      const context = await browser.newContext({
        viewport: { width: size.width, height: size.height },
        deviceScaleFactor: size.scale,
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
      await shoot(page);
      await sleep(400);
      const file = join(out, `${name}-${theme}.png`);
      await page.screenshot({ path: file });
      console.log(file);
      await context.close();
    }
  }
} finally {
  await browser.close();
}
