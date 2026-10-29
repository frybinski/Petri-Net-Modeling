import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Download, type Page } from '@playwright/test';

const root = join(import.meta.dirname, '..', '..', '..');
const fixture = (name: string): Promise<string> =>
  readFile(join(root, 'packages', 'io', 'test', 'fixtures', 'pnml', name), 'utf8');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function openApp(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
}

async function openExample(page: Page, id: string): Promise<void> {
  await openApp(page);
  await page.getByTestId('menu-file').click();
  await page.getByTestId(`menu-item-example-${id}`).click();
  await expect(page.getByTestId('place-shape').first()).toBeVisible();
}

async function menuItem(page: Page, id: string): Promise<void> {
  await page.getByTestId('menu-file').click();
  await page.getByTestId(`menu-item-${id}`).click();
}

async function readDownload(download: Download): Promise<Buffer> {
  return readFile(await download.path());
}

/** Width and height from the IHDR chunk of a PNG. */
function pngSize(png: Buffer): { width: number; height: number; colorType: number } {
  expect(png.subarray(0, 8)).toEqual(PNG_SIGNATURE);
  expect(png.subarray(12, 16).toString('latin1')).toBe('IHDR');
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20), colorType: png[25] ?? -1 };
}

async function downloadFromDialog(page: Page): Promise<Download> {
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('export-download').click();
  return downloadPromise;
}

test('a PNML file without positions is imported, laid out and reported', async ({ page }) => {
  await openApp(page);
  await page.getByTestId('open-file-input').setInputFiles({
    name: 'reklamation.pnml',
    mimeType: 'application/xml',
    buffer: Buffer.from(await fixture('mockup-reklamation.pnml')),
  });
  await expect(page.getByTestId('net-name')).toHaveValue('Reklamation');
  await expect(page.getByTestId('place-shape')).toHaveCount(8);
  await expect(page.getByTestId('transition-shape')).toHaveCount(7);
  await expect(page.getByTestId('arc')).toHaveCount(16);
  // The net was laid out: no two nodes on top of each other, so all are visible and distinct.
  const report = page.getByTestId('import-report');
  await expect(report).toBeVisible();
  await expect(report).toContainText('Reklamation: 8 places, 7 transitions, 16 arcs.');
  await expect(page.getByTestId('import-laid-out')).toBeVisible();
  await page.getByTestId('import-report-ok').click();
  await expect(report).toBeHidden();
  // The import is a new, unsaved document.
  await expect(page.getByTestId('dirty-indicator')).toBeVisible();
  // It can be simulated.
  await page.getByTestId('mode-simulate').click();
  await expect(page.locator('[data-testid="transition-shape"][data-enabled="true"]')).toHaveCount(
    1,
  );
});

test('the remarks of an import are listed', async ({ page }) => {
  await openApp(page);
  await page.getByTestId('open-file-input').setInputFiles({
    name: 'special.pnml',
    mimeType: 'application/xml',
    buffer: Buffer.from(await fixture('special-arcs.pnml')),
  });
  const warnings = page.getByTestId('import-warnings');
  await expect(warnings).toBeVisible();
  await expect(warnings).toContainText('inhibitor arc Lock');
  await expect(warnings).toContainText('"ghost"');
  await expect(page.getByTestId('import-laid-out')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('import-report')).toBeHidden();
});

test('a PNML file can be dropped onto the editor', async ({ page }) => {
  await openApp(page);
  const text = await fixture('woped-like.pnml');
  const dataTransfer = await page.evaluateHandle((xml) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([xml], 'woped.pnml', { type: 'application/xml' }));
    return transfer;
  }, text);
  await page.getByTestId('canvas').dispatchEvent('dragover', { dataTransfer });
  await expect(page.getByTestId('drop-overlay')).toBeVisible();
  await page.getByTestId('canvas').dispatchEvent('drop', { dataTransfer });
  await expect(page.getByTestId('net-name')).toHaveValue('noID');
  await expect(page.getByTestId('place-shape')).toHaveCount(3);
  await expect(page.getByTestId('transition-shape')).toHaveCount(2);
});

