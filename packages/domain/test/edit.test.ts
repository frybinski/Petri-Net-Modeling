import { describe, expect, it } from 'vitest';
import {
  addDecor,
  addSlot,
  allowedPlaceKinds,
  allowedTransitionKinds,
  decorAt,
  GRID,
  hideEntry,
  insertPoint,
  markUser,
  MIN_SIZE,
  movePoint,
  moveEntry,
  moveSlot,
  newDecor,
  ref,
  removeDecor,
  removePoint,
  removeSlot,
  resizeEntry,
  resizeRect,
  setBox,
  setEntryKind,
  setLabel,
  setPass,
  setSensor,
  showEntry,
  validateDomainView,
  type DomainView,
  type Rect,
} from '../src';
import { smallNet, smallView } from './helpers';

const AT = '2026-02-02T00:00:00.000Z';
const OPTIONS = { at: AT };

const station = ref('transitions', 'work');
const queue = ref('places', 'q');

/** All entries of a view as strings, to see what changed. */
function snapshot(view: DomainView): Map<string, string> {
  const out = new Map<string, string>();
  for (const [id, entry] of Object.entries(view.places))
    out.set(`places.${id}`, JSON.stringify(entry));
  for (const [id, entry] of Object.entries(view.transitions)) {
    out.set(`transitions.${id}`, JSON.stringify(entry));
  }
  for (const [key, entry] of Object.entries(view.arcs ?? {})) {
    out.set(`arcs.${key}`, JSON.stringify(entry));
  }
  (view.decor ?? []).forEach((entry, i) => out.set(`decor.${i}`, JSON.stringify(entry)));
  for (const [key, entry] of Object.entries(view.provenance)) {
    out.set(`provenance.${key}`, JSON.stringify(entry));
  }
  return out;
}

/** The keys whose content differs between two views. */
function changed(before: DomainView, after: DomainView): string[] {
  const a = snapshot(before);
  const b = snapshot(after);
  const keys = new Set([...a.keys(), ...b.keys()]);
  return [...keys].filter((key) => a.get(key) !== b.get(key)).sort();
}

function expectValid(view: DomainView): void {
  const result = validateDomainView(smallNet(), view);
  expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
}

describe('markUser', () => {
  it('sets the provenance of entries to user and skips decor', () => {
    const view = smallView();
    const next = markUser(view, [ref('places', 'done'), ref('decor', 0)], AT);
    expect(next.provenance['places.done']).toEqual({ source: 'user', at: AT });
    expect(Object.keys(next.provenance).sort()).toEqual([
      'places.done',
      'places.q',
      'transitions.work',
    ]);
    expect(markUser(view, [ref('decor', 0)], AT)).toBe(view);
  });
});

