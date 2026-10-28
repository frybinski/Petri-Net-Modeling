import { genericDomainView, layoutTokens, stationInfos, type DomainView } from '@pnm/domain';
import { createSimulation } from '@pnm/sim';
import { describe, expect, it } from 'vitest';
import { loadExample } from '../test/domain-fixtures';
import { buildDomainCard, formatOrigin } from './domain-hover';

describe('buildDomainCard', () => {
  const net = loadExample('parcel-center');
  const view = genericDomainView(net, { at: '2026-10-28T09:00:00.000Z' });

  it('describes a place with its role, tokens and origin', () => {
    const card = buildDomainCard({ net, view, marking: { p_in: [1, 1, 1] }, id: 'p_in' });
    expect(card).toMatchObject({
      id: 'p_in',
      kind: 'place',
      name: 'Eingangspuffer',
      shownAs: 'conveyor',
      role: 'case',
      tokens: 3,
      origin: { source: 'generic' },
    });
  });

  it('knows resources and sinks', () => {
    expect(buildDomainCard({ net, view, marking: net.marking, id: 'p_scanner' })).toMatchObject({
      role: 'resource',
      shownAs: 'slots',
      tokens: 2,
    });
    expect(buildDomainCard({ net, view, marking: {}, id: 'p_done' })).toMatchObject({
      role: 'sink',
      shownAs: 'sink',
    });
  });

  it('describes a transition with its firings under way and its sensor', () => {
    const own = loadExample('smart-office');
    const card = buildDomainCard({
      net: own,
      view: own.domainView as never,
      marking: own.marking,
      running: new Map([['o_work', 3]]),
      id: 'o_work',
    });
    expect(card).toMatchObject({
      kind: 'transition',
      shownAs: 'area',
      running: 3,
      sensor: 'Präsenzsensor je Schreibtisch',
      origin: { source: 'user' },
    });
  });

  it('describes an arc by its ends', () => {
    const arc = net.arcs.find((a) => a.source === 'p_sorted' && a.target === 't_rA');
    expect(arc).toBeDefined();
    const card = buildDomainCard({ net, view, marking: {}, id: arc!.id });
    expect(card).toMatchObject({ kind: 'arc', name: 'Sortiert → Weiche A' });
  });

  it('says when an element is not drawn and ignores unknown ids', () => {
    const hidden = structuredClone(view);
    hidden.places['p_in'] = { kind: 'hidden', reason: 'x' };
    expect(buildDomainCard({ net, view: hidden, marking: {}, id: 'p_in' })?.shownAs).toBeNull();
    expect(buildDomainCard({ net, view, marking: {}, id: 'nothing' })).toBeNull();
  });
});

describe('formatOrigin', () => {
  it('shows source, model and day', () => {
    expect(formatOrigin({ source: 'user', at: '2026-10-28T09:00:00.000Z' })).toBe(
      'user · 2026-10-28',
    );
    expect(formatOrigin({ source: 'llm', model: 'm1', at: '2026-10-28T09:00:00.000Z' })).toBe(
      'LLM (m1) · 2026-10-28',
    );
  });
});

describe('buildDomainCard while simulating', () => {
  const net = loadExample('parcel-center');
  const view = net.domainView as DomainView;

  /** A run of the parcel center up to a moment with cases waiting. */
  async function snapshot() {
    const sim = createSimulation(net);
    await sim.advance(2400);
    const state = {
      time: sim.state.time,
      marking: sim.state.marking,
      meta: sim.state.meta,
      running: sim.state.running.map((f) => ({
        firingId: f.id,
        transitionId: f.transitionId,
        start: f.start,
        end: f.end,
        slot: f.slot,
        caseIds: f.caseIds,
      })),
    };
    const layout = layoutTokens(net, view, state);
    return {
      state,
      live: {
        layout,
        stations: stationInfos(net, view, layout.counts, layout.running),
        metrics: sim.metrics(),
        thresholds: { warn: 6, critical: 10 },
      },
    };
  }

  it('gives a queue its waiting cases, the mean wait and the level', async () => {
    const { state, live } = await snapshot();
    const waiting = state.marking['p_in']?.length ?? 0;
    const card = buildDomainCard({ net, view, marking: state.marking, live, id: 'p_in' });
    expect(card?.waiting).toBe(waiting);
    if (waiting > 0) {
      expect(card?.waitingCases?.ids).toHaveLength(Math.min(4, waiting));
      expect(card?.waitingCases?.more).toBe(Math.max(0, waiting - 4));
    }
    expect(card?.meanWait === null || typeof card?.meanWait === 'number').toBe(true);
    expect(card?.level === undefined || ['warn', 'crit'].includes(card.level)).toBe(true);
  });

  it('gives a station its status, slots and the use of its resource', async () => {
    const { state, live } = await snapshot();
    const card = buildDomainCard({ net, view, marking: state.marking, live, id: 't_scan' });
    expect(card?.status).toBeDefined();
    expect(card?.slots).toEqual({ busy: expect.any(Number), capacity: 2 });
    expect(card?.waiting).toBe(state.marking['p_in']?.length ?? 0);
    expect(card?.utilization).toBeGreaterThanOrEqual(0);
    expect(card?.utilization).toBeLessThanOrEqual(1);
  });

  it('gives a resource its free tokens and its use', async () => {
    const { state, live } = await snapshot();
    const card = buildDomainCard({ net, view, marking: state.marking, live, id: 'p_scanner' });
    expect(card?.free).toBeGreaterThanOrEqual(0);
    expect(card?.utilization).toBeDefined();
  });

  it('shows none of this while editing', () => {
    const card = buildDomainCard({ net, view, marking: net.marking, id: 't_scan' });
    expect(card?.status).toBeUndefined();
    expect(card?.slots).toBeUndefined();
  });
});
