import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createEmptyNet, parseNetText } from '@pnm/core';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_THRESHOLDS,
  counterOverflows,
  layoutTokens,
  netHash,
  queueLevel,
  stationInfos,
  stationStatus,
  type DomainView,
} from '../src';
import { smallNet, smallView } from './helpers';

describe('stationStatus', () => {
  it('is full only when every slot is in use and cases are waiting', () => {
    expect(stationStatus(2, 2, 1)).toBe('busy-full');
    expect(stationStatus(2, 2, 0)).toBe('busy');
    expect(stationStatus(1, 2, 5)).toBe('busy');
    expect(stationStatus(3, 2, 1)).toBe('busy-full');
    // A station without slots in the view is never full or blocked.
    expect(stationStatus(1, 0, 5)).toBe('busy');
  });

  it('is blocked once the waiting cases reach the yellow limit of the queues', () => {
    expect(stationStatus(2, 2, 5)).toBe('busy-full');
    expect(stationStatus(2, 2, 6)).toBe('blocked');
    expect(stationStatus(2, 2, 40)).toBe('blocked');
    // The limit is the one of the key figure settings.
    expect(stationStatus(2, 2, 2, { warn: 3, critical: 5 })).toBe('busy-full');
    expect(stationStatus(2, 2, 3, { warn: 3, critical: 5 })).toBe('blocked');
    // Free slots never block, however many cases wait.
    expect(stationStatus(1, 2, 40)).toBe('busy');
  });

  it('tells a station without work from one that is about to start', () => {
    expect(stationStatus(0, 2, 0)).toBe('starved');
    expect(stationStatus(0, 2, 3)).toBe('free');
  });
});

describe('queueLevel', () => {
  it('turns yellow from 6 and red from 10 by default', () => {
    expect(DEFAULT_THRESHOLDS).toEqual({ warn: 6, critical: 10 });
    expect([0, 5, 6, 9, 10, 40].map((n) => queueLevel(n))).toEqual([
      'ok',
      'ok',
      'warn',
      'warn',
      'crit',
      'crit',
    ]);
  });

  it('uses thresholds of the key figure settings', () => {
    const thresholds = { warn: 2, critical: 3 };
    expect([1, 2, 3].map((n) => queueLevel(n, thresholds))).toEqual(['ok', 'warn', 'crit']);
  });
});

describe('stationInfos', () => {
  const net = smallNet();
  const view = smallView(net);
  const firing = {
    firingId: 1,
    transitionId: 'work',
    start: 0,
    end: 10,
    slot: 0,
    caseIds: ['C-1'],
  };

  it('counts the waiting cases and the firings under way', () => {
    const layout = layoutTokens(net, view, {
      time: 0,
      marking: { q: [1, 1, 1], res: [] },
      running: [firing],
    });
    const info = stationInfos(net, view, layout.counts, layout.running).get('work')!;
    expect(info).toMatchObject({ busy: 1, capacity: 1, waiting: 3, status: 'busy-full' });
    const many = layoutTokens(net, view, {
      time: 0,
      marking: { q: Array.from({ length: 7 }, () => 1), res: [] },
      running: [firing],
    });
    expect(stationInfos(net, view, many.counts, many.running).get('work')!.status).toBe('blocked');
    // The thresholds of the settings apply.
    expect(
      stationInfos(net, view, layout.counts, layout.running, undefined, {
        warn: 3,
        critical: 5,
      }).get('work')!.status,
    ).toBe('blocked');
  });

  it('has no entry for arrivals and for stations without a card', () => {
    const layout = layoutTokens(net, view, { time: 0, marking: {}, running: [] });
    const infos = stationInfos(net, view, layout.counts, layout.running);
    expect([...infos.keys()]).toEqual(['work']);
    expect(infos.get('work')!.status).toBe('starved');
  });

  it('does not count resources as waiting cases', () => {
    const layout = layoutTokens(net, view, { time: 0, marking: { res: [1] }, running: [] });
    expect(stationInfos(net, view, layout.counts, layout.running).get('work')!.waiting).toBe(0);
  });

  it('works for the example nets', () => {
    const parcel = parseNetText(
      readFileSync(
        join(import.meta.dirname, '..', '..', '..', 'examples', 'parcel-center.pn.json'),
        'utf8',
      ),
    );
    const parcelView = parcel.domainView as DomainView;
    const layout = layoutTokens(parcel, parcelView, {
      time: 0,
      marking: parcel.marking,
      running: [],
    });
    const infos = stationInfos(parcel, parcelView, layout.counts, layout.running);
    expect(infos.has('t_scan')).toBe(true);
    expect(infos.has('t_rA')).toBe(false);
    expect(infos.has('t_arr')).toBe(false);
  });
});

describe('counterOverflows (N2)', () => {
  const net = createEmptyNet('Store');
  net.places = [
    { id: 'tubes', name: 'Tubes', position: { x: 0, y: 0 }, role: 'quantity' },
    { id: 'scrap', name: 'Scrap', position: { x: 0, y: 0 }, role: 'quantity' },
    { id: 'plain', name: 'Plain', position: { x: 0, y: 0 }, role: 'quantity' },
  ];
  const view: DomainView = {
    schemaVersion: 1,
    netHash: netHash(net),
    meta: {
      theme: 'T',
      viewName: 'V',
      entity: { singular: 'x', plural: 'x', sprite: 'dot' },
      canvas: { width: 400, height: 300 },
    },
    places: {
      tubes: {
        kind: 'pool',
        pos: [60, 60],
        label: 'Rohrlager (kg)',
        display: { style: 'fill', max: 200 },
      },
      scrap: { kind: 'pool', pos: [160, 60], display: { style: 'fill', max: 10 } },
      plain: { kind: 'pool', pos: [260, 60] },
    },
    transitions: {},
    provenance: {},
  };
  const marking = (tubes: number, scrap: number, plain: number) => ({
    tubes: Array.from({ length: tubes }, () => 1),
    scrap: Array.from({ length: scrap }, () => 1),
    plain: Array.from({ length: plain }, () => 1),
  });

  it('lists the fill levels that are above their limit, with the name without the unit', () => {
    expect(counterOverflows(net, view, marking(213, 3, 900))).toEqual([
      { placeId: 'tubes', name: 'Rohrlager', count: 213, max: 200 },
    ]);
    expect(counterOverflows(net, view, marking(200, 10, 0))).toEqual([]);
    expect(counterOverflows(net, view, marking(201, 11, 0)).map((o) => o.placeId)).toEqual([
      'tubes',
      'scrap',
    ]);
    // The name of the place stands in for a missing label.
    expect(counterOverflows(net, view, marking(0, 11, 0))[0]).toMatchObject({ name: 'Scrap' });
  });
});
