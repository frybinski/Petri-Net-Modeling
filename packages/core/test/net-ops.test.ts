import { describe, expect, it } from 'vitest';
import { makeJsonNet } from './helpers';
import {
  addAnnotation,
  addToken,
  addType,
  removeToken,
  removeType,
  renameType,
  setGuard,
  setInscription,
  setPlaceType,
  setProfile,
  setTokens,
  updateToken,
  updateType,
  alignNodes,
  distributeNodes,
  addArc,
  addPlace,
  addTransition,
  arcsOf,
  canConnect,
  createEmptyNet,
  createId,
  findArc,
  moveNodes,
  nodeById,
  isPlace,
  isTransition,
  NetOpError,
  placeById,
  postset,
  preset,
  removeArc,
  removeElements,
  removeNode,
  renameNet,
  reverseArc,
  setInitialTokens,
  setWeight,
  uniqueName,
  updateAnnotation,
  updateArc,
  updateNode,
  validate,
  arcById,
  transitionById,
  type PetriNet,
} from '../src';

function sample(): PetriNet {
  let net = createEmptyNet('sample');
  net = addPlace(net, { id: 'p1', position: { x: 0, y: 0 } });
  net = addPlace(net, { id: 'p2', position: { x: 200, y: 0 } });
  net = addTransition(net, { id: 't1', position: { x: 100, y: 0 } });
  net = addArc(net, 'p1', 't1', { id: 'a1' });
  net = addArc(net, 't1', 'p2', { id: 'a2', weight: 2 });
  return setInitialTokens(net, 'p1', 3);
}

describe('createId', () => {
  it('creates distinct URL-safe ids of 11 characters', () => {
    const ids = new Set(Array.from({ length: 500 }, () => createId()));
    expect(ids.size).toBe(500);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{11}$/);
  });
});

describe('uniqueName', () => {
  it('returns the base when free and increments trailing numbers otherwise', () => {
    expect(uniqueName([], 'P1')).toBe('P1');
    expect(uniqueName(['P1'], 'P1')).toBe('P2');
    expect(uniqueName(['P1', 'P2', 'P3'], 'P1')).toBe('P4');
    expect(uniqueName(['Buffer'], 'Buffer')).toBe('Buffer 2');
    expect(uniqueName(['Buffer', 'Buffer 2'], 'Buffer')).toBe('Buffer 3');
  });
});

