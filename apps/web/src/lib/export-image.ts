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

let fontCssPromise: Promise<string> | null = null;

/**
 * `@font-face` rules with the fonts of the editor as data URLs (Inter and JetBrains Mono, the
 * Latin subset), so that an SVG that is drawn as an image has the right fonts. Loaded on first
 * use and kept.
 */
export function loadFontCss(): Promise<string> {
  fontCssPromise ??= (async () => {
    const [sans, mono] = await Promise.all([
      import('@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?inline'),
      import('@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2?inline'),
    ]);
    const rule = (family: string, url: string): string =>
      `@font-face{font-family:'${family}';font-style:normal;font-weight:100 900;` +
      `src:url(${url}) format('woff2');}`;
    return rule('Inter Variable', sans.default) + rule('JetBrains Mono Variable', mono.default);
  })().catch((error: unknown) => {
    // Without the fonts the image falls back to the system fonts; try again next time.
    fontCssPromise = null;
    throw error;
  });
  return fontCssPromise;
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
    css = await loadFontCss();
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
