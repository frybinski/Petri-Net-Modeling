import { createEmptyNet, type PetriNet } from '@pnm/core';
import type { RunningView } from '@pnm/sim';
import { describe, expect, it } from 'vitest';
import { findBottlenecks, runningByTransition } from './sim-view';

const run = (id: number, transitionId: string, start: number, end: number): RunningView => ({
  firingId: id,
  transitionId,
  start,
  end,
  slot: 0,
  caseIds: [],
});

describe('runningByTransition', () => {
  it('counts the firings and takes the progress of the one that ends first', () => {
    const result = runningByTransition(
      [run(1, 't', 0, 10), run(2, 't', 5, 25), run(3, 'u', 0, 4)],
      8,
    );
    expect(result.get('t')).toEqual({ count: 2, progress: 0.8 });
    expect(result.get('u')).toEqual({ count: 1, progress: 1 });
    expect(result.size).toBe(2);
  });

  it('keeps the progress between 0 and 1 and treats zero duration as done', () => {
    expect(runningByTransition([run(1, 't', 10, 20)], 5).get('t')?.progress).toBe(0);
    expect(runningByTransition([run(1, 't', 10, 10)], 10).get('t')?.progress).toBe(1);
  });
});

describe('findBottlenecks', () => {
  /** in -> t -> queue -> u -> out, with a worker place that holds many tokens. */
  function net(): PetriNet {
    const n = createEmptyNet('x');
    for (const id of ['in', 'queue', 'out', 'worker']) {
      n.places.push({ id, name: id, position: { x: 0, y: 0 } });
    }
    n.transitions.push(
      { id: 't', name: 't', position: { x: 0, y: 0 } },
      { id: 'u', name: 'u', position: { x: 0, y: 0 } },
    );
    const arcs: Array<[string, string]> = [
      ['in', 't'],
      ['t', 'queue'],
      ['queue', 'u'],
      ['worker', 'u'],
      ['u', 'worker'],
      ['u', 'out'],
    ];
    arcs.forEach(([source, target], i) => n.arcs.push({ id: `a${i}`, source, target, weight: 1 }));
    n.marking['worker'] = [1];
    return n;
  }

  it('marks queues at the thresholds and leaves sources, sinks and resources alone', () => {
    const marking = {
      in: Array(20).fill(1),
      queue: Array(6).fill(1),
      out: Array(20).fill(1),
      worker: Array(20).fill(1),
    };
    expect([...findBottlenecks(net(), marking, 6, 10)]).toEqual([['queue', 'warn']]);
    expect([...findBottlenecks(net(), { queue: Array(10).fill(1) }, 6, 10)]).toEqual([
      ['queue', 'crit'],
    ]);
    expect([...findBottlenecks(net(), { queue: Array(5).fill(1) }, 6, 10)]).toEqual([]);
  });
});
