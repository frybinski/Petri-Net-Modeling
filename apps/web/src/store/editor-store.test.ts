import {
  createEmptyNet,
  markingToCounts,
  parseNetText,
  serializeNet,
  type PetriNet,
} from '@pnm/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HISTORY_LIMIT,
  selectCanRedo,
  selectCanUndo,
  selectIsDirty,
  useEditorStore,
} from './editor-store';
import { useUiStore } from './ui-store';

const store = () => useEditorStore.getState();

function resetStores(): void {
  store().newNet();
  useEditorStore.setState({ clipboard: null, pasteCount: 0 });
  useUiStore.setState({ toasts: [], confirm: null });
}

/** p1 -> t1 -> p2 with two tokens on p1. */
function buildSmallNet(): { p1: string; p2: string; t1: string } {
  const p1 = store().addPlace({ x: 0, y: 0 }) as string;
  const t1 = store().addTransition({ x: 100, y: 0 }) as string;
  const p2 = store().addPlace({ x: 200, y: 0 }) as string;
  store().addArc(p1, t1);
  store().addArc(t1, p2);
  store().setTokens(p1, 2);
  return { p1, p2, t1 };
}

beforeEach(resetStores);

describe('creating and connecting', () => {
  it('adds places and transitions with default names and selects them', () => {
    const p = store().addPlace({ x: 10, y: 20 });
    const t = store().addTransition({ x: 50, y: 20 });
    expect(store().net.places).toHaveLength(1);
    expect(store().net.places[0]).toMatchObject({ id: p, name: 'P1', position: { x: 10, y: 20 } });
    expect(store().net.transitions[0]).toMatchObject({ id: t, name: 'T1' });
    expect(store().selection).toEqual([t]);
    expect(store().diagnostics.map((d) => d.code)).toContain('ISOLATED_NODE');
  });

  it('adds notes', () => {
    const id = store().addAnnotation({ x: 0, y: 0 });
    expect(store().net.annotations).toHaveLength(1);
    store().updateAnnotation(id as string, { text: 'hello' });
    expect(store().net.annotations?.[0]?.text).toBe('hello');
  });

  it('connects place and transition, but refuses invalid connections', () => {
    const { p1, p2, t1 } = buildSmallNet();
    expect(store().net.arcs).toHaveLength(2);
    const before = store().net;
    expect(store().addArc(p1, p2)).toBeNull();
    expect(store().net).toBe(before);
    expect(useUiStore.getState().toasts.at(-1)?.message).toMatch(
      /place cannot be connected to a place/,
    );
    const t2 = store().addTransition({ x: 300, y: 0 }) as string;
    expect(store().addArc(t1, t2)).toBeNull();
  });

  it('raises the weight when the same arc is drawn twice', () => {
    const { p1, t1 } = buildSmallNet();
    const arcId = store().addArc(p1, t1);
    expect(store().net.arcs).toHaveLength(2);
    expect(store().net.arcs.find((a) => a.id === arcId)?.weight).toBe(2);
  });
});

