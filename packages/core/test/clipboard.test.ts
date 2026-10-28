import { describe, expect, it } from 'vitest';
import {
  addArc,
  addPlace,
  addTransition,
  createEmptyNet,
  extractFragment,
  insertFragment,
  isEmptyFragment,
  setInitialTokens,
  validate,
  addAnnotation,
  type PetriNet,
} from '../src';

function sample(): PetriNet {
  let net = createEmptyNet('sample');
  net = addPlace(net, { id: 'p1', name: 'P1', position: { x: 0, y: 0 } });
  net = addPlace(net, { id: 'p2', name: 'P2', position: { x: 200, y: 0 } });
  net = addTransition(net, { id: 't1', name: 'T1', position: { x: 100, y: 0 } });
  net = addArc(net, 'p1', 't1', { id: 'a1' });
  net = addArc(net, 't1', 'p2', { id: 'a2' });
  net = addAnnotation(net, { id: 'n1', position: { x: 0, y: 100 }, text: 'note' });
  return setInitialTokens(net, 'p1', 2);
}

describe('clipboard fragments', () => {
  it('extracts selected nodes with the arcs between them', () => {
    const fragment = extractFragment(sample(), ['p1', 't1']);
    expect(fragment.places.map((p) => p.id)).toEqual(['p1']);
    expect(fragment.transitions.map((t) => t.id)).toEqual(['t1']);
    expect(fragment.arcs.map((a) => a.id)).toEqual(['a1']);
    expect(fragment.marking).toEqual({ p1: [1, 1] });
    expect(isEmptyFragment(fragment)).toBe(false);
    expect(isEmptyFragment(extractFragment(sample(), ['a1']))).toBe(true);
  });

  it('inserts with fresh ids, offset, unique names and tokens', () => {
    const net = sample();
    const fragment = extractFragment(net, ['p1', 't1', 'n1']);
    const { net: pasted, ids, nodeIds } = insertFragment(net, fragment, { x: 20, y: 20 });
    expect(pasted.places).toHaveLength(3);
    expect(pasted.transitions).toHaveLength(2);
    expect(pasted.arcs).toHaveLength(3);
    expect(pasted.annotations).toHaveLength(2);
    expect(ids).toHaveLength(4);
    expect(nodeIds).toHaveLength(3);

    const originalIds = new Set(['p1', 'p2', 't1', 'a1', 'a2', 'n1']);
    for (const id of ids) expect(originalIds.has(id)).toBe(false);

    const newPlace = pasted.places[2]!;
    expect(newPlace.name).toBe('P3');
    expect(newPlace.position).toEqual({ x: 20, y: 20 });
    expect(pasted.transitions[1]?.name).toBe('T2');
    expect(pasted.marking[newPlace.id]).toEqual([1, 1]);
    const newArc = pasted.arcs[2]!;
    expect(newArc.source).toBe(newPlace.id);
    expect(newArc.target).toBe(pasted.transitions[1]?.id);
    expect(validate(pasted).filter((d) => d.severity === 'error')).toEqual([]);
    // the source net is untouched
    expect(net.places).toHaveLength(2);
  });

  it('pasting the same fragment twice yields distinct ids and names', () => {
    const net = sample();
    const fragment = extractFragment(net, ['p1']);
    const first = insertFragment(net, fragment, { x: 10, y: 10 }).net;
    const second = insertFragment(first, fragment, { x: 20, y: 20 }).net;
    expect(new Set(second.places.map((p) => p.id)).size).toBe(4);
    expect(second.places.map((p) => p.name)).toEqual(['P1', 'P2', 'P3', 'P4']);
  });

  it('shifts bend points and creates the annotation list on demand', () => {
    let net = sample();
    net = {
      ...net,
      arcs: net.arcs.map((a) => (a.id === 'a1' ? { ...a, points: [{ x: 50, y: 5 }] } : a)),
    };
    const fragment = extractFragment(net, ['p1', 't1']);
    const bare = { ...net, annotations: undefined };
    const result = insertFragment(bare, fragment, { x: 10, y: 0 });
    expect(result.net.arcs[2]?.points).toEqual([{ x: 60, y: 5 }]);
    expect(result.net.annotations).toBeUndefined();
    const withNote = insertFragment(bare, extractFragment(net, ['n1']), { x: 1, y: 1 });
    expect(withNote.net.annotations).toHaveLength(1);
  });
});
