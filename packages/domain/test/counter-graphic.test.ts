import { createEmptyNet, type PetriNet } from '@pnm/core';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_ANIMATION,
  LAYERS,
  buildDynamicScene,
  buildScene,
  buildStaticScene,
  cellCenter,
  counterArea,
  counterInfo,
  counterLayout,
  counterSummary,
  dynamicCounterCommands,
  fillLevel,
  fillRatio,
  graphicDisplay,
  hitTest,
  layoutContext,
  layoutTokens,
  legendText,
  nameWithoutUnit,
  netHash,
  overflowOf,
  pictogramSymbols,
  staticCounterCommands,
  unitOf,
  validateDomainView,
  type CounterDisplay,
  type CounterEntry,
  type DomainView,
  type DrawCommand,
  type Scene,
} from '../src';

/** A store and two totals of amounts, and a place that counts finished cases. */
function amountsNet(): PetriNet {
  const net = createEmptyNet('Amounts');
  net.places = [
    { id: 'store', name: 'Store', position: { x: 0, y: 0 }, role: 'quantity' },
    { id: 'co2', name: 'CO2', position: { x: 0, y: 0 }, role: 'quantity' },
    { id: 'scrap', name: 'Scrap', position: { x: 0, y: 0 }, role: 'quantity' },
    { id: 'in', name: 'In', position: { x: 0, y: 0 } },
    { id: 'done', name: 'Done', position: { x: 0, y: 0 } },
  ];
  net.transitions = [
    { id: 't', name: 'Work', position: { x: 0, y: 0 }, timing: { kind: 'fixed', value: 10 } },
  ];
  net.arcs = [
    { id: 'a1', source: 'store', target: 't', weight: 3 },
    { id: 'a2', source: 'in', target: 't', weight: 1 },
    { id: 'a3', source: 't', target: 'co2', weight: 2 },
    { id: 'a4', source: 't', target: 'scrap', weight: 1 },
    { id: 'a5', source: 't', target: 'done', weight: 1 },
  ];
  net.marking = { store: Array.from({ length: 120 }, () => 1), in: [1] };
  return net;
}

const net = amountsNet();

function amountsView(
  displays: {
    store?: CounterDisplay;
    co2?: CounterDisplay;
    scrap?: CounterDisplay;
    done?: CounterDisplay;
  } = {},
): DomainView {
  const d = (display: CounterDisplay | undefined) => (display ? { display } : {});
  return {
    schemaVersion: 1,
    netHash: netHash(net),
    meta: {
      theme: 'Test',
      viewName: 'Plant',
      entity: { singular: 'Frame', plural: 'Frames', sprite: 'frame' },
      canvas: { width: 900, height: 500 },
    },
    places: {
      store: { kind: 'pool', pos: [100, 200], label: 'Store (kg)', ...d(displays.store) },
      co2: { kind: 'sink', box: [400, 20, 336, 100], label: 'CO2e (kg)', ...d(displays.co2) },
      scrap: { kind: 'pool', pos: [100, 400], label: 'Scrap (kg)', ...d(displays.scrap) },
      in: {
        kind: 'queue',
        path: [
          [20, 300],
          [200, 300],
        ],
      },
      done: { kind: 'sink', box: [400, 300, 100, 120], label: 'Done', ...d(displays.done) },
    },
    transitions: { t: { kind: 'station', box: [250, 250, 100, 80], slots: [[300, 290]] } },
    provenance: {},
  };
}

const FILL: CounterDisplay = { style: 'fill', max: 200, low: 40, icon: 'material' };
const PICTOGRAM: CounterDisplay = { style: 'pictogram', per: 50, icon: 'co2', history: true };

const entryOf = (view: DomainView, id: string): CounterEntry => view.places[id] as CounterEntry;
const all = (scene: Scene): DrawCommand[] => LAYERS.flatMap((layer) => scene.layers[layer]);
const info = (view: DomainView, id: string) => {
  const entry = entryOf(view, id);
  const display = graphicDisplay(entry)!;
  return counterInfo(id, entry, display, net, view, id === 'done');
};
const frameOf = (view: DomainView, id: string, count: number, extra = {}) =>
  dynamicCounterCommands(info(view, id), { count, ...extra });