describe('editing', () => {
  it('updates names, capacity and weight; invalid values are rejected with a message', () => {
    const { p1, t1 } = buildSmallNet();
    store().updatePlace(p1, { name: 'Input', capacity: 5 });
    expect(store().net.places[0]).toMatchObject({ name: 'Input', capacity: 5 });
    store().updateTransition(t1, { name: 'go' });
    expect(store().net.transitions[0]?.name).toBe('go');
    const arc = store().net.arcs[0]?.id as string;
    store().updateArc(arc, { weight: 4 });
    expect(store().net.arcs[0]?.weight).toBe(4);
    const before = store().net;
    store().updateArc(arc, { weight: 0 });
    expect(store().net).toBe(before);
    expect(useUiStore.getState().toasts.at(-1)?.kind).toBe('error');
  });

  it('does not create history steps for unchanged values', () => {
    const { p1 } = buildSmallNet();
    const steps = store().past.length;
    store().updatePlace(p1, { name: store().net.places[0]?.name as string });
    store().setTokens(p1, 2);
    store().renameNet(store().net.name);
    expect(store().past.length).toBe(steps);
  });

  it('sets and clamps tokens', () => {
    const { p1 } = buildSmallNet();
    store().updatePlace(p1, { capacity: 3 });
    store().setTokens(p1, 10);
    expect(markingToCounts(store().net.marking)[p1]).toBe(3);
    store().select([p1]);
    store().adjustTokens(-1);
    expect(markingToCounts(store().net.marking)[p1]).toBe(2);
    store().adjustTokens(5);
    expect(markingToCounts(store().net.marking)[p1]).toBe(3);
    store().adjustTokens(-10);
    expect(store().net.marking[p1]).toBeUndefined();
  });

  it('reverses arcs and removes selected elements with their arcs', () => {
    const { p1, t1 } = buildSmallNet();
    const arc = store().net.arcs[0]?.id as string;
    store().reverseArc(arc);
    expect(store().net.arcs[0]).toMatchObject({ source: t1, target: p1 });
    store().select([t1]);
    store().removeSelected();
    expect(store().net.transitions).toHaveLength(0);
    expect(store().net.arcs).toHaveLength(0);
    expect(store().selection).toEqual([]);
  });

  it('moves nodes as one undo step', () => {
    const { p1, t1 } = buildSmallNet();
    const steps = store().past.length;
    store().moveNodes({ [p1]: { x: 40, y: 40 }, [t1]: { x: 140, y: 40 } });
    expect(store().past.length).toBe(steps + 1);
    store().undo();
    expect(store().net.places[0]?.position).toEqual({ x: 0, y: 0 });
    store().redo();
    expect(store().net.places[0]?.position).toEqual({ x: 40, y: 40 });
    store().moveNodes({ [p1]: { x: 40, y: 40 } });
    expect(store().past.length).toBe(steps + 1);
  });

  it('nudges, aligns and distributes the selection', () => {
    const a = store().addPlace({ x: 0, y: 10 }) as string;
    const b = store().addPlace({ x: 40, y: 50 }) as string;
    const c = store().addPlace({ x: 400, y: 90 }) as string;
    store().select([a, b, c]);
    store().nudgeSelected(10, 0);
    expect(store().net.places.map((p) => p.position.x)).toEqual([10, 50, 410]);
    store().align('top');
    expect(new Set(store().net.places.map((p) => p.position.y))).toEqual(new Set([10]));
    store().distribute('horizontal');
    expect(store().net.places[1]?.position.x).toBe(210);
  });

  it('applies a layout as one undo step', () => {
    const { p1, p2, t1 } = buildSmallNet();
    const steps = store().past.length;
    store().applyLayout({
      [p1]: { x: 0, y: 0 },
      [t1]: { x: 100, y: 100 },
      [p2]: { x: 200, y: 200 },
    });
    expect(store().past.length).toBe(steps + 1);
    expect(store().net.transitions[0]?.position).toEqual({ x: 100, y: 100 });
  });
});

describe('undo and redo', () => {
  it('walks through history and tracks the dirty state', () => {
    expect(selectIsDirty(store())).toBe(false);
    expect(selectCanUndo(store())).toBe(false);
    const p = store().addPlace({ x: 0, y: 0 }) as string;
    expect(selectIsDirty(store())).toBe(true);
    store().updatePlace(p, { name: 'A' });
    store().undo();
    expect(store().net.places[0]?.name).toBe('P1');
    expect(selectCanRedo(store())).toBe(true);
    store().undo();
    expect(store().net.places).toHaveLength(0);
    expect(selectIsDirty(store())).toBe(false);
    store().redo();
    store().redo();
    expect(store().net.places[0]?.name).toBe('A');
  });

  it('clears the redo stack on a new edit and prunes the selection', () => {
    const p = store().addPlace({ x: 0, y: 0 }) as string;
    store().undo();
    expect(store().selection).not.toContain(p);
    store().addPlace({ x: 0, y: 0 });
    expect(store().future).toHaveLength(0);
  });

  it('keeps the history bounded', () => {
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) store().addPlace({ x: i, y: 0 });
    expect(store().past.length).toBe(HISTORY_LIMIT);
  });

  it('recomputes diagnostics', () => {
    const { t1 } = buildSmallNet();
    store().select([t1]);
    store().removeSelected();
    const withoutT = store().diagnostics.length;
    store().undo();
    expect(store().diagnostics.length).not.toBe(withoutT);
  });
});

