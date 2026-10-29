import type { Id } from '@pnm/core';
import {
  FLASH_MS,
  sampleSprites,
  shownCount,
  type AnimationState,
  type SpriteSample,
} from './animation';
import { distance, pointInRect } from './geometry';
import {
  cellSize,
  cellStyleOf,
  spriteSize,
  withHighlight,
  type CellState,
  type DrawCommand,
  type Layer,
  type Scene,
  type Shape,
} from './scene';
import type { Point, Rect } from './schema';
import {
  DEFAULT_THRESHOLDS,
  queueLevel,
  stationInfos,
  type StationInfo,
  type Thresholds,
} from './status';
import type { LayoutContext, LayoutFiring, TokenLayout } from './token-layout';
import { isPathPlace } from './token-layout';

export interface DynamicOptions {
  /** Wall-clock milliseconds, the clock of the animation state. */
  now: number;
  /**
   * Simulation seconds at `now`: the time of the layout plus what has passed since, so that
   * progress rings and cases on a route run smoothly between two bundles of events.
   */
  simTime?: number;
  thresholds?: Thresholds;
  hover?: Id | null;
  selection?: readonly Id[];
  /** The case that is followed: its sprites get a ring. */
  followCase?: string | null;
  /** Transitions the followed case has been at; they get a light frame. */
  visited?: readonly Id[];
}

export interface DynamicScene {
  layers: Record<Layer, DrawCommand[]>;
  /** The sprites at `options.now`, for hit tests on tokens. */
  sprites: SpriteSample[];
  stations: Map<Id, StationInfo>;
}

const BELT_WIDTH = 24;
const BUFFER_WIDTH = 30;
const LANE_WIDTH = 18;

function emptyLayers(): Record<Layer, DrawCommand[]> {
  return {
    decor: [],
    arcs: [],
    places: [],
    transitions: [],
    tokens: [],
    labels: [],
    highlight: [],
  };
}

/** How long a counter that changed keeps its light background, in milliseconds. */
const COUNTER_PULSE_MS = 450;

function rectOf(shape: Shape): Rect | null {
  if (shape.type === 'rect') return shape.rect;
  if (shape.type === 'circle')
    return [shape.x - shape.r, shape.y - shape.r, 2 * shape.r, 2 * shape.r];
  return null;
}

/**
 * The part of the picture that changes while the simulation runs, on top of the static scene:
 * bottleneck colors of queues, the state of stations (free, busy, blocked) with progress rings
 * and bars, slot cells, counters of sinks and pools, the sprites of all cases, flashes, the
 * outline of the followed case and the highlight of hover and selection. Pure; built every frame.
 */