describe('moveEntry', () => {
  it('moves the box together with its slots and snaps the origin to the grid', () => {
    const view = smallView();
    const next = moveEntry(view, station, [13, -9], { ...OPTIONS, snap: GRID });
    const entry = next.transitions['work'];
    expect(entry).toMatchObject({ kind: 'station' });
    if (entry?.kind !== 'station') throw new Error('station expected');
    // The box was at [320, 160]: 333 and 151 snap to 336 and 152.
    expect(entry.box).toEqual([336, 152, 100, 80]);
    expect(entry.slots).toEqual([[386, 192]]);
    expectValid(next);
  });

  it('moves by whole numbers without a grid and records the user as author', () => {
    const next = moveEntry(smallView(), station, [3.4, 5.6], OPTIONS);
    const entry = next.transitions['work'];
    if (entry?.kind !== 'station') throw new Error('station expected');
    expect(entry.box).toEqual([323, 166, 100, 80]);
    expect(next.provenance['transitions.work']).toEqual({ source: 'user', at: AT });
  });

  it('changes nothing but the moved entry and its provenance', () => {
    const view = smallView();
    const next = moveEntry(view, ref('places', 'done'), [40, 40], { ...OPTIONS, snap: GRID });
    expect(changed(view, next)).toEqual(['places.done', 'provenance.places.done']);
  });

  it('keeps the entry inside the canvas', () => {
    const view = smallView();
    const right = moveEntry(view, ref('places', 'done'), [5000, 5000], OPTIONS);
    expect(right.places['done']).toEqual({ kind: 'sink', box: [720, 360, 80, 40] });
    const left = moveEntry(view, ref('places', 'done'), [-5000, -5000], OPTIONS);
    expect(left.places['done']).toEqual({ kind: 'sink', box: [0, 0, 80, 40] });
    const belt = moveEntry(view, queue, [-5000, 0], OPTIONS);
    expect(belt.places['q']).toMatchObject({
      path: [
        [0, 200],
        [200, 200],
      ],
    });
  });

  it('moves every point of a path and every end of a wall', () => {
    const view = smallView();
    const next = moveEntry(view, queue, [16, 8], { ...OPTIONS, snap: GRID });
    expect(next.places['q']).toMatchObject({
      path: [
        [120, 208],
        [320, 208],
      ],
    });
    const decor: DomainView = {
      ...view,
      decor: [
        {
          kind: 'wall',
          segs: [
            [10, 10, 110, 10],
            [110, 10, 110, 90],
          ],
          width: 4,
        },
      ],
    };
    const wall = moveEntry(decor, ref('decor', 0), [8, 8], OPTIONS);
    expect(wall.decor?.[0]).toMatchObject({
      segs: [
        [18, 18, 118, 18],
        [118, 18, 118, 98],
      ],
    });
  });

  it('moves the end of the arcs along when the net is given', () => {
    const view = smallView();
    const net = smallNet();
    const next = moveEntry(view, station, [0, 24], { ...OPTIONS, net });
    expect(next.arcs?.['work>done']).toEqual({
      path: [
        [420, 224],
        [600, 200],
      ],
    });
    expect(next.provenance['arcs.work>done']?.source).toBe('user');
    // Without the net the arc stays.
    expect(moveEntry(view, station, [0, 24], OPTIONS).arcs).toEqual(view.arcs);
  });

  it('does nothing for an unknown entry or a move that ends where it began', () => {
    const view = smallView();
    expect(moveEntry(view, ref('places', 'nope'), [5, 5], OPTIONS)).toBe(view);
    expect(moveEntry(view, ref('places', 'res'), [5, 5], OPTIONS)).toBe(view);
    expect(moveEntry(view, station, [0, 0], OPTIONS)).toBe(view);
  });
});

describe('resizeRect', () => {
  const canvas = { width: 800, height: 400 };
  const rect: Rect = [100, 100, 80, 60];

  it('moves the edges of the handle and snaps them', () => {
    expect(resizeRect(rect, 'se', [21, 13], canvas, { snap: 8 })).toEqual([100, 100, 100, 76]);
    expect(resizeRect(rect, 'nw', [-13, -9], canvas, { snap: 8 })).toEqual([88, 88, 92, 72]);
    expect(resizeRect(rect, 'e', [17, 99], canvas)).toEqual([100, 100, 97, 60]);
    expect(resizeRect(rect, 'n', [99, -10], canvas)).toEqual([100, 90, 80, 70]);
  });

  it('never gets smaller than the minimum size', () => {
    expect(resizeRect(rect, 'se', [-500, -500], canvas)).toEqual([100, 100, MIN_SIZE, MIN_SIZE]);
    expect(resizeRect(rect, 'nw', [500, 500], canvas)).toEqual([156, 136, MIN_SIZE, MIN_SIZE]);
  });

  it('stays inside the canvas', () => {
    expect(resizeRect(rect, 'se', [9999, 9999], canvas)).toEqual([100, 100, 700, 300]);
    expect(resizeRect(rect, 'nw', [-9999, -9999], canvas)).toEqual([0, 0, 180, 160]);
  });

  it('keeps the proportions of a corner with keepAspect', () => {
    const next = resizeRect(rect, 'se', [40, 0], canvas, { keepAspect: true });
    expect(next[2] / next[3]).toBeCloseTo(80 / 60, 1);
    expect(next[0]).toBe(100);
    expect(next[1]).toBe(100);
    expect(next[2]).toBeGreaterThan(80);
  });
});