describe('copy and paste', () => {
  it('pastes selected elements with new ids, offset, unique names and tokens', () => {
    const { p1, t1, p2 } = buildSmallNet();
    const originalIds = new Set([p1, t1, p2, ...store().net.arcs.map((a) => a.id)]);
    store().select([p1, t1]);
    store().copy();
    store().paste();
    const net = store().net;
    expect(net.places).toHaveLength(3);
    expect(net.transitions).toHaveLength(2);
    expect(net.arcs).toHaveLength(3);
    const created = [...net.places, ...net.transitions, ...net.arcs].filter(
      (e) => !originalIds.has(e.id),
    );
    expect(created).toHaveLength(3);
    const newPlace = net.places[2];
    expect(newPlace?.position).toEqual({ x: 40, y: 40 });
    expect(newPlace?.name).toBe('P3');
    expect(net.marking[newPlace?.id as string]).toEqual([1, 1]);
    expect(store().selection).toHaveLength(3);
    // Pasting again shifts further.
    store().paste();
    expect(store().net.places[3]?.position).toEqual({ x: 80, y: 80 });
  });

  it('ignores copying an empty selection and pasting without a clipboard', () => {
    buildSmallNet();
    store().select([]);
    store().copy();
    expect(store().clipboard).toBeNull();
    store().paste();
    expect(store().net.places).toHaveLength(2);
  });

  it('cuts and duplicates', () => {
    const { p1 } = buildSmallNet();
    store().select([p1]);
    store().duplicate();
    expect(store().net.places).toHaveLength(3);
    store().cut();
    expect(store().net.places).toHaveLength(2);
    expect(store().clipboard?.places).toHaveLength(1);
    store().paste();
    expect(store().net.places).toHaveLength(3);
  });

  it('select all selects every element', () => {
    buildSmallNet();
    store().selectAll();
    expect(store().selection).toHaveLength(5);
  });
});

describe('tools and rename state', () => {
  it('resets the arc source when the tool changes', () => {
    store().setTool('arc');
    store().setArcSource('x');
    store().setTool('place');
    expect(store().arcSource).toBeNull();
    expect(store().tool).toBe('place');
  });
});

describe('files', () => {
  it('loads a net, resets history and marks it saved', () => {
    buildSmallNet();
    const net: PetriNet = parseNetText(serializeNet({ ...createEmptyNet('Loaded') }));
    store().loadNet(net, 'loaded.pn.json');
    expect(store().net.name).toBe('Loaded');
    expect(store().fileName).toBe('loaded.pn.json');
    expect(store().past).toHaveLength(0);
    expect(selectIsDirty(store())).toBe(false);
    expect(store().docVersion).toBeGreaterThan(0);
  });

  it('markSaved clears the dirty flag', () => {
    store().addPlace({ x: 0, y: 0 });
    expect(selectIsDirty(store())).toBe(true);
    store().markSaved('x.pn.json');
    expect(selectIsDirty(store())).toBe(false);
    expect(store().fileName).toBe('x.pn.json');
  });
});

describe('simulation', () => {
  it('fires enabled transitions, records history and resets', () => {
    const { p1, p2, t1 } = buildSmallNet();
    store().startSimulation();
    expect(store().mode).toBe('simulate');
    store().fireTransition(t1);
    expect(markingToCounts(store().simMarking ?? {})).toEqual({ [p1]: 1, [p2]: 1 });
    expect(store().simHistory).toEqual([
      { index: 1, transitionId: t1, transitionName: 'T1', binding: {} },
    ]);
    store().fireTransition(t1);
    store().fireTransition(t1); // not enabled any more: ignored
    expect(store().simHistory).toHaveLength(2);
    expect(store().net.marking[p1]).toHaveLength(2); // the document is untouched
    store().resetSimulation();
    expect(store().simHistory).toHaveLength(0);
    expect(markingToCounts(store().simMarking ?? {})[p1]).toBe(2);
  });

  it('steps randomly and reports deadlocks', () => {
    const { t1 } = buildSmallNet();
    store().startSimulation();
    expect(store().stepRandom(() => 0)).toBe(t1);
    expect(store().stepRandom(() => 0.99)).toBe(t1);
    expect(store().stepRandom()).toBeNull();
    expect(useUiStore.getState().toasts.at(-1)?.message).toMatch(/No transition is enabled/);
  });

  it('locks editing while simulating and restores it afterwards', () => {
    const { p1 } = buildSmallNet();
    store().startSimulation();
    const before = store().net;
    expect(store().addPlace({ x: 0, y: 0 })).toBeNull();
    store().updatePlace(p1, { name: 'nope' });
    store().undo();
    store().setTool('place');
    expect(store().net).toBe(before);
    expect(store().tool).toBe('select');
    store().stopSimulation();
    expect(store().mode).toBe('edit');
    expect(store().simMarking).toBeNull();
    expect(store().addPlace({ x: 0, y: 0 })).not.toBeNull();
  });

  it('ignores simulation actions in edit mode', () => {
    const { t1 } = buildSmallNet();
    store().fireTransition(t1);
    expect(store().stepRandom()).toBeNull();
    store().resetSimulation();
    expect(store().simHistory).toHaveLength(0);
  });
});

