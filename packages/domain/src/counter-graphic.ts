import type { Id, PetriNet } from '@pnm/core';
import { stepLine, type HistoryPoint } from './history';
import type { DrawCommand } from './scene';
import type {
  CounterDisplay,
  DisplayIcon,
  DomainView,
  PlaceView,
  Point,
  Rect,
  Sprite,
} from './schema';

/**
 * The graphics of a counter (N2): a container with a fill level, or a pictogram in which every
 * symbol stands for a fixed number of tokens, with an optional curve over the simulated time. The
 * number is always shown. Everything here is pure and works on numbers: the heights, the number
 * of symbols and the places of the texts can be tested without a canvas.
 */

export type CounterEntry = Extract<PlaceView, { kind: 'pool' | 'source' | 'sink' }>;

/** The size of the container or the area of a `pool` when the display gives none. */
export const POOL_SIZES = {
  fill: [52, 84],
  pictogram: [156, 66],
  number: [100, 58],
} as const satisfies Record<CounterDisplay['style'], readonly [number, number]>;

const PAD = 6;
const ICON_GAP = 3;

/** Width of a text, rough: the painter measures nothing. */
function approxWidth(text: string, size: number, mono = false): number {
  return text.length * size * (mono ? 0.62 : 0.56);
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

/**
 * The display of a counter that needs more than the number, or `null` for a plain number. A
 * display with a limit that cannot be used (`max` or `per` not positive, which rule V10 reports)
 * is drawn as far as it can be: as a number, with its history if it asks for one.
 */
export function graphicDisplay(entry: PlaceView | undefined): CounterDisplay | null {
  if (!entry || (entry.kind !== 'pool' && entry.kind !== 'source' && entry.kind !== 'sink')) {
    return null;
  }
  const display = entry.display;
  if (display === undefined) return null;
  if (display.style === 'fill' && display.max > 0 && Number.isFinite(display.max)) return display;
  if (display.style === 'pictogram' && display.per > 0 && Number.isFinite(display.per)) {
    return display;
  }
  return display.history === true ? { style: 'number', history: true } : null;
}

/** The rectangle that a counter with a graphic fills. */
export function counterArea(entry: CounterEntry, display: CounterDisplay): Rect {
  if (entry.kind !== 'pool') return entry.box;
  const size =
    display.style !== 'number' && display.size !== undefined
      ? display.size
      : POOL_SIZES[display.style];
  return [entry.pos[0] - size[0] / 2, entry.pos[1] - size[1] / 2, size[0], size[1]];
}

/** The unit of a counter: `display.unit`, else the last brackets of the label (`CO₂e (kg)`). */
export function unitOf(display: CounterDisplay, label: string | undefined): string {
  if (display.unit !== undefined && display.unit.trim() !== '') return display.unit.trim();
  const found = label !== undefined ? /\(([^()]+)\)\s*$/.exec(label) : null;
  return found?.[1]?.trim() ?? '';
}

/** The label without the unit in brackets at its end (`Rohrlager (kg)` becomes `Rohrlager`). */
export function nameWithoutUnit(label: string): string {
  return label.replace(/\s*\([^()]+\)\s*$/, '').trim() || label;
}

/** The part of the container that is filled: 0 to 1; a count beyond `max` fills it completely. */
export function fillRatio(count: number, max: number): number {
  if (!(max > 0)) return 0;
  return clamp(count / max, 0, 1);
}

/** By how much a fill level is over its limit (0 if it is not). */
export function overflowOf(display: CounterDisplay | null | undefined, count: number): number {
  if (!display || display.style !== 'fill') return 0;
  return count > display.max ? count - display.max : 0;
}

export type FillLevel = 'normal' | 'low' | 'full' | 'over';

/** The state of a fill level: yellow below `low`, and over the limit beyond `max`. */
export function fillLevel(
  display: Extract<CounterDisplay, { style: 'fill' }>,
  count: number,
): FillLevel {
  if (count > display.max) return 'over';
  if (display.low !== undefined && count < display.low) return 'low';
  return count >= display.max ? 'full' : 'normal';
}

/** What a pictogram shows for a count: whole symbols, a part of one, and what does not fit. */
export interface Symbols {
  /** Symbols that are completely filled. */
  full: number;
  /** The part of the symbol after them: 0 for none, otherwise more than 0 and less than 1. */
  part: number;
  /** All symbols the count needs, a partial one included. */
  total: number;
  /** Symbols that are drawn (a partial one included). */
  shown: number;
  /** Symbols that are not drawn; they are announced as `+N`. */
  hidden: number;
}

/**
 * The symbols of a pictogram: one for every `per` tokens, the rest as a partly filled symbol. If
 * not all of them fit in `capacity` cells, the last cell announces the hidden ones, so `shown`
 * is one less than `capacity` then: the symbols are never made smaller to make room.
 */
export function pictogramSymbols(count: number, per: number, capacity: number): Symbols {
  const exact = Math.max(0, count) / per;
  // A rounding error of a division must not leave a sliver of a symbol.
  const full = Math.floor(exact + 1e-9);
  const rest = exact - full;
  const part = rest > 1e-9 && rest < 1 - 1e-9 ? rest : 0;
  const total = full + (part > 0 ? 1 : 0);
  const cells = Math.max(1, Math.floor(capacity));
  if (total <= cells) return { full, part, total, shown: total, hidden: 0 };
  return { full: cells - 1, part: 0, total, shown: cells - 1, hidden: total - (cells - 1) };
}

export interface CounterLayout {
  area: Rect;
  /** A large box carries its label as a title on top, so that nothing hangs below it. */
  title?: { x: number; y: number };
  /** A large box (200 x 72 px or more): its number is a headline figure. */
  large: boolean;
  radius: number;
  number: { x: number; y: number; size: number; align: 'left' | 'center' | 'right' };
  /** Fill: the inner rectangle that the liquid rises in. */
  inner: Rect;
  /** Fill: the place of the text with the limit: beside a container, inside a box. */
  caption?: { x: number; y: number; align: 'left' | 'right' | 'center'; above: boolean };
  symbol?: { x: number; y: number; size: number };
  /** Pictogram: the cells for the symbols. */
  cells?: { rect: Rect; size: number; gap: number; cols: number; rows: number; capacity: number };
  legend?: { x: number; y: number };
  spark?: Rect;
}

/** Where everything stands in the area of a counter. */
export function counterLayout(
  area: Rect,
  display: CounterDisplay,
  count: number,
  entry: CounterEntry,
  hasLabel = false,
  label = '',
): CounterLayout {
  const [x, y, w, h] = area;
  const history = display.history === true;
  const large = w >= 200 && h >= 72;
  const titleHeight = large && hasLabel ? 14 : 0;
  const sparkHeight = history ? clamp(Math.round(h * 0.24), 14, 24) : 0;
  const spark: Rect | undefined = history
    ? [x + PAD, y + h - PAD - sparkHeight, w - 2 * PAD, sparkHeight]
    : undefined;
  const top = y + PAD + titleHeight;
  const bottom = y + h - PAD - (history ? sparkHeight + 4 : 0);
  const content = Math.max(8, bottom - top);
  const radius = entry.kind === 'pool' ? 7 : 8;
  const inner: Rect = [x + 2, y + 2, w - 4, h - 4];
  const base: CounterLayout = {
    area,
    ...(titleHeight > 0 && { title: { x: x + PAD + 4, y: y + PAD + 1 } }),
    large,
    radius,
    number: { x: x + w / 2, y: top + content / 2, size: 15, align: 'center' },
    inner,
    ...(spark && { spark }),
  };

  if (display.style === 'fill') {
    const narrow = w < 64;
    const size = large ? 28 : narrow ? 14 : 16;
    const hasSymbol = display.icon !== undefined;
    return {
      ...base,
      number: {
        x: x + w / 2,
        y: top + content / 2 + (hasSymbol && !large ? 6 : 0),
        size,
        align: 'center',
      },
      caption:
        entry.kind === 'pool'
          ? { x: x + w + 4, y: y + 2, align: 'left', above: false }
          : { x: x + w - 6, y: y + 6, align: 'right', above: false },
      ...(hasSymbol && {
        symbol:
          narrow || large
            ? { x: x + w / 2, y: top + 8, size: 14 }
            : { x: x + PAD + 8, y: top + 8, size: 14 },
      }),
    };
  }

  if (display.style === 'pictogram') {
    const wide = w >= 190 && h >= 62;
    // A fixed size by the room of the box, never by the number of symbols.
    const iconSize = content >= 46 && w >= 100 ? 18 : 16;
    const legendHeight = 14;
    let cellsRect: Rect;
    let numberLayout: CounterLayout['number'];
    let legend: { x: number; y: number };
    if (wide) {
      const size = content >= 50 ? 30 : 26;
      // The block is as wide as its widest content, for at least four digits, so that the symbols
      // do not move when the number gets one digit longer.
      const digits = Math.max(4, String(count).length);
      const legendWidth = 36 + approxWidth(legendText(display, label), 10, true);
      const numberWidth = clamp(
        Math.max(approxWidth('0'.repeat(digits), size, true) + 12, legendWidth),
        56,
        w * 0.45,
      );
      numberLayout = {
        x: x + PAD + 4,
        y: top + (content - legendHeight) / 2,
        size,
        align: 'left',
      };
      legend = { x: x + PAD + 4, y: bottom - legendHeight / 2 };
      cellsRect = [x + PAD + numberWidth + 8, top, w - 2 * PAD - numberWidth - 8, content];
    } else {
      const size = w < 90 ? 14 : 16;
      numberLayout = { x: x + PAD + 2, y: top + size / 2, size, align: 'left' };
      legend = { x: x + PAD + 2, y: bottom - legendHeight / 2 };
      const used = size + 6;
      cellsRect = [
        x + PAD,
        top + used,
        w - 2 * PAD,
        Math.max(iconSize, content - used - legendHeight),
      ];
    }
    const cols = Math.max(1, Math.floor((cellsRect[2] + ICON_GAP) / (iconSize + ICON_GAP)));
    const rows = Math.max(1, Math.floor((cellsRect[3] + ICON_GAP) / (iconSize + ICON_GAP)));
    return {
      ...base,
      number: numberLayout,
      legend,
      cells: {
        rect: cellsRect,
        size: iconSize,
        gap: ICON_GAP,
        cols,
        rows,
        capacity: cols * rows,
      },
    };
  }

  // A plain number with a history: the number on top, the curve below.
  const size = large ? 26 : 15;
  return {
    ...base,
    number: { x: x + PAD + 2, y: top + size / 2, size, align: 'left' },
  };
}

/** The center of the cell with the given index. */
export function cellCenter(cells: NonNullable<CounterLayout['cells']>, index: number): Point {
  const col = index % cells.cols;
  const row = Math.floor(index / cells.cols);
  return [
    cells.rect[0] + col * (cells.size + cells.gap) + cells.size / 2,
    cells.rect[1] + row * (cells.size + cells.gap) + cells.size / 2,
  ];
}

/** What a counter needs from the view and the net to be drawn. */
export interface CounterInfo {
  placeId: Id;
  entry: CounterEntry;
  display: CounterDisplay;
  /** The label of the entry; a counter without one has no text next to its graphic. */
  label: string | undefined;
  /** The name of the place, which the unit is taken from if the label has none. */
  name: string;
  /** The symbol of the pictogram: the one of the display, else the dot or the entity. */
  icon: DisplayIcon;
}

/** The symbol of a pictogram without one in its display: the entity for cases, else a dot. */
export function defaultIcon(isCounterOfCases: boolean, entity: Sprite): DisplayIcon {
  return isCounterOfCases ? entity : 'dot';
}

export function counterInfo(
  placeId: Id,
  entry: CounterEntry,
  display: CounterDisplay,
  net: PetriNet,
  view: DomainView,
  roleIsCases: boolean,
): CounterInfo {
  const name = net.places.find((p) => p.id === placeId)?.name ?? placeId;
  return {
    placeId,
    entry,
    display,
    label: entry.label,
    name,
    icon: display.icon ?? defaultIcon(roleIsCases, view.meta.entity.sprite),
  };
}

// --- Static part ------------------------------------------------------------------------------

/**
 * The part of the graphic that does not change while the simulation runs: the container, its
 * ticks and the legend of a pictogram. Dashed for a source, raised for a sink or pool, as the
 * boxes of plain counters are.
 */
export function staticCounterCommands(info: CounterInfo): DrawCommand[] {
  const { placeId, entry, display } = info;
  const area = counterArea(entry, display);
  const layout = counterLayout(
    area,
    display,
    0,
    entry,
    info.label !== undefined,
    info.label ?? info.name,
  );
  const [x, y, w, h] = area;
  const commands: DrawCommand[] = [
    {
      layer: 'places',
      elementId: placeId,
      op: 'rect',
      x,
      y,
      w,
      h,
      radius: layout.radius,
      fill: entry.kind === 'source' ? 'surface2' : 'surface',
      stroke: 'ink2',
      lineWidth: entry.kind === 'pool' ? 1.4 : 1.2,
      ...(entry.kind === 'source' ? { dash: [5, 4] as [number, number] } : { shadow: true }),
    },
  ];
  if (display.style === 'fill') {
    // Ticks at a quarter, a half and three quarters of the limit.
    const [ix, iy, , ih] = layout.inner;
    commands.push({
      layer: 'places',
      elementId: placeId,
      op: 'segments',
      segs: [0.25, 0.5, 0.75].map((t): Rect => {
        const ty = iy + ih * (1 - t);
        return [ix + 1, ty, ix + 6, ty];
      }),
      stroke: 'inkMuted',
      lineWidth: 1,
    });
  }
  if (layout.title && info.label !== undefined) {
    commands.push({
      layer: 'labels',
      elementId: placeId,
      op: 'text',
      x: layout.title.x,
      y: layout.title.y,
      text: info.label,
      size: 11,
      weight: 600,
      tone: 'ink2',
      align: 'left',
      baseline: 'top',
    });
  }
  if (display.style === 'pictogram' && layout.legend) {
    commands.push(...legendCommands(info, layout.legend));
  }
  if (layout.spark) {
    const [sx, sy, sw, sh] = layout.spark;
    commands.push({
      layer: 'places',
      elementId: placeId,
      op: 'path',
      points: [
        [sx, sy + sh],
        [sx + sw, sy + sh],
      ],
      stroke: 'line',
      lineWidth: 1,
    });
  }
  return commands;
}

/** The text after the symbol in the legend of a pictogram: `= 50 kg`. */
export function legendText(display: CounterDisplay, label: string): string {
  if (display.style !== 'pictogram') return '';
  const unit = unitOf(display, label);
  return `= ${formatAmount(display.per)}${unit !== '' ? ` ${unit}` : ''}`;
}

/** The legend of a pictogram: `1 <symbol> = 50 kg`. */
function legendCommands(info: CounterInfo, at: { x: number; y: number }): DrawCommand[] {
  const { placeId, display } = info;
  if (display.style !== 'pictogram') return [];
  const text = legendText(display, info.label ?? info.name);
  return [
    {
      layer: 'places',
      elementId: placeId,
      op: 'text',
      x: at.x,
      y: at.y,
      text: '1',
      size: 10,
      weight: 600,
      tone: 'ink2',
      align: 'left',
      baseline: 'middle',
      mono: true,
    },
    {
      layer: 'places',
      elementId: placeId,
      op: 'icon',
      icon: info.icon,
      x: at.x + 17,
      y: at.y,
      size: 12,
    },
    {
      layer: 'places',
      elementId: placeId,
      op: 'text',
      x: at.x + 26,
      y: at.y,
      text,
      size: 10,
      weight: 600,
      tone: 'ink2',
      align: 'left',
      baseline: 'middle',
      mono: true,
    },
  ];
}

/** A number for texts: whole numbers as they are, others with one decimal place. */
export function formatAmount(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 10) / 10);
}

