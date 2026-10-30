import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseNetText, serializeNet, type PetriNet } from '@pnm/core';
import { createSimulation, type SimEvent } from '@pnm/sim';
import { describe, expect, it } from 'vitest';
import { toEventLogCsv, toPnml, toXes } from '../src';

/**
 * Acceptance N1-3, the exchange formats: for the examples of 1.2.0 the event log (CSV and XES),
 * the PNML export and the JSON file are exactly as in 1.2.0. The fixture holds a hash of each,
 * taken with that version. Regenerate only for a change that is meant to alter an output
 * (`PNM_WRITE_GOLDEN=1`), never to get green.
 */
const FIXTURE = join(import.meta.dirname, 'fixtures', 'examples-1.2.0.json');
const EXAMPLES = join(import.meta.dirname, '..', '..', '..', 'examples');
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
const SEEDS: Array<number | undefined> = [undefined, 5];

const load = (name: string): PetriNet =>
  parseNetText(readFileSync(join(EXAMPLES, `${name}.pn.json`), 'utf8'));

const sha = (text: string): string => createHash('sha256').update(text).digest('hex');

async function digests(name: string): Promise<Record<string, string>> {
  const net = load(name);
  const settings = { ...net.simulation };
  const result: Record<string, string> = {
    json: sha(serializeNet(net)),
    pnml: sha(toPnml(net)),
    pnmlPlain: sha(toPnml(net, { toolspecific: false })),
  };
  for (const seed of SEEDS) {
    const options = seed === undefined ? {} : { seed };
    const timed = createSimulation(net, options);
    const timedEvents: SimEvent[] = [...timed.initialEvents];
    while (timed.state.time < 3600) timedEvents.push(...(await timed.advance(600)));
    const stepped = createSimulation(net, options);
    const steppedEvents: SimEvent[] = [...stepped.initialEvents];
    for (let i = 0; i < 200; i += 1) steppedEvents.push(...(await stepped.stepRandom()));
    const key = String(seed ?? 'net');
    result[`${key}:timed:csv`] = sha(toEventLogCsv(timedEvents, net, settings));
    result[`${key}:timed:xes`] = sha(toXes(timedEvents, net, settings));
    result[`${key}:stepped:csv`] = sha(toEventLogCsv(steppedEvents, net, settings));
    result[`${key}:stepped:xes`] = sha(toXes(steppedEvents, net, settings));
  }
  return result;
}

describe('acceptance N1-3: exports of the examples without quantity places are unchanged since 1.2.0', () => {
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
  });

  for (const name of NAMES) {
    it(`${name}: same JSON, PNML, CSV and XES`, async () => {
      expect(await digests(name)).toEqual(golden[name]);
    }, 60_000);
  }
});