describe('resizeEntry and setBox', () => {
  it('scales the slots with the box and keeps them inside', () => {
    const view = smallView();
    const next = resizeEntry(view, station, 'resize-se', [100, 80], OPTIONS);
    const entry = next.transitions['work'];
    if (entry?.kind !== 'station') throw new Error('station expected');
    expect(entry.box).toEqual([320, 160, 200, 160]);
    // The slot was in the middle of the box and is still.
    expect(entry.slots).toEqual([[420, 240]]);
    expectValid(next);
    const small = resizeEntry(view, station, 'resize-nw', [500, 500], OPTIONS);
    const shrunk = small.transitions['work'];
    if (shrunk?.kind !== 'station') throw new Error('station expected');
    expect(shrunk.box[2]).toBe(MIN_SIZE);
    const [x, y, w, h] = shrunk.box;
    for (const slot of shrunk.slots ?? []) {
      expect(slot[0]).toBeGreaterThanOrEqual(x);
      expect(slot[0]).toBeLessThanOrEqual(x + w);
      expect(slot[1]).toBeGreaterThanOrEqual(y);
      expect(slot[1]).toBeLessThanOrEqual(y + h);
    }
    expectValid(small);
  });

  it('resizes sinks, decor rectangles and the length of a scale bar', () => {
    let view = smallView();
    view = {
      ...view,
      decor: [
        { kind: 'zone', rect: [100, 50, 120, 80], label: 'Z' },
        { kind: 'scale', pos: [600, 360], px: 100, label: '10 m' },
      ],
    };
    const sink = resizeEntry(view, ref('places', 'done'), 'resize-w', [-40, 0], OPTIONS);
    expect(sink.places['done']).toMatchObject({ box: [560, 180, 120, 40] });
    const zone = resizeEntry(view, ref('decor', 0), 'resize-s', [0, 24], OPTIONS);
    expect(zone.decor?.[0]).toMatchObject({ rect: [100, 50, 120, 104] });
    const scale = resizeEntry(view, ref('decor', 1), 'resize-e', [40, 0], OPTIONS);
    expect(scale.decor?.[1]).toMatchObject({ px: 140 });
    const clipped = resizeEntry(view, ref('decor', 1), 'resize-e', [4000, 0], OPTIONS);
    expect(clipped.decor?.[1]).toMatchObject({ px: 200 });
  });

  it('resizes one room of a rooms area and scales all rooms with the box', () => {
    const view = smallView();
    const area: DomainView = {
      ...view,
      transitions: {
        ...view.transitions,
        work: {
          kind: 'rooms',
          box: [300, 100, 200, 100],
          slots: [[400, 150]],
          rooms: [
            [300, 100, 100, 100],
            [400, 100, 100, 100],
          ],
        },
      },
    };
    const target = ref('transitions', 'work');
    const one = resizeEntry(area, target, 'resize-se', [20, 0], { ...OPTIONS, room: 0 });
    expect(one.transitions['work']).toMatchObject({
      rooms: [
        [300, 100, 120, 100],
        [400, 100, 100, 100],
      ],
    });
    const all = resizeEntry(area, target, 'resize-se', [200, 0], OPTIONS);
    expect(all.transitions['work']).toMatchObject({
      box: [300, 100, 400, 100],
      slots: [[500, 150]],
      rooms: [
        [300, 100, 200, 100],
        [500, 100, 200, 100],
      ],
    });
  });

  it('sets a box exactly, within the limits', () => {
    const view = smallView();
    const next = setBox(view, station, [10.4, 20.6, 90, 70], OPTIONS);
    expect(next.transitions['work']).toMatchObject({ box: [10, 21, 90, 70] });
    const tiny = setBox(view, station, [10, 20, 1, 1], OPTIONS);
    expect(tiny.transitions['work']).toMatchObject({ box: [10, 20, MIN_SIZE, MIN_SIZE] });
    const far = setBox(view, station, [790, 390, 100, 100], OPTIONS);
    expect(far.transitions['work']).toMatchObject({ box: [700, 300, 100, 100] });
    expect(setBox(view, queue, [0, 0, 50, 50], OPTIONS)).toBe(view);
  });
});

