import { toEventLogCsv, toXes } from '@pnm/io';
import {
  applyEvents,
  buildDynamicScene,
  EMPTY_ANIMATION,
  layoutContext,
  layoutStateOf,
  layoutTokens,
  buildStaticScene,
  type DomainView,
} from '@pnm/domain';
import { createSimulation, type SimEvent } from '@pnm/sim';
import { describe, expect, it } from 'vitest';
import { loadExample } from '../test/domain-fixtures';

/**
 * Acceptance A3: the same seed gives the same stream of events and the same export, also when the
 * domain view runs along. The view reads the state of the simulation and never writes to it.
 */
describe('the domain view does not change the simulation', () => {
  const net = loadExample('parcel-center');
  const view = net.domainView as DomainView;
  const SECONDS = 3600;

  async function plain(seed: number): Promise<SimEvent[]> {
    const sim = createSimulation(net, { seed });
    const events = [...sim.initialEvents];
    events.push(...(await sim.advance(SECONDS)));
    return events;
  }

  /** The same run in bundles of different sizes, with layout, animation and a frame for each. */
  async function withView(seed: number, bundles: readonly number[]): Promise<SimEvent[]> {
    const sim = createSimulation(net, { seed });
    const context = layoutContext(net, view);
    const staticScene = buildStaticScene(net, view);
    let layout = layoutTokens(net, view, { time: 0, marking: {}, running: [] });
    let anim = EMPTY_ANIMATION;
    const events = [...sim.initialEvents];
    let now = 0;
    const feed = (batch: SimEvent[]): void => {
      const next = layoutTokens(net, view, layoutStateOf(sim.state));
      anim = applyEvents(anim, batch, layout, next, now, { context, logLimit: 100 });
      buildDynamicScene(context, staticScene, next, anim, {
        now: now + 20,
        simTime: next.time,
        followCase: batch[0]?.type === 'start' ? (batch[0].caseIds[0] ?? null) : null,
      });
      layout = next;
      now += 40;
    };
    feed(events);
    let done = 0;
    let index = 0;
    while (done < SECONDS) {
      const size = Math.min(bundles[index % bundles.length]!, SECONDS - done);
      const batch = await sim.advance(size);
      events.push(...batch);
      feed(batch);
      done += size;
      index += 1;
    }
    return events;
  }

  it('produces the same event stream, whatever the size of the bundles', async () => {
    const reference = await plain(7);
    expect(reference.length).toBeGreaterThan(500);
    expect(await withView(7, [0.4])).toEqual(reference);
    expect(await withView(7, [6, 0.1, 90, 1])).toEqual(reference);
  });

  it('produces the same exports', async () => {
    const reference = await plain(7);
    const viewed = await withView(7, [0.4, 6]);
    expect(toEventLogCsv(viewed, net)).toBe(toEventLogCsv(reference, net));
    expect(toXes(viewed, net)).toBe(toXes(reference, net));
    expect(toEventLogCsv(reference, net).split('\n').length).toBeGreaterThan(500);
  });

  it('still depends on the seed', async () => {
    const other = await withView(8, [6]);
    expect(toEventLogCsv(other, net)).not.toBe(toEventLogCsv(await plain(7), net));
  });
});