// --- Dynamic part -----------------------------------------------------------------------------

export interface CounterFrame {
  /** The number that is shown (it may lag behind the count while an amount is on its way). */
  count: number;
  /** The count over the simulated time, for `display.history`. */
  history?: readonly HistoryPoint[];
  /** Simulated seconds now: the right end of the curve. */
  time?: number;
  /** 1 right after a change down to 0: the light-up of the counter. */
  pulse?: number;
}

/**
 * What changes while the simulation runs: the fill level, the symbols, the number, the curve and
 * the mark of an overflow. All of it is drawn on the `tokens` layer.
 */
export function dynamicCounterCommands(info: CounterInfo, frame: CounterFrame): DrawCommand[] {
  const { placeId, entry, display } = info;
  const area = counterArea(entry, display);
  const layout = counterLayout(
    area,
    display,
    frame.count,
    entry,
    info.label !== undefined,
    info.label ?? info.name,
  );
  const [x, y, w, h] = area;
  const commands: DrawCommand[] = [];
  const push = (command: DrawCommand): void => {
    commands.push(command);
  };
  const over = overflowOf(display, frame.count) > 0;

  if (frame.pulse !== undefined && frame.pulse > 0) {
    push({
      layer: 'tokens',
      elementId: placeId,
      op: 'rect',
      x,
      y,
      w,
      h,
      radius: layout.radius,
      fill: 'ok',
      alpha: 0.3 * frame.pulse,
    });
  }

  if (display.style === 'fill') {
    const ratio = fillRatio(frame.count, display.max);
    const level = fillLevel(display, frame.count);
    const tone = level === 'over' ? 'danger' : level === 'low' ? 'warn' : 'accent';
    const [ix, iy, iw, ih] = layout.inner;
    if (ratio > 0) {
      push({
        layer: 'tokens',
        elementId: placeId,
        op: 'fill',
        x: ix,
        y: iy,
        w: iw,
        h: ih,
        radius: Math.max(2, layout.radius - 2),
        value: ratio,
        tone,
      });
    }
    if (display.low !== undefined && display.low > 0 && display.low < display.max) {
      const ly = iy + ih * (1 - display.low / display.max);
      push({
        layer: 'tokens',
        elementId: placeId,
        op: 'path',
        points: [
          [ix + 1, ly],
          [ix + iw - 1, ly],
        ],
        stroke: 'warn',
        lineWidth: 1.2,
        dash: [3, 3],
        alpha: 0.95,
        cap: 'butt',
      });
    }
    if (layout.symbol && display.icon !== undefined) {
      push({
        layer: 'tokens',
        elementId: placeId,
        op: 'icon',
        icon: display.icon,
        x: layout.symbol.x,
        y: layout.symbol.y,
        size: layout.symbol.size,
        alpha: 0.9,
      });
    }
    if (layout.caption && !over) {
      push({
        layer: 'tokens',
        elementId: placeId,
        op: 'text',
        x: layout.caption.x,
        y: layout.caption.y,
        text: `max ${formatAmount(display.max)}`,
        size: 9,
        weight: 600,
        tone: 'ink2',
        align: layout.caption.align,
        baseline: layout.caption.above ? 'bottom' : 'top',
        mono: true,
        halo: true,
      });
    }
    if (over) {
      push({
        layer: 'tokens',
        elementId: placeId,
        op: 'rect',
        x: x - 1,
        y: y - 1,
        w: w + 2,
        h: h + 2,
        radius: layout.radius + 1,
        stroke: 'danger',
        lineWidth: 2.6,
      });
      push({
        layer: 'tokens',
        elementId: placeId,
        op: 'badge',
        x: x + w / 2,
        y,
        text: `${formatAmount(frame.count)} > ${formatAmount(display.max)}`,
        tone: 'danger',
      });
    }
  }

  if (display.style === 'pictogram' && layout.cells) {
    const cells = layout.cells;
    const symbols = pictogramSymbols(frame.count, display.per, cells.capacity);
    for (let i = 0; i < symbols.shown; i += 1) {
      const [cx, cy] = cellCenter(cells, i);
      const partial = i === symbols.full && symbols.part > 0;
      push({
        layer: 'tokens',
        elementId: placeId,
        op: 'icon',
        icon: info.icon,
        x: cx,
        y: cy,
        size: cells.size,
        ...(partial && { fraction: symbols.part }),
      });
    }
    if (symbols.hidden > 0) {
      const [cx, cy] = cellCenter(cells, symbols.shown);
      const text = `+${symbols.hidden}`;
      const pill = Math.max(18, approxWidth(text, 10, true) + 10);
      const right = cells.rect[0] + cells.rect[2];
      push({
        layer: 'tokens',
        elementId: placeId,
        op: 'badge',
        x: Math.min(cx, right - pill / 2),
        y: cy,
        text,
        accent: true,
      });
    }
  }

  push({
    layer: 'tokens',
    elementId: placeId,
    op: 'text',
    x: layout.number.x,
    y: layout.number.y,
    text: String(frame.count),
    size: layout.number.size,
    weight: 700,
    tone: over ? 'danger' : 'ink',
    align: layout.number.align,
    baseline: 'middle',
    mono: true,
    ...(display.style === 'fill' && { halo: true }),
  });

  if (layout.spark && frame.history && frame.history.length > 0) {
    const top = display.style === 'fill' ? display.max : 0;
    const now = frame.time ?? frame.history[frame.history.length - 1]!.t;
    // At the start there is no time yet that a curve could show.
    const line = now > frame.history[0]!.t ? stepLine(frame.history, now, layout.spark, top) : [];
    if (line.length >= 2) {
      push({
        layer: 'tokens',
        elementId: placeId,
        op: 'spark',
        points: line,
        base: layout.spark[1] + layout.spark[3],
        tone: 'accent',
      });
    }
  }
  return commands;
}

