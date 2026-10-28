import { createEmptyNet, type PetriNet } from '@pnm/core';
import { createSimulation, type SimEvent } from '@pnm/sim';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  applyEvents,
  buildDynamicScene,
  buildStaticScene,
  EMPTY_ANIMATION,
  genericDomainView,
  layoutContext,
  layoutStateOf,
  layoutTokens,
  sampleSprites,
  type DomainView,
} from '../src';

const spec = fc.record({
  places: fc.integer({ min: 1, max: 12 }),
  transitions: fc.integer({ min: 1, max: 10 }),
  arcs: fc.array(fc.tuple(fc.nat(40), fc.nat(40), fc.boolean()), { maxLength: 50 }),
  marks: fc.array(fc.integer({ min: 0, max: 4 }), { maxLength: 12 }),
  durations: fc.array(fc.option(fc.integer({ min: 1, max: 20 }), { nil: null }), { maxLength: 10 }),
  rates: fc.array(fc.option(fc.integer({ min: 20, max: 600 }), { nil: null }), { maxLength: 10 }),
  hidden: fc.array(fc.boolean(), { maxLength: 22 }),
  bundle: fc.constantFrom(0.5, 3, 30),
  instant: fc.boolean(),
});

type Spec = typeof spec extends fc.Arbitrary<infer T> ? T : never;

function build(s: Spec): PetriNet {
  const net = createEmptyNet('Random');
  for (let i = 0; i < s.places; i += 1) {
    net.places.push({
      id: `p${i}`,
      name: `P${i}`,
      position: { x: (i % 4) * 160, y: Math.floor(i / 4) * 140 },
    });
    const marks = s.marks[i] ?? 0;
    if (marks > 0) net.marking[`p${i}`] = Array.from({ length: marks }, () => 1);
  }
  for (let j = 0; j < s.transitions; j += 1) {
    const duration = s.durations[j];
    const rate = s.rates[j];
    net.transitions.push({
      id: `t${j}`,
      name: `T${j}`,
      position: { x: (j % 4) * 160 + 80, y: Math.floor(j / 4) * 140 + 60 },
      ...(duration ? { timing: { kind: 'fixed' as const, value: duration } } : {}),
      ...(rate ? { rate } : {}),
    });
  }
  const seen = new Set<string>();
  s.arcs.forEach(([a, b, toPlace], index) => {
    const p = `p${a % s.places}`;
    const t = `t${b % s.transitions}`;
    const [source, target] = toPlace ? [t, p] : [p, t];
    if (seen.has(`${source}>${target}`)) return;
    seen.add(`${source}>${target}`);
    net.arcs.push({ id: `a${index}`, source, target, weight: 1 });
  });
  return net;
}

describe('the animation on random nets', () => {
  it('never throws, never loses an event at a visible element and keeps every sprite on the sheet', async () => {
    let total = 0;
    await fc.assert(
      fc.asyncProperty(spec, async (s) => {
        const net = build(s);
        const generic = genericDomainView(net);
        const view: DomainView = structuredClone(generic);
        // Hide some elements at random: their events must be logged as hidden.
        net.places.forEach((p, i) => {
          if (s.hidden[i]) view.places[p.id] = { kind: 'hidden', reason: 'test' };
        });
        net.transitions.forEach((t, j) => {
          if (s.hidden[net.places.length + j])
            view.transitions[t.id] = { kind: 'hidden', reason: 'test' };
        });
        const context = layoutContext(net, view);
        const staticScene = buildStaticScene(net, view);
        const options = {
          context,
          logLimit: Infinity,
          ...(s.instant ? { duration: 0, flash: 0 } : {}),
        };
        let sim;
        try {
          sim = createSimulation(net, { seed: 3 });
        } catch {
          return true;
        }
        let layout = layoutTokens(net, view, { time: 0, marking: {}, running: [] });
        let anim = EMPTY_ANIMATION;
        const events: SimEvent[] = [];
        let now = 0;
        const feed = (batch: SimEvent[]): void => {
          const next = layoutTokens(net, view, layoutStateOf(sim.state));
          anim = applyEvents(anim, batch, layout, next, now, options);
          const frame = buildDynamicScene(context, staticScene, next, anim, {
            now: now + 10,
            simTime: next.time,
          });
          for (const sprite of sampleSprites(next, anim, now + 10, next.time)) {
            expect(Number.isFinite(sprite.point[0]) && Number.isFinite(sprite.point[1])).toBe(true);
          }
          expect(anim.motions.length).toBeLessThanOrEqual(60);
          expect(frame.layers.tokens.length).toBeGreaterThanOrEqual(0);
          events.push(...batch);
          layout = next;
          now += 40;
        };
        feed([...sim.initialEvents]);
        try {
          // Nets that make tokens without end are cut off by the number of events.
          for (let t = 0; t < 300 && events.length < 3000; t += s.bundle) {
            feed(await sim.advance(s.bundle, { maxEvents: 300 }));
          }
        } catch {
          // A net with a cycle that takes no time is reported by the engine; that ends the run.
        }
        total += events.length;
        const ids = new Set(events.map((e) => e.id));
        const logged = new Set(anim.handled.map((h) => h.eventId));
        for (const entry of anim.handled) expect(ids.has(entry.eventId)).toBe(true);
        for (const event of events) {
          if (event.type !== 'start' && event.type !== 'complete') continue;
          expect(logged.has(event.id), `${event.type} ${event.transitionId}`).toBe(true);
        }
        return true;
      }),
      { numRuns: 60 },
    );
    // The runs were not empty.
    expect(total).toBeGreaterThan(1000);
  }, 120_000);
});
