import { distance } from './geometry';
import { TINT_TONES, type ScenePalette } from './palette';
import {
  LAYERS,
  type CellState,
  type CellStyle,
  type DrawCommand,
  type Glyph,
  type Layer,
  type Scene,
} from './scene';
import { isItemIcon, type DisplayIcon, type Point, type Sprite, type Tint } from './schema';

export interface PaintOptions {
  /**
   * Device pixels per scene pixel (device pixel ratio times zoom). Shadows and hairlines are sized
   * in device pixels by the canvas, so they are scaled by this.
   */
  scale?: number;
  /** Draws sprites from pre-rendered images, which is much cheaper with hundreds of them. */
  sprites?: SpriteCache;
}

/** An image that a canvas can draw and that a 2D context can render into. */
export interface SpriteSurface {
  width: number;
  height: number;
  getContext(kind: '2d'): CanvasRenderingContext2D | null;
}

/** The steps in which the direction of person and vehicle sprites is rounded in the cache. */
const ANGLE_STEPS = 32;

/** The steps in which the filled part of a partly filled symbol is rounded in the cache. */
const FRACTION_STEPS = 16;

/**
 * Sprites and symbols rendered once per picture, size, direction and zoom into small canvases and
 * drawn with `drawImage` afterwards. A frame with 200 cases then needs 200 blits instead of about
 * 2000 path operations. The caller supplies how canvases are created, so the painter touches no
 * DOM.
 */
export class SpriteCache {
  private readonly images = new WeakMap<ScenePalette, Map<string, CanvasImageSource>>();

  constructor(private readonly create: (width: number, height: number) => SpriteSurface) {}

  private imageFor(
    palette: ScenePalette,
    key: string,
    half: number,
    quality: number,
    render: (inner: CanvasRenderingContext2D) => void,
  ): CanvasImageSource | null {
    let byKey = this.images.get(palette);
    if (!byKey) {
      byKey = new Map();
      this.images.set(palette, byKey);
    }
    let image = byKey.get(key);
    if (!image) {
      const side = Math.max(2, Math.ceil(2 * half * quality));
      const surface = this.create(side, side);
      const inner = surface.getContext('2d');
      if (!inner) return null;
      inner.scale(quality, quality);
      render(inner);
      image = surface as unknown as CanvasImageSource;
      byKey.set(key, image);
    }
    return image;
  }

  /** Draws a sprite centered on (x, y). Returns false if no surface could be made. */
  draw(
    ctx: Ctx,
    sprite: Sprite,
    x: number,
    y: number,
    size: number,
    palette: ScenePalette,
    angle: number | undefined,
    scale: number,
    tint?: Tint,
  ): boolean {
    const quality = Math.max(0.25, Math.round(scale * 4) / 4);
    const oriented = sprite === 'person' || sprite === 'vehicle';
    const bucket =
      oriented && angle !== undefined
        ? ((Math.round((angle / (Math.PI * 2)) * ANGLE_STEPS) % ANGLE_STEPS) + ANGLE_STEPS) %
          ANGLE_STEPS
        : 0;
    const key = `${sprite}|${size}|${quality}|${bucket}${tint !== undefined ? `|${tint}` : ''}`;
    const half = size * 0.75;
    const image = this.imageFor(palette, key, half, quality, (inner) => {
      drawSprite(
        inner,
        sprite,
        half,
        half,
        size,
        palette,
        (bucket / ANGLE_STEPS) * Math.PI * 2,
        tint,
      );
    });
    if (!image) return false;
    ctx.drawImage(image, x - half, y - half, 2 * half, 2 * half);
    return true;
  }

  /** Draws a symbol, whole or filled from the left up to `fraction`. */
  drawIcon(
    ctx: Ctx,
    icon: DisplayIcon,
    x: number,
    y: number,
    size: number,
    palette: ScenePalette,
    fraction: number,
    scale: number,
  ): boolean {
    const quality = Math.max(0.25, Math.round(scale * 4) / 4);
    const step = fraction >= 1 ? FRACTION_STEPS : Math.round(fraction * FRACTION_STEPS);
    const key = `icon:${icon}|${size}|${quality}|${step}`;
    const half = size * 0.75;
    const image = this.imageFor(palette, key, half, quality, (inner) => {
      drawIcon(inner, icon, half, half, size, palette, step / FRACTION_STEPS);
    });
    if (!image) return false;
    ctx.drawImage(image, x - half, y - half, 2 * half, 2 * half);
    return true;
  }
}

type Ctx = CanvasRenderingContext2D;

/** Fills the area around the sheet. Call with an identity transform. */
export function paintBackdrop(
  ctx: Ctx,
  width: number,
  height: number,
  palette: ScenePalette,
): void {
  ctx.fillStyle = palette.bg;
  ctx.fillRect(0, 0, width, height);
}

/** The sheet (floor) with a soft shadow, a border and a fine dot grid. */
export function paintSheet(ctx: Ctx, scene: Scene, palette: ScenePalette, scale = 1): void {
  ctx.save();
  ctx.shadowColor = palette.shadow;
  ctx.shadowBlur = 18 * scale;
  ctx.shadowOffsetY = 4 * scale;
  ctx.fillStyle = palette.sheet;
  ctx.fillRect(0, 0, scene.width, scene.height);
  ctx.restore();
  ctx.fillStyle = palette.grid;
  const step = 32;
  for (let x = step; x < scene.width; x += step) {
    for (let y = step; y < scene.height; y += step) ctx.fillRect(x - 0.8, y - 0.8, 1.6, 1.6);
  }
  ctx.strokeStyle = palette.sheetBorder;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(0, 0, scene.width, scene.height);
}

/** Draws the scene in scene coordinates (the caller has set the transform). */
export function paintScene(
  ctx: Ctx,
  scene: Scene,
  palette: ScenePalette,
  options: PaintOptions = {},
): void {
  const scale = options.scale ?? 1;
  paintSheet(ctx, scene, palette, scale);
  paintLayers(ctx, scene.layers, palette, options);
}

/** Draws the layers of a scene without the sheet, for layers on top of another one. */
export function paintLayers(
  ctx: Ctx,
  layers: Record<Layer, readonly DrawCommand[]>,
  palette: ScenePalette,
  options: PaintOptions = {},
): void {
  const scale = options.scale ?? 1;
  for (const layer of LAYERS) {
    for (const command of layers[layer])
      paintCommand(ctx, command, palette, scale, options.sprites);
  }
}