describe('net operations', () => {
  it('adds elements with default names and does not mutate the input', () => {
    const empty = createEmptyNet('x');
    const one = addPlace(empty, { position: { x: 1, y: 2 } });
    const two = addPlace(one, { position: { x: 3, y: 4 } });
    expect(empty.places).toHaveLength(0);
    expect(two.places.map((p) => p.name)).toEqual(['P1', 'P2']);
    const t = addTransition(two, { position: { x: 0, y: 0 } });
    expect(t.transitions[0]?.name).toBe('T1');
    expect(two.places[0]?.position).toEqual({ x: 1, y: 2 });
  });

  it('rejects duplicate ids and invalid capacities', () => {
    const net = sample();
    expect(() => addPlace(net, { id: 't1', position: { x: 0, y: 0 } })).toThrow(NetOpError);
    expect(() => addPlace(net, { position: { x: 0, y: 0 }, capacity: 0 })).toThrow(NetOpError);
    expect(() => addTransition(net, { id: 'p1', position: { x: 0, y: 0 } })).toThrow(NetOpError);
    expect(() =>
      addAnnotation(addAnnotation(net, { id: 'n', position: { x: 0, y: 0 } }), {
        id: 'n',
        position: { x: 0, y: 0 },
      }),
    ).toThrow(NetOpError);
  });

  it('keeps optional place fields', () => {
    const net = addPlace(createEmptyNet('x'), {
      position: { x: 0, y: 0 },
      capacity: 4,
      type: 'T',
      name: 'Buffer',
    });
    expect(net.places[0]).toMatchObject({ capacity: 4, type: 'T', name: 'Buffer' });
    const withGuard = addTransition(net, { position: { x: 0, y: 0 }, guard: 'x > 1' });
    expect(withGuard.transitions[0]?.guard).toBe('x > 1');
  });

  it('only connects places with transitions', () => {
    const net = sample();
    expect(canConnect(net, 'p1', 't1')).toEqual({ ok: true });
    expect(canConnect(net, 'p1', 'p2')).toMatchObject({ ok: false });
    expect(
      canConnect(addTransition(net, { id: 't2', position: { x: 0, y: 0 } }), 't1', 't2'),
    ).toMatchObject({ ok: false });
    expect(canConnect(net, 'p1', 'nowhere')).toMatchObject({ ok: false });
    expect(() => addArc(net, 'p1', 'p2')).toThrow(NetOpError);
    expect(() => addArc(net, 'p1', 't1', { weight: 0 })).toThrow(NetOpError);
  });

  it('adds arcs with inscription and points', () => {
    const net = addArc(sample(), 't1', 'p1', {
      id: 'a3',
      inscription: 'x',
      points: [{ x: 1, y: 1 }],
    });
    expect(arcById(net, 'a3')).toMatchObject({ inscription: 'x', points: [{ x: 1, y: 1 }] });
    expect(findArc(net, 't1', 'p1')?.id).toBe('a3');
    expect(findArc(net, 'p2', 't1')).toBeUndefined();
  });

  it('removing a node removes its arcs and tokens', () => {
    const net = removeNode(sample(), 'p1');
    expect(net.places.map((p) => p.id)).toEqual(['p2']);
    expect(net.arcs.map((a) => a.id)).toEqual(['a2']);
    expect(net.marking).toEqual({});
    expect(removeNode(net, 'ghost')).toBe(net);
    expect(validate(removeNode(sample(), 't1')).some((d) => d.severity === 'error')).toBe(false);
  });

  it('removes arcs and mixed element sets', () => {
    const net = sample();
    expect(removeArc(net, 'a1').arcs.map((a) => a.id)).toEqual(['a2']);
    expect(removeArc(net, 'ghost')).toBe(net);
    const withNote = addAnnotation(net, { id: 'n1', position: { x: 0, y: 0 }, text: 'hi' });
    const cleaned = removeElements(withNote, ['n1', 't1', 'a2']);
    expect(cleaned.transitions).toEqual([]);
    expect(cleaned.arcs).toEqual([]);
    expect(cleaned.annotations).toEqual([]);
    expect(cleaned.places).toHaveLength(2);
  });

  it('updates nodes; undefined removes optional fields', () => {
    let net = updateNode(sample(), 'p1', { name: 'Input', capacity: 5 });
    expect(placeById(net, 'p1')).toMatchObject({ name: 'Input', capacity: 5 });
    net = updateNode(net, 'p1', { capacity: undefined });
    expect(placeById(net, 'p1')).not.toHaveProperty('capacity');
    net = updateNode(net, 't1', { name: 'Fire', capacity: 9 });
    expect(transitionById(net, 't1')).toEqual({
      id: 't1',
      name: 'Fire',
      position: { x: 100, y: 0 },
    });
    expect(() => updateNode(net, 'ghost', { name: 'x' })).toThrow(NetOpError);
    expect(() => updateNode(net, 'p1', { capacity: -1 })).toThrow(NetOpError);
    expect(placeById(updateNode(net, 'p1', { guard: 'ignored' }), 'p1')).not.toHaveProperty(
      'guard',
    );
  });

  it('updates arcs and weights', () => {
    let net = setWeight(sample(), 'a1', 4);
    expect(arcById(net, 'a1')?.weight).toBe(4);
    net = updateArc(net, 'a1', { inscription: 'y' });
    expect(arcById(net, 'a1')).toMatchObject({ weight: 4, inscription: 'y' });
    net = updateArc(net, 'a1', { inscription: undefined });
    expect(arcById(net, 'a1')).not.toHaveProperty('inscription');
    expect(() => setWeight(net, 'a1', 0)).toThrow(NetOpError);
    expect(() => setWeight(net, 'a1', 1.5)).toThrow(NetOpError);
    expect(() => updateArc(net, 'ghost', {})).toThrow(NetOpError);
  });

  it('reverses an arc and its bend points', () => {
    let net = updateArc(sample(), 'a1', {
      points: [
        { x: 1, y: 1 },
        { x: 2, y: 2 },
      ],
    });
    net = reverseArc(net, 'a1');
    expect(arcById(net, 'a1')).toMatchObject({
      source: 't1',
      target: 'p1',
      points: [
        { x: 2, y: 2 },
        { x: 1, y: 1 },
      ],
    });
    expect(validate(net).some((d) => d.severity === 'error')).toBe(false);
    expect(() => reverseArc(net, 'ghost')).toThrow(NetOpError);
    expect(arcById(reverseArc(sample(), 'a1'), 'a1')).not.toHaveProperty('points');
  });

  it('sets initial tokens', () => {
    const net = sample();
    expect(net.marking.p1).toEqual([1, 1, 1]);
    expect(setInitialTokens(net, 'p1', 0).marking).toEqual({});
    expect(setInitialTokens(net, 'p2', 1).marking.p2).toEqual([1]);
    expect(() => setInitialTokens(net, 'p2', -1)).toThrow(NetOpError);
    expect(() => setInitialTokens(net, 'p2', 0.5)).toThrow(NetOpError);
    expect(() => setInitialTokens(net, 't1', 1)).toThrow(NetOpError);
  });

  it('moves nodes and annotations', () => {
    const net = addAnnotation(sample(), { id: 'n1', position: { x: 0, y: 0 } });
    const moved = moveNodes(net, {
      p1: { x: 40, y: 60 },
      n1: { x: 7, y: 8 },
      ghost: { x: 1, y: 1 },
    });
    expect(placeById(moved, 'p1')?.position).toEqual({ x: 40, y: 60 });
    expect(moved.annotations?.[0]?.position).toEqual({ x: 7, y: 8 });
    expect(placeById(moved, 'p2')).toBe(placeById(net, 'p2'));
    expect(moveNodes(sample(), {}).annotations).toBeUndefined();
  });

  it('renames the net and edits annotations', () => {
    expect(renameNet(sample(), 'New').name).toBe('New');
    let net = addAnnotation(sample(), { id: 'n1', position: { x: 0, y: 0 } });
    net = updateAnnotation(net, 'n1', { text: 'note' });
    expect(net.annotations?.[0]?.text).toBe('note');
    expect(() => updateAnnotation(net, 'ghost', {})).toThrow(NetOpError);
    expect(() => updateAnnotation(sample(), 'ghost', {})).toThrow(NetOpError);
  });
});

