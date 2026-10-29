import { describe, expect, it } from 'vitest';
// @ts-expect-error -- a plain Node script without types
import { walk } from '../../../scripts/live-demo.mjs';
import { createLiveReplay, type LiveEvent } from '../src';
import { loadExample } from './replay-helpers';

interface DemoEvent {
  case: string;
  activity: string;
  lifecycle: 'start' | 'complete';
  time: number;
}

describe('the live demo script (scripts/live-demo.mjs)', () => {
  const net = loadExample('smart-office');

  for (const seed of [1, 2, 3, 4, 5]) {
    it(`its events replay on the smart office without deviation (seed ${seed})`, async () => {
      const events = walk(net, { cases: 8, seed }) as DemoEvent[];
      const live = createLiveReplay(net, { mapping: {}, autoMap: true, clock: () => 0 });
      const pushed: LiveEvent[] = events.map((e) => ({
        caseId: e.case,
        activity: e.activity,
        lifecycle: e.lifecycle,
        time: e.time,
      }));
      live.push(pushed);
      const played = await live.advance(100_000);
      expect(played.filter((e) => e.type === 'deviation')).toEqual([]);
      const stats = live.metrics().replay!;
      expect(stats).toMatchObject({
        fitness: 1,
        missing: 0,
        ignored: 0,
        remaining: 0,
        openCases: 0,
      });
      expect(live.state.marking['o_gone']).toHaveLength(8);
    });
  }
});