describe('higher nets: profile and types', () => {
  it('switches the profile as an undoable edit', () => {
    expect(store().net.profile).toBe('pt-net');
    store().setProfile('json-net');
    expect(store().net.profile).toBe('json-net');
    expect(selectCanUndo(store())).toBe(true);
    store().undo();
    expect(store().net.profile).toBe('pt-net');
    store().redo();
    expect(store().net.profile).toBe('json-net');
  });

  it('keeps types, guards and inscriptions when going back to a P/T net', () => {
    store().setProfile('json-net');
    const { p1, t1 } = buildSmallNet();
    expect(store().saveType(null, 'Count', { type: 'integer' })).toBe(true);
    store().setPlaceType(p1, 'Count');
    store().updateTransition(t1, { guard: '$n > 0' });
    store().setProfile('pt-net');
    expect(store().net.types).toHaveProperty('Count');
    expect(store().net.places[0]?.type).toBe('Count');
    expect(store().net.transitions[0]?.guard).toBe('$n > 0');
    expect(store().diagnostics.map((d) => d.code)).toContain('INSCRIPTION_ON_PT_NET');
  });

  it('creates, renames, updates, duplicates and deletes types, each as one undo step', () => {
    store().setProfile('json-net');
    const p = store().addPlace({ x: 0, y: 0 }) as string;
    expect(store().saveType(null, 'Order', { type: 'object' })).toBe(true);
    store().setPlaceType(p, 'Order');
    const steps = store().past.length;

    expect(store().saveType('Order', 'Purchase', { type: 'object', required: ['id'] })).toBe(true);
    expect(store().past.length).toBe(steps + 1);
    expect(Object.keys(store().net.types)).toEqual(['Purchase']);
    expect(store().net.places[0]?.type).toBe('Purchase');
    expect(store().net.types['Purchase']).toEqual({ type: 'object', required: ['id'] });

    expect(store().duplicateType('Purchase')).toBe('PurchaseCopy');
    expect(Object.keys(store().net.types)).toEqual(['Purchase', 'PurchaseCopy']);

    store().removeType('Purchase');
    expect(store().net.places[0]?.type).toBeUndefined();
    store().undo();
    expect(store().net.places[0]?.type).toBe('Purchase');
  });

  it('refuses invalid or duplicate type names with a message', () => {
    expect(store().saveType(null, 'A', { type: 'string' })).toBe(true);
    expect(store().saveType(null, 'A', { type: 'string' })).toBe(false);
    expect(store().saveType(null, '1x', { type: 'string' })).toBe(false);
    expect(useUiStore.getState().toasts.some((t) => t.kind === 'error')).toBe(true);
  });

  it('reports type diagnostics in the status list', () => {
    store().setProfile('json-net');
    const p = store().addPlace({ x: 0, y: 0 }) as string;
    store().saveType(null, 'Count', { type: 'integer' });
    store().setPlaceType(p, 'Count');
    store().addToken(p, 'not a number');
    expect(store().diagnostics.map((d) => d.code)).toContain('TOKEN_TYPE_MISMATCH');
    store().updateToken(p, 0, 7);
    expect(store().diagnostics.map((d) => d.code)).not.toContain('TOKEN_TYPE_MISMATCH');
  });
});

describe('higher nets: tokens', () => {
  it('adds typed starting values, edits, duplicates and removes tokens', () => {
    store().setProfile('json-net');
    const p = store().addPlace({ x: 0, y: 0 }) as string;
    store().saveType(null, 'Order', {
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'string' } },
    });
    store().setPlaceType(p, 'Order');
    store().addToken(p);
    expect(store().net.marking[p]).toEqual([{ id: '' }]);
    store().updateToken(p, 0, { id: 'A-1' });
    store().duplicateToken(p, 0);
    expect(store().net.marking[p]).toEqual([{ id: 'A-1' }, { id: 'A-1' }]);
    store().removeToken(p, 0);
    expect(store().net.marking[p]).toEqual([{ id: 'A-1' }]);
    store().setPlaceTokens(p, []);
    expect(store().net.marking[p]).toBeUndefined();
  });

  it('respects the capacity when adding tokens', () => {
    store().setProfile('json-net');
    const p = store().addPlace({ x: 0, y: 0 }) as string;
    store().updatePlace(p, { capacity: 1 });
    store().addToken(p, 'a');
    store().addToken(p, 'b');
    expect(store().net.marking[p]).toEqual(['a']);
    expect(useUiStore.getState().toasts.at(-1)?.message).toMatch(/capacity 1/);
  });

  it('adjusts token counts without losing the values of a JSON net', () => {
    store().setProfile('json-net');
    const p = store().addPlace({ x: 0, y: 0 }) as string;
    store().setPlaceTokens(p, ['x', 'y']);
    store().select([p]);
    store().adjustTokens(1);
    expect(store().net.marking[p]).toHaveLength(3);
    expect(store().net.marking[p]?.slice(0, 2)).toEqual(['x', 'y']);
    store().adjustTokens(-2);
    expect(store().net.marking[p]).toEqual(['x']);
  });
});