function shadowOn(ctx: Ctx, palette: ScenePalette, scale: number, blur = 6): void {
  ctx.shadowColor = palette.shadow;
  ctx.shadowBlur = blur * scale;
  ctx.shadowOffsetY = 2 * scale;
}

function shadowOff(ctx: Ctx): void {
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  roundRectPath(ctx, x, y, w, h, r);
}

/** Adds a rounded rectangle to the current path, which stays as it is otherwise. */
function roundRectPath(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function tracePath(ctx: Ctx, points: readonly Point[]): void {
  ctx.beginPath();
  points.forEach((p, i) => {
    if (i === 0) ctx.moveTo(p[0], p[1]);
    else ctx.lineTo(p[0], p[1]);
  });
}

/** Fills the current path with diagonal lines (the path is left as it is). */
function hatchPath(
  ctx: Ctx,
  color: string,
  bounds: { x: number; y: number; w: number; h: number },
): void {
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.1;
  ctx.globalAlpha *= 0.7;
  ctx.setLineDash([]);
  ctx.beginPath();
  const step = 5;
  for (let k = -bounds.h; k <= bounds.w; k += step) {
    ctx.moveTo(bounds.x + k, bounds.y + bounds.h);
    ctx.lineTo(bounds.x + k + bounds.h, bounds.y);
  }
  ctx.stroke();
  ctx.restore();
}

function setDash(ctx: Ctx, dash: [number, number] | undefined): void {
  ctx.setLineDash(dash ?? []);
}

function arrowHead(ctx: Ctx, from: Point, to: Point, size: number): void {
  const length = distance(from, to);
  if (length === 0) return;
  const ux = (to[0] - from[0]) / length;
  const uy = (to[1] - from[1]) / length;
  ctx.beginPath();
  ctx.moveTo(to[0], to[1]);
  ctx.lineTo(to[0] - ux * size - uy * size * 0.55, to[1] - uy * size + ux * size * 0.55);
  ctx.lineTo(to[0] - ux * size + uy * size * 0.55, to[1] - uy * size - ux * size * 0.55);
  ctx.closePath();
  ctx.fill();
}

// --- Belts, lanes, buffers --------------------------------------------------------------------

function drawBelt(ctx: Ctx, points: readonly Point[], width: number, palette: ScenePalette): void {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'butt';
  ctx.setLineDash([]);
  tracePath(ctx, points);
  ctx.strokeStyle = palette.beltEdge;
  ctx.lineWidth = width + 3;
  ctx.stroke();
  tracePath(ctx, points);
  ctx.strokeStyle = palette.belt;
  ctx.lineWidth = width;
  ctx.stroke();
  // Rollers across the belt and chevrons that show the direction.
  ctx.strokeStyle = palette.roller;
  ctx.lineWidth = 1.2;
  ctx.globalAlpha = 0.7;
  ctx.beginPath();
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const length = distance(a, b);
    if (length < 1) continue;
    const ux = (b[0] - a[0]) / length;
    const uy = (b[1] - a[1]) / length;
    const nx = -uy * (width / 2 - 2.5);
    const ny = ux * (width / 2 - 2.5);
    for (let s = 4; s < length - 2; s += 8) {
      const x = a[0] + ux * s;
      const y = a[1] + uy * s;
      ctx.moveTo(x + nx, y + ny);
      ctx.lineTo(x - nx, y - ny);
    }
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = palette.surface;
  ctx.lineWidth = 1.6;
  ctx.globalAlpha = 0.5;
  ctx.lineCap = 'round';
  let offset = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const length = distance(a, b);
    if (length < 1) continue;
    const ux = (b[0] - a[0]) / length;
    const uy = (b[1] - a[1]) / length;
    for (let s = 28 - (offset % 56); s < length - 8; s += 56) {
      if (s < 8) continue;
      const x = a[0] + ux * s;
      const y = a[1] + uy * s;
      ctx.beginPath();
      ctx.moveTo(x - ux * 3 - uy * 4, y - uy * 3 + ux * 4);
      ctx.lineTo(x + ux * 3, y + uy * 3);
      ctx.lineTo(x - ux * 3 + uy * 4, y - uy * 3 - ux * 4);
      ctx.stroke();
    }
    offset += length;
  }
  ctx.globalAlpha = 1;
}

function drawLane(ctx: Ctx, points: readonly Point[], width: number, palette: ScenePalette): void {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.setLineDash([]);
  tracePath(ctx, points);
  ctx.strokeStyle = palette.line;
  ctx.lineWidth = width;
  ctx.stroke();
  ctx.restore();
  ctx.setLineDash([3, 6]);
  tracePath(ctx, points);
  ctx.strokeStyle = palette.ink2;
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.setLineDash([]);
  const head = points[points.length - 1]!;
  const before = points[points.length - 2]!;
  const length = distance(before, head) || 1;
  const ux = (head[0] - before[0]) / length;
  const uy = (head[1] - before[1]) / length;
  ctx.strokeStyle = palette.ink;
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(head[0] - uy * 9, head[1] + ux * 9);
  ctx.lineTo(head[0] + uy * 9, head[1] - ux * 9);
  ctx.stroke();
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(head[0] - ux * 7 - uy * 5, head[1] - uy * 7 + ux * 5);
  ctx.lineTo(head[0], head[1]);
  ctx.lineTo(head[0] - ux * 7 + uy * 5, head[1] - uy * 7 - ux * 5);
  ctx.stroke();
}

function drawBuffer(
  ctx: Ctx,
  points: readonly Point[],
  width: number,
  palette: ScenePalette,
): void {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.setLineDash([]);
  tracePath(ctx, points);
  ctx.strokeStyle = palette.line;
  ctx.lineWidth = width + 3;
  ctx.stroke();
  tracePath(ctx, points);
  ctx.strokeStyle = palette.surface2;
  ctx.lineWidth = width;
  ctx.stroke();
  // Tick marks every 16 px, one per place for a token.
  ctx.strokeStyle = palette.line;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.6;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const length = distance(a, b);
    if (length < 1) continue;
    const ux = (b[0] - a[0]) / length;
    const uy = (b[1] - a[1]) / length;
    for (let s = 8; s < length - 4; s += 16) {
      const x = a[0] + ux * s;
      const y = a[1] + uy * s;
      ctx.moveTo(x - uy * (width / 2 - 3), y + ux * (width / 2 - 3));
      ctx.lineTo(x + uy * (width / 2 - 3), y - ux * (width / 2 - 3));
    }
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}