test('a broken PNML file is rejected with a message', async ({ page }) => {
  await openApp(page);
  await page.getByTestId('open-file-input').setInputFiles({
    name: 'broken.pnml',
    mimeType: 'application/xml',
    buffer: Buffer.from(await fixture('broken.pnml')),
  });
  const toast = page.getByTestId('toast-error');
  await expect(toast).toContainText('Could not open broken.pnml');
  await expect(toast).toContainText('not well-formed');
  await expect(page.getByTestId('empty-hint')).toBeVisible();
});

test('PNML export and import keep a higher net unchanged', async ({ page }) => {
  await openExample(page, 'order-processing');
  await menuItem(page, 'export-pnml');
  await expect(page.getByTestId('export-preview-text')).toContainText('<pnml');
  await expect(page.getByTestId('export-preview-text')).toContainText('ptnet');
  const download = await downloadFromDialog(page);
  expect(download.suggestedFilename()).toBe('Order-processing.pnml');
  const xml = (await readDownload(download)).toString('utf8');
  expect(xml).toContain('<place id="n_incoming">');
  expect(xml).toContain('tool="pnm"');
  await expect(page.getByTestId('export-dialog')).toBeHidden();

  // A new net, then the file comes back.
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-item-new').click();
  await expect(page.getByTestId('empty-hint')).toBeVisible();
  await page.getByTestId('open-file-input').setInputFiles({
    name: 'Order-processing.pnml',
    mimeType: 'application/xml',
    buffer: Buffer.from(xml),
  });
  await expect(page.getByTestId('net-name')).toHaveValue('Order processing');
  await expect(page.getByTestId('place-shape')).toHaveCount(5);
  await expect(page.getByTestId('transition-shape')).toHaveCount(3);
  await expect(page.getByTestId('profile-json')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('type-item')).toHaveCount(3);
  // Everything came back, so there is nothing to remark and the dialog stays away.
  await expect(page.getByTestId('import-report')).toHaveCount(0);
  await page.getByTestId('status-diagnostics').click();
  await expect(page.getByTestId('status-diagnostics')).toContainText('No problems');
});

test('PNML export can leave the tool specific data out', async ({ page }) => {
  await openExample(page, 'order-processing');
  await menuItem(page, 'export-pnml');
  await page.getByTestId('export-toolspecific').uncheck();
  await expect(page.getByTestId('export-preview-text')).not.toContainText('toolspecific');
  const xml = (await readDownload(await downloadFromDialog(page))).toString('utf8');
  expect(xml).not.toContain('toolspecific');
  expect(xml).toContain('<place id="n_incoming">');
});

test('TikZ export previews, follows the options and downloads', async ({ page }) => {
  await openExample(page, 'producer-consumer');
  await menuItem(page, 'export-tikz');
  const preview = page.getByTestId('export-preview-text');
  await expect(preview).toContainText('\\begin{tikzpicture}');
  await expect(preview).toContainText('\\tikzset{');
  await page.getByTestId('export-standalone').check();
  await expect(preview).toContainText('\\documentclass[tikz,border=4pt]{standalone}');
  await page.getByTestId('export-styles').selectOption('external');
  await expect(preview).not.toContainText('\\tikzset');
  const download = await downloadFromDialog(page);
  expect(download.suggestedFilename()).toBe('Producer-consumer.tex');
  const tex = (await readDownload(download)).toString('utf8');
  expect(tex).toContain('\\begin{document}');
  expect(tex).toContain('\\node[place');
  expect(tex).toContain('\\end{document}');
  expect(tex).not.toContain('\\tikzset');
});

test('JSON can be exported from the menu', async ({ page }) => {
  await openExample(page, 'producer-consumer');
  await page.getByTestId('menu-file').click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('menu-item-export-json').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('Producer-consumer.pn.json');
  const saved = JSON.parse((await readDownload(download)).toString('utf8')) as { name: string };
  expect(saved.name).toBe('Producer/consumer');
});

