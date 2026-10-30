import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createEmptyNet, parseNetText, type PetriNet } from '@pnm/core';
import { createSimulation } from '@pnm/sim';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_ANIMATION,
  HISTORY_LIMIT,
  HISTORY_WINDOW_SECONDS,
  applyEvents,
  buildDynamicScene,
  buildStaticScene,
  genericDomainView,
  layoutContext,
  layoutStateOf,
  layoutTokens,
  pruneAnimation,
  rewindHistory,
  trimHistory,
  type DomainView,
  type FlowMarker,
} from '../src';
import { runAnimated } from './animated-run';

const bikes = parseNetText(
  readFileSync(
    join(import.meta.dirname, '..', '..', '..', 'examples', 'bike-frames.pn.json'),
    'utf8',
  ),
);
const bikeView = bikes.domainView as DomainView;

describe('the history of a counter', () => {
  it('has a point at the events that changed the count, and ends with the count that is shown', async () => {
    const { events, anim, layout } = await runAnimated(bikes, bikeView, {
      bundle: 30,
      seconds: 4 * 3600,
    });
    const series = anim.history?.['p_co2'] ?? [];
    expect(series.length).toBeGreaterThan(20);
    // The last value is the number on the counter.
    expect(series[series.length - 1]!.v).toBe(layout.counts.get('p_co2'));
    expect(anim.counters['p_co2']?.value).toBe(layout.counts.get('p_co2'));
    // The time only moves forward, and every point but the first is at an event that changed the count.
    const eventTimes = new Set(
      events
        .filter((e) => e.type === 'complete' && e.produced.some((ref) => ref.placeId === 'p_co2'))
        .map((e) => e.t),
    );
    series.forEach((point, i) => {
      if (i > 0) expect(point.t).toBeGreaterThanOrEqual(series[i - 1]!.t);
      if (i > 0) expect(eventTimes.has(point.t), `t=${point.t}`).toBe(true);
      expect(point.v).toBeGreaterThanOrEqual(0);
    });
    // A delivery of primary steel puts 80 kg of CO2e on the counter in one step: the jump is in it.
    const jumps = series.filter((point, i) => i > 0 && point.v - series[i - 1]!.v >= 80);
    expect(jumps.length).toBeGreaterThan(0);
    // The values are those of the stream.
    const produced = events.reduce(
      (n, e) =>
        n + (e.type === 'complete' ? e.produced.filter((r) => r.placeId === 'p_co2').length : 0),
      0,
    );
    expect(series[series.length - 1]!.v).toBe(produced);
    // The counters without `history` have none.
    expect(Object.keys(anim.history ?? {})).toEqual(['p_co2']);
  }, 30_000);

  it('keeps the last eight simulated hours and at most 500 points', async () => {
    const { anim, layout } = await runAnimated(bikes, bikeView, {
      bundle: 120,
      seconds: 20 * 3600,
    });
    const series = anim.history!['p_co2']!;
    expect(layout.time).toBeGreaterThan(19 * 3600);
    // Trimmed whenever the count changes (the curve cuts at the time it is drawn for).
    expect(series[0]!.t).toBeGreaterThanOrEqual(layout.time - HISTORY_WINDOW_SECONDS - 600);
    expect(trimHistory(series, layout.time)[0]!.t).toBeGreaterThanOrEqual(
      layout.time - HISTORY_WINDOW_SECONDS,
    );
    expect(series.length).toBeLessThanOrEqual(HISTORY_LIMIT);
    expect(series[series.length - 1]!.v).toBe(layout.counts.get('p_co2'));
  }, 60_000);

  it('is the same series whatever the size of the bundles', async () => {
    const fine = await runAnimated(bikes, bikeView, { bundle: 7, seconds: 3 * 3600 });
    const coarse = await runAnimated(bikes, bikeView, { bundle: 600, seconds: 3 * 3600 });
    const tail = (series: Array<{ t: number; v: number }> | undefined) => (series ?? []).slice(1);
    expect(tail(coarse.anim.history?.['p_co2'])).toEqual(tail(fine.anim.history?.['p_co2']));
  }, 60_000);

  it('does nothing for a view without a history: the state is as it was', async () => {
    const plain = structuredClone(bikeView);
    for (const entry of Object.values(plain.places)) {
      if ('display' in entry && entry.display) delete entry.display.history;
    }
    const { anim } = await runAnimated(bikes, plain, { bundle: 60, seconds: 3600 });
    expect(anim.history).toEqual({});
    expect(EMPTY_ANIMATION.history).toEqual({});
  });
});

