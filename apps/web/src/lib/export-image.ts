import type { Marking, PetriNet } from '@pnm/core';
import { renderNetSvg, type RenderedSvg } from '@pnm/io';

/** The scales at which a PNG can be exported. */
export const PNG_SCALES = [1, 2, 3] as const;
export type PngScale = (typeof PNG_SCALES)[number];

/** Largest side of an exported PNG and largest area in pixels; browsers fail beyond these. */
export const MAX_PNG_SIDE = 16_384;
export const MAX_PNG_PIXELS = 100_000_000;

export interface ImageOptions {
  /** Draw on the dark palette. */
  dark: boolean;
  /** No background, so that the image can be put on any page. */
  transparent: boolean;
  /** Draw guards, inscriptions and place types. */
  inscriptions: boolean;
  /** Marking to draw; defaults to the initial marking. */
  marking?: Marking;
  /** Margin around the drawing in pixels. */
  padding?: number;
}

export interface PngOptions extends ImageOptions {
  scale: PngScale;
}

/** Raised for images that cannot be made, with a message for the person. */
export class ImageExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageExportError';
  }
}

export function svgOptions(options: ImageOptions, fontCss?: string) {
  return {
    dark: options.dark,
    transparent: options.transparent,
    inscriptions: options.inscriptions,
    ...(options.marking ? { marking: options.marking } : {}),
    ...(options.padding !== undefined ? { padding: options.padding } : {}),
    ...(fontCss ? { fontCss } : {}),
  };
}

/** The SVG of the net with the size of the drawing. */
export function netSvg(net: PetriNet, options: ImageOptions, fontCss?: string): RenderedSvg {
  return renderNetSvg(net, svgOptions(options, fontCss));
}

/** The code points of the Latin subset of the fonts and of the Latin Extended subset (as in `@fontsource`). */
const LATIN_RANGE =
  'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const LATIN_EXT_RANGE =
  'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';
/** Characters that the Latin subset lacks and the Latin Extended subset has: Ł, ź, ő, ǎ and the like. */
const LATIN_EXT_CHARS =
  /(?![\u0131\u0152\u0153\u02bb\u02bc\u02c6\u02da\u02dc\u0304\u0308\u0329])[\u0100-\u02ba\u02bd-\u02c5\u02c7-\u02cc\u02ce-\u02d7\u02dd-\u02ff\u1d00-\u1dbf\u1e00-\u1e9f\u1ef2-\u1eff\u2020\u20a0-\u20ab\u20ad-\u20c0\u2113\u2c60-\u2c7f\ua720-\ua7ff]/;

/**
 * True if a text has a character that only the Latin Extended subset of the fonts has. Umlauts
 * and accents of Western European languages are Latin-1 and in the Latin subset already.
 */
export function needsLatinExtended(text: string): boolean {
  return LATIN_EXT_CHARS.test(text);
}

const fontCssPromises = new Map<boolean, Promise<string>>();

/**
 * `@font-face` rules with the fonts of the editor as data URLs (Inter and JetBrains Mono), so
 * that an SVG that is drawn as an image has the right fonts. The Latin subset is always in; the
 * Latin Extended subset (about 100 kB more) only when `extended` is true, that is, when a text of
 * the drawing needs it. Each subset has its `unicode-range`, so that every character comes from
 * the file that has it. Loaded on first use and kept.
 */
export function loadFontCss(extended = false): Promise<string> {
  const known = fontCssPromises.get(extended);
  if (known) return known;
  const promise = (async () => {
    const rule = (family: string, url: string, range: string): string =>
      `@font-face{font-family:'${family}';font-style:normal;font-weight:100 900;` +
      `src:url(${url}) format('woff2');unicode-range:${range};}`;
    const [sans, mono] = await Promise.all([
      import('@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?inline'),
      import('@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2?inline'),
    ]);
    // Where ranges overlap the face declared last wins: the Latin subset goes last, as in the
    // style sheets of `@fontsource`.
    let css = '';
    if (extended) {
      const [sansExt, monoExt] = await Promise.all([
        import('@fontsource-variable/inter/files/inter-latin-ext-wght-normal.woff2?inline'),
        import('@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-ext-wght-normal.woff2?inline'),
      ]);
      css =
        rule('Inter Variable', sansExt.default, LATIN_EXT_RANGE) +
        rule('JetBrains Mono Variable', monoExt.default, LATIN_EXT_RANGE);
    }
    css +=
      rule('Inter Variable', sans.default, LATIN_RANGE) +
      rule('JetBrains Mono Variable', mono.default, LATIN_RANGE);
    return css;
  })().catch((error: unknown) => {
    // Without the fonts the image falls back to the system fonts; try again next time.
    fontCssPromises.delete(extended);
    throw error;
  });
  fontCssPromises.set(extended, promise);
  return promise;
}

/** The size in pixels of the PNG for a drawing; throws if the browser could not make it. */
export function pngSize(
  width: number,
  height: number,
  scale: PngScale,
): { width: number; height: number } {
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  if (w > MAX_PNG_SIDE || h > MAX_PNG_SIDE || w * h > MAX_PNG_PIXELS) {
    throw new ImageExportError(
      `The image would be ${w} × ${h} pixels, which is more than a browser can make. Choose a smaller scale.`,
    );
  }
  return { width: w, height: h };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      resolve(image);
    };
    image.onerror = () => {
      reject(new ImageExportError('The browser could not draw the image.'));
    };
    image.src = url;
  });
}

/** Encodes a canvas as PNG. */
export function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new ImageExportError('The browser could not encode the PNG.'));
    }, 'image/png');
  });
}

export interface PngResult {
  blob: Blob;
  width: number;
  height: number;
}

/**
 * Rasterises the net: the SVG (with the fonts embedded) is drawn onto a canvas of
 * `scale` times its size. The result does not depend on the screen or its pixel ratio.
 */
export async function netToPng(net: PetriNet, options: PngOptions): Promise<PngResult> {
  let css: string | undefined;
  try {
    // The drawing says which subset of the fonts it needs (the first pass is cheap).
    css = await loadFontCss(needsLatinExtended(netSvg(net, options).svg));
  } catch {
    css = undefined;
  }
  const { svg, width, height } = netSvg(net, options, css);
  const size = pngSize(width, height, options.scale);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = await loadImage(url);
    // Fonts of an SVG image are fetched while it decodes; wait for them where the API exists.
    if (typeof image.decode === 'function') await image.decode().catch(() => undefined);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new ImageExportError('The browser has no canvas to draw on.');
    ctx.drawImage(image, 0, 0, size.width, size.height);
    return { blob: await canvasToPng(canvas), width: size.width, height: size.height };
  } finally {
    URL.revokeObjectURL(url);
  }
}
