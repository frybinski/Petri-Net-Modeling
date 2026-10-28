import { genericDomainView } from '@pnm/domain';
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
