import type { DomainView } from '@pnm/domain';
import { describe, expect, it } from 'vitest';
import { centerOf, compareViews } from '../src';
import { EXAMPLE_IDS, loadExample } from './helpers';

/** A small view; only the parts the comparison reads are filled in. */
function view(parts: Pick<DomainView, 'places' | 'transitions'>, w = 300, h = 400): DomainView {
  return {
    schemaVersion: 1,
    netHash: 'x',
    meta: {
      theme: 't',
      viewName: 'v',
      entity: { singular: 'a', plural: 'b', sprite: 'dot' },
      canvas: { width: w, height: h },
    },
    provenance: {},
    ...parts,
  } as DomainView;
}

const reference = view({
  places: {
    p1: {
      kind: 'queue',
      path: [
        [0, 0],
        [100, 0],
      ],
      appearance: { sprite: 'person', tint: 'neutral' },
    },
    p2: { kind: 'pool', pos: [100, 100], display: { style: 'fill', max: 10, icon: 'water' } },
    p3: { kind: 'slots', of: 't1' },
    p4: { kind: 'hidden', reason: 'aux' },
  },
  transitions: {
    t1: { kind: 'station', box: [200, 200, 20, 40] },
    t2: { kind: 'door', pos: [10, 10] },
  },
});

describe('compareViews', () => {
  it('gives 100 percent and distance 0 for a view and itself, also for the examples', () => {
    const same = compareViews(reference, reference);
    expect(same).toMatchObject({
      elements: 6,
      kindPercent: 100,
      centered: 4,
      meanDistance: 0,
      appearancePercent: 100,
      displayPercent: 100,
    });
    for (const id of EXAMPLE_IDS) {
      const { view: v } = loadExample(id);
      const result = compareViews(v, v);
      expect(result.kindPercent).toBe(100);
      expect(result.meanDistance).toBe(0);
    }
  });

  it('counts kinds, by hand', () => {
    const other = view({
      places: {
        ...reference.places,
        p1: {
          kind: 'conveyor',
          path: [
            [0, 0],
            [100, 0],
          ],
        },
        p4: { kind: 'sink', box: [0, 0, 10, 10] },
      },
      transitions: { ...reference.transitions, t2: { kind: 'dock', pos: [10, 10] } },
    } as never);
    const result = compareViews(other, reference);
    // p2, p3, t1 agree out of six.
    expect(result.kindPercent).toBeCloseTo(50, 10);
  });

  it('measures the mean distance of the centers against the diagonal of the reference canvas', () => {
    // The diagonal of 300 x 400 is 500. p1 is moved by 50 (center 50,0 to 50,50), t2 by 100 along x
    // (10,10 to 110,10); p2 and t1 stay. Mean over four elements: (50 + 0 + 0 + 100) / 4 = 37.5.
    const moved = view({
      places: {
        ...reference.places,
        p1: {
          kind: 'queue',
          path: [
            [0, 50],
            [100, 50],
          ],
        },
      },
      transitions: { ...reference.transitions, t2: { kind: 'door', pos: [110, 10] } },
    } as never);
    const result = compareViews(moved, reference);
    expect(result.centered).toBe(4);
    expect(result.meanDistance).toBeCloseTo(37.5 / 500, 12);
  });

  it('uses the middle of a path along its length and the middle of a box', () => {
    expect(
      centerOf({
        kind: 'queue',
        path: [
          [0, 0],
          [10, 0],
          [10, 30],
        ],
      }),
    ).toEqual([10, 10]);
    expect(centerOf({ kind: 'station', box: [0, 0, 10, 20] })).toEqual([5, 10]);
    expect(centerOf({ kind: 'door', pos: [3, 4] })).toEqual([3, 4]);
    expect(centerOf({ kind: 'hidden', reason: 'x' })).toBeNull();
    expect(centerOf({ kind: 'slots', of: 't' })).toBeNull();
    expect(centerOf(undefined)).toBeNull();
  });

  it('lets a hidden element count for its kind only', () => {
    const hiddenEverywhere = view({
      places: { ...reference.places, p2: { kind: 'hidden', reason: 'x' } },
      transitions: reference.transitions,
    } as never);
    const result = compareViews(hiddenEverywhere, reference);
    expect(result.centered).toBe(3);
    expect(result.kindPercent).toBeCloseTo((5 / 6) * 100, 10);
  });

  it('counts a missing element as another kind without a center', () => {
    const { p1: _gone, ...rest } = reference.places;
    const result = compareViews(
      view({ places: rest, transitions: reference.transitions }),
      reference,
    );
    expect(result.kindPercent).toBeCloseTo((5 / 6) * 100, 10);
    expect(result.centered).toBe(3);
    expect(result.appearances).toBe(1);
    expect(result.appearancePercent).toBe(0);
  });

  it('compares appearance (sprite and tint) and display (style and icon) where either view has one', () => {
    const changed = view({
      places: {
        ...reference.places,
        p1: {
          kind: 'queue',
          path: [
            [0, 0],
            [100, 0],
          ],
          appearance: { sprite: 'person', tint: 'ok' },
        },
        p2: { kind: 'pool', pos: [100, 100], display: { style: 'fill', max: 99, icon: 'water' } },
        p4: { kind: 'hidden', reason: 'aux' },
      },
      transitions: reference.transitions,
    } as never);
    const result = compareViews(changed, reference);
    expect(result.appearances).toBe(1);
    expect(result.appearancePercent).toBe(0);
    // `max` is not compared.
    expect(result.displays).toBe(1);
    expect(result.displayPercent).toBe(100);

    const extra = view({
      places: {
        ...reference.places,
        p2: { kind: 'pool', pos: [100, 100], display: { style: 'pictogram', per: 2 } },
      },
      transitions: reference.transitions,
    } as never);
    expect(compareViews(extra, reference).displayPercent).toBe(0);
  });

  it('has no percentage for appearance and display when neither view has any', () => {
    const plain = view({
      places: { a: { kind: 'pool', pos: [1, 1] } },
      transitions: {},
    } as never);
    const result = compareViews(plain, plain);
    expect(result.appearancePercent).toBeNull();
    expect(result.displayPercent).toBeNull();
    expect(result.meanDistance).toBe(0);
    const none = compareViews(
      view({ places: {}, transitions: {} }),
      view({ places: {}, transitions: {} }),
    );
    expect(none).toMatchObject({ elements: 0, kindPercent: 100, meanDistance: null });
  });
});
