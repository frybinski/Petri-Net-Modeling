import { describe, expect, it } from 'vitest';
import {
  elementOfRef,
  entryBounds,
  fillMissing,
  handlesFor,
  hiddenPlaceholders,
  hideEntry,
  hitHandle,
  missingEntries,
  placeholderAt,
  ref,
  refOfElement,
  removeStale,
  resetEntry,
  staleEntries,
  validateDomainView,
  type DomainView,
} from '../src';
import { smallNet, smallView } from './helpers';

const AT = '2026-02-02T00:00:00.000Z';

function kinds(
  view: DomainView,
  section: 'places' | 'transitions' | 'arcs' | 'decor',
  key: string,
) {
  return handlesFor(view, ref(section, key)).map((h) => h.kind);
}

describe('handlesFor', () => {
  it('gives a box a surface and eight resize handles, and a slot handle per slot', () => {
    const view = smallView();
    const handles = handlesFor(view, ref('transitions', 'work'));
    expect(handles.filter((h) => h.kind === 'move')).toHaveLength(1);
    expect(handles.filter((h) => h.kind.startsWith('resize-'))).toHaveLength(8);
    expect(handles.filter((h) => h.kind === 'slot')).toHaveLength(1);
    const se = handles.find((h) => h.kind === 'resize-se');
    expect(se?.at).toEqual([420, 240]);
    expect(se?.cursor).toBe('nwse-resize');
    expect(new Set(handles.map((h) => h.id)).size).toBe(handles.length);
  });

  it('gives a path a point per point and a segment handle per segment', () => {
    const view = smallView();
    const handles = handlesFor(view, ref('places', 'q'));
    expect(handles.map((h) => h.kind)).toEqual(['segment', 'point', 'point']);
    expect(handles[0]?.at).toEqual([200, 200]);
    expect(kinds(view, 'arcs', 'work>done')).toEqual(['segment', 'point', 'point']);
  });

  it('gives points and sinks what they need and hidden entries nothing', () => {
    const net = smallNet();
    const view = smallView(net);
    expect(kinds(view, 'transitions', 't_in')).toEqual(['pos']);
    expect(kinds(view, 'places', 'done')).toHaveLength(9);
    expect(kinds(view, 'places', 'res')).toEqual([]);
    expect(kinds(hideEntry(view, net, ref('transitions', 'work')), 'transitions', 'work')).toEqual(
      [],
    );
    expect(kinds(view, 'places', 'missing')).toEqual([]);
  });

  it('gives rooms their own handles and a wall two handles per segment', () => {
    const view = smallView();
    const area: DomainView = {
      ...view,
      transitions: {
        ...view.transitions,
        work: {
          kind: 'rooms',
          box: [300, 100, 200, 100],
          slots: [],
          rooms: [
            [300, 100, 100, 100],
            [400, 100, 100, 100],
          ],
        },
      },
      decor: [
        {
          kind: 'wall',
          segs: [
            [10, 10, 100, 10],
            [100, 10, 100, 90],
          ],
        },
      ],
    };
    const rooms = handlesFor(area, ref('transitions', 'work')).filter((h) => h.part === 'room');
    // A surface and four corners per room.
    expect(rooms).toHaveLength(10);
    expect(new Set(rooms.map((h) => h.index))).toEqual(new Set([0, 1]));
    const wall = handlesFor(area, ref('decor', 0));
    expect(wall.map((h) => h.index)).toEqual([0, 1, 2, 3]);
    expect(wall.every((h) => h.part === 'wall' && h.kind === 'point')).toBe(true);
  });

  it('gives a scale bar a handle at each end', () => {
    const view: DomainView = {
      ...smallView(),
      decor: [{ kind: 'scale', pos: [100, 300], px: 80, label: '5 m' }],
    };
    const handles = handlesFor(view, ref('decor', 0));
    expect(handles.map((h) => [h.kind, h.at])).toEqual([
      ['pos', [100, 300]],
      ['resize-e', [180, 300]],
    ]);
  });
});

describe('hitHandle', () => {
  const view = smallView();
  const handles = handlesFor(view, ref('transitions', 'work'));

  it('finds corners, slots and the surface in this order of priority', () => {
    expect(hitHandle(handles, [421, 241], 6)?.kind).toBe('resize-se');
    expect(hitHandle(handles, [371, 201], 6)?.kind).toBe('slot');
    expect(hitHandle(handles, [340, 180], 6)?.kind).toBe('move');
    expect(hitHandle(handles, [700, 10], 6)).toBeNull();
  });

  it('prefers a point to the middle of a segment close by', () => {
    const path = handlesFor(
      {
        ...smallView(),
        places: {
          ...smallView().places,
          q: {
            kind: 'queue',
            path: [
              [100, 200],
              [110, 200],
              [300, 200],
            ],
          },
        },
      },
      ref('places', 'q'),
    );
    expect(hitHandle(path, [105, 200], 8)?.kind).toBe('point');
    expect(hitHandle(path, [205, 200], 8)?.kind).toBe('segment');
  });

  it('takes the smallest surface when rooms lie on the box', () => {
    const room = handlesFor(
      {
        ...smallView(),
        transitions: {
          ...smallView().transitions,
          work: {
            kind: 'rooms',
            box: [300, 100, 200, 100],
            slots: [],
            rooms: [[320, 120, 60, 60]],
          },
        },
      },
      ref('transitions', 'work'),
    );
    expect(hitHandle(room, [350, 150], 2)?.part).toBe('room');
    expect(hitHandle(room, [480, 190], 2)?.part).toBeUndefined();
  });
});