describe('queries', () => {
  it('computes presets, postsets and incident arcs', () => {
    const net = sample();
    expect(preset(net, 't1')).toEqual(['p1']);
    expect(postset(net, 't1')).toEqual(['p2']);
    expect(preset(net, 'p1')).toEqual([]);
    expect(arcsOf(net, 't1').map((a) => a.id)).toEqual(['a1', 'a2']);
    expect(isPlace(net, 'p1')).toBe(true);
    expect(isTransition(net, 'p1')).toBe(false);
    expect(isTransition(net, 't1')).toBe(true);
    expect(nodeById(net, 't1')?.id).toBe('t1');
    expect(nodeById(net, 'ghost')).toBeUndefined();
  });

  it('does not list a node twice for parallel arcs', () => {
    const net = addArc(sample(), 'p1', 't1');
    expect(preset(net, 't1')).toEqual(['p1']);
  });
});

describe('alignment', () => {
  const spread = (): PetriNet => {
    let net = createEmptyNet('align');
    net = addPlace(net, { id: 'a', position: { x: 0, y: 10 } });
    net = addPlace(net, { id: 'b', position: { x: 100, y: 50 } });
    net = addTransition(net, { id: 'c', position: { x: 400, y: 90 } });
    return addAnnotation(net, { id: 'n', position: { x: 1000, y: 1000 } });
  };
  const pos = (net: PetriNet, id: string) => nodeById(net, id)?.position;

  it('aligns to the extremes or the mean', () => {
    const ids = ['a', 'b', 'c'];
    expect(pos(alignNodes(spread(), ids, 'left'), 'c')).toEqual({ x: 0, y: 90 });
    expect(pos(alignNodes(spread(), ids, 'right'), 'a')).toEqual({ x: 400, y: 10 });
    expect(pos(alignNodes(spread(), ids, 'center'), 'a')).toEqual({ x: 167, y: 10 });
    expect(pos(alignNodes(spread(), ids, 'top'), 'c')).toEqual({ x: 400, y: 10 });
    expect(pos(alignNodes(spread(), ids, 'bottom'), 'a')).toEqual({ x: 0, y: 90 });
    expect(pos(alignNodes(spread(), ids, 'middle'), 'b')).toEqual({ x: 100, y: 50 });
  });

  it('leaves unselected elements alone and ignores a single element', () => {
    const net = spread();
    expect(pos(alignNodes(net, ['a', 'b'], 'left'), 'c')).toEqual({ x: 400, y: 90 });
    expect(alignNodes(net, ['a'], 'left')).toBe(net);
  });

  it('distributes evenly between the outermost elements', () => {
    let net = spread();
    net = moveNodes(net, { b: { x: 30, y: 50 } });
    const h = distributeNodes(net, ['a', 'b', 'c'], 'horizontal');
    expect(pos(h, 'b')).toEqual({ x: 200, y: 50 });
    const v = distributeNodes(net, ['a', 'b', 'c'], 'vertical');
    expect(pos(v, 'b')).toEqual({ x: 30, y: 50 });
    expect(distributeNodes(net, ['a', 'b'], 'horizontal')).toBe(net);
  });
});

