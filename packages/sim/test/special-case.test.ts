import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  countsToMarking,
  findEnabled,
  fireBinding,
  markingToCounts,
  parseNetText,
  type Marking,
  type PetriNet,
} from '@pnm/core';
import { describe, expect, it } from 'vitest';
import { createRng, createSimulation, isTimedNet } from '../src';

const examplesDir = join(import.meta.dirname, '..', '..', '..', 'examples');
const examples = readdirSync(examplesDir)
  .filter((f) => f.endsWith('.pn.json'))
  .map((f) => ({ file: f, net: parseNetText(readFileSync(join(examplesDir, f), 'utf8')) }));

const normalise = (net: PetriNet, marking: Marking): Marking =>
  net.profile === 'pt-net' ? countsToMarking(markingToCounts(marking)) : marking;

const sorted = (marking: Marking): Marking =>
  Object.fromEntries(
    Object.entries(marking)
      .filter(([, tokens]) => tokens.length > 0)
      .map(([id, tokens]) => [
        id,
        [...tokens].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      ]),
  );

describe('duration 0 is the atomic firing rule', () => {
  const untimed = examples.filter(({ net }) => !isTimedNet(net));

  it('covers the examples of the earlier milestones', () => {
    expect(untimed.length).toBeGreaterThanOrEqual(7);
  });

  for (const { file, net } of untimed) {
    it(`${file}: the same markings and the same enabled bindings along a random run`, async () => {
      const sim = createSimulation(net, { seed: 1 });
      const choose = createRng(99);
      let atomic = normalise(net, structuredClone(net.marking));
      for (let step = 0; step < 150; step += 1) {
        const reference = await findEnabled(net, atomic);
        const { enabled } = await sim.enabled();
        expect([...enabled.keys()]).toEqual([...reference.enabled.keys()]);
        for (const [id, result] of enabled) {
          expect(result.bindings.map((b) => b.binding)).toEqual(
            reference.enabled.get(id)!.bindings.map((b) => b.binding),
          );
        }
        const all = [...reference.enabled.values()].flatMap((r) => r.bindings);
        if (all.length === 0) break;
        const chosen = all[Math.floor(choose.next() * all.length)]!;
        atomic = fireBinding(net, atomic, chosen);
        await sim.fireManually(chosen.transitionId, chosen);
        expect(sim.state.running).toHaveLength(0);
        expect(sorted(sim.state.marking)).toEqual(sorted(atomic));
      }
    });

    it(`${file}: random steps never leave a firing unfinished`, async () => {
      const sim = createSimulation(net, { seed: 4 });
      for (let i = 0; i < 60; i += 1) {
        await sim.stepRandom();
        expect(sim.state.running).toHaveLength(0);
      }
    });
  }
});