/** What a counter shows, in numbers: for tests, the status of the view and the hover card. */
export interface CounterSummary {
  style: CounterDisplay['style'];
  /** The number that is shown. */
  count: number;
  /** Fill: the part of the container that is filled, 0 to 1. */
  ratio?: number;
  level?: FillLevel;
  /** Fill: by how much the count is over `max`. */
  overflow?: number;
  /** Pictogram: the symbols that are drawn (a partial one included), and those that are not. */
  symbols?: number;
  hidden?: number;
}

/** The numbers behind the picture of a counter for a count. */
export function counterSummary(info: CounterInfo, count: number): CounterSummary {
  const { display } = info;
  if (display.style === 'fill') {
    const over = overflowOf(display, count);
    return {
      style: 'fill',
      count,
      ratio: fillRatio(count, display.max),
      level: fillLevel(display, count),
      ...(over > 0 && { overflow: over }),
    };
  }
  if (display.style === 'pictogram') {
    const cells = counterLayout(
      counterArea(info.entry, display),
      display,
      count,
      info.entry,
      info.label !== undefined,
      info.label ?? info.name,
    ).cells;
    const symbols = pictogramSymbols(count, display.per, cells?.capacity ?? 1);
    return { style: 'pictogram', count, symbols: symbols.shown, hidden: symbols.hidden };
  }
  return { style: 'number', count };
}