describe('which counters get a graphic', () => {
  it('only those with a fill, a pictogram or a history', () => {
    const view = amountsView({ store: FILL, co2: { style: 'number', history: true } });
    expect(graphicDisplay(view.places['store'])).toEqual(FILL);
    expect(graphicDisplay(view.places['co2'])).toEqual({ style: 'number', history: true });
    expect(graphicDisplay(view.places['scrap'])).toBeNull();
    expect(graphicDisplay(amountsView({ scrap: { style: 'number' } }).places['scrap'])).toBeNull();
    expect(graphicDisplay(view.places['in'])).toBeNull();
    expect(graphicDisplay(undefined)).toBeNull();
  });

  it('draws what it can of a display that rule V10 rejects, and never divides by zero', () => {
    const broken = amountsView({
      store: { style: 'fill', max: 0 },
      co2: { style: 'pictogram', per: 0, history: true },
    });
    expect(graphicDisplay(broken.places['store'])).toBeNull();
    expect(graphicDisplay(broken.places['co2'])).toEqual({ style: 'number', history: true });
    const scene = buildScene(net, broken, net.marking);
    expect(all(scene).every((c) => c.op !== 'fill')).toBe(true);
    expect(JSON.stringify(all(scene))).not.toMatch(/NaN|Infinity|null/);
  });
});

describe('the fill level', () => {
  it('is proportional to the count, empty at 0, full at max and for more', () => {
    expect(fillRatio(0, 200)).toBe(0);
    expect(fillRatio(50, 200)).toBe(0.25);
    expect(fillRatio(120, 200)).toBe(0.6);
    expect(fillRatio(200, 200)).toBe(1);
    expect(fillRatio(213, 200)).toBe(1);
    expect(fillRatio(5, 0)).toBe(0);
  });

  it('is yellow below low, normal from low on, and over the limit beyond max', () => {
    const fill = FILL as Extract<CounterDisplay, { style: 'fill' }>;
    expect(fillLevel(fill, 0)).toBe('low');
    expect(fillLevel(fill, 39)).toBe('low');
    expect(fillLevel(fill, 40)).toBe('normal');
    expect(fillLevel(fill, 199)).toBe('normal');
    expect(fillLevel(fill, 200)).toBe('full');
    expect(fillLevel(fill, 201)).toBe('over');
    expect(fillLevel({ style: 'fill', max: 10 }, 0)).toBe('normal');
  });

  it('is drawn as a liquid whose height is the count over max, with the tone of its state', () => {
    const view = amountsView({ store: FILL });
    const liquid = (count: number) =>
      frameOf(view, 'store', count).find((c) => c.op === 'fill') as
        Extract<DrawCommand, { op: 'fill' }> | undefined;
    expect(liquid(0)).toBeUndefined();
    expect(liquid(120)).toMatchObject({ value: 0.6, tone: 'accent' });
    expect(liquid(30)).toMatchObject({ value: 0.15, tone: 'warn' });
    expect(liquid(200)).toMatchObject({ value: 1, tone: 'accent' });
    expect(liquid(213)).toMatchObject({ value: 1, tone: 'danger' });
    // The liquid stays inside the container.
    const area = counterArea(entryOf(view, 'store'), FILL);
    const box = liquid(120)!;
    expect(box.x).toBeGreaterThanOrEqual(area[0]);
    expect(box.x + box.w).toBeLessThanOrEqual(area[0] + area[2]);
    expect(box.y).toBeGreaterThanOrEqual(area[1]);
    expect(box.y + box.h).toBeLessThanOrEqual(area[1] + area[3]);
  });

  it('marks the limit where the container is full and the level where it turns yellow', () => {
    const view = amountsView({ store: FILL });
    const commands = frameOf(view, 'store', 120);
    expect(commands.find((c) => c.op === 'text' && c.text === 'max 200')).toBeDefined();
    const lowLine = commands.find((c) => c.op === 'path' && c.stroke === 'warn');
    const area = counterArea(entryOf(view, 'store'), FILL);
    // 40 of 200 is a fifth of the way up from the inside bottom edge.
    const bottom = area[1] + area[3] - 2;
    expect(lowLine && lowLine.op === 'path' && bottom - lowLine.points[0]![1]).toBeCloseTo(
      (area[3] - 4) * 0.2,
      5,
    );
    // Without low there is no line.
    const noLow = amountsView({ store: { style: 'fill', max: 200 } });
    expect(frameOf(noLow, 'store', 120).some((c) => c.op === 'path' && c.stroke === 'warn')).toBe(
      false,
    );
  });

  it('draws the overflow visibly: the container full and red, a mark with the numbers, the number red', () => {
    const view = amountsView({ store: FILL });
    expect(overflowOf(FILL, 213)).toBe(13);
    expect(overflowOf(FILL, 200)).toBe(0);
    expect(overflowOf({ style: 'pictogram', per: 5 }, 999)).toBe(0);
    const commands = frameOf(view, 'store', 213);
    const badge = commands.find((c) => c.op === 'badge');
    expect(badge).toMatchObject({ text: '213 > 200', tone: 'danger' });
    expect(commands.some((c) => c.op === 'rect' && c.stroke === 'danger')).toBe(true);
    expect(commands.find((c) => c.op === 'text' && c.text === '213')).toMatchObject({
      tone: 'danger',
    });
    // Nothing of that when it is not over.
    const fine = frameOf(view, 'store', 200);
    expect(fine.some((c) => c.op === 'badge')).toBe(false);
    expect(fine.some((c) => c.op === 'rect' && c.stroke === 'danger')).toBe(false);
  });

  it('summarizes what it shows', () => {
    const view = amountsView({ store: FILL });
    expect(counterSummary(info(view, 'store'), 120)).toEqual({
      style: 'fill',
      count: 120,
      ratio: 0.6,
      level: 'normal',
    });
    expect(counterSummary(info(view, 'store'), 213)).toMatchObject({
      ratio: 1,
      level: 'over',
      overflow: 13,
    });
  });
});

