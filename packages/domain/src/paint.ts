import { distance } from './geometry';
import type { ScenePalette } from './palette';
import {
  LAYERS,
  type CellState,
  type CellStyle,
  type DrawCommand,
  type Glyph,
  type Layer,
  type Scene,
} from './scene';
import type { Point, Sprite } from './schema';

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

/**
 * Sprites rendered once per picture, size, direction and zoom into small canvases and drawn with
 * `drawImage` afterwards. A frame with 200 cases then needs 200 blits instead of about 2000 path
 * operations. The caller supplies how canvases are created, so the painter touches no DOM.
 */
export class SpriteCache {
  private readonly images = new WeakMap<ScenePalette, Map<string, CanvasImageSource>>();

  constructor(private readonly create: (width: number, height: number) => SpriteSurface) {}

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
  ): boolean {
    const quality = Math.max(0.25, Math.round(scale * 4) / 4);
    const oriented = sprite === 'person' || sprite === 'vehicle';
    const bucket =
      oriented && angle !== undefined
        ? ((Math.round((angle / (Math.PI * 2)) * ANGLE_STEPS) % ANGLE_STEPS) + ANGLE_STEPS) %
          ANGLE_STEPS
        : 0;
    const key = `${sprite}|${size}|${quality}|${bucket}`;
    let byKey = this.images.get(palette);
    if (!byKey) {
      byKey = new Map();
      this.images.set(palette, byKey);
    }
    const half = size * 0.75;
    let image = byKey.get(key);
    if (!image) {
      const side = Math.max(2, Math.ceil(2 * half * quality));
      const surface = this.create(side, side);
      const inner = surface.getContext('2d');
      if (!inner) return false;
      inner.scale(quality, quality);
      drawSprite(inner, sprite, half, half, size, palette, (bucket / ANGLE_STEPS) * Math.PI * 2);
      image = surface as unknown as CanvasImageSource;
      byKey.set(key, image);
    }
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
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
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
  const edge = state === 'busy' ? palette.ok : state === 'free' ? palette.ink2 : palette.inkMuted;
  const fill =
    state === 'busy' ? palette.okSoft : state === 'free' ? palette.surface : palette.surface2;
  const lineWidth = state === 'busy' ? 2 : 1.2;
  const dash: [number, number] | undefined = state === 'off' ? [3, 3] : undefined;
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
    ctx.strokeStyle = edge;
    ctx.lineWidth = lineWidth;
    setDash(ctx, dash);
    ctx.stroke();
    setDash(ctx, undefined);
    if (state === 'off') cross(ctx, x, y, 7, palette.inkMuted);
    else {
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
    else {
      ctx.fillStyle = palette.ok;
      ctx.beginPath();
      ctx.arc(x + w / 2 - 6, y + h / 2 - 5, state === 'busy' ? 3.2 : 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
    return;
  }
  // slot and machine: a rounded cell.
  roundRect(ctx, x - w / 2, y - h / 2, w, h, style === 'machine' ? 4 : 6);
  ctx.fillStyle = fill;
  ctx.fill();
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

/** Draws a case: two tones and a soft shadow, `size` px across (14 to 18 is the usual range). */
export function drawSprite(
  ctx: Ctx,
  sprite: Sprite,
  x: number,
  y: number,
  size: number,
  palette: ScenePalette,
  angle = 0,
): void {
  const s = size;
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
      ctx.fillStyle = palette.parcel;
      ctx.fill();
      ctx.strokeStyle = palette.parcelEdge;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = palette.parcelEdge;
      ctx.globalAlpha = 0.28;
      ctx.fillRect(-w / 2 + 0.5, h / 2 - s * 0.16, w - 1, s * 0.16 - 0.5);
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-s * 0.08, -h / 2 + 0.5, s * 0.16, h - 1);
      ctx.globalAlpha = 1;
      break;
    }
    case 'person': {
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.ellipse(0, 0, s * 0.26, s * 0.46, 0, 0, Math.PI * 2);
      ctx.fillStyle = palette.person;
      ctx.fill();
      ctx.strokeStyle = palette.personEdge;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(s * 0.04, 0, s * 0.21, 0, Math.PI * 2);
      ctx.fillStyle = palette.personEdge;
      ctx.fill();
      break;
    }
    case 'vehicle': {
      ctx.rotate(angle);
      const w = s * 1.1;
      const h = s * 0.62;
      ctx.fillStyle = palette.vehicleEdge;
      ctx.fillRect(-w * 0.32, -h / 2 - 1.5, w * 0.2, 2.5);
      ctx.fillRect(-w * 0.32, h / 2 - 1, w * 0.2, 2.5);
      ctx.fillRect(w * 0.14, -h / 2 - 1.5, w * 0.2, 2.5);
      ctx.fillRect(w * 0.14, h / 2 - 1, w * 0.2, 2.5);
      roundRect(ctx, -w / 2, -h / 2, w, h, 3);
      ctx.fillStyle = palette.vehicle;
      ctx.fill();
      ctx.strokeStyle = palette.vehicleEdge;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = palette.vehicleEdge;
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
      ctx.fillStyle = palette.document;
      ctx.fill();
      ctx.strokeStyle = palette.documentEdge;
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
      ctx.fillStyle = palette.dot;
      ctx.fill();
      ctx.strokeStyle = palette.dotEdge;
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
  }
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
    const drawn = sprites?.draw(
      ctx,
      command.sprite,
      command.x,
      command.y,
      command.size,
      palette,
      command.angle,
      scale,
    );
    if (!drawn) {
      drawSprite(ctx, command.sprite, command.x, command.y, command.size, palette, command.angle);
    }
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
      ctx.fillStyle = command.accent ? palette.accent : palette.surface;
      ctx.fill();
      shadowOff(ctx);
      ctx.strokeStyle = command.accent ? palette.accent : palette.ink2;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = command.accent ? palette.surface : palette.ink;
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