/** A JSON net with one input place holding `tokens` and a doubling transition. */
function buildJsonNet(tokens: number[]): { p: string; q: string; t: string } {
  store().setProfile('json-net');
  const p = store().addPlace({ x: 0, y: 0 }) as string;
  const t = store().addTransition({ x: 100, y: 0 }) as string;
  const q = store().addPlace({ x: 200, y: 0 }) as string;
  const a1 = store().addArc(p, t) as string;
  const a2 = store().addArc(t, q) as string;
  store().updateArc(a1, { inscription: '$n' });
  store().updateArc(a2, { inscription: '$n * 2' });
  store().setPlaceTokens(p, tokens);
  return { p, q, t };
}

const settled = () =>
  vi.waitFor(() => {
    expect(store().computing).toBe(false);
  });

describe('simulation of JSON nets', () => {
  it('computes bindings asynchronously and fires a chosen one', async () => {
    const { p, q, t } = buildJsonNet([1, 2, 3]);
    store().startSimulation();
    expect(store().computing).toBe(true);
    expect(store().enabled.size).toBe(0);
    store().fireTransition(t); // ignored while computing
    expect(store().simHistory).toHaveLength(0);
    await settled();
    expect(
      store()
        .enabled.get(t)
        ?.bindings.map((b) => b.binding),
    ).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);

    store().fireTransition(t); // several bindings: opens the list instead of firing
    expect(store().picker).toBe(t);
    expect(store().simHistory).toHaveLength(0);
    store().fireBindingAt(t, 1);
    expect(store().picker).toBeNull();
    expect(store().simMarking).toEqual({ [p]: [1, 3], [q]: [4] });
    expect(store().simHistory).toMatchObject([{ transitionId: t, binding: { n: 2 } }]);
    await settled();
    expect(store().enabled.get(t)?.bindings).toHaveLength(2);
    expect(store().net.marking[p]).toEqual([1, 2, 3]); // the document is untouched
  });

  it('fires directly when there is exactly one binding', async () => {
    const { q, t } = buildJsonNet([5]);
    store().startSimulation();
    await settled();
    store().fireTransition(t);
    expect(store().picker).toBeNull();
    expect(store().simMarking).toEqual({ [q]: [10] });
    await settled();
    expect(store().enabled.size).toBe(0);
  });

  it('steps randomly through transitions and bindings', async () => {
    const { q, t } = buildJsonNet([1, 2, 3]);
    store().startSimulation();
    await settled();
    expect(store().stepRandom(() => 0.99)).toBe(t);
    expect(store().simMarking?.[q]).toEqual([6]);
    await settled();
    expect(store().stepRandom(() => 0)).toBe(t);
    expect(store().simMarking?.[q]).toEqual([6, 2]);
  });

  it('discards the result of an outdated computation', async () => {
    const { p, t } = buildJsonNet([1, 2, 3]);
    store().startSimulation();
    store().stopSimulation();
    store().setPlaceTokens(p, [7]);
    store().startSimulation();
    await settled();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(
      store()
        .enabled.get(t)
        ?.bindings.map((b) => b.binding),
    ).toEqual([{ n: 7 }]);
  });

  it('collects evaluation problems for the status bar and clears them on exit', async () => {
    const { t } = buildJsonNet([1]);
    store().updateTransition(t, { guard: '$n.missing.deep' });
    store().startSimulation();
    await settled();
    expect(store().simDiagnostics.map((d) => d.code)).toEqual(['GUARD_ERROR']);
    store().stopSimulation();
    expect(store().simDiagnostics).toEqual([]);
  });

  it('keeps P/T simulation synchronous', () => {
    const { t1 } = buildSmallNet();
    store().startSimulation();
    expect(store().computing).toBe(false);
    expect([...store().enabled.keys()]).toEqual([t1]);
  });
});
