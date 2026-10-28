import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  computeBindings,
  findEnabled,
  fireBinding,
  parseNetText,
  validate,
  type Marking,
  type PetriNet,
} from '../src';

const load = (name: string): PetriNet =>
  parseNetText(
    readFileSync(
      join(import.meta.dirname, '..', '..', '..', 'examples', `${name}.pn.json`),
      'utf8',
    ),
  );

async function runToEnd(net: PetriNet, limit = 200): Promise<{ marking: Marking; steps: number }> {
  let marking = net.marking;
  for (let steps = 0; steps < limit; steps += 1) {
    const { enabled } = await findEnabled(net, marking);
    const first = [...enabled.values()][0]?.bindings[0];
    if (!first) return { marking, steps };
    marking = fireBinding(net, marking, first);
  }
  throw new Error('did not terminate');
}

describe('order-processing example', () => {
  const net = load('order-processing');

  it('is a valid JSON net', () => {
    expect(net.profile).toBe('json-net');
    expect(validate(net)).toEqual([]);
  });

  it('creates invoices exactly for approved orders of known customers', async () => {
    const result = await computeBindings(net, net.marking, 'invoice');
    expect(result.truncated).toBe(false);
    expect(result.diagnostics).toEqual([]);
    expect(result.bindings.map((b) => b.binding)).toEqual([
      {
        c: { id: 'c1', name: 'Ada Lovelace' },
        o: { id: 'A-0', amount: 30, customer: 'c1' },
      },
      {
        c: { id: 'c2', name: 'Alan Turing' },
        o: { id: 'A-9', amount: 99, customer: 'c2' },
      },
    ]);
    expect(result.bindings.map((b) => b.produces['invoices'])).toEqual([
      [{ order: 'A-0', customer: 'Ada Lovelace', total: 30 }],
      [{ order: 'A-9', customer: 'Alan Turing', total: 99 }],
    ]);
  });

  it('splits incoming orders by the complementary guards', async () => {
    const approve = await computeBindings(net, net.marking, 'approve');
    const reject = await computeBindings(net, net.marking, 'reject');
    // Objects are ordered by their canonical JSON, which starts with "amount".
    expect(approve.bindings.map((b) => (b.binding['o'] as { id: string }).id)).toEqual([
      'A-1',
      'A-4',
      'A-2',
    ]);
    expect(reject.bindings.map((b) => (b.binding['o'] as { id: string }).id)).toEqual(['A-3']);
  });

  it('processes all orders when run to the end', async () => {
    const { marking } = await runToEnd(net);
    expect(marking['incoming']).toBeUndefined();
    expect(marking['approved']).toBeUndefined();
    expect(marking['rejected']).toHaveLength(1);
    expect(marking['invoices']).toHaveLength(5);
    expect(marking['customers']).toHaveLength(2);
  });
});

describe('token-ring example', () => {
  const net = load('token-ring');

  it('is valid and moves every token until it has made ten hops', async () => {
    expect(validate(net)).toEqual([]);
    const { marking, steps } = await runToEnd(net);
    // Hops needed: 10 (from 0) + 7 (from 3) + 3 (from 7).
    expect(steps).toBe(20);
    const all = Object.values(marking).flat().sort();
    expect(all).toEqual([10, 10, 10]);
  });
});

describe('dining-philosophers-json example', () => {
  const net = load('dining-philosophers-json');

  it('is valid and offers one binding per philosopher with both forks', async () => {
    expect(validate(net)).toEqual([]);
    const result = await computeBindings(net, net.marking, 'take');
    expect(result.bindings).toHaveLength(3);
    for (const { binding } of result.bindings) {
      const p = (binding['p'] as { id: number }).id;
      expect((binding['l'] as { id: number }).id).toBe(p);
      expect((binding['r'] as { id: number }).id).toBe((p % 3) + 1);
    }
  });

  it('never lets two neighbours eat at once and never deadlocks', async () => {
    let marking = net.marking;
    for (let step = 0; step < 60; step += 1) {
      const { enabled } = await findEnabled(net, marking);
      expect(enabled.size).toBeGreaterThan(0);
      const choices = [...enabled.values()].flatMap((r) => r.bindings);
      marking = fireBinding(net, marking, choices[step % choices.length]!);
      expect((marking['eating'] ?? []).length).toBeLessThanOrEqual(1);
      const forks = (marking['forks'] ?? []).length + 2 * (marking['eating'] ?? []).length;
      expect(forks).toBe(3);
    }
  });
});