export function buildDynamicScene(
  context: LayoutContext,
  scene: Scene,
  layout: TokenLayout,
  anim: AnimationState,
  options: DynamicOptions,
): DynamicScene {
  const { net, view } = context;
  const layers = emptyLayers();
  const sprite = view.meta.entity.sprite;
  const thresholds = options.thresholds ?? DEFAULT_THRESHOLDS;
  const simTime = options.simTime ?? layout.time;
  const now = options.now;
  const stations = stationInfos(net, view, layout.counts, layout.running, context, thresholds);

  // Which transition's slots are drawn by a resource place.
  const slotPlaceOf = new Map<Id, Id>();
  for (const place of net.places) {
    const entry = view.places[place.id];
    if (entry?.kind === 'slots' && net.transitions.some((t) => t.id === entry.of)) {
      if (!slotPlaceOf.has(entry.of)) slotPlaceOf.set(entry.of, place.id);
    }
  }

  // Places: bottleneck colors of queues, counters of the places that are only numbers.
  for (const place of net.places) {
    const entry = view.places[place.id];
    if (!entry) continue;
    const count = layout.counts.get(place.id) ?? 0;
    if (isPathPlace(entry)) {
      if (context.roles.get(place.id) !== 'case' || entry.path.length < 2) continue;
      const level = queueLevel(count, thresholds);
      if (level === 'ok') continue;
      const width =
        entry.kind === 'conveyor' ? BELT_WIDTH : entry.kind === 'queue' ? LANE_WIDTH : BUFFER_WIDTH;
      layers.places.push({
        layer: 'places',
        elementId: place.id,
        op: 'path',
        points: entry.path,
        stroke: level === 'crit' ? 'danger' : 'warn',
        lineWidth: width + 4,
        alpha: level === 'crit' ? 0.62 : 0.55,
        cap: 'round',
      });
      continue;
    }
    if (entry.kind !== 'pool' && entry.kind !== 'sink' && entry.kind !== 'source') continue;
    const shown = shownCount(anim, place.id, count, now);
    const counter = anim.counters[place.id];
    const age = counter && now >= counter.changedAt ? now - counter.changedAt : Infinity;
    const pulse = age < COUNTER_PULSE_MS ? 1 - age / COUNTER_PULSE_MS : 0;
    if (entry.kind === 'pool') {
      const [x, y] = entry.pos;
      if (pulse > 0) {
        layers.tokens.push({
          layer: 'tokens',
          elementId: place.id,
          op: 'circle',
          x,
          y,
          r: 16,
          fill: 'ok',
          alpha: 0.35 * pulse,
        });
      }
      layers.tokens.push({
        layer: 'tokens',
        elementId: place.id,
        op: 'text',
        x,
        y,
        text: String(shown),
        size: 12,
        weight: 600,
        tone: 'ink',
        align: 'center',
        baseline: 'middle',
        mono: true,
      });
      continue;
    }
    const [x, y, w, h] = entry.box;
    const small = h < 56 || w < 70;
    const textX = small ? x + w - 8 : x + w / 2;
    const textY = small ? y + h / 2 : y + h / 2 + 14;
    if (pulse > 0) {
      layers.tokens.push({
        layer: 'tokens',
        elementId: place.id,
        op: 'rect',
        x: textX - (small ? 24 : 20),
        y: textY - 11,
        w: small ? 28 : 40,
        h: 22,
        radius: 6,
        fill: 'ok',
        alpha: 0.35 * pulse,
      });
    }
    layers.tokens.push({
      layer: 'tokens',
      elementId: place.id,
      op: 'text',
      x: textX,
      y: textY,
      text: String(shown),
      size: small ? 13 : 15,
      weight: 700,
      tone: 'ink',
      align: small ? 'right' : 'center',
      baseline: 'middle',
      mono: true,
    });
  }

  // Transitions: state of the stations, slot cells, progress.
  const runningAt = new Map<Id, LayoutFiring[]>();
  for (const firing of layout.running) {
    const list = runningAt.get(firing.transitionId) ?? [];
    list.push(firing);
    runningAt.set(firing.transitionId, list);
  }
  for (const transition of net.transitions) {
    const entry = view.transitions[transition.id];
    if (!entry || entry.kind === 'hidden') continue;
    const id = transition.id;
    const firings = runningAt.get(id) ?? [];
    const busySlots = new Set(firings.map((f) => f.slot));
    const info = stations.get(id);
    const slots: readonly Point[] = 'slots' in entry ? (entry.slots ?? []) : [];
    const claimed = slotPlaceOf.get(id);

    if ('box' in entry && info) {
      const regions: Rect[] =
        entry.kind === 'rooms' && entry.rooms?.length ? entry.rooms : [entry.box];
      const [x, y, w, h] = entry.box;
      const card = entry.kind === 'station' || entry.kind === 'machine' || entry.kind === 'gate';
      if (info.status === 'busy' || info.status === 'busy-full' || info.status === 'blocked') {
        const blocked = info.status === 'blocked';
        // Green while working, amber with every slot in use and cases waiting, red for a bottleneck.
        const tone = blocked ? 'danger' : info.status === 'busy-full' ? 'warn' : 'ok';
        if (card) {
          if (info.status !== 'busy') {
            layers.transitions.push({
              layer: 'transitions',
              elementId: id,
              op: 'rect',
              x,
              y,
              w,
              h,
              radius: 8,
              fill: tone,
              alpha: blocked ? 0.09 : 0.07,
            });
          }
          layers.transitions.push({
            layer: 'transitions',
            elementId: id,
            op: 'rect',
            x,
            y,
            w,
            h,
            radius: 8,
            stroke: tone,
            lineWidth: blocked ? 2.6 : info.status === 'busy-full' ? 2.3 : 2,
          });
        } else {
          for (const region of regions) {
            const [rx, ry, rw, rh] = region;
            // A room only lights up while a firing is in one of its slots (all of them if blocked).
            if (
              entry.kind === 'rooms' &&
              !blocked &&
              !slots.some((slot, index) => busySlots.has(index) && pointInRect(slot, region))
            ) {
              continue;
            }
            const inset = entry.kind === 'rooms' ? 5 : 0;
            layers.transitions.push({
              layer: 'transitions',
              elementId: id,
              op: 'rect',
              x: rx + inset,
              y: ry + inset,
              w: rw - 2 * inset,
              h: rh - 2 * inset,
              radius: entry.kind === 'rooms' ? 4 : 6,
              stroke: tone,
              lineWidth: blocked ? 2.2 : info.status === 'busy-full' ? 1.8 : 1.4,
              dash: [7, 5],
              alpha: 0.9,
            });
          }
        }
      }
      if (card) {
        const lowest = slots.reduce((m, s) => Math.max(m, s[1]), -Infinity);
        const barY = y + h - 10;
        if (h >= 44 && w >= 36 && lowest + 14 < barY) {
          layers.transitions.push({
            layer: 'transitions',
            elementId: id,
            op: 'progress',
            x: x + 8,
            y: barY,
            w: w - 16,
            h: 4,
            value:
              slots.length === 0 ? (info.busy > 0 ? 1 : 0) : Math.min(1, info.busy / slots.length),
            tone:
              info.status === 'blocked' ? 'danger' : info.status === 'busy-full' ? 'warn' : 'ok',
          });
        }
      }
    } else if ('pos' in entry && firings.length > 0) {
      const [x, y] = entry.pos;
      layers.transitions.push({
        layer: 'transitions',
        elementId: id,
        op: 'circle',
        x,
        y,
        r: entry.kind === 'waypoint' ? 11 : entry.kind === 'door' ? 20 : 26,
        fill: 'okSoft',
        stroke: 'ok',
        lineWidth: 1.6,
        alpha: entry.kind === 'waypoint' ? 0.9 : 0.75,
      });
    }

    // Cells of the resource place of the transition, or a plain mark on each busy slot.
    const style = 'kind' in entry ? cellStyleOf(entry.kind) : 'slot';
    const [cw, ch] = cellSize(style);
    let free = claimed !== undefined ? (layout.counts.get(claimed) ?? 0) : 0;
    slots.forEach((slot, index) => {
      const busy = busySlots.has(index);
      if (claimed !== undefined) {
        let state: CellState = 'off';
        if (busy) state = 'busy';
        else if (free > 0) {
          state = 'free';
          free -= 1;
        }
        layers.tokens.push({
          layer: 'tokens',
          elementId: claimed,
          op: 'cell',
          style,
          x: slot[0],
          y: slot[1],
          w: cw,
          h: ch,
          state,
        });
      } else if (busy) {
        layers.transitions.push({
          layer: 'transitions',
          elementId: id,
          op: 'circle',
          x: slot[0],
          y: slot[1],
          r: 14,
          fill: 'okSoft',
          stroke: 'ok',
          lineWidth: 1.5,
        });
      }
    });
    for (const firing of firings) {
      const slot = slots[firing.slot];
      if (!slot) continue;
      const span = firing.end - firing.start;
      const value = span > 0 ? Math.min(1, Math.max(0, (simTime - firing.start) / span)) : 1;
      if (style === 'slot' || style === 'machine') {
        layers.tokens.push({
          layer: 'tokens',
          elementId: id,
          op: 'ring',
          x: slot[0],
          y: slot[1],
          r: Math.max(cw, ch) / 2 + 3,
          value,
          tone: 'ok',
        });
      } else {
        layers.tokens.push({
          layer: 'tokens',
          elementId: id,
          op: 'progress',
          x: slot[0] - cw / 2,
          y: slot[1] + ch / 2 + 3,
          w: cw,
          h: 3,
          value,
        });
      }
    }
  }

  // The followed case: a frame around the stations it has been at.
  const visited = new Set(options.visited ?? []);
  if (visited.size > 0) {
    for (const area of scene.hits) {
      if (area.kind !== 'transition' || !visited.has(area.elementId)) continue;
      const rect = rectOf(area.shape);
      if (!rect) continue;
      layers.transitions.push({
        layer: 'transitions',
        elementId: area.elementId,
        op: 'rect',
        x: rect[0] - 3,
        y: rect[1] - 3,
        w: rect[2] + 6,
        h: rect[3] + 6,
        radius: 10,
        stroke: 'accent',
        lineWidth: 1.5,
        dash: [4, 4],
        alpha: 0.55,
      });
    }
  }

  // The sprites of all cases; the followed one has a ring.
  const sprites = sampleSprites(layout, anim, now, simTime);
  const size = spriteSize(sprite);
  const oriented = sprite === 'person' || sprite === 'vehicle';
  const followed = options.followCase ?? null;
  for (const item of sprites) {
    if (followed !== null && item.caseId === followed) {
      layers.tokens.push({
        layer: 'tokens',
        op: 'circle',
        x: item.point[0],
        y: item.point[1],
        r: size * 0.85,
        fill: 'accent',
        stroke: 'accent',
        lineWidth: 2,
        alpha: 0.3,
      });
    }
    layers.tokens.push({
      layer: 'tokens',
      op: 'sprite',
      sprite,
      x: item.point[0],
      y: item.point[1],
      size,
      ...(oriented && { angle: Math.atan2(item.direction[1], item.direction[0]) }),
    });
  }
  for (const [placeId, over] of layout.overflow) {
    layers.tokens.push({
      layer: 'tokens',
      elementId: placeId,
      op: 'badge',
      x: over.pos[0],
      y: over.pos[1],
      text: `+${over.extra}`,
    });
  }

  // Flashes: an outline that grows and fades around the element.
  for (const flash of anim.flashes) {
    const age = now - flash.startedAt;
    if (age < 0 || age >= FLASH_MS) continue;
    const progress = age / FLASH_MS;
    const fade = (1 - progress) * (1 - progress);
    for (const area of scene.hits) {
      if (area.elementId !== flash.elementId || area.kind === 'arc') continue;
      const grow = 3 + progress * 9;
      const shape = area.shape;
      if (shape.type === 'rect') {
        const [x, y, w, h] = shape.rect;
        layers.tokens.push({
          layer: 'tokens',
          elementId: flash.elementId,
          op: 'rect',
          x: x - grow,
          y: y - grow,
          w: w + 2 * grow,
          h: h + 2 * grow,
          radius: 10 + grow / 2,
          stroke: 'ok',
          lineWidth: 2,
          alpha: 0.75 * fade,
        });
      } else if (shape.type === 'circle') {
        layers.tokens.push({
          layer: 'tokens',
          elementId: flash.elementId,
          op: 'circle',
          x: shape.x,
          y: shape.y,
          r: shape.r + grow,
          stroke: 'ok',
          lineWidth: 2,
          alpha: 0.75 * fade,
        });
      } else {
        layers.tokens.push({
          layer: 'tokens',
          elementId: flash.elementId,
          op: 'path',
          points: shape.points,
          stroke: 'ok',
          lineWidth: shape.width + grow,
          alpha: 0.28 * fade,
          cap: 'round',
        });
      }
    }
  }

  layers.highlight = withHighlight(scene, {
    hover: options.hover ?? null,
    selection: options.selection ?? [],
  }).layers.highlight;

  return { layers, sprites, stations };
}

/** The sprite under a point (scene coordinates), the front-most one if several overlap. */
export function hitSprite(
  sprites: readonly SpriteSample[],
  point: Point,
  size: number,
  slack = 0,
): SpriteSample | null {
  let best: SpriteSample | null = null;
  let bestDistance = Infinity;
  for (let i = sprites.length - 1; i >= 0; i -= 1) {
    const item = sprites[i]!;
    const d = distance(point, item.point);
    if (d <= size * 0.6 + slack && d < bestDistance) {
      best = item;
      bestDistance = d;
    }
  }
  return best;
}