describe('rewinding the history', () => {
  async function runTo(seconds: number) {
    return runAnimated(bikes, bikeView, { bundle: 30, seconds });
  }

  it('cuts what lies after the new time, and ends with the count of the new state', async () => {
    const full = await runTo(4 * 3600);
    const series = full.anim.history!['p_co2']!;
    const context = layoutContext(bikes, bikeView);
    const middle = series[Math.floor(series.length / 2)]!;
    // The state at the time of that point (a step back to it, or a jump).
    const earlier = layoutTokens(bikes, bikeView, {
      time: middle.t,
      marking: { p_co2: Array.from({ length: middle.v }, () => 1) },
      running: [],
    });
    const rewound = rewindHistory(full.anim.history, context, earlier)!;
    const cut = rewound['p_co2']!;
    expect(cut[cut.length - 1]).toEqual({ t: middle.t, v: middle.v });
    expect(cut.every((point) => point.t <= middle.t)).toBe(true);
    expect(cut.length).toBeLessThan(series.length);
    // What was before stays as it was.
    expect(cut.slice(0, -1)).toEqual(series.filter((p) => p.t < middle.t).slice(0, cut.length - 1));
  }, 30_000);

  it('a reset to time 0 leaves one point, and a view without history has none', async () => {
    const full = await runTo(3600);
    const context = layoutContext(bikes, bikeView);
    const reset = layoutTokens(bikes, bikeView, { time: 0, marking: bikes.marking, running: [] });
    expect(rewindHistory(full.anim.history, context, reset)).toEqual({ p_co2: [{ t: 0, v: 0 }] });
    expect(rewindHistory(undefined, context, reset)).toEqual({ p_co2: [{ t: 0, v: 0 }] });
    const plain = structuredClone(bikeView);
    for (const entry of Object.values(plain.places)) {
      if ('display' in entry && entry.display) delete entry.display.history;
    }
    expect(rewindHistory(full.anim.history, layoutContext(bikes, plain), reset)).toBeUndefined();
  }, 30_000);

  it('goes on from the rewound series with the events that follow', async () => {
    const sim = createSimulation(bikes);
    const context = layoutContext(bikes, bikeView);
    let layout = layoutTokens(bikes, bikeView, layoutStateOf(sim.state));
    let anim = EMPTY_ANIMATION;
    for (const events of [
      [...sim.initialEvents],
      await sim.advance(5400),
      await sim.advance(1800),
    ]) {
      const next = layoutTokens(bikes, bikeView, layoutStateOf(sim.state));
      anim = applyEvents(anim, events, layout, next, 0, { context, logLimit: Infinity });
      layout = next;
    }
    const series = anim.history!['p_co2']!;
    // A jump back to the state of one hour: the series ends there and counts on from it.
    const back = series.filter((p) => p.t <= 3600);
    const at = layoutTokens(bikes, bikeView, {
      time: 3600,
      marking: { p_co2: Array.from({ length: back[back.length - 1]!.v }, () => 1) },
      running: [],
    });
    const rewound = { ...anim, history: rewindHistory(anim.history, context, at) };
    expect(rewound.history!['p_co2']!.at(-1)).toEqual({ t: 3600, v: back[back.length - 1]!.v });
    expect(pruneAnimation(rewound, 0).history).toBe(rewound.history);
  }, 30_000);
});

describe('the markers of amounts carry the symbol of their place', () => {
  it('co2, material, scrap and waste for the bicycle frames, in the order of the events', async () => {
    const seen = new Map<string, Set<string | undefined>>();
    const markers = new Set<FlowMarker>();
    const { events } = await runAnimated(bikes, bikeView, {
      bundle: 6,
      seconds: 2 * 3600,
      onBundle: (_bundle, anim) => {
        for (const flow of anim.flows) markers.add(flow);
      },
    });
    for (const flow of markers) {
      const icons = seen.get(flow.placeId) ?? new Set();
      icons.add(flow.icon);
      seen.set(flow.placeId, icons);
    }
    expect(Object.fromEntries([...seen].map(([id, icons]) => [id, [...icons]]))).toEqual({
      p_co2: ['co2'],
      p_tubes: ['material'],
      p_scrap: ['scrap'],
      p_waste: ['waste'],
    });
    // A2 still holds: every marker has its event.
    const byId = new Map(events.map((e) => [e.id, e]));
    for (const flow of markers) expect(byId.has(flow.eventId)).toBe(true);
  }, 30_000);

  it('a place without a symbol has a plain marker, as before', async () => {
    const plain = structuredClone(bikeView);
    for (const entry of Object.values(plain.places)) {
      if ('display' in entry && entry.display) delete entry.display.icon;
    }
    const markers = new Set<FlowMarker>();
    await runAnimated(bikes, plain, {
      bundle: 6,
      seconds: 3600,
      onBundle: (_bundle, anim) => {
        for (const flow of anim.flows) markers.add(flow);
      },
    });
    expect(markers.size).toBeGreaterThan(5);
    for (const flow of markers) expect(flow).not.toHaveProperty('icon');
  }, 30_000);

  it('draws the symbol of the marker, and a cloud of CO2 rises', async () => {
    const context = layoutContext(bikes, bikeView);
    const scene = buildStaticScene(bikes, bikeView);
    let found = 0;
    await runAnimated(bikes, bikeView, {
      bundle: 6,
      seconds: 3600,
      onBundle: (_bundle, anim, layout, now) => {
        const frame = buildDynamicScene(context, scene, layout, anim, {
          now: now + 150,
          simTime: layout.time,
        });
        for (const command of frame.layers.tokens) {
          if (command.op !== 'icon' || command.elementId === undefined) continue;
          if (!['p_co2', 'p_tubes', 'p_scrap', 'p_waste'].includes(command.elementId)) continue;
          // Not the symbols of the pictograms: those are drawn in the area of their box.
          if (command.size === 15) found += 1;
        }
      },
    });
    expect(found).toBeGreaterThan(10);
  }, 30_000);
});