describe('the pictogram', () => {
  it('is one symbol for every per tokens, and the rest as a partly filled one', () => {
    expect(pictogramSymbols(0, 50, 20)).toEqual({
      full: 0,
      part: 0,
      total: 0,
      shown: 0,
      hidden: 0,
    });
    expect(pictogramSymbols(49, 50, 20)).toMatchObject({ full: 0, total: 1, shown: 1, hidden: 0 });
    expect(pictogramSymbols(49, 50, 20).part).toBeCloseTo(0.98, 5);
    expect(pictogramSymbols(50, 50, 20)).toEqual({
      full: 1,
      part: 0,
      total: 1,
      shown: 1,
      hidden: 0,
    });
    const s = pictogramSymbols(130, 50, 20);
    expect(s).toMatchObject({ full: 2, total: 3, shown: 3, hidden: 0 });
    expect(s.part).toBeCloseTo(0.6, 5);
    // A rounding error of the division is no part of a symbol.
    expect(pictogramSymbols(0.3 * 10, 0.1 * 30, 20)).toMatchObject({ part: 0 });
    expect(pictogramSymbols(7, 1, 20)).toMatchObject({ full: 7, part: 0, total: 7 });
  });

  it('announces what does not fit instead of making the symbols smaller', () => {
    // 12 cells; 1000 / 50 = 20 symbols: 11 are drawn and the last cell says +9.
    expect(pictogramSymbols(1000, 50, 12)).toEqual({
      full: 11,
      part: 0,
      total: 20,
      shown: 11,
      hidden: 9,
    });
    // Exactly as many as cells: nothing is cut.
    expect(pictogramSymbols(600, 50, 12)).toMatchObject({ shown: 12, hidden: 0 });
    expect(pictogramSymbols(601, 50, 12)).toMatchObject({ shown: 11, hidden: 2 });
    expect(pictogramSymbols(5, 1, 1)).toEqual({ full: 0, part: 0, total: 5, shown: 0, hidden: 5 });
  });

  it('draws the symbols of the display with the fraction of the last one, and the number', () => {
    const view = amountsView({ co2: PICTOGRAM });
    const commands = frameOf(view, 'co2', 130);
    const icons = commands.filter((c) => c.op === 'icon');
    expect(icons).toHaveLength(3);
    expect(icons.every((c) => c.op === 'icon' && c.icon === 'co2')).toBe(true);
    expect(icons.map((c) => c.op === 'icon' && c.fraction)).toEqual([
      undefined,
      undefined,
      expect.closeTo(0.6, 5),
    ]);
    expect(commands.find((c) => c.op === 'text' && c.text === '130')).toBeDefined();
    expect(commands.some((c) => c.op === 'badge')).toBe(false);
    // Same size, in rows from the left.
    const sizes = new Set(icons.map((c) => c.op === 'icon' && c.size));
    expect(sizes.size).toBe(1);
    const xs = icons.map((c) => c.op === 'icon' && c.x) as number[];
    expect(xs[1]! - xs[0]!).toBeGreaterThan(sizes.values().next().value as number);
  });

  it('cuts with +N when the box is full, at any count, with symbols of one size', () => {
    const view = amountsView({ co2: PICTOGRAM });
    const layout = counterLayout(
      counterArea(entryOf(view, 'co2'), PICTOGRAM),
      PICTOGRAM,
      0,
      entryOf(view, 'co2'),
      true,
      'CO2e (kg)',
    );
    const capacity = layout.cells!.capacity;
    expect(capacity).toBeGreaterThanOrEqual(20);
    for (const symbolsNeeded of [capacity - 1, capacity, capacity + 1, capacity + 30]) {
      const commands = frameOf(view, 'co2', symbolsNeeded * 50);
      const icons = commands.filter((c) => c.op === 'icon');
      const badge = commands.find((c) => c.op === 'badge');
      const sizes = new Set(icons.map((c) => c.op === 'icon' && c.size));
      expect(sizes.size).toBe(1);
      if (symbolsNeeded <= capacity) {
        expect(icons).toHaveLength(symbolsNeeded);
        expect(badge).toBeUndefined();
      } else {
        expect(icons).toHaveLength(capacity - 1);
        expect(badge).toMatchObject({ text: `+${symbolsNeeded - (capacity - 1)}` });
        // The mark stands inside the box.
        const [x, , w] = counterArea(entryOf(view, 'co2'), PICTOGRAM);
        expect(badge?.op === 'badge' && badge.x).toBeLessThan(x + w);
      }
    }
  });

  it('puts the cells inside the box and the number clear of them', () => {
    for (const [id, display] of [
      ['co2', PICTOGRAM],
      ['done', { style: 'pictogram', per: 5, icon: 'parcel' }],
    ] as const) {
      const view = amountsView({ [id]: display });
      const entry = entryOf(view, id);
      const area = counterArea(entry, display);
      const layout = counterLayout(area, display, 1234, entry, true, 'x');
      const cells = layout.cells!;
      for (let i = 0; i < cells.capacity; i += 1) {
        const [cx, cy] = cellCenter(cells, i);
        expect(cx - cells.size / 2).toBeGreaterThanOrEqual(area[0]);
        expect(cx + cells.size / 2).toBeLessThanOrEqual(area[0] + area[2] + 0.001);
        expect(cy - cells.size / 2).toBeGreaterThanOrEqual(area[1]);
        expect(cy + cells.size / 2).toBeLessThanOrEqual(area[1] + area[3] + 0.001);
      }
      if (layout.large) expect(layout.number.x + 20).toBeLessThan(cells.rect[0]);
    }
  });

  it('has a legend with the scale: one symbol is per tokens and the unit', () => {
    const view = amountsView({
      co2: PICTOGRAM,
      done: { style: 'pictogram', per: 5, icon: 'parcel' },
    });
    const legend = (id: string) =>
      staticCounterCommands(info(view, id)).filter(
        (c) => (c.op === 'text' && c.text.startsWith('=')) || c.op === 'icon',
      );
    const co2 = legend('co2');
    expect(co2.find((c) => c.op === 'text')).toMatchObject({ text: '= 50 kg' });
    expect(co2.find((c) => c.op === 'icon')).toMatchObject({ icon: 'co2' });
    // No unit in the label: no unit in the legend.
    expect(legend('done').find((c) => c.op === 'text')).toMatchObject({ text: '= 5' });
    expect(legend('done').find((c) => c.op === 'icon')).toMatchObject({ icon: 'parcel' });
    expect(unitOf({ style: 'number', unit: 'litres' }, 'Water (kg)')).toBe('litres');
    expect(unitOf({ style: 'number' }, 'Water (m³)')).toBe('m³');
    expect(unitOf({ style: 'number' }, 'Water')).toBe('');
    expect(legendText({ style: 'pictogram', per: 2.5 }, 'x (kg)')).toBe('= 2.5 kg');
    expect(nameWithoutUnit('Rohrlager (kg)')).toBe('Rohrlager');
    expect(nameWithoutUnit('(kg)')).toBe('(kg)');
  });

  it('uses the entity for a counter of cases and the dot for an amount when no symbol is given', () => {
    const view = amountsView({
      co2: { style: 'pictogram', per: 50 },
      done: { style: 'pictogram', per: 5 },
    });
    expect(info(view, 'co2').icon).toBe('dot');
    expect(info(view, 'done').icon).toBe('frame');
  });
});

