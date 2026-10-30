import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseNetText, type PetriNet } from '@pnm/core';
import { describe, expect, it } from 'vitest';
import { createSimulation, type SimEvent } from '../src';

/**
 * Acceptance N2-3: the bicycle frame production behaves exactly as in 1.3.0. Version 1.4.0 gave its
 * domain view pictures of quantities and an appearance by stage, and nothing else: the net, and so
 * every run, stays as it was. The fixture holds a hash of the net without its domain view and a
 * hash of everything a run produces (event stream, key figures and final state) per seed, taken
 * with version 1.3.0. Regenerate only for a change that is meant to alter the behaviour
 * (`PNM_WRITE_GOLDEN=1`), never to get green.
 */
const FIXTURE = join(import.meta.dirname, 'fixtures', 'bike-frames-1.3.0.json');
const FILE = join(import.meta.dirname, '..', '..', '..', 'examples', 'bike-frames.pn.json');
/** `undefined` is the seed of the net itself. */
const SEEDS: Array<number | undefined> = [undefined, 3, 42];
const SECONDS = 8 * 3600;
const RANDOM_STEPS = 400;

const sha = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

const load = (): PetriNet => parseNetText(readFileSync(FILE, 'utf8'));

type Sim = ReturnType<typeof createSimulation>;

function finalState(sim: Sim) {
  const { time, marking, meta, running, counters } = sim.state;
  return { time, marking, meta, running, counters };
}

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

async function digests(): Promise<Record<string, string>> {
  const net = load();
  const { domainView: _view, ...rest } = net;
  const result: Record<string, string> = { netWithoutView: sha(rest) };
  for (const seed of SEEDS) result[String(seed ?? 'net')] = await digest(net, seed);
  return result;
}

describe('acceptance N2-3: the bicycle frame production is unchanged since 1.3.0', () => {
  if (process.env['PNM_WRITE_GOLDEN'] === '1') {
    it('writes the fixture', async () => {
      writeFileSync(FIXTURE, `${JSON.stringify(await digests(), null, 2)}\n`);
    }, 120_000);
    return;
  }

  it('has the same net (without its view) and the same events, key figures and final state for every seed', async () => {
    const golden = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<string, string>;
    expect(await digests()).toEqual(golden);
  }, 120_000);
});