describe('points', () => {
  it('moves a point with snapping and clamping, and keeps the length positive', () => {
    const view = smallView();
    const moved = movePoint(view, queue, 1, [333, 211], { ...OPTIONS, snap: GRID });
    expect(moved.places['q']).toMatchObject({
      path: [
        [100, 200],
        [336, 208],
      ],
    });
    const clamped = movePoint(view, queue, 0, [-50, 9999], OPTIONS);
    expect(clamped.places['q']).toMatchObject({
      path: [
        [0, 400],
        [300, 200],
      ],
    });
    // A path of two points whose ends meet has no length: the move is refused.
    expect(movePoint(view, queue, 1, [100, 200], OPTIONS)).toBe(view);
    expect(movePoint(view, queue, 7, [1, 1], OPTIONS)).toBe(view);
  });

  it('moves the arcs that end at the end of a belt along', () => {
    const net = smallNet();
    const view: DomainView = {
      ...smallView(net),
      arcs: {
        'q>work': {
          path: [
            [300, 200],
            [320, 200],
          ],
        },
      },
    };
    const next = movePoint(view, queue, 1, [296, 232], { ...OPTIONS, net });
    expect(next.arcs?.['q>work']).toEqual({
      path: [
        [296, 232],
        [320, 200],
      ],
    });
    const start = movePoint(view, queue, 0, [96, 232], { ...OPTIONS, net });
    expect(start.arcs).toEqual(view.arcs);
  });

  it('inserts a point in the middle of a segment or at a given place, and removes it again', () => {
    const view = smallView();
    const inserted = insertPoint(view, queue, 0, undefined, OPTIONS);
    expect(inserted.places['q']).toMatchObject({
      path: [
        [100, 200],
        [200, 200],
        [300, 200],
      ],
    });
    const at = insertPoint(view, queue, 0, [150, 260], OPTIONS);
    expect(at.places['q']).toMatchObject({
      path: [
        [100, 200],
        [150, 260],
        [300, 200],
      ],
    });
    const back = removePoint(at, queue, 1, OPTIONS);
    expect(back.places['q']).toMatchObject({
      path: [
        [100, 200],
        [300, 200],
      ],
    });
    expect(back.provenance['places.q']).toEqual({ source: 'user', at: AT });
  });

  it('keeps at least two points', () => {
    const view = smallView();
    expect(removePoint(view, queue, 0, OPTIONS)).toBe(view);
    expect(insertPoint(view, queue, 5, undefined, OPTIONS)).toBe(view);
  });

  it('edits the paths of arcs', () => {
    const view = smallView();
    const key = ref('arcs', 'work>done');
    const bent = insertPoint(view, key, 0, [500, 260], OPTIONS);
    expect(bent.arcs?.['work>done']?.path).toHaveLength(3);
    expect(bent.provenance['arcs.work>done']).toEqual({ source: 'user', at: AT });
    const dragged = movePoint(bent, key, 1, [500, 300], OPTIONS);
    expect(dragged.arcs?.['work>done']?.path[1]).toEqual([500, 300]);
  });

  it('moves the end of a wall segment', () => {
    const view: DomainView = {
      ...smallView(),
      decor: [{ kind: 'wall', segs: [[10, 10, 110, 10]], width: 4 }],
    };
    const next = movePoint(view, ref('decor', 0), 1, [200, 100], OPTIONS);
    expect(next.decor?.[0]).toMatchObject({ segs: [[10, 10, 200, 100]] });
  });
});

describe('slots', () => {
  it('moves a slot inside the box only', () => {
    const view = smallView();
    const inside = moveSlot(view, station, 0, [340, 180], OPTIONS);
    expect(inside.transitions['work']).toMatchObject({ slots: [[340, 180]] });
    const outside = moveSlot(view, station, 0, [9000, -9000], OPTIONS);
    const entry = outside.transitions['work'];
    if (entry?.kind !== 'station') throw new Error('station expected');
    expect(entry.slots?.[0]).toEqual([412, 168]);
    expectValid(outside);
    expect(moveSlot(view, station, 3, [340, 180], OPTIONS)).toBe(view);
  });

  it('adds a slot at the first free spot and removes slots again', () => {
    const view = smallView();
    const more = addSlot(view, station, undefined, OPTIONS);
    const entry = more.transitions['work'];
    if (entry?.kind !== 'station') throw new Error('station expected');
    expect(entry.slots).toHaveLength(2);
    expectValid(more);
    const given = addSlot(view, station, [400, 220], OPTIONS);
    expect(given.transitions['work']).toMatchObject({
      slots: [
        [370, 200],
        [400, 220],
      ],
    });
    const none = removeSlot(removeSlot(given, station, 1, OPTIONS), station, 0, OPTIONS);
    expect(none.transitions['work']).toEqual({ kind: 'station', box: [320, 160, 100, 80] });
    expect(addSlot(view, ref('places', 'q'), undefined, OPTIONS)).toBe(view);
  });
});

