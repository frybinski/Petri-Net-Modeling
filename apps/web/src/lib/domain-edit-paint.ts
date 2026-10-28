import type { Handle, Placeholder, Rect, ScenePalette } from '@pnm/domain';
import type { Viewport } from './viewport';

/** What the mode "Edit layout" draws on top of the picture. */
export interface EditOverlay {
  /** Frame around the selected entry, in sheet pixels. */
  frame: Rect | null;
  handles: readonly Handle[];
  hover: string | null;
  active: string | null;
  placeholders: ReadonlyArray<Placeholder & { selected: boolean }>;
}

export const EMPTY_OVERLAY: EditOverlay = {
  frame: null,
  handles: [],
  hover: null,
  active: null,
  placeholders: [],
};

/** Size of a square handle on the screen, in CSS pixels, whatever the zoom. */
export const HANDLE_SIZE = 8;
/** Radius of a round handle. */
const POINT_RADIUS = 4.5;
const SEGMENT_RADIUS = 3;
/** The frame stands this far off the entry on the screen. */
const FRAME_PAD = 4;

type Ctx = CanvasRenderingContext2D;

function withAlpha(color: string, alpha: number): string {
  // Palette colors are `#rrggbb`.
  if (/^#[0-9a-f]{6}$/i.test(color)) {
    const r = Number.parseInt(color.slice(1, 3), 16);
    const g = Number.parseInt(color.slice(3, 5), 16);
    const b = Number.parseInt(color.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return color;
}

/**
 * Draws placeholders, the frame and the handles in screen space: they keep their size at any
 * zoom, and positions are rounded to device pixels so that the edges stay crisp.
 */
export function paintEditOverlay(
  ctx: Ctx,
  overlay: EditOverlay,
  viewport: Viewport,
  dpr: number,
  palette: ScenePalette,
): void {
  const { x: vx, y: vy, zoom } = viewport;
  const sx = (x: number): number => (vx + x * zoom) * dpr;
  const sy = (y: number): number => (vy + y * zoom) * dpr;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.lineJoin = 'round';

  // Hidden elements: dashed outlines where a generic view would draw them.
  for (const placeholder of overlay.placeholders) {
    const [x, y, w, h] = placeholder.rect;
    const left = Math.round(sx(x)) + 0.5;
    const top = Math.round(sy(y)) + 0.5;
    const width = Math.round(w * zoom * dpr);
    const height = Math.round(h * zoom * dpr);
    ctx.save();
    ctx.setLineDash([5 * dpr, 4 * dpr]);
    ctx.lineWidth = Math.max(1, Math.round(1.25 * dpr));
    ctx.fillStyle = withAlpha(palette.accent, placeholder.selected ? 0.14 : 0.06);
    ctx.strokeStyle = withAlpha(palette.accent, placeholder.selected ? 1 : 0.7);
    ctx.fillRect(left, top, width, height);
    ctx.strokeRect(left, top, width, height);
    ctx.restore();
    const size = 11 * dpr;
    ctx.font = `500 ${size}px ${palette.fontSans}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = palette.ink2;
    const cx = left + width / 2;
    const cy = top + height / 2;
    ctx.fillText(placeholder.name, cx, cy - 6 * dpr, Math.max(width - 6 * dpr, 20 * dpr));
    ctx.font = `italic 400 ${10 * dpr}px ${palette.fontSans}`;
    ctx.fillStyle = palette.inkMuted;
    ctx.fillText('hidden', cx, cy + 8 * dpr, Math.max(width - 6 * dpr, 20 * dpr));
  }

  if (overlay.frame) {
    const [x, y, w, h] = overlay.frame;
    const pad = FRAME_PAD * dpr;
    const left = Math.round(sx(x) - pad) + 0.5;
    const top = Math.round(sy(y) - pad) + 0.5;
    const width = Math.round(w * zoom * dpr + 2 * pad);
    const height = Math.round(h * zoom * dpr + 2 * pad);
    ctx.lineWidth = Math.max(1, Math.round(1.5 * dpr));
    ctx.strokeStyle = palette.accent;
    ctx.fillStyle = withAlpha(palette.accent, 0.06);
    ctx.fillRect(left, top, width, height);
    ctx.strokeRect(left, top, width, height);
  }

  const lineWidth = Math.max(1, Math.round(1.5 * dpr));
  for (const handle of overlay.handles) {
    if (handle.kind === 'move') continue;
    const cx = Math.round(sx(handle.at[0]));
    const cy = Math.round(sy(handle.at[1]));
    const emphasised = handle.id === overlay.active || handle.id === overlay.hover;
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = palette.accent;
    ctx.fillStyle = emphasised ? palette.accent : palette.surface;
    ctx.shadowColor = palette.shadow;
    ctx.shadowBlur = 0;
    if (handle.kind.startsWith('resize-')) {
      // Square handles: an even size on an integer position keeps the edges on device pixels.
      const size = Math.round(HANDLE_SIZE * dpr) + (emphasised ? 2 : 0);
      const half = Math.round(size / 2);
      ctx.beginPath();
      ctx.rect(cx - half + 0.5, cy - half + 0.5, size, size);
      ctx.fill();
      ctx.stroke();
    } else if (handle.kind === 'segment') {
      const r = (SEGMENT_RADIUS + (emphasised ? 1 : 0)) * dpr;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = emphasised ? palette.accent : withAlpha(palette.accent, 0.35);
      ctx.fill();
      ctx.lineWidth = Math.max(1, Math.round(1 * dpr));
      ctx.stroke();
    } else if (handle.kind === 'slot') {
      // A slot handle is a small diamond with a dot: it sits on top of the cell it moves.
      const r = (5.5 + (emphasised ? 1 : 0)) * dpr;
      ctx.beginPath();
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx + r, cy);
      ctx.lineTo(cx, cy + r);
      ctx.lineTo(cx - r, cy);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (handle.kind === 'pos') {
      const r = (6.5 + (emphasised ? 1 : 0)) * dpr;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, 1.6 * dpr, 0, Math.PI * 2);
      ctx.fillStyle = emphasised ? palette.surface : palette.accent;
      ctx.fill();
    } else {
      const r = (POINT_RADIUS + (emphasised ? 1 : 0)) * dpr;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.restore();
}
