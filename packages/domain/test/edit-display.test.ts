import { describe, expect, it } from 'vitest';
import {
  ref,
  setAppearance,
  setDisplay,
  setEntryKind,
  suggestDisplay,
  validateDomainView,
  type CounterDisplay,
  type DomainView,
} from '../src';
import { smallNet, smallView } from './helpers';

const AT = '2026-02-02T00:00:00.000Z';
const OPTIONS = { at: AT };
const done = ref('places', 'done');
const queue = ref('places', 'q');

/** The small view with the queue drawn as a pool, which is a counter. */
function withPool(): DomainView {
  const view = structuredClone(smallView());
  view.places['q'] = { kind: 'pool', pos: [150, 150], label: 'Waiting' };
  return view;
}

describe('setDisplay', () => {
  it('writes the display of a counter, marks the entry as made by hand and keeps the rest', () => {
    const view = smallView();
    const display: CounterDisplay = { style: 'fill', max: 40, low: 10, icon: 'dot' };
    const next = setDisplay(view, done, display, OPTIONS);
    expect(next.places['done']).toEqual({ kind: 'sink', box: [600, 180, 80, 40], display });
    expect(next.provenance['places.done']).toEqual({ source: 'user', at: AT });
    expect(view.places['done']).toEqual({ kind: 'sink', box: [600, 180, 80, 40] });
    const pool = setDisplay(withPool(), queue, { style: 'pictogram', per: 2 }, OPTIONS);
    expect(pool.places['q']).toMatchObject({ kind: 'pool', label: 'Waiting' });
  });

  it('removes the display with undefined, which is the plain number again', () => {
    const view = setDisplay(smallView(), done, { style: 'fill', max: 40 }, OPTIONS);
    const plain = setDisplay(view, done, undefined, OPTIONS);
    expect(plain.places['done']).toEqual({ kind: 'sink', box: [600, 180, 80, 40] });
  });

  it('leaves entries alone that are no counters', () => {
    const view = smallView();
    expect(setDisplay(view, queue, { style: 'fill', max: 40 }, OPTIONS)).toBe(view);
    expect(setDisplay(view, ref('transitions', 'work'), { style: 'number' }, OPTIONS)).toBe(view);
    expect(setDisplay(view, ref('places', 'res'), { style: 'number' }, OPTIONS)).toBe(view);
  });
});

describe('setAppearance', () => {
  it('writes and removes the appearance of a belt, a queue or a box', () => {
    const view = smallView();
    const next = setAppearance(view, queue, { sprite: 'bars', tint: 'neutral' }, OPTIONS);
    expect(next.places['q']).toMatchObject({
      kind: 'conveyor',
      appearance: { sprite: 'bars', tint: 'neutral' },
    });
    expect(next.provenance['places.q']).toEqual({ source: 'user', at: AT });
    expect(validateDomainView(smallNet(), next).diagnostics).toEqual([]);
    const sink = setAppearance(view, done, { sprite: 'parcel' }, OPTIONS);
    expect(sink.places['done']).toMatchObject({ appearance: { sprite: 'parcel' } });
    const back = setAppearance(next, queue, undefined, OPTIONS);
    expect(back.places['q']).toEqual(view.places['q']);
  });

  it('leaves a counter that is no box and the other entries alone', () => {
    const view = withPool();
    expect(setAppearance(view, queue, { sprite: 'bars' }, OPTIONS)).toBe(view);
    expect(setAppearance(view, ref('transitions', 'work'), { sprite: 'bars' }, OPTIONS)).toBe(view);
  });
});

describe('changing the kind keeps what has a place in the new kind', () => {
  it('the display goes along from a pool to a box, the appearance from a belt to a queue', () => {
    const net = smallNet();
    const view = setDisplay(
      withPool(),
      queue,
      { style: 'fill', max: 40, size: [60, 90], icon: 'dot' },
      OPTIONS,
    );
    const sink = setEntryKind(view, net, queue, 'sink', OPTIONS);
    expect(sink.places['q']).toMatchObject({
      kind: 'sink',
      label: 'Waiting',
      // The box gives the size now.
      display: { style: 'fill', max: 40, icon: 'dot' },
    });
    expect((sink.places['q'] as { display: object }).display).not.toHaveProperty('size');
    const back = setEntryKind(sink, net, queue, 'pool', OPTIONS);
    expect(back.places['q']).toMatchObject({ kind: 'pool', display: { style: 'fill', max: 40 } });
    // A belt has no display, a counter no appearance.
    const belt = setEntryKind(sink, net, queue, 'queue', OPTIONS);
    expect(belt.places['q']).not.toHaveProperty('display');

    const looks = setAppearance(smallView(), queue, { sprite: 'frame', tint: 'accent' }, OPTIONS);
    const queued = setEntryKind(looks, net, queue, 'queue', OPTIONS);
    expect(queued.places['q']).toMatchObject({
      kind: 'queue',
      appearance: { sprite: 'frame', tint: 'accent' },
    });
    const box = setEntryKind(queued, net, queue, 'sink', OPTIONS);
    expect(box.places['q']).toMatchObject({ kind: 'sink', appearance: { sprite: 'frame' } });
    const pool = setEntryKind(box, net, queue, 'pool', OPTIONS);
    expect(pool.places['q']).not.toHaveProperty('appearance');
    expect(validateDomainView(net, pool).diagnostics).toEqual([]);
  });
});

describe('suggestDisplay', () => {
  const net = smallNet();
  net.marking = { q: Array.from({ length: 120 }, () => 1), res: [1] };

  it('suggests round limits for the marking of the place', () => {
    const fill = suggestDisplay(net, 'q', 'fill');
    expect(fill).toEqual({ style: 'fill', max: 500 });
    const empty = suggestDisplay(net, 'done', 'fill');
    expect(empty).toEqual({ style: 'fill', max: 10 });
    expect(suggestDisplay(net, 'q', 'pictogram')).toEqual({ style: 'pictogram', per: 20 });
    expect(suggestDisplay(net, 'done', 'pictogram')).toEqual({ style: 'pictogram', per: 1 });
    expect(suggestDisplay(net, 'q', 'number')).toEqual({ style: 'number' });
  });

  it('takes the capacity of the place as the limit', () => {
    const bounded = structuredClone(net);
    bounded.places.find((p) => p.id === 'q')!.capacity = 150;
    expect(suggestDisplay(bounded, 'q', 'fill')).toEqual({ style: 'fill', max: 150 });
  });

  it('keeps the symbol, the unit and the history when the style changes, and the limits of the same style', () => {
    const before: CounterDisplay = {
      style: 'fill',
      max: 77,
      low: 5,
      icon: 'material',
      unit: 'kg',
      history: true,
    };
    expect(suggestDisplay(net, 'q', 'pictogram', before)).toEqual({
      style: 'pictogram',
      per: 20,
      icon: 'material',
      unit: 'kg',
      history: true,
    });
    expect(suggestDisplay(net, 'q', 'fill', before)).toEqual(before);
    expect(suggestDisplay(net, 'q', 'number', before)).toEqual({
      style: 'number',
      icon: 'material',
      unit: 'kg',
      history: true,
    });
  });

  it('every suggestion passes the schema', () => {
    for (const style of ['number', 'fill', 'pictogram'] as const) {
      const view = setDisplay(withPool(), queue, suggestDisplay(net, 'q', style), OPTIONS);
      const found = validateDomainView(net, view).diagnostics.filter((d) => d.rule === 'V10');
      expect(found, style).toEqual([]);
    }
  });
});
