import type { Marking, PetriNet } from '@pnm/core';
import { buildScene, paintScene, type DomainView } from '@pnm/domain';
import { paletteFor } from './domain-theme';
import {
  ImageExportError,
  canvasToPng,
  pngSize,
  type PngResult,
  type PngScale,
} from './export-image';

export interface DomainImageOptions {
  scale: PngScale;
  dark: boolean;
  /** Leave the area around the sheet transparent. */
  transparent: boolean;
  /** Marking to draw; defaults to the initial marking. */
  marking?: Marking;
}

/**
 * The domain view as PNG, drawn by the scene painter onto a canvas of `scale` times the size of
 * the view. The sheet with its shadow is part of the picture; "transparent" only leaves out the
 * background around it.
 */
export async function domainToPng(
  net: PetriNet,
  view: DomainView,
  options: DomainImageOptions,
): Promise<PngResult> {
  const scene = buildScene(net, view, options.marking ?? net.marking);
  const margin = 16;
  const size = pngSize(scene.width + 2 * margin, scene.height + 2 * margin, options.scale);
  const palette = paletteFor(options.dark ? 'dark' : 'light');
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new ImageExportError('The browser has no canvas to draw on.');
  if (!options.transparent) {
    ctx.fillStyle = palette.bg;
    ctx.fillRect(0, 0, size.width, size.height);
  }
  ctx.setTransform(
    options.scale,
    0,
    0,
    options.scale,
    margin * options.scale,
    margin * options.scale,
  );
  paintScene(ctx, scene, palette, { scale: options.scale });
  return { blob: await canvasToPng(canvas), width: size.width, height: size.height };
}