test('the image export gives PNG files of 1, 2 and 3 times the size of the SVG', async ({
  page,
}) => {
  await openExample(page, 'producer-consumer');
  await menuItem(page, 'export-image');
  await expect(page.getByTestId('export-preview')).toBeVisible();

  // The SVG fixes the size of the drawing.
  await page.getByTestId('export-format-svg').click();
  const svg = (await readDownload(await downloadFromDialog(page))).toString('utf8');
  const width = Number(/<svg[^>]* width="(\d+)"/.exec(svg)?.[1]);
  const height = Number(/<svg[^>]* height="(\d+)"/.exec(svg)?.[1]);
  expect(width).toBeGreaterThan(300);

  for (const scale of [1, 2, 3]) {
    await menuItem(page, 'export-image');
    await page.getByTestId('export-format-png').click();
    await page.getByTestId(`export-scale-${scale}`).click();
    await expect(page.getByTestId('export-size')).toContainText(
      `${width * scale} × ${height * scale} px`,
    );
    const download = await downloadFromDialog(page);
    expect(download.suggestedFilename()).toBe('Producer-consumer.png');
    const size = pngSize(await readDownload(download));
    expect(size.width).toBe(width * scale);
    expect(size.height).toBe(height * scale);
  }
});

test('the keyboard shortcut opens the image export, and Escape closes it', async ({ page }) => {
  await openExample(page, 'producer-consumer');
  await page.keyboard.press('Control+Shift+E');
  await expect(page.getByRole('dialog', { name: 'Export image' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('export-dialog')).toBeHidden();
});

test('a transparent PNG has no background, a solid one has', async ({ page }) => {
  await openExample(page, 'producer-consumer');
  const alphaAtCorner = async (transparent: boolean): Promise<{ alpha: number; red: number }> => {
    await menuItem(page, 'export-image');
    await page.getByTestId('export-format-png').click();
    await page.getByTestId('export-scale-1').click();
    await page.getByTestId(`export-background-${transparent ? 'transparent' : 'theme'}`).click();
    const png = await readDownload(await downloadFromDialog(page));
    expect(pngSize(png).colorType).toBe(6);
    return page.evaluate(async (base64) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no canvas');
      ctx.drawImage(image, 0, 0);
      const [red = 0, , , alpha = 0] = ctx.getImageData(2, 2, 1, 1).data;
      return { alpha, red };
    }, png.toString('base64'));
  };
  expect((await alphaAtCorner(true)).alpha).toBe(0);
  const solid = await alphaAtCorner(false);
  expect(solid.alpha).toBe(255);
  // The light palette: #fafafa.
  expect(solid.red).toBe(250);
});

test('a dark PNG is drawn with the dark palette', async ({ page }) => {
  await openExample(page, 'producer-consumer');
  await menuItem(page, 'export-image');
  await page.getByTestId('export-format-png').click();
  await page.getByTestId('export-scale-1').click();
  await page.getByTestId('export-theme-dark').click();
  const png = await readDownload(await downloadFromDialog(page));
  const red = await page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas');
    ctx.drawImage(image, 0, 0);
    return ctx.getImageData(2, 2, 1, 1).data[0];
  }, png.toString('base64'));
  // #111114
  expect(red).toBe(17);
});

test('the domain view is exported as PNG from its panel', async ({ page }) => {
  await openExample(page, 'parcel-center');
  await page.getByTestId('view-domain').click();
  await expect(page.getByTestId('domain-panel')).toBeVisible();
  await page.getByTestId('domain-export-image').click();
  await expect(page.getByTestId('export-source-domain')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('export-format-svg')).toBeDisabled();
  await page.getByTestId('export-scale-1').click();
  await expect(page.getByTestId('export-preview')).toBeVisible();
  await expect(page.getByTestId('export-size')).toBeVisible();
  const advertised = (await page.getByTestId('export-size').textContent()) ?? '';
  const download = await downloadFromDialog(page);
  expect(download.suggestedFilename()).toBe('Paketzentrum-domain.png');
  const size = pngSize(await readDownload(download));
  expect(size.width).toBeGreaterThan(500);
  expect(size.height).toBeGreaterThan(300);
  expect(advertised).toContain(`${size.width} × ${size.height} px`);
});

test('the image export from the keyboard in the domain view starts on the domain view', async ({
  page,
}) => {
  await openExample(page, 'parcel-center');
  await page.getByTestId('view-domain').click();
  await page.keyboard.press('Control+Shift+E');
  await expect(page.getByTestId('export-source-domain')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('export-source-net').click();
  await expect(page.getByTestId('export-format-svg')).toBeEnabled();
  await expect(page.getByTestId('export-filename')).toHaveValue('Paketzentrum');
});