describe('labels and fields', () => {
  it('sets and removes labels', () => {
    const view = smallView();
    const named = setLabel(view, station, 'Packing', OPTIONS);
    expect(named.transitions['work']).toMatchObject({ label: 'Packing' });
    const cleared = setLabel(named, station, '  ', OPTIONS);
    expect(cleared.transitions['work']).not.toHaveProperty('label');
    const decor: DomainView = {
      ...view,
      decor: [
        { kind: 'label', pos: [10, 20], text: 'Hall' },
        { kind: 'room', rect: [10, 10, 100, 100] },
      ],
    };
    expect(setLabel(decor, ref('decor', 0), 'Hall 2', OPTIONS).decor?.[0]).toMatchObject({
      text: 'Hall 2',
    });
    expect(setLabel(decor, ref('decor', 0), '', OPTIONS)).toBe(decor);
    expect(setLabel(decor, ref('decor', 1), 'Office', OPTIONS).decor?.[1]).toMatchObject({
      label: 'Office',
    });
  });

  it('sets the sensor of a transition and the pass flag of a point', () => {
    const view = smallView();
    const sensor = setSensor(view, station, 'light-barrier', OPTIONS);
    expect(sensor.transitions['work']).toMatchObject({ sensor: 'light-barrier' });
    expect(setSensor(sensor, station, '', OPTIONS).transitions['work']).not.toHaveProperty(
      'sensor',
    );
    const dock = ref('transitions', 't_in');
    expect(setPass(view, dock, true, OPTIONS).transitions['t_in']).toMatchObject({ pass: true });
    expect(setPass(view, station, true, OPTIONS)).toBe(view);
  });
});

describe('kinds', () => {
  it('offers only the kinds that rule V4 allows', () => {
    const net = smallNet();
    expect(allowedPlaceKinds(net, 'res')).toEqual(['pool', 'slots']);
    expect(allowedPlaceKinds(net, 'done')).toEqual(['sink']);
    expect(allowedPlaceKinds(net, 'q')).toEqual([
      'queue',
      'conveyor',
      'buffer',
      'source',
      'sink',
      'pool',
    ]);
    expect(allowedTransitionKinds(net, 't_in')).toEqual(['door', 'dock']);
    expect(allowedTransitionKinds(net, 'work')).toContain('station');
    expect(allowedTransitionKinds(net, 'work')).not.toContain('hidden');
  });

  it('switches between card kinds without touching the geometry', () => {
    const net = smallNet();
    const view = smallView(net);
    const next = setEntryKind(view, net, station, 'machine', OPTIONS);
    expect(next.transitions['work']).toEqual({
      kind: 'machine',
      box: [320, 160, 100, 80],
      slots: [[370, 200]],
    });
    expect(next.provenance['transitions.work']).toEqual({ source: 'user', at: AT });
  });

  it('turns a box into a point and a point into a box', () => {
    const net = smallNet();
    const view = smallView(net);
    const door = setEntryKind(view, net, station, 'door', OPTIONS);
    expect(door.transitions['work']).toEqual({ kind: 'door', pos: [370, 200] });
    expectValid(door);
    const back = setEntryKind(door, net, station, 'area', OPTIONS);
    expect(back.transitions['work']).toMatchObject({ kind: 'area', slots: [] });
    const box = back.transitions['work'];
    if (box?.kind !== 'area') throw new Error('area expected');
    expect(box.box[2]).toBe(96);
    expectValid(back);
  });

  it('converts places between paths, pools and boxes', () => {
    const net = smallNet();
    const view = smallView(net);
    const pool = setEntryKind(view, net, ref('places', 'q'), 'source', OPTIONS);
    expect(pool.places['q']).toEqual({ kind: 'source', box: [164, 180, 72, 40] });
    const path = setEntryKind(pool, net, ref('places', 'q'), 'queue', OPTIONS);
    expect(path.places['q']).toMatchObject({ kind: 'queue' });
    expectValid(path);
    const worker = setEntryKind(view, net, ref('places', 'res'), 'pool', OPTIONS);
    expect(worker.places['res']).toEqual({ kind: 'pool', pos: [370, 200] });
    const slots = setEntryKind(worker, net, ref('places', 'res'), 'slots', OPTIONS);
    expect(slots.places['res']).toEqual({ kind: 'slots', of: 'work' });
    expectValid(slots);
  });

  it('refuses kinds that the role does not allow', () => {
    const net = smallNet();
    const view = smallView(net);
    expect(setEntryKind(view, net, ref('places', 'done'), 'queue', OPTIONS)).toBe(view);
    expect(setEntryKind(view, net, ref('transitions', 't_in'), 'station', OPTIONS)).toBe(view);
    expect(setEntryKind(view, net, ref('places', 'res'), 'sink', OPTIONS)).toBe(view);
    expect(setEntryKind(view, net, station, 'station', OPTIONS)).toBe(view);
    expect(setEntryKind(view, net, station, 'nonsense', OPTIONS)).toBe(view);
  });
});

