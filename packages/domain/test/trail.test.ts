import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseNetText } from '@pnm/core';
import { describe, expect, it } from 'vitest';
import { caseActivities, caseTrail, visitedTransitions, type DomainView } from '../src';
import { runAnimated } from './animated-run';

describe('caseTrail', () => {
  it('lists the arrival and the activities of one parcel in order', async () => {
    const net = parseNetText(
      readFileSync(
        join(import.meta.dirname, '..', '..', '..', 'examples', 'parcel-center.pn.json'),
        'utf8',
      ),
    );
    const { events } = await runAnimated(net, net.domainView as DomainView, {
      bundle: 6,
      seconds: 3600,
    });
    const trail = caseTrail(events, 'P-0010');
    expect(trail[0]).toMatchObject({ type: 'spawn', transitionId: 't_arr' });
    const times = trail.map((t) => t.t);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(trail.every((t) => events.some((e) => e.id === t.eventId))).toBe(true);
    const activities = caseActivities(trail);
    expect(activities.map((a) => a.transitionId).slice(0, 3)).toEqual([
      't_arr',
      't_scan',
      't_sort',
    ]);
    for (const activity of activities) {
      if (activity.end !== undefined) expect(activity.end).toBeGreaterThanOrEqual(activity.start);
    }
    expect(visitedTransitions(trail).slice(0, 3)).toEqual(['t_arr', 't_scan', 't_sort']);
    // Cases of other parcels do not appear.
    const other = caseTrail(events, 'P-0011');
    expect(
      other.every((t) => !trail.some((x) => x.eventId === t.eventId && x.type === 'spawn')),
    ).toBe(true);
    expect(caseTrail(events, 'nobody')).toEqual([]);
  });

  it('leaves an unfinished activity open', () => {
    const trail = caseTrail(
      [
        { id: 1, t: 0, type: 'spawn', caseId: 'C' },
        {
          id: 2,
          t: 5,
          type: 'start',
          transitionId: 'a',
          firingId: 1,
          slot: 0,
          caseIds: ['C'],
          binding: {},
          consumed: [],
        },
      ],
      'C',
    );
    expect(caseActivities(trail)).toEqual([{ transitionId: 'a', firingId: 1, start: 5 }]);
  });
});
