import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  countsToMarking,
  enabledTransitions,
  fire,
  isEnabled,
  markingToCounts,
  totalTokens,
  countsEqual,
} from '../src';
import { makeNet } from './helpers';

describe('P/T firing rule', () => {
  const producerConsumer = makeNet({
    places: [
      ['idle', 1],
      ['buffer', 0, 2],
      ['done', 0],
    ],
    transitions: ['produce', 'consume'],
    arcs: [
      ['idle', 'produce'],
      ['produce', 'idle'],
      ['produce', 'buffer'],
      ['buffer', 'consume'],
      ['consume', 'done'],
    ],
  });

  it('enables a transition whose preset is marked', () => {
    const m = producerConsumer.marking;
    expect(enabledTransitions(producerConsumer, m)).toEqual(['produce']);
    expect(isEnabled(producerConsumer, m, 'consume')).toBe(false);
  });

  it('moves tokens from producer to consumer', () => {
    let m = producerConsumer.marking;
    m = fire(producerConsumer, m, 'produce');
    expect(markingToCounts(m)).toEqual({ idle: 1, buffer: 1 });
    expect(enabledTransitions(producerConsumer, m)).toEqual(['produce', 'consume']);
    m = fire(producerConsumer, m, 'consume');
    expect(markingToCounts(m)).toEqual({ idle: 1, done: 1 });
  });

  it('does not modify the input marking', () => {
    const before = structuredClone(producerConsumer.marking);
    fire(producerConsumer, producerConsumer.marking, 'produce');
    expect(producerConsumer.marking).toEqual(before);
  });

  it('respects capacities (weak rule)', () => {
    let m = producerConsumer.marking;
    m = fire(producerConsumer, m, 'produce');
    m = fire(producerConsumer, m, 'produce');
    expect(markingToCounts(m).buffer).toBe(2);
    expect(isEnabled(producerConsumer, m, 'produce')).toBe(false);
    expect(() => fire(producerConsumer, m, 'produce')).toThrow(/not enabled/);
  });

  it('honours arc weights greater than one', () => {
    const net = makeNet({
      places: [
        ['in', 3],
        ['out', 0],
      ],
      transitions: ['t'],
      arcs: [
        ['in', 't', 2],
        ['t', 'out', 3],
      ],
    });
    const m1 = fire(net, net.marking, 't');
    expect(markingToCounts(m1)).toEqual({ in: 1, out: 3 });
    expect(isEnabled(net, m1, 't')).toBe(false);
  });

  it('sums the weights of parallel arcs', () => {
    const net = makeNet({
      places: [['p', 1]],
      transitions: ['t'],
      arcs: [
        ['p', 't'],
        ['p', 't'],
      ],
    });
    expect(isEnabled(net, net.marking, 't')).toBe(false);
  });

  it('handles loops: a place that is both input and output', () => {
    const net = makeNet({
      places: [['p', 1, 1]],
      transitions: ['t'],
      arcs: [
        ['p', 't'],
        ['t', 'p'],
      ],
    });
    // The loop is enabled although the capacity is exhausted, because the token is returned.
    expect(isEnabled(net, net.marking, 't')).toBe(true);
    expect(markingToCounts(fire(net, net.marking, 't'))).toEqual({ p: 1 });
  });

  it('loop with larger output weight still respects the capacity', () => {
    const net = makeNet({
      places: [['p', 1, 1]],
      transitions: ['t'],
      arcs: [
        ['p', 't'],
        ['t', 'p', 2],
      ],
    });
    expect(isEnabled(net, net.marking, 't')).toBe(false);
  });

  it('a transition without input places is always enabled unless capacity blocks it', () => {
    const net = makeNet({ places: [['p', 0, 1]], transitions: ['src'], arcs: [['src', 'p']] });
    expect(isEnabled(net, {}, 'src')).toBe(true);
    expect(isEnabled(net, fire(net, {}, 'src'), 'src')).toBe(false);
  });

  it('throws for unknown transitions and reports them as not enabled', () => {
    expect(isEnabled(producerConsumer, {}, 'nope')).toBe(false);
    expect(() => fire(producerConsumer, {}, 'nope')).toThrow(/Unknown transition/);
  });

  it('never fires transitions next to invalid arcs', () => {
    const net = makeNet({ places: [['p', 1]], transitions: ['t'], arcs: [['p', 't', 0]] });
    expect(isEnabled(net, net.marking, 't')).toBe(false);
  });

  it('ignores arcs that do not connect a place and a transition', () => {
    const net = makeNet({
      places: [
        ['p', 1],
        ['q', 0],
      ],
      transitions: ['t'],
      arcs: [
        ['p', 'q'],
        ['p', 't'],
        ['ghost', 't'],
      ],
    });
    expect(isEnabled(net, net.marking, 't')).toBe(true);
  });

  it('conserves tokens in a conservative net (property)', () => {
    // Ring of three places, each transition moves one token to the next place.
    const ring = makeNet({
      places: [['a'], ['b'], ['c']],
      transitions: ['ab', 'bc', 'ca'],
      arcs: [
        ['a', 'ab'],
        ['ab', 'b'],
        ['b', 'bc'],
        ['bc', 'c'],
        ['c', 'ca'],
        ['ca', 'a'],
      ],
    });
    fc.assert(
      fc.property(
        fc.record({ a: fc.nat(5), b: fc.nat(5), c: fc.nat(5) }),
        fc.array(fc.nat(), { maxLength: 30 }),
        (counts, choices) => {
          let m = countsToMarking(counts);
          const total = totalTokens(m);
          for (const choice of choices) {
            const enabled = enabledTransitions(ring, m);
            if (enabled.length === 0) break;
            const picked = enabled[choice % enabled.length];
            if (picked === undefined) break;
            m = fire(ring, m, picked);
            if (totalTokens(m) !== total) return false;
          }
          return true;
        },
      ),
    );
  });

  it('firing exactly the enabled transitions never throws (property)', () => {
    fc.assert(
      fc.property(fc.nat(4), fc.nat(4), (x, y) => {
        const net = makeNet({
          places: [
            ['p', x, 4],
            ['q', y, 4],
          ],
          transitions: ['t', 'u'],
          arcs: [
            ['p', 't'],
            ['t', 'q'],
            ['q', 'u', 2],
            ['u', 'p'],
          ],
        });
        for (const id of enabledTransitions(net, net.marking)) {
          expect(() => fire(net, net.marking, id)).not.toThrow();
        }
      }),
    );
  });
});

describe('marking helpers', () => {
  it('converts between markings and counts', () => {
    const counts = { a: 2, b: 1 };
    const marking = countsToMarking(counts);
    expect(marking).toEqual({ a: [1, 1], b: [1] });
    expect(markingToCounts(marking)).toEqual(counts);
    expect(markingToCounts({ a: [], b: ['x', { k: 1 }] })).toEqual({ b: 2 });
    expect(countsToMarking({ a: 0 })).toEqual({});
  });

  it('compares counts ignoring zero entries', () => {
    expect(countsEqual({ a: 1, b: 0 }, { a: 1 })).toBe(true);
    expect(countsEqual({ a: 1 }, { a: 2 })).toBe(false);
  });
});