describe('entries and elements', () => {
  it('maps elements of the net to entries and back', () => {
    const net = smallNet();
    const view = smallView(net);
    expect(refOfElement(net, view, 'q')).toEqual(ref('places', 'q'));
    // The cells of a resource belong to the card of their transition.
    expect(refOfElement(net, view, 'res')).toEqual(ref('transitions', 'work'));
    expect(refOfElement(net, view, 'a5')).toEqual(ref('arcs', 'work>done'));
    expect(refOfElement(net, view, 'a1')).toBeNull();
    expect(refOfElement(net, view, 'nope')).toBeNull();
    expect(elementOfRef(net, ref('arcs', 'work>done'))).toBe('a5');
    expect(elementOfRef(net, ref('places', 'q'))).toBe('q');
    expect(elementOfRef(net, ref('decor', 0))).toBeNull();
  });

  it('computes the bounds of everything an entry covers', () => {
    const view = smallView();
    expect(entryBounds(view, ref('places', 'q'))).toEqual([100, 200, 200, 0]);
    expect(entryBounds(view, ref('transitions', 'work'))).toEqual([320, 160, 100, 80]);
    expect(entryBounds(view, ref('places', 'res'))).toBeNull();
  });
});

describe('placeholders of hidden entries', () => {
  it('appear where the generic view would put the element', () => {
    const net = smallNet();
    const view = hideEntry(smallView(net), net, ref('transitions', 'work'));
    const placeholders = hiddenPlaceholders(net, view);
    expect(placeholders.map((p) => p.elementId)).toEqual(['work']);
    const [first] = placeholders;
    expect(first?.name).toBe('Work');
    const rect = first?.rect ?? [0, 0, 0, 0];
    expect(placeholderAt(placeholders, [rect[0] + 3, rect[1] + 3])?.elementId).toBe('work');
    expect(placeholderAt(placeholders, [-50, -50])).toBeNull();
    expect(hiddenPlaceholders(net, smallView(net))).toEqual([]);
  });
});

describe('completing and cleaning a view', () => {
  function withNewPlace() {
    const net = smallNet();
    const view = smallView(net);
    const grown = structuredClone(net);
    grown.places.push({ id: 'extra', name: 'Extra', position: { x: 300, y: 300 } });
    grown.arcs.push({ id: 'a9', source: 'work', target: 'extra', weight: 1 });
    return { net: grown, view };
  }

  it('lists missing and stale entries', () => {
    const { net, view } = withNewPlace();
    expect(missingEntries(net, view)).toEqual(['places.extra']);
    expect(staleEntries(net, view)).toEqual([]);
    const shrunk = smallNet();
    shrunk.places = shrunk.places.filter((p) => p.id !== 'done');
    shrunk.arcs = shrunk.arcs.filter((a) => a.id !== 'a5');
    expect(staleEntries(shrunk, view).sort()).toEqual(['arcs.work>done', 'places.done']);
  });

  it('fills only what is missing and keeps stale entries when asked', () => {
    const { net, view } = withNewPlace();
    const filled = fillMissing(net, view, { at: AT, dropStale: false });
    expect(Object.keys(filled.places).sort()).toEqual(['done', 'extra', 'q', 'res']);
    expect(filled.provenance['places.extra']).toEqual({ source: 'generic', at: AT });
    for (const id of ['q', 'res', 'done']) expect(filled.places[id]).toEqual(view.places[id]);
    expect(filled.transitions).toEqual(view.transitions);
    expect(filled.netHash).toBe(view.netHash);
    expect(validateDomainView(net, filled).diagnostics.map((d) => d.rule)).toEqual(['V7']);

    const shrunk = smallNet();
    shrunk.places = shrunk.places.filter((p) => p.id !== 'done');
    shrunk.arcs = shrunk.arcs.filter((a) => a.id !== 'a5');
    const kept = fillMissing(shrunk, view, { at: AT, dropStale: false });
    expect(kept.places['done']).toEqual(view.places['done']);
    expect(kept.arcs?.['work>done']).toEqual(view.arcs?.['work>done']);
  });

  it('removes stale entries and nothing else', () => {
    const view = smallView();
    const shrunk = smallNet();
    shrunk.places = shrunk.places.filter((p) => p.id !== 'done');
    shrunk.arcs = shrunk.arcs.filter((a) => a.id !== 'a5');
    const cleaned = removeStale(shrunk, view);
    expect(Object.keys(cleaned.places).sort()).toEqual(['q', 'res']);
    expect(cleaned.arcs).toEqual({});
    expect(cleaned.transitions).toEqual(view.transitions);
    expect(cleaned.provenance).toEqual(view.provenance);
    expect(removeStale(smallNet(), view)).toEqual(view);
  });
});

describe('resetEntry', () => {
  it('gives an entry its generic form with the provenance generic', () => {
    const net = smallNet();
    const view = smallView(net);
    const next = resetEntry(net, view, { section: 'places', key: 'done' }, { at: AT });
    expect(next.places['done']?.kind).toBe('sink');
    expect(next.places['done']).not.toEqual(view.places['done']);
    expect(next.provenance['places.done']).toEqual({ source: 'generic', at: AT });
    expect(next.places['q']).toEqual(view.places['q']);
    expect(next.transitions).toEqual(view.transitions);
    expect(validateDomainView(net, next).ok).toBe(true);
  });

  it('resets the path of an arc', () => {
    const net = smallNet();
    const view = smallView(net);
    const bent: DomainView = {
      ...view,
      arcs: {
        'work>done': {
          path: [
            [420, 200],
            [500, 300],
            [600, 200],
          ],
        },
      },
    };
    const next = resetEntry(net, bent, { section: 'arcs', key: 'work>done' }, { at: AT });
    expect(next.arcs?.['work>done']?.path).toHaveLength(2);
    expect(next.provenance['arcs.work>done']).toEqual({ source: 'generic', at: AT });
  });
});