describe('higher net operations', () => {
  const start = (): PetriNet =>
    makeJsonNet({
      types: { A: { type: 'string' }, B: { type: 'integer' } },
      places: [
        { id: 'p', type: 'A', tokens: ['x', 'y'] },
        { id: 'q', type: 'A' },
      ],
      transitions: [{ id: 't', guard: 'true' }],
      arcs: [{ from: 'p', to: 't', inscription: '$a' }],
    });

  it('addType adds a schema and validates the name', () => {
    const net = addType(start(), 'C', { type: 'boolean' });
    expect(net.types['C']).toEqual({ type: 'boolean' });
    expect(() => addType(net, 'C', {})).toThrow(NetOpError);
    expect(() => addType(net, '1bad', {})).toThrow(NetOpError);
  });

  it('renameType updates all places that use the type', () => {
    const net = renameType(start(), 'A', 'Text');
    expect(Object.keys(net.types)).toEqual(['Text', 'B']);
    expect(net.places.map((p) => p.type)).toEqual(['Text', 'Text']);
    expect(() => renameType(start(), 'A', 'B')).toThrow(NetOpError);
    expect(() => renameType(start(), 'Z', 'Y')).toThrow(NetOpError);
    expect(renameType(start(), 'A', 'A').types).toEqual(start().types);
  });

  it('updateType replaces the schema', () => {
    const net = updateType(start(), 'A', { type: 'number' });
    expect(net.types['A']).toEqual({ type: 'number' });
    expect(() => updateType(start(), 'Z', {})).toThrow(NetOpError);
  });

  it('removeType detaches the places', () => {
    const net = removeType(start(), 'A');
    expect(Object.keys(net.types)).toEqual(['B']);
    expect(net.places.every((p) => p.type === undefined && !('type' in p))).toBe(true);
    const unchanged = start();
    expect(removeType(unchanged, 'Z')).toBe(unchanged);
  });

  it('setPlaceType assigns and clears a type', () => {
    const typed = setPlaceType(start(), 'q', 'B');
    expect(typed.places[1]!.type).toBe('B');
    expect('type' in setPlaceType(typed, 'q', undefined).places[1]!).toBe(false);
    expect(() => setPlaceType(start(), 'q', 'Z')).toThrow(NetOpError);
    expect(() => setPlaceType(start(), 't', 'A')).toThrow(NetOpError);
  });

  it('setGuard and setInscription set and clear text', () => {
    const net = setGuard(start(), 't', '$a = "x"');
    expect(net.transitions[0]!.guard).toBe('$a = "x"');
    expect('guard' in setGuard(net, 't', '  ').transitions[0]!).toBe(false);
    const arc = setInscription(start(), 'arc0', '$b, $c');
    expect(arc.arcs[0]!.inscription).toBe('$b, $c');
    expect('inscription' in setInscription(arc, 'arc0', undefined).arcs[0]!).toBe(false);
    expect(() => setGuard(start(), 'p', 'x')).toThrow(NetOpError);
    expect(() => setInscription(start(), 'nope', 'x')).toThrow(NetOpError);
  });

  it('manages initial tokens', () => {
    let net = setTokens(start(), 'q', ['a', { id: 1 }]);
    expect(net.marking['q']).toEqual(['a', { id: 1 }]);
    net = addToken(net, 'q', 'c');
    expect(net.marking['q']).toEqual(['a', { id: 1 }, 'c']);
    net = updateToken(net, 'q', 1, 42);
    expect(net.marking['q']).toEqual(['a', 42, 'c']);
    net = removeToken(net, 'q', 0);
    expect(net.marking['q']).toEqual([42, 'c']);
    net = setTokens(net, 'q', []);
    expect('q' in net.marking).toBe(false);
  });

  it('rejects invalid tokens and indices, and does not alias the input', () => {
    expect(() => addToken(start(), 'q', null as never)).toThrow(NetOpError);
    expect(() => setTokens(start(), 'q', [() => 1] as never)).toThrow(NetOpError);
    expect(() => updateToken(start(), 'p', 5, 'z')).toThrow(NetOpError);
    expect(() => removeToken(start(), 'q', 0)).toThrow(NetOpError);
    expect(() => addToken(start(), 'nope', 1)).toThrow(NetOpError);
    const token = { id: 1 };
    const net = addToken(start(), 'q', token);
    token.id = 2;
    expect(net.marking['q']).toEqual([{ id: 1 }]);
  });

  it('setProfile switches the class and keeps the higher fields', () => {
    const net = setProfile(start(), 'pt-net');
    expect(net.profile).toBe('pt-net');
    expect(net.types).toEqual(start().types);
    expect(net.arcs[0]!.inscription).toBe('$a');
    const same = start();
    expect(setProfile(same, 'json-net')).toBe(same);
  });
});
