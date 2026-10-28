import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseNetText, type PetriNet } from '@pnm/core';
import { describe, expect, it } from 'vitest';
import {
  firingKey,
  layoutTokens,
  staticLayoutState,
  travelPath,
  layoutContext,
  type DomainView,
  type LayoutState,
} from '../src';
import { smallNet, smallView } from './helpers';

const root = join(import.meta.dirname, '..', '..', '..');
const example = (name: string): PetriNet =>
  parseNetText(readFileSync(join(root, 'examples', `${name}.pn.json`), 'utf8'));

const metas = (place: string, entered: number[], prefix = place) =>
  entered.map((enteredAt, i) => ({ id: `${prefix}${i}`, caseId: `C-${prefix}${i}`, enteredAt }));

function stateWith(partial: Partial<LayoutState>): LayoutState {
  return { time: 0, marking: {}, running: [], ...partial };
}

describe('layoutTokens on a belt', () => {
  const net = smallNet();
  const view = smallView(net);

  it('lines the tokens up from the head backwards, oldest first, 16 px apart', () => {
    const layout = layoutTokens(
      net,
      view,
      stateWith({
        marking: { q: [1, 1, 1] },
        // k1 is the oldest although it comes second in the list.
        meta: {
          q: [
            { id: 'k2', enteredAt: 20 },
            { id: 'k1', enteredAt: 10 },
            { id: 'k3', enteredAt: 30 },
          ],
        },
      }),
    );
    const head = layout.tokens.get('k1')!;
    const second = layout.tokens.get('k2')!;
    const third = layout.tokens.get('k3')!;
    expect(head.pos).toEqual([292, 200]);
    expect(second.pos).toEqual([276, 200]);
    expect(third.pos).toEqual([260, 200]);
    expect(head.state).toBe('waiting');
    expect(head.elementId).toBe('q');
    expect(layout.counts.get('q')).toBe(3);
    expect(layout.overflow.size).toBe(0);
  });

  it('keeps the order of arrival for tokens that arrived at the same time', () => {
    const layout = layoutTokens(
      net,
      view,
      stateWith({
        marking: { q: [1, 1] },
        meta: {
          q: [
            { id: 'a', enteredAt: 5 },
            { id: 'b', enteredAt: 5 },
          ],
        },
      }),
    );
    expect(layout.tokens.get('a')!.pos[0]).toBeGreaterThan(layout.tokens.get('b')!.pos[0]);
  });

  it('stacks what does not fit at the start of the path and counts it', () => {
    const marking = { q: Array.from({ length: 40 }, () => 1) };
    const layout = layoutTokens(
      net,
      view,
      stateWith({
        marking,
        meta: {
          q: metas(
            'q',
            marking.q.map((_, i) => i),
          ),
        },
      }),
    );
    const visible = [...layout.tokens.values()].filter((t) => t.visible);
    const stacked = [...layout.tokens.values()].filter((t) => !t.visible);
    expect(visible).toHaveLength(11);
    expect(stacked).toHaveLength(29);
    expect(layout.overflow.get('q')?.extra).toBe(29);
    // The stack stands where the counter is.
    const spot = layout.overflow.get('q')!.pos;
    expect(stacked.every((t) => t.pos[0] === spot[0] && t.pos[1] === spot[1])).toBe(true);
    // The oldest are at the head, the newest are in the stack.
    expect(layout.tokens.get('q0')!.visible).toBe(true);
    expect(layout.tokens.get('q39')!.visible).toBe(false);
  });

  it('gives tokens without metadata an id of their own', () => {
    const layout = layoutTokens(net, view, staticLayoutState({ ...net, marking: { q: [1, 1] } }));
    expect([...layout.tokens.keys()].sort()).toEqual(['q#0', 'q#1']);
  });

  it('puts no tokens on resource slots, sinks and pools, only counts', () => {
    const layout = layoutTokens(
      net,
      view,
      stateWith({
        marking: { res: [1], done: [1, 1, 1] },
        meta: { done: metas('done', [1, 2, 3]) },
      }),
    );
    expect(layout.tokens.size).toBe(0);
    expect(layout.counts.get('done')).toBe(3);
    expect(layout.counts.get('res')).toBe(1);
  });

  it('leaves out hidden places', () => {
    const hidden: DomainView = structuredClone(view);
    hidden.places['q'] = { kind: 'hidden', reason: 'x' };
    const layout = layoutTokens(net, hidden, stateWith({ marking: { q: [1, 1] } }));
    expect(layout.tokens.size).toBe(0);
  });
});

