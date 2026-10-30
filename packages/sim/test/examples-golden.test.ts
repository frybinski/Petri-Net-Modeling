import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseNetText, type PetriNet } from '@pnm/core';
import { describe, expect, it } from 'vitest';
import { createSimulation, type SimEvent } from '../src';

/**
 * Acceptance N1-3: the examples that have no quantity place behave exactly as in 1.2.0. The
 * fixture holds a hash of everything a run produces (event stream, key figures and final state)
 * per example and seed, taken with version 1.2.0. A change of the engine or of the key figures that
 * alters any of them for such a net fails here. Regenerate only for a change that is meant to
 * alter the behaviour (`PNM_WRITE_GOLDEN=1`), never to get green.
 */
const FIXTURE = join(import.meta.dirname, 'fixtures', 'examples-1.2.0.json');
const EXAMPLES = join(import.meta.dirname, '..', '..', '..', 'examples');
/** Examples of 1.2.0. Later examples have their own tests. */
const NAMES = [
  'complaint-handling',
  'dining-philosophers-3',
  'dining-philosophers-json',
  'mutual-exclusion',
  'order-processing',
  'parcel-center',
  'producer-consumer',
  'smart-office',
  'token-ring',
  'traffic-light',
];
/** `undefined` is the seed of the net itself. */
const SEEDS: Array<number | undefined> = [undefined, 3, 42];
const SECONDS = 7200;
const RANDOM_STEPS = 300;

const load = (name: string): PetriNet =>
  parseNetText(readFileSync(join(EXAMPLES, `${name}.pn.json`), 'utf8'));

const sha = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

type Sim = ReturnType<typeof createSimulation>;

function finalState(sim: Sim) {
  const { time, marking, meta, running, counters } = sim.state;
  return { time, marking, meta, running, counters };
}

/** Two runs of one net: with `advance` (timed nets) and with random single steps (all nets). */
async function digest(net: PetriNet, seed: number | undefined): Promise<string> {
  const options = seed === undefined ? {} : { seed };
  const timed = createSimulation(net, options);
  const timedEvents: SimEvent[] = [...timed.initialEvents];
  while (timed.state.time < SECONDS) {
    timedEvents.push(...(await timed.advance(600, { maxEvents: 100_000 })));
  }
  const stepped = createSimulation(net, options);
  const steppedEvents: SimEvent[] = [...stepped.initialEvents];
  for (let i = 0; i < RANDOM_STEPS; i += 1) steppedEvents.push(...(await stepped.stepRandom()));
  return sha({
    timed: { events: timedEvents, metrics: timed.metrics(), state: finalState(timed) },
    stepped: { events: steppedEvents, metrics: stepped.metrics(), state: finalState(stepped) },
  });
}

async function digests(name: string): Promise<Record<string, string>> {
  const net = load(name);
  const result: Record<string, string> = {};
  for (const seed of SEEDS) result[String(seed ?? 'net')] = await digest(net, seed);
  return result;
}

describe('acceptance N1-3: examples without quantity places are unchanged since 1.2.0', () => {
  if (process.env['PNM_WRITE_GOLDEN'] === '1') {
    it('writes the fixture', async () => {
      const all: Record<string, Record<string, string>> = {};
      for (const name of NAMES) all[name] = await digests(name);
      writeFileSync(FIXTURE, `${JSON.stringify(all, null, 2)}\n`);
    }, 120_000);
    return;
  }

  const golden = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<
    string,
    Record<string, string>
  >;

  it('the fixture covers the ten examples of 1.2.0', () => {
    expect(Object.keys(golden).sort()).toEqual([...NAMES].sort());
    for (const name of NAMES) expect(existsSync(join(EXAMPLES, `${name}.pn.json`))).toBe(true);
  });

  for (const name of NAMES) {
    it(`${name}: same events, key figures and final state for every seed`, async () => {
      const net = load(name);
      expect(net.places.some((p) => p.role === ('quantity' as string))).toBe(false);
      expect(await digests(name)).toEqual(golden[name]);
    }, 60_000);
  }
});