describe('frame budget with every new picture', () => {
  /** A ring of 20 belts and stations with 200 cases, and four counters with a graphic. */
  function ringNet(): PetriNet {
    const ring = createEmptyNet('Ring');
    const n = 20;
    for (let i = 0; i < n; i += 1) {
      ring.places.push({
        id: `p${i}`,
        name: `P${i}`,
        position: { x: (i % 10) * 160, y: Math.floor(i / 10) * 200 },
      });
      ring.transitions.push({
        id: `t${i}`,
        name: `T${i}`,
        position: { x: (i % 10) * 160 + 80, y: Math.floor(i / 10) * 200 + 60 },
        timing: { kind: 'uniform', min: 1, max: 3 },
      });
      ring.marking[`p${i}`] = Array(10).fill(1) as number[];
    }
    for (let i = 0; i < n; i += 1) {
      ring.arcs.push({ id: `a${i}`, source: `p${i}`, target: `t${i}`, weight: 1 });
      ring.arcs.push({ id: `b${i}`, source: `t${i}`, target: `p${(i + 1) % n}`, weight: 1 });
    }
    // Four amounts that the stations put on counters.
    for (const [k, station] of [0, 5, 10, 15].entries()) {
      ring.places.push({
        id: `q${k}`,
        name: `Q${k} (kg)`,
        position: { x: 40 + k * 50, y: 500 },
        role: 'quantity',
      });
      ring.arcs.push({ id: `c${k}`, source: `t${station}`, target: `q${k}`, weight: 2 });
    }
    return ring;
  }

  it('lays out, animates and builds 200 cases with fills, pictograms, curves and appearances in under 8 ms', async () => {
    const ring = ringNet();
    const base = genericDomainView(ring);
    const ringView: DomainView = structuredClone(base);
    ringView.meta.canvas = { width: 1800, height: 700 };
    ringView.places['q0'] = {
      kind: 'pool',
      pos: [100, 600],
      label: 'Q0 (kg)',
      display: { style: 'fill', max: 400, low: 40, icon: 'material', history: true },
    };
    ringView.places['q1'] = {
      kind: 'sink',
      box: [300, 540, 300, 100],
      label: 'Q1 (kg)',
      display: { style: 'pictogram', per: 2, icon: 'co2', history: true },
    };
    ringView.places['q2'] = {
      kind: 'sink',
      box: [700, 540, 200, 100],
      label: 'Q2 (kg)',
      display: { style: 'pictogram', per: 5, icon: 'waste' },
    };
    ringView.places['q3'] = {
      kind: 'pool',
      pos: [1000, 600],
      label: 'Q3 (kg)',
      display: { style: 'number', history: true, icon: 'water' },
    };
    const sprites = ['document', 'bars', 'frame', 'bicycle', 'parcel'] as const;
    ring.places.slice(0, 20).forEach((place, i) => {
      const entry = ringView.places[place.id];
      if (entry && 'path' in entry) {
        entry.appearance = {
          sprite: sprites[i % sprites.length]!,
          tint: i % 2 === 0 ? 'neutral' : 'accent',
        };
      }
    });
    const ringContext = layoutContext(ring, ringView);
    const staticScene = buildStaticScene(ring, ringView);
    const sim = createSimulation(ring);
    let layout = layoutTokens(ring, ringView, layoutStateOf(sim.state));
    let anim = EMPTY_ANIMATION;
    const times: number[] = [];
    let seen = 0;
    let graphics = 0;
    for (let step = 0; step < 300; step += 1) {
      const events = await sim.advance(0.5);
      const started = performance.now();
      const next = layoutTokens(ring, ringView, layoutStateOf(sim.state));
      anim = applyEvents(anim, events, layout, next, step * 40, { context: ringContext });
      const frame = buildDynamicScene(ringContext, staticScene, next, anim, {
        now: step * 40 + 10,
        simTime: next.time,
      });
      times.push(performance.now() - started);
      seen = Math.max(seen, frame.sprites.length);
      graphics = Math.max(graphics, frame.graphics.size);
      layout = next;
    }
    const warm = times.slice(20);
    const median = [...warm].sort((a, b) => a - b)[Math.floor(warm.length / 2)]!;
    expect(seen).toBeGreaterThanOrEqual(150);
    expect(graphics).toBe(4);
    expect((anim.history?.['q1'] ?? []).length).toBeGreaterThan(5);
    expect(median).toBeLessThan(8);
  }, 60_000);
});