describe('hiding', () => {
  it('hides an entry with a reason and drops the arcs that touch it', () => {
    const net = smallNet();
    const view = smallView(net);
    const next = hideEntry(view, net, station, 'hidden by user', OPTIONS);
    expect(next.transitions['work']).toEqual({ kind: 'hidden', reason: 'hidden by user' });
    expect(next.arcs).toEqual({});
    expect(next.provenance['transitions.work']).toEqual({ source: 'user', at: AT });
    expect(next.provenance['arcs.work>done']).toBeUndefined();
    // Hiding twice, or hiding decor, changes nothing.
    expect(hideEntry(next, net, station, 'x', OPTIONS)).toBe(next);
    expect(hideEntry(view, net, ref('decor', 0), 'x', OPTIONS)).toBe(view);
  });

  it('shows a hidden entry at its generic place and gives its arcs a path again', () => {
    const net = smallNet();
    const view = smallView(net);
    const hidden = hideEntry(view, net, station, 'hidden by user', OPTIONS);
    const shown = showEntry(hidden, net, station, OPTIONS);
    expect(shown.transitions['work']?.kind).toBe('station');
    expect(shown.provenance['transitions.work']).toEqual({ source: 'generic', at: AT });
    expect(shown.arcs?.['work>done']).toBeDefined();
    expectValid(shown);
  });

  it('switching the kind of a hidden entry shows it first', () => {
    const net = smallNet();
    const hidden = hideEntry(smallView(net), net, station, 'x', OPTIONS);
    const next = setEntryKind(hidden, net, station, 'gate', OPTIONS);
    expect(next.transitions['work']?.kind).toBe('gate');
    expect(next.provenance['transitions.work']?.source).toBe('user');
  });
});

describe('decor', () => {
  const canvas = { width: 800, height: 400 };

  it('creates every kind of decor inside the canvas', () => {
    for (const kind of ['room', 'zone', 'furniture', 'label', 'scale', 'wall'] as const) {
      const decor = newDecor(kind, [790, 395], canvas);
      const view: DomainView = { ...smallView(), decor: [decor] };
      expectValid(view);
    }
  });

  it('adds decor on top and removes it again', () => {
    const view = smallView();
    const added = addDecor(view, newDecor('room', [200, 200], canvas));
    expect(added.index).toBe(1);
    expect(added.view.decor).toHaveLength(2);
    const removed = removeDecor(added.view, 0);
    expect(removed.decor).toHaveLength(1);
    expect(removed.decor?.[0]?.kind).toBe('room');
    expect(removeDecor(view, 9)).toBe(view);
    expect(view.decor).toHaveLength(1);
  });

  it('finds decor under a point', () => {
    const view: DomainView = {
      ...smallView(),
      decor: [
        { kind: 'room', rect: [0, 0, 400, 400], label: 'R' },
        { kind: 'furniture', rect: [100, 100, 50, 20] },
        { kind: 'wall', segs: [[0, 300, 400, 300]], width: 6 },
      ],
    };
    expect(decorAt(view, [120, 110])).toBe(1);
    expect(decorAt(view, [300, 50])).toBe(0);
    expect(decorAt(view, [200, 302])).toBe(2);
    expect(decorAt(view, [600, 50])).toBeNull();
  });
});