// --- Cells ------------------------------------------------------------------------------------

function cross(ctx: Ctx, x: number, y: number, size: number, color: string): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - size, y - size);
  ctx.lineTo(x + size, y + size);
  ctx.moveTo(x + size, y - size);
  ctx.lineTo(x - size, y + size);
  ctx.stroke();
}

function drawCell(
  ctx: Ctx,
  style: CellStyle,
  x: number,
  y: number,
  w: number,
  h: number,
  state: CellState,
  palette: ScenePalette,
): void {
  // A reserved cell is taken, but its case has not arrived: hatched, with a dashed edge.
  const reserved = state === 'reserved';
  const edge =
    state === 'busy' || reserved ? palette.ok : state === 'free' ? palette.ink2 : palette.inkMuted;
  const fill =
    state === 'busy'
      ? palette.okSoft
      : state === 'free' || reserved
        ? palette.surface
        : palette.surface2;
  const lineWidth = state === 'busy' || reserved ? 2 : 1.2;
  const dash: [number, number] | undefined =
    state === 'off' ? [3, 3] : reserved ? [4, 3] : undefined;
  const bounds = { x: x - w / 2, y: y - h / 2, w, h };
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (style === 'table') {
    ctx.strokeStyle = state === 'off' ? palette.inkMuted : palette.line;
    ctx.fillStyle = palette.surface2;
    ctx.lineWidth = 1.2;
    setDash(ctx, undefined);
    for (let k = 0; k < 6; k += 1) {
      const a = (k * Math.PI) / 3 + Math.PI / 6;
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * (w / 2 + 6), y + Math.sin(a) * (h / 2 + 6), 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.ellipse(x, y, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    if (reserved) {
      hatchPath(ctx, edge, bounds);
      ctx.beginPath();
      ctx.ellipse(x, y, w / 2, h / 2, 0, 0, Math.PI * 2);
    }
    ctx.strokeStyle = edge;
    ctx.lineWidth = lineWidth;
    setDash(ctx, dash);
    ctx.stroke();
    setDash(ctx, undefined);
    if (state === 'off') cross(ctx, x, y, 7, palette.inkMuted);
    else if (!reserved) {
      ctx.fillStyle = state === 'busy' ? palette.ok : palette.ok;
      ctx.beginPath();
      ctx.arc(x - w / 2 + 9, y - h / 2 + 7, state === 'busy' ? 3.4 : 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
    return;
  }
  if (style === 'desk') {
    // Chair below the desk.
    ctx.beginPath();
    ctx.arc(x, y + h / 2 + 5, 6, 0, Math.PI * 2);
    ctx.fillStyle = palette.surface2;
    ctx.fill();
    ctx.strokeStyle = palette.line;
    ctx.lineWidth = 1.2;
    setDash(ctx, undefined);
    ctx.stroke();
    roundRect(ctx, x - w / 2, y - h / 2, w, h, 3);
    ctx.fillStyle = fill;
    ctx.fill();
    if (reserved) {
      hatchPath(ctx, edge, bounds);
      roundRect(ctx, x - w / 2, y - h / 2, w, h, 3);
    }
    ctx.strokeStyle = edge;
    ctx.lineWidth = lineWidth;
    setDash(ctx, dash);
    ctx.stroke();
    setDash(ctx, undefined);
    // Monitor.
    ctx.strokeStyle = state === 'off' ? palette.inkMuted : palette.ink2;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x - 8, y - h / 2 + 6);
    ctx.lineTo(x + 8, y - h / 2 + 6);
    ctx.stroke();
    if (state === 'off') cross(ctx, x, y + 2, 5, palette.inkMuted);
    else if (!reserved) {
      ctx.fillStyle = palette.ok;
      ctx.beginPath();
      ctx.arc(x + w / 2 - 6, y + h / 2 - 5, state === 'busy' ? 3.2 : 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
    return;
  }
  // slot and machine: a rounded cell.
  const radius = style === 'machine' ? 4 : 6;
  roundRect(ctx, x - w / 2, y - h / 2, w, h, radius);
  ctx.fillStyle = fill;
  ctx.fill();
  if (reserved) {
    hatchPath(ctx, edge, bounds);
    roundRect(ctx, x - w / 2, y - h / 2, w, h, radius);
  }
  ctx.strokeStyle = edge;
  ctx.lineWidth = lineWidth;
  setDash(ctx, dash);
  ctx.stroke();
  setDash(ctx, undefined);
  if (state === 'off') cross(ctx, x, y, 5, palette.inkMuted);
  else if (state === 'free') {
    ctx.fillStyle = palette.ok;
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

// --- Glyphs -----------------------------------------------------------------------------------

function drawGlyph(
  ctx: Ctx,
  glyph: Glyph,
  x: number,
  y: number,
  size: number,
  color: string,
  palette: ScenePalette,
): void {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  setDash(ctx, undefined);
  const r = size / 2;
  switch (glyph) {
    case 'gear': {
      ctx.beginPath();
      ctx.arc(x, y, r * 0.55, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      for (let k = 0; k < 8; k += 1) {
        const a = (k * Math.PI) / 4;
        ctx.moveTo(x + Math.cos(a) * r * 0.7, y + Math.sin(a) * r * 0.7);
        ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      }
      ctx.stroke();
      break;
    }
    case 'barrier': {
      const left = x - size / 2;
      const arm = size - 4;
      ctx.beginPath();
      ctx.arc(left + 2, y, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.save();
      ctx.beginPath();
      ctx.rect(left + 4, y - 2.5, arm - 4, 5);
      ctx.clip();
      ctx.fillStyle = palette.surface;
      ctx.fillRect(left + 4, y - 2.5, arm - 4, 5);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      for (let s = left; s < left + arm + 8; s += 7) {
        ctx.moveTo(s, y + 3);
        ctx.lineTo(s + 5, y - 3);
      }
      ctx.stroke();
      ctx.restore();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.2;
      ctx.strokeRect(left + 4, y - 2.5, arm - 4, 5);
      break;
    }
    case 'door': {
      // Opening of `size` px in a vertical wall, door leaf swung open, arrow showing the way in.
      const top = y - r;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x - 4, top);
      ctx.lineTo(x + 4, top);
      ctx.moveTo(x - 4, y + r);
      ctx.lineTo(x + 4, y + r);
      ctx.stroke();
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x + size, top);
      ctx.stroke();
      ctx.lineWidth = 1;
      setDash(ctx, [3, 4]);
      ctx.beginPath();
      ctx.arc(x, top, size, 0, Math.PI / 2);
      ctx.stroke();
      setDash(ctx, undefined);
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(x - 30, y);
      ctx.lineTo(x - 12, y);
      ctx.stroke();
      arrowHead(ctx, [x - 30, y], [x - 8, y], 7);
      break;
    }
    case 'dock': {
      const top = y - r;
      ctx.fillStyle = palette.roller;
      roundRect(ctx, x - 5, top, 10, size, 2);
      ctx.fill();
      ctx.strokeStyle = palette.ink2;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.strokeStyle = palette.surface;
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let s = top + 6; s < top + size - 3; s += 6) {
        ctx.moveTo(x - 4, s);
        ctx.lineTo(x + 4, s);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      // Ramp outside.
      ctx.fillStyle = palette.surface2;
      ctx.strokeStyle = palette.line;
      ctx.lineWidth = 1.2;
      roundRect(ctx, x - 20, top + 6, 13, size - 12, 2);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(x + 10, y);
      ctx.lineTo(x + 20, y);
      ctx.stroke();
      arrowHead(ctx, [x + 10, y], [x + 25, y], 6);
      break;
    }
    case 'arrow-in':
    case 'arrow-out': {
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x - r, y);
      ctx.lineTo(x + r * 0.55, y);
      ctx.stroke();
      arrowHead(ctx, [x - r, y], [x + r, y], Math.max(5, size * 0.3));
      if (glyph === 'arrow-in') {
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(x - r - 2, y - r * 0.7);
        ctx.lineTo(x - r - 2, y + r * 0.7);
        ctx.stroke();
      }
      break;
    }
    case 'truck': {
      const w = size * 1.3;
      const h = size * 0.7;
      const left = x - w / 2;
      const top = y - h / 2;
      ctx.fillStyle = palette.surface2;
      roundRect(ctx, left, top, w * 0.66, h, 3);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = color;
      roundRect(ctx, left + w * 0.7, top + h * 0.22, w * 0.3, h * 0.78, 3);
      ctx.fill();
      ctx.fillStyle = palette.surface;
      ctx.beginPath();
      ctx.arc(left + w * 0.2, top + h, 3, 0, Math.PI * 2);
      ctx.arc(left + w * 0.82, top + h, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'exit': {
      roundRect(ctx, x - r, y - r, size * 0.6, size, 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - 1, y);
      ctx.lineTo(x + r * 1.3, y);
      ctx.stroke();
      arrowHead(ctx, [x - 1, y], [x + r * 1.5, y], 6);
      break;
    }
    case 'ring': {
      ctx.fillStyle = palette.surface;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 1.8;
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'diamond': {
      ctx.beginPath();
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r);
      ctx.lineTo(x - r, y);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = palette.surface;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      break;
    }
    case 'cross':
      cross(ctx, x, y, r, color);
      break;
  }
}

// --- Sprites ----------------------------------------------------------------------------------

/** A color of the palette darkened by `amount` (0 to 1). Colors that are no `#rrggbb` stay. */
export function shade(color: string, amount: number): string {
  const found = /^#([0-9a-f]{6})$/i.exec(color);
  if (!found) return color;
  const value = Number.parseInt(found[1]!, 16);
  const part = (shift: number): string =>
    Math.round(((value >> shift) & 255) * (1 - amount))
      .toString(16)
      .padStart(2, '0');
  return `#${part(16)}${part(8)}${part(0)}`;
}

interface SpriteColors {
  body: string;
  edge: string;
}

/** The two tones of a sprite: those of its own, or the tint (a token of the palette) and its shade. */
function spriteColors(sprite: Sprite, palette: ScenePalette, tint: Tint | undefined): SpriteColors {
  if (tint !== undefined) {
    const body = palette[TINT_TONES[tint]];
    return { body, edge: shade(body, 0.5) };
  }
  switch (sprite) {
    case 'parcel':
      return { body: palette.parcel, edge: palette.parcelEdge };
    case 'person':
      return { body: palette.person, edge: palette.personEdge };
    case 'vehicle':
      return { body: palette.vehicle, edge: palette.vehicleEdge };
    case 'document':
      return { body: palette.document, edge: palette.documentEdge };
    case 'dot':
      return { body: palette.dot, edge: palette.dotEdge };
    case 'frame':
    case 'bicycle':
      return { body: palette.vehicle, edge: palette.vehicleEdge };
    case 'bars':
      return { body: palette.inkMuted, edge: palette.ink2 };
  }
}

/**
 * The tubes of a bicycle frame between the rear hub `r` and the front hub `f`: the main triangle
 * (top tube, down tube, seat tube), the rear triangle (seat stays, chain stays), the fork and
 * stubs for the saddle and the handlebar. A dark casing under a bright core keeps the thin tubes
 * readable on belts of any color.
 */
function drawFrameTubes(ctx: Ctx, r: Point, f: Point, width: number, colors: SpriteColors): void {
  const l = f[0] - r[0];
  const at = (dx: number, dy: number): Point => [r[0] + dx * l, r[1] + dy * l];
  const bottom = at(0.42, 0.08);
  const seat = at(0.3, -0.52);
  const headBottom = at(0.9, -0.3);
  const headTop = at(0.95, -0.55);
  const tubes: Array<[Point, Point]> = [
    [r, bottom],
    [r, seat],
    [bottom, seat],
    [seat, headTop],
    [bottom, headBottom],
    [headBottom, headTop],
    [headBottom, f],
    [seat, at(0.27, -0.66)],
    [headTop, at(0.88, -0.66)],
  ];
  ctx.setLineDash([]);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // A faint light rim, then the dark casing, then the bright core: the tubes stand out from a
  // dark belt as well as from a white card.
  for (const [layerColor, layerWidth, alpha] of [
    ['#ffffff', width + 3.2, 0.45],
    [colors.edge, width + 1.7, 1],
    [colors.body, width, 1],
  ] as const) {
    ctx.strokeStyle = layerColor;
    ctx.lineWidth = layerWidth;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    for (const [a, b] of tubes) {
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // The saddle and the grip.
  ctx.strokeStyle = colors.edge;
  ctx.lineWidth = width + 0.6;
  ctx.beginPath();
  const saddle = at(0.27, -0.66);
  const grip = at(0.88, -0.66);
  ctx.moveTo(saddle[0] - 0.12 * l, saddle[1]);
  ctx.lineTo(saddle[0] + 0.1 * l, saddle[1]);
  ctx.moveTo(grip[0] - 0.02 * l, grip[1]);
  ctx.lineTo(grip[0] + 0.1 * l, grip[1]);
  ctx.stroke();
}

/** Draws a case: two tones and a soft shadow, `size` px across (14 to 24 is the usual range). */
export function drawSprite(
  ctx: Ctx,
  sprite: Sprite,
  x: number,
  y: number,
  size: number,
  palette: ScenePalette,
  angle = 0,
  tint?: Tint,
): void {
  const s = size;
  const colors = spriteColors(sprite, palette, tint);
  ctx.save();
  ctx.setLineDash([]);
  ctx.fillStyle = palette.shadow;
  ctx.beginPath();
  ctx.ellipse(x, y + s * 0.42, s * 0.46, s * 0.17, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.translate(x, y);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  switch (sprite) {
    case 'parcel': {
      const w = s * 0.92;
      const h = s * 0.74;
      roundRect(ctx, -w / 2, -h / 2, w, h, 2);
      ctx.fillStyle = colors.body;
      ctx.fill();
      ctx.strokeStyle = colors.edge;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = colors.edge;
      ctx.globalAlpha = 0.28;
      ctx.fillRect(-w / 2 + 0.5, h / 2 - s * 0.16, w - 1, s * 0.16 - 0.5);
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-s * 0.08, -h / 2 + 0.5, s * 0.16, h - 1);
      ctx.globalAlpha = 1;
      break;
    }
    case 'person': {
      // Seen from above, facing the +x direction: broad shoulders, a head in front of their middle.
      ctx.rotate(angle);
      const half = s * 0.46;
      const depth = s * 0.34;
      // A light shadow, a little to the side and down, lifts the figure off the floor.
      roundRect(ctx, -depth * 0.45 + 0.8, -half + 1.4, depth, half * 2, depth / 2);
      ctx.fillStyle = palette.shadow;
      ctx.fill();
      roundRect(ctx, -depth * 0.45, -half, depth, half * 2, depth / 2);
      ctx.fillStyle = colors.body;
      ctx.fill();
      ctx.strokeStyle = colors.edge;
      ctx.lineWidth = 1;
      ctx.stroke();
      // The head is lighter than the shoulders and has its own outline: it reads as a head.
      ctx.beginPath();
      ctx.arc(s * 0.07, 0, s * 0.21, 0, Math.PI * 2);
      ctx.fillStyle = colors.body;
      ctx.fill();
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = colors.edge;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      break;
    }
    case 'vehicle': {
      ctx.rotate(angle);
      const w = s * 1.1;
      const h = s * 0.62;
      ctx.fillStyle = colors.edge;
      ctx.fillRect(-w * 0.32, -h / 2 - 1.5, w * 0.2, 2.5);
      ctx.fillRect(-w * 0.32, h / 2 - 1, w * 0.2, 2.5);
      ctx.fillRect(w * 0.14, -h / 2 - 1.5, w * 0.2, 2.5);
      ctx.fillRect(w * 0.14, h / 2 - 1, w * 0.2, 2.5);
      roundRect(ctx, -w / 2, -h / 2, w, h, 3);
      ctx.fillStyle = colors.body;
      ctx.fill();
      ctx.strokeStyle = colors.edge;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = colors.edge;
      ctx.globalAlpha = 0.75;
      ctx.fillRect(w * 0.06, -h * 0.34, w * 0.2, h * 0.68);
      ctx.fillRect(-w * 0.36, -h * 0.3, w * 0.12, h * 0.6);
      ctx.globalAlpha = 1;
      break;
    }
    case 'document': {
      const w = s * 0.7;
      const h = s * 0.9;
      const fold = s * 0.22;
      ctx.beginPath();
      ctx.moveTo(-w / 2, -h / 2);
      ctx.lineTo(w / 2 - fold, -h / 2);
      ctx.lineTo(w / 2, -h / 2 + fold);
      ctx.lineTo(w / 2, h / 2);
      ctx.lineTo(-w / 2, h / 2);
      ctx.closePath();
      ctx.fillStyle = colors.body;
      ctx.fill();
      ctx.strokeStyle = colors.edge;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(w / 2 - fold, -h / 2);
      ctx.lineTo(w / 2 - fold, -h / 2 + fold);
      ctx.lineTo(w / 2, -h / 2 + fold);
      ctx.stroke();
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      for (const dy of [0.0, 0.18, 0.36]) {
        ctx.moveTo(-w * 0.32, h * dy - h * 0.05);
        ctx.lineTo(w * 0.32, h * dy - h * 0.05);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      break;
    }
    case 'dot': {
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.4, 0, Math.PI * 2);
      ctx.fillStyle = colors.body;
      ctx.fill();
      ctx.strokeStyle = colors.edge;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(-s * 0.1, -s * 0.12, s * 0.12, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = 0.45;
      ctx.fill();
      ctx.globalAlpha = 1;
      break;
    }
    case 'frame': {
      // A bicycle frame in the diamond shape, without wheels, seen from the side.
      drawFrameTubes(
        ctx,
        [-0.44 * s, 0.2 * s],
        [0.44 * s, 0.2 * s],
        Math.max(1.5, s * 0.075),
        colors,
      );
      break;
    }
    case 'bicycle': {
      // The frame between two wheels.
      const rear: Point = [-0.27 * s, 0.14 * s];
      const front: Point = [0.27 * s, 0.14 * s];
      const wheel = 0.19 * s;
      for (const hub of [rear, front]) {
        ctx.beginPath();
        ctx.arc(hub[0], hub[1], wheel, 0, Math.PI * 2);
        ctx.strokeStyle = palette.ink2;
        ctx.lineWidth = Math.max(1.4, s * 0.07);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(hub[0], hub[1], Math.max(0.9, s * 0.03), 0, Math.PI * 2);
        ctx.fillStyle = palette.ink2;
        ctx.fill();
      }
      drawFrameTubes(ctx, rear, front, Math.max(1.3, s * 0.06), colors);
      break;
    }
    case 'bars': {
      // A bundle of tubes or bars, three layers high, with a strap around it.
      const w = s * 0.92;
      const h = s * 0.19;
      for (const dy of [-0.23, 0, 0.23]) {
        roundRect(ctx, -w / 2, dy * s - h / 2, w, h, h / 2);
        ctx.fillStyle = colors.body;
        ctx.fill();
        ctx.strokeStyle = colors.edge;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      // The light on the upper edge of each bar.
      ctx.strokeStyle = '#ffffff';
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      for (const dy of [-0.23, 0, 0.23]) {
        ctx.moveTo(-w / 2 + h * 0.6, dy * s - h * 0.2);
        ctx.lineTo(w / 2 - h * 0.6, dy * s - h * 0.2);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = colors.edge;
      ctx.lineWidth = Math.max(1.3, s * 0.08);
      ctx.beginPath();
      ctx.moveTo(-w * 0.12, -s * 0.36);
      ctx.lineTo(-w * 0.12, s * 0.36);
      ctx.stroke();
      break;
    }
  }
  ctx.restore();
}

// --- Symbols of amounts -----------------------------------------------------------------------

/** One symbol (a picture of an amount or of an object), `size` px across, centered on (x, y). */
function drawIconBody(
  ctx: Ctx,
  icon: DisplayIcon,
  x: number,
  y: number,
  size: number,
  palette: ScenePalette,
): void {
  // The objects, and the dot, are the sprites.
  if (isItemIcon(icon)) {
    drawSprite(ctx, icon, x, y, size, palette);
    return;
  }
  const s = size;
  ctx.save();
  ctx.translate(x, y);
  ctx.setLineDash([]);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const lineWidth = Math.max(1, s * 0.07);
  switch (icon) {
    case 'co2': {
      // A cloud: three round bumps on a flat base. The outline is the shapes drawn wider, then
      // the same shapes in the body color on top, so that the bumps merge without inner lines.
      const shapes = (draw: () => void): void => {
        ctx.beginPath();
        ctx.arc(-0.22 * s, 0.06 * s, 0.2 * s, 0, Math.PI * 2);
        ctx.moveTo(0.1 * s, -0.12 * s);
        ctx.arc(-0.02 * s, -0.12 * s, 0.27 * s, 0, Math.PI * 2);
        ctx.moveTo(0.46 * s, 0.05 * s);
        ctx.arc(0.25 * s, 0.05 * s, 0.21 * s, 0, Math.PI * 2);
        roundRectPath(ctx, -0.42 * s, 0.05 * s, 0.88 * s, 0.22 * s, 0.11 * s);
        draw();
      };
      ctx.strokeStyle = palette.ink2;
      ctx.lineWidth = lineWidth * 2.1;
      shapes(() => ctx.stroke());
      ctx.fillStyle = palette.line;
      shapes(() => ctx.fill());
      break;
    }
    case 'material': {
      // A block of stock, seen from a corner: a light top, a mid left and a dark right face.
      const top: Array<[number, number]> = [
        [0, -0.44],
        [0.4, -0.22],
        [0, 0],
        [-0.4, -0.22],
      ];
      const left: Array<[number, number]> = [
        [-0.4, -0.22],
        [0, 0],
        [0, 0.46],
        [-0.4, 0.24],
      ];
      const right: Array<[number, number]> = [
        [0, 0],
        [0.4, -0.22],
        [0.4, 0.24],
        [0, 0.46],
      ];
      const face = (points: Array<[number, number]>): void => {
        ctx.beginPath();
        points.forEach(([px, py], i) => {
          if (i === 0) ctx.moveTo(px * s, py * s);
          else ctx.lineTo(px * s, py * s);
        });
        ctx.closePath();
      };
      for (const [points, color, over, overAlpha] of [
        [top, palette.roller, '#ffffff', 0.45],
        [left, palette.roller, '#ffffff', 0.08],
        [right, palette.roller, '#000000', 0.25],
      ] as const) {
        face([...points]);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.save();
        ctx.globalAlpha *= overAlpha;
        ctx.fillStyle = over;
        ctx.fill();
        ctx.restore();
      }
      ctx.strokeStyle = palette.ink2;
      ctx.lineWidth = lineWidth;
      for (const points of [top, left, right]) {
        face([...points]);
        ctx.stroke();
      }
      break;
    }
    case 'scrap': {
      // A crumpled piece of sheet: a jagged outline.
      const points: Array<[number, number]> = [
        [-0.42, 0.1],
        [-0.22, -0.3],
        [-0.02, -0.12],
        [0.16, -0.42],
        [0.42, -0.04],
        [0.28, 0.32],
        [-0.04, 0.2],
        [-0.26, 0.4],
      ];
      ctx.beginPath();
      points.forEach(([px, py], i) => {
        if (i === 0) ctx.moveTo(px * s, py * s);
        else ctx.lineTo(px * s, py * s);
      });
      ctx.closePath();
      ctx.fillStyle = palette.warn;
      ctx.fill();
      ctx.strokeStyle = shade(palette.warn, 0.5);
      ctx.lineWidth = lineWidth;
      ctx.stroke();
      ctx.strokeStyle = '#ffffff';
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = Math.max(0.8, s * 0.05);
      ctx.beginPath();
      ctx.moveTo(-0.15 * s, -0.12 * s);
      ctx.lineTo(0.1 * s, 0.1 * s);
      ctx.stroke();
      break;
    }
    case 'waste': {
      // A bin with a lid.
      ctx.beginPath();
      ctx.moveTo(-0.3 * s, -0.16 * s);
      ctx.lineTo(0.3 * s, -0.16 * s);
      ctx.lineTo(0.24 * s, 0.4 * s);
      ctx.lineTo(-0.24 * s, 0.4 * s);
      ctx.closePath();
      ctx.fillStyle = palette.inkMuted;
      ctx.fill();
      ctx.strokeStyle = palette.ink2;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-0.4 * s, -0.22 * s);
      ctx.lineTo(0.4 * s, -0.22 * s);
      ctx.moveTo(-0.1 * s, -0.22 * s);
      ctx.lineTo(-0.1 * s, -0.36 * s);
      ctx.lineTo(0.1 * s, -0.36 * s);
      ctx.lineTo(0.1 * s, -0.22 * s);
      ctx.lineWidth = lineWidth * 1.4;
      ctx.stroke();
      ctx.strokeStyle = palette.surface;
      ctx.globalAlpha = 0.65;
      ctx.lineWidth = Math.max(0.8, s * 0.05);
      ctx.beginPath();
      for (const dx of [-0.1, 0.1]) {
        ctx.moveTo(dx * s, -0.08 * s);
        ctx.lineTo(dx * 0.85 * s, 0.32 * s);
      }
      ctx.stroke();
      break;
    }
    case 'energy': {
      // A lightning bolt.
      ctx.beginPath();
      ctx.moveTo(0.12 * s, -0.46 * s);
      ctx.lineTo(-0.28 * s, 0.08 * s);
      ctx.lineTo(-0.02 * s, 0.08 * s);
      ctx.lineTo(-0.12 * s, 0.46 * s);
      ctx.lineTo(0.3 * s, -0.12 * s);
      ctx.lineTo(0.04 * s, -0.12 * s);
      ctx.closePath();
      ctx.fillStyle = palette.warn;
      ctx.fill();
      ctx.strokeStyle = shade(palette.warn, 0.5);
      ctx.lineWidth = lineWidth;
      ctx.stroke();
      break;
    }
    case 'water': {
      // A drop.
      ctx.beginPath();
      ctx.moveTo(0, -0.44 * s);
      ctx.bezierCurveTo(0.1 * s, -0.22 * s, 0.3 * s, -0.04 * s, 0.3 * s, 0.14 * s);
      ctx.arc(0, 0.14 * s, 0.3 * s, 0, Math.PI);
      ctx.bezierCurveTo(-0.3 * s, -0.04 * s, -0.1 * s, -0.22 * s, 0, -0.44 * s);
      ctx.closePath();
      ctx.fillStyle = palette.vehicle;
      ctx.fill();
      ctx.strokeStyle = palette.vehicleEdge;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
      ctx.strokeStyle = '#ffffff';
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = Math.max(0.9, s * 0.06);
      ctx.beginPath();
      ctx.arc(0, 0.14 * s, 0.18 * s, Math.PI * 0.62, Math.PI * 0.95);
      ctx.stroke();
      break;
    }
  }
  ctx.restore();
}

/**
 * Draws a symbol. With a `fraction` below 1 it is a partly filled one: the whole symbol faintly,
 * and the left part of that width in full color, as in a pictogram (Isotype) for a rest.
 */
export function drawIcon(
  ctx: Ctx,
  icon: DisplayIcon,
  x: number,
  y: number,
  size: number,
  palette: ScenePalette,
  fraction = 1,
): void {
  if (fraction >= 1) {
    drawIconBody(ctx, icon, x, y, size, palette);
    return;
  }
  ctx.save();
  ctx.globalAlpha *= 0.28;
  drawIconBody(ctx, icon, x, y, size, palette);
  ctx.restore();
  if (fraction <= 0) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x - size * 0.6, y - size, size * 0.1 + fraction * size, size * 2);
  ctx.clip();
  drawIconBody(ctx, icon, x, y, size, palette);
  ctx.restore();
}

// --- Commands ---------------------------------------------------------------------------------

function paintCommand(
  ctx: Ctx,
  command: DrawCommand,
  palette: ScenePalette,
  scale: number,
  sprites?: SpriteCache,
): void {
  if (command.op === 'sprite') {
    // A sprite keeps the state of the context as it was (the cache and `drawSprite` both do).
    const faded = command.alpha !== undefined && command.alpha < 1;
    const before = ctx.globalAlpha;
    if (faded) ctx.globalAlpha = before * command.alpha!;
    const drawn = sprites?.draw(
      ctx,
      command.sprite,
      command.x,
      command.y,
      command.size,
      palette,
      command.angle,
      scale,
      command.tint,
    );
    if (!drawn) {
      drawSprite(
        ctx,
        command.sprite,
        command.x,
        command.y,
        command.size,
        palette,
        command.angle,
        command.tint,
      );
    }
    if (faded) ctx.globalAlpha = before;
    return;
  }
  if (command.op === 'icon') {
    const faded = command.alpha !== undefined && command.alpha < 1;
    const before = ctx.globalAlpha;
    if (faded) ctx.globalAlpha = before * command.alpha!;
    const fraction = command.fraction ?? 1;
    const drawn = sprites?.drawIcon(
      ctx,
      command.icon,
      command.x,
      command.y,
      command.size,
      palette,
      fraction,
      scale,
    );
    if (!drawn) drawIcon(ctx, command.icon, command.x, command.y, command.size, palette, fraction);
    if (faded) ctx.globalAlpha = before;
    return;
  }
  ctx.save();
  ctx.globalAlpha = 'alpha' in command && command.alpha !== undefined ? command.alpha : 1;
  switch (command.op) {
    case 'rect': {
      roundRect(ctx, command.x, command.y, command.w, command.h, command.radius ?? 0);
      if (command.fill) {
        if (command.shadow) shadowOn(ctx, palette, scale);
        ctx.fillStyle = palette[command.fill];
        ctx.fill();
        shadowOff(ctx);
      }
      if (command.stroke) {
        ctx.strokeStyle = palette[command.stroke];
        ctx.lineWidth = command.lineWidth ?? 1;
        setDash(ctx, command.dash);
        ctx.stroke();
      }
      break;
    }
    case 'path': {
      tracePath(ctx, command.points);
      ctx.strokeStyle = palette[command.stroke];
      ctx.lineWidth = command.lineWidth;
      ctx.lineCap = command.cap ?? 'round';
      ctx.lineJoin = 'round';
      setDash(ctx, command.dash);
      ctx.stroke();
      if (command.arrow && command.points.length >= 2) {
        setDash(ctx, undefined);
        ctx.fillStyle = palette[command.stroke];
        arrowHead(
          ctx,
          command.points[command.points.length - 2]!,
          command.points[command.points.length - 1]!,
          7,
        );
      }
      break;
    }
    case 'segments': {
      ctx.strokeStyle = palette[command.stroke];
      ctx.lineWidth = command.lineWidth;
      ctx.lineCap = 'square';
      ctx.beginPath();
      for (const [x1, y1, x2, y2] of command.segs) {
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
      }
      ctx.stroke();
      break;
    }
    case 'circle': {
      ctx.beginPath();
      ctx.arc(command.x, command.y, command.r, 0, Math.PI * 2);
      if (command.hatch && command.stroke) {
        hatchPath(ctx, palette[command.stroke], {
          x: command.x - command.r,
          y: command.y - command.r,
          w: 2 * command.r,
          h: 2 * command.r,
        });
        ctx.beginPath();
        ctx.arc(command.x, command.y, command.r, 0, Math.PI * 2);
      }
      if (command.fill) {
        if (command.shadow) shadowOn(ctx, palette, scale);
        ctx.fillStyle = palette[command.fill];
        ctx.fill();
        shadowOff(ctx);
      }
      if (command.stroke) {
        ctx.strokeStyle = palette[command.stroke];
        ctx.lineWidth = command.lineWidth ?? 1;
        setDash(ctx, command.dash);
        ctx.stroke();
      }
      break;
    }
    case 'text': {
      ctx.font = `${command.weight} ${command.size}px ${command.mono ? palette.fontMono : palette.fontSans}`;
      ctx.textAlign = command.align;
      ctx.textBaseline = command.baseline;
      if ('letterSpacing' in ctx) {
        (ctx as Ctx & { letterSpacing: string }).letterSpacing = `${command.spacing ?? 0}px`;
      }
      if (command.halo) {
        ctx.strokeStyle = palette.halo;
        ctx.lineWidth = 4;
        ctx.lineJoin = 'round';
        ctx.strokeText(command.text, command.x, command.y);
      }
      ctx.fillStyle = palette[command.tone];
      ctx.fillText(command.text, command.x, command.y);
      break;
    }
    case 'belt':
      drawBelt(ctx, command.points, command.width, palette);
      break;
    case 'lane':
      drawLane(ctx, command.points, command.width, palette);
      break;
    case 'buffer':
      drawBuffer(ctx, command.points, command.width, palette);
      break;
    case 'cell':
      drawCell(
        ctx,
        command.style,
        command.x,
        command.y,
        command.w,
        command.h,
        command.state,
        palette,
      );
      break;
    case 'glyph':
      drawGlyph(
        ctx,
        command.glyph,
        command.x,
        command.y,
        command.size,
        palette[command.tone],
        palette,
      );
      break;
    case 'badge': {
      ctx.font = `600 10px ${palette.fontMono}`;
      const width = Math.max(18, ctx.measureText(command.text).width + 10);
      roundRect(ctx, command.x - width / 2, command.y - 8, width, 16, 8);
      shadowOn(ctx, palette, scale, 4);
      const filled = command.tone !== undefined || command.accent === true;
      const color = command.tone !== undefined ? palette[command.tone] : palette.accent;
      ctx.fillStyle = filled ? color : palette.surface;
      ctx.fill();
      shadowOff(ctx);
      ctx.strokeStyle = filled ? color : palette.ink2;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = filled ? palette.surface : palette.ink;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if ('letterSpacing' in ctx) (ctx as Ctx & { letterSpacing: string }).letterSpacing = '0px';
      ctx.fillText(command.text, command.x, command.y + 0.5);
      break;
    }
    case 'progress': {
      roundRect(ctx, command.x, command.y, command.w, command.h, command.h / 2);
      ctx.fillStyle = palette.surface2;
      ctx.fill();
      ctx.strokeStyle = palette.line;
      ctx.lineWidth = 0.8;
      ctx.stroke();
      if (command.value > 0) {
        roundRect(
          ctx,
          command.x,
          command.y,
          Math.max(command.h, command.w * command.value),
          command.h,
          command.h / 2,
        );
        ctx.fillStyle = palette[command.tone ?? 'ok'];
        ctx.fill();
      }
      break;
    }
    case 'fill': {
      // The liquid of a container: clipped to the rounded rectangle, a line on its surface.
      if (command.value <= 0) break;
      const base = ctx.globalAlpha;
      const top = command.y + command.h * (1 - Math.min(1, command.value));
      roundRect(ctx, command.x, command.y, command.w, command.h, command.radius);
      ctx.clip();
      ctx.globalAlpha = base * 0.5;
      ctx.fillStyle = palette[command.tone];
      ctx.fillRect(command.x, top, command.w, command.y + command.h - top);
      ctx.globalAlpha = base;
      ctx.strokeStyle = palette[command.tone];
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(command.x, top + 0.9);
      ctx.lineTo(command.x + command.w, top + 0.9);
      ctx.stroke();
      break;
    }
    case 'spark': {
      const points = command.points;
      if (points.length < 2) break;
      const base = ctx.globalAlpha;
      const first = points[0]!;
      const last = points[points.length - 1]!;
      ctx.beginPath();
      ctx.moveTo(first[0], command.base);
      for (const p of points) ctx.lineTo(p[0], p[1]);
      ctx.lineTo(last[0], command.base);
      ctx.closePath();
      ctx.globalAlpha = base * 0.18;
      ctx.fillStyle = palette[command.tone];
      ctx.fill();
      ctx.globalAlpha = base;
      tracePath(ctx, points);
      ctx.strokeStyle = palette[command.tone];
      ctx.lineWidth = 1.5;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      setDash(ctx, undefined);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(last[0], last[1], 2.2, 0, Math.PI * 2);
      ctx.fillStyle = palette[command.tone];
      ctx.fill();
      break;
    }
    case 'ring': {
      const base = ctx.globalAlpha;
      ctx.lineWidth = command.lineWidth ?? 2.5;
      ctx.lineCap = 'round';
      ctx.setLineDash([]);
      ctx.globalAlpha = base * 0.4;
      ctx.strokeStyle = palette.line;
      ctx.beginPath();
      ctx.arc(command.x, command.y, command.r, 0, Math.PI * 2);
      ctx.stroke();
      if (command.value > 0) {
        ctx.globalAlpha = base;
        ctx.strokeStyle = palette[command.tone];
        ctx.beginPath();
        const start = -Math.PI / 2;
        ctx.arc(
          command.x,
          command.y,
          command.r,
          start,
          start + Math.PI * 2 * Math.min(1, command.value),
        );
        ctx.stroke();
      }
      break;
    }
  }
  ctx.restore();
}