describe('the number stays in every style, and the label is a title in a large box', () => {
  const styles: Array<[string, Partial<Record<'store' | 'co2' | 'done', CounterDisplay>>]> = [
    ['fill in a pool', { store: FILL }],
    ['pictogram in a box', { co2: PICTOGRAM }],
    ['pictogram in a small box', { done: { style: 'pictogram', per: 5, icon: 'parcel' } }],
    ['fill in a box', { co2: { style: 'fill', max: 500 } }],
    ['history of a plain number', { co2: { style: 'number', history: true } }],
  ];
  for (const [name, displays] of styles) {
    it(`${name}`, () => {
      const view = amountsView(displays);
      const [id] = Object.keys(displays) as Array<'store' | 'co2' | 'done'>;
      for (const count of [0, 7, 120, 5000]) {
        const commands = frameOf(view, id!, count);
        const number = commands.filter((c) => c.op === 'text' && c.text === String(count));
        expect(number, `count ${count}`).toHaveLength(1);
        // The number lies inside the area of the counter.
        const display = graphicDisplay(view.places[id!])!;
        const [x, y, w, h] = counterArea(entryOf(view, id!), display);
        const at = number[0] as Extract<DrawCommand, { op: 'text' }>;
        expect(at.x).toBeGreaterThanOrEqual(x);
        expect(at.x).toBeLessThanOrEqual(x + w);
        expect(at.y).toBeGreaterThanOrEqual(y);
        expect(at.y).toBeLessThanOrEqual(y + h);
      }
    });
  }

  it('a large box carries its label inside, a small one and a pool below', () => {
    const view = amountsView({ store: FILL, co2: PICTOGRAM, done: { style: 'pictogram', per: 5 } });
    const scene = buildScene(net, view, net.marking);
    const label = (id: string, text: string) =>
      scene.layers.labels.find((c) => c.op === 'text' && c.elementId === id && c.text === text) as
        Extract<DrawCommand, { op: 'text' }> | undefined;
    const co2 = label('co2', 'CO2e (kg)')!;
    expect(co2.y).toBeLessThan(40);
    expect(co2.align).toBe('left');
    expect(label('done', 'Done')!.y).toBeGreaterThan(420);
    expect(label('store', 'Store (kg)')!.y).toBeGreaterThan(200 + 40);
  });
});