describe('layoutTokens in stations', () => {
  const net = smallNet();
  const view = smallView(net);
  const firing = {
    firingId: 7,
    transitionId: 'work',
    start: 10,
    end: 30,
    slot: 0,
    caseIds: ['C-1'],
  };

  it('holds the case of a firing on its slot', () => {
    const layout = layoutTokens(net, view, stateWith({ time: 12, running: [firing] }));
    const token = layout.tokens.get(firingKey(7, 'C-1'))!;
    expect(token.pos).toEqual([370, 200]);
    expect(token.state).toBe('working');
    expect(token.elementId).toBe('work');
    expect(token.firingId).toBe(7);
  });

  it('puts several cases of one firing slightly apart', () => {
    const layout = layoutTokens(
      net,
      view,
      stateWith({ running: [{ ...firing, caseIds: ['C-1', 'C-2', 'C-3'] }] }),
    );
    const positions = ['C-1', 'C-2', 'C-3'].map((c) => layout.tokens.get(firingKey(7, c))!.pos);
    expect(new Set(positions.map((p) => p.join(','))).size).toBe(3);
    for (const p of positions) expect(Math.hypot(p[0] - 370, p[1] - 200)).toBeLessThan(15);
  });

  it('uses the middle of the card when the slot does not exist', () => {
    const layout = layoutTokens(net, view, stateWith({ running: [{ ...firing, slot: 4 }] }));
    expect(layout.tokens.get(firingKey(7, 'C-1'))!.pos).toEqual([370, 200]);
    const noSlots: DomainView = structuredClone(view);
    noSlots.transitions['work'] = { kind: 'station', box: [320, 160, 100, 80] };
    const middle = layoutTokens(net, noSlots, stateWith({ running: [firing] }));
    expect(middle.tokens.get(firingKey(7, 'C-1'))!.pos).toEqual([370, 200]);
  });

  it('shows nothing for firings of hidden transitions or without cases', () => {
    const hidden: DomainView = structuredClone(view);
    hidden.transitions['work'] = { kind: 'hidden', reason: 'x' };
    expect(layoutTokens(net, hidden, stateWith({ running: [firing] })).tokens.size).toBe(0);
    expect(
      layoutTokens(net, view, stateWith({ running: [{ ...firing, caseIds: [] }] })).tokens.size,
    ).toBe(0);
  });
});

describe('layoutTokens on pass-through waypoints', () => {
  const net = example('parcel-center');
  const view = net.domainView as DomainView;

  it('moves the case along the route while the firing lasts', () => {
    const route = travelPath(layoutContext(net, view), 't_rA');
    expect(route).not.toBeNull();
    const running = [
      { firingId: 3, transitionId: 't_rA', start: 100, end: 110, slot: 0, caseIds: ['P-0001'] },
    ];
    const at = (time: number) =>
      layoutTokens(net, view, { time, marking: {}, running }).tokens.get(firingKey(3, 'P-0001'))!;
    const begin = at(100);
    const middle = at(105);
    const end = at(110);
    expect(begin.state).toBe('traveling');
    expect(begin.pos).toEqual(route![0]);
    expect(end.pos[0]).toBeCloseTo(route![route!.length - 1]![0], 5);
    expect(end.pos[1]).toBeCloseTo(route![route!.length - 1]![1], 5);
    // Halfway in time is halfway along the route, and it passes the waypoint region.
    expect(middle.pos[0]).toBeGreaterThan(begin.pos[0]);
    expect(middle.pos[0]).toBeLessThan(end.pos[0] + 1);
    expect(middle.travel?.end).toBe(110);
  });

  it('starts at the head of the belt before and ends at the zone behind', () => {
    const route = travelPath(layoutContext(net, view), 't_rB')!;
    const sorted = view.places['p_sorted'];
    const zone = view.places['p_B'];
    if (sorted?.kind !== 'conveyor' || zone?.kind !== 'buffer') throw new Error('unexpected view');
    expect(route[0]![0]).toBeCloseTo(sorted.path[1]![0] - 8, 5);
    expect(route[route.length - 1]![0]).toBeCloseTo(zone.path[0]![0] + 8, 5);
  });
});