describe('the scene of counters with a graphic', () => {
  const view = amountsView({ store: FILL, co2: PICTOGRAM, done: { style: 'pictogram', per: 5 } });

  it('is part of the static scene (container, ticks, legend) and of the dynamic one (level, symbols, number)', () => {
    const scene = buildStaticScene(net, view);
    expect(scene.layers.tokens).toEqual([]);
    expect(scene.layers.places.some((c) => c.op === 'segments' && c.elementId === 'store')).toBe(
      true,
    );
    expect(scene.layers.places.some((c) => c.op === 'text' && c.text === '= 50 kg')).toBe(true);
    const context = layoutContext(net, view);
    const layout = layoutTokens(net, view, {
      time: 0,
      marking: { store: Array(150).fill(1), co2: Array(130).fill(1) },
      running: [],
    });
    const frame = buildDynamicScene(context, scene, layout, EMPTY_ANIMATION, {
      now: 0,
      simTime: 0,
    });
    expect(frame.layers.tokens.find((c) => c.op === 'fill')).toMatchObject({
      elementId: 'store',
      value: 0.75,
    });
    expect(
      frame.layers.tokens.filter((c) => c.op === 'icon' && c.elementId === 'co2'),
    ).toHaveLength(3);
    expect(frame.graphics.get('store')).toMatchObject({ style: 'fill', ratio: 0.75 });
    expect(frame.graphics.get('co2')).toMatchObject({ style: 'pictogram', symbols: 3, hidden: 0 });
    expect(frame.graphics.has('scrap')).toBe(false);
  });

  it('is the same with the marking in one scene (an export)', () => {
    const marking = { store: Array(150).fill(1) as number[], co2: Array(130).fill(1) as number[] };
    const whole = buildScene(net, view, marking);
    expect(
      whole.layers.tokens.find((c) => c.op === 'fill' && c.elementId === 'store'),
    ).toMatchObject({ value: 0.75 });
    expect(
      whole.layers.tokens.filter((c) => c.op === 'icon' && c.elementId === 'co2'),
    ).toHaveLength(3);
    // The curve is drawn if the caller has the history.
    const withHistory = buildScene(net, view, marking, {
      history: {
        co2: [
          { t: 0, v: 0 },
          { t: 100, v: 130 },
        ],
      },
      time: 200,
    });
    expect(withHistory.layers.tokens.some((c) => c.op === 'spark')).toBe(true);
    expect(whole.layers.tokens.some((c) => c.op === 'spark')).toBe(false);
  });

  it('has a region for hover and clicks that is the area of the counter', () => {
    const scene = buildScene(net, view, net.marking);
    const area = counterArea(entryOf(view, 'store'), FILL);
    expect(hitTest(scene, [area[0] + area[2] / 2, area[1] + area[3] / 2])).toEqual({
      elementId: 'store',
      kind: 'place',
    });
    // The corner of the container is part of it, where the circle of a plain pool would not be.
    expect(hitTest(scene, [area[0] + 3, area[1] + 3])).toEqual({
      elementId: 'store',
      kind: 'place',
    });
    expect(hitTest(scene, [area[0] + area[2] + 30, area[1] + area[3] / 2])).toBeNull();
  });

  it('draws the curve of a counter from its history, to the current time', () => {
    const commands = frameOf(amountsView({ co2: PICTOGRAM }), 'co2', 130, {
      history: [
        { t: 0, v: 0 },
        { t: 1000, v: 80 },
        { t: 2000, v: 130 },
      ],
      time: 3000,
    });
    const spark = commands.find((c) => c.op === 'spark') as Extract<DrawCommand, { op: 'spark' }>;
    expect(spark.tone).toBe('accent');
    const view = amountsView({ co2: PICTOGRAM });
    const layout = counterLayout(
      counterArea(entryOf(view, 'co2'), PICTOGRAM),
      PICTOGRAM,
      0,
      entryOf(view, 'co2'),
      true,
      'x',
    );
    const [sx, sy, sw, sh] = layout.spark!;
    for (const [x, y] of spark.points) {
      expect(x).toBeGreaterThanOrEqual(sx - 0.001);
      expect(x).toBeLessThanOrEqual(sx + sw + 0.001);
      expect(y).toBeGreaterThanOrEqual(sy - 0.001);
      expect(y).toBeLessThanOrEqual(sy + sh + 0.001);
    }
    expect(spark.points[spark.points.length - 1]![0]).toBeCloseTo(sx + sw, 5);
    expect(spark.base).toBe(sy + sh);
    // At time 0 there is nothing to show yet, and without a history no curve.
    expect(
      frameOf(amountsView({ co2: PICTOGRAM }), 'co2', 0, {
        history: [{ t: 0, v: 0 }],
        time: 0,
      }).some((c) => c.op === 'spark'),
    ).toBe(false);
    expect(frameOf(amountsView({ co2: PICTOGRAM }), 'co2', 5).some((c) => c.op === 'spark')).toBe(
      false,
    );
  });

  it('a counter without a graphic is drawn exactly as before', () => {
    const plain = amountsView();
    const scene = buildScene(net, plain, net.marking);
    const kinds = new Set(all(scene).map((c) => c.op));
    for (const op of ['fill', 'icon', 'spark'] as const) expect(kinds.has(op)).toBe(false);
    expect(validateDomainView(net, view).diagnostics.filter((d) => d.severity === 'error')).toEqual(
      [],
    );
  });
});
