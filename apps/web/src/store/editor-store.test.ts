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
import { toastDuration, useUiStore } from './ui-store';

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

/** Waits until the engine has answered everything that was asked of it. */
const settled = () =>
  vi.waitFor(() => {
    expect(store().computing).toBe(false);
  });

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

  describe('between nets', () => {
    const integer = { type: 'integer' };
    const text = { type: 'string' };

    /** A JSON net with one place of type `Hops` and the given schema; it is copied to the clipboard. */
    function copyTypedPlace(schema: unknown): void {
      store().newNet();
      store().setProfile('json-net');
      const place = store().addPlace({ x: 0, y: 0 }) as string;
      store().saveType(null, 'Hops', schema);
      store().setPlaceType(place, 'Hops');
      store().select([place]);
      store().copy();
    }

    it('takes the types of the copied places along into a net that lacks them', () => {
      copyTypedPlace(integer);
      expect(store().clipboard?.types).toEqual({ Hops: integer });
      store().newNet();
      store().setProfile('json-net');
      store().paste();
      expect(store().net.types).toEqual({ Hops: integer });
      expect(store().net.places[0]?.type).toBe('Hops');
      expect(store().diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(useUiStore.getState().toasts[0]?.message).toContain('Hops');
    });

    it('uses a type of the same name and schema that the net already has', () => {
      copyTypedPlace(integer);
      store().newNet();
      store().setProfile('json-net');
      store().saveType(null, 'Hops', { type: 'integer' });
      store().paste();
      expect(Object.keys(store().net.types)).toEqual(['Hops']);
      expect(store().net.places[0]?.type).toBe('Hops');
      expect(useUiStore.getState().toasts).toHaveLength(0);
    });

    it('adds a type under a new name when the name is taken by another schema', () => {
      copyTypedPlace(integer);
      store().newNet();
      store().setProfile('json-net');
      store().saveType(null, 'Hops', text);
      store().paste();
      expect(store().net.types).toEqual({ Hops: text, Hops_2: integer });
      expect(store().net.places[0]?.type).toBe('Hops_2');
      // Pasting again reuses the type that the first paste created.
      store().paste();
      expect(Object.keys(store().net.types)).toEqual(['Hops', 'Hops_2']);
      expect(store().net.places.map((p) => p.type)).toEqual(['Hops_2', 'Hops_2']);
      expect(useUiStore.getState().toasts[0]?.message).toContain('Hops became Hops_2');
    });

    it('leaves the types alone when a fragment is duplicated in its own net', () => {
      copyTypedPlace(integer);
      store().duplicate();
      expect(Object.keys(store().net.types)).toEqual(['Hops']);
    });
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
  it('fires enabled transitions, records history and resets', async () => {
    const { p1, p2, t1 } = buildSmallNet();
    store().startSimulation();
    expect(store().mode).toBe('simulate');
    await settled();
    store().fireTransition(t1);
    await settled();
    expect(markingToCounts(store().simMarking ?? {})).toEqual({ [p1]: 1, [p2]: 1 });
    expect(store().simHistory).toEqual([
      { index: 1, transitionId: t1, transitionName: 'T1', binding: {} },
    ]);
    store().fireTransition(t1);
    await settled();
    store().fireTransition(t1); // not enabled any more: ignored
    await settled();
    expect(store().simHistory).toHaveLength(2);
    expect(store().net.marking[p1]).toHaveLength(2); // the document is untouched
    await store().resetSimulation();
    expect(store().simHistory).toHaveLength(0);
    expect(markingToCounts(store().simMarking ?? {})[p1]).toBe(2);
  });

  it('steps randomly and reports deadlocks', async () => {
    const { p2 } = buildSmallNet();
    store().startSimulation();
    await settled();
    await store().stepRandom();
    await store().stepRandom();
    expect(markingToCounts(store().simMarking ?? {})).toEqual({ [p2]: 2 });
    expect(store().simHistory).toHaveLength(2);
    await store().stepRandom();
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

  it('ignores simulation actions in edit mode', async () => {
    const { t1 } = buildSmallNet();
    store().fireTransition(t1);
    await store().stepRandom();
    await store().resetSimulation();
    store().setPlaying(true);
    expect(store().simPlaying).toBe(false);
    expect(store().simHistory).toHaveLength(0);
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

describe('simulation of JSON nets', () => {
  it('computes bindings asynchronously and fires a chosen one', async () => {
    const { p, q, t } = buildJsonNet([1, 2, 3]);
    store().startSimulation();
    expect(store().computing).toBe(true);
    expect(store().enabled.size).toBe(0);
    store().fireTransition(t); // kept until the first answer, then it opens the list
    expect(store().simHistory).toHaveLength(0);
    expect(store().picker).toBeNull();
    await settled();
    expect(
      store()
        .enabled.get(t)
        ?.bindings.map((b) => b.binding),
    ).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);

    // Several bindings: the kept click opened the list instead of firing.
    expect(store().picker).toBe(t);
    expect(store().simHistory).toHaveLength(0);
    store().fireBindingAt(t, 1);
    expect(store().picker).toBeNull();
    await settled();
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
    await settled();
    expect(store().simMarking).toEqual({ [q]: [10] });
    expect(store().enabled.size).toBe(0);
  });

  it('steps randomly through transitions and bindings', async () => {
    const { q, t } = buildJsonNet([1, 2, 3]);
    store().startSimulation();
    await settled();
    await store().stepRandom();
    expect(store().simHistory.map((step) => step.transitionId)).toEqual([t]);
    expect(store().simMarking?.[q]).toHaveLength(1);
    await store().stepRandom();
    expect(store().simMarking?.[q]).toHaveLength(2);
    // Each token is doubled, whichever binding was chosen.
    expect(store().simMarking?.[q]?.every((n) => [2, 4, 6].includes(n as number))).toBe(true);
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

  it('computes the enabled transitions of a P/T net as well', async () => {
    const { t1 } = buildSmallNet();
    store().startSimulation();
    await settled();
    expect([...store().enabled.keys()]).toEqual([t1]);
  });
});

describe('sticky tools', () => {
  it('keeps a sticky tool active after placing until Escape or another tool', () => {
    store().setTool('place', true);
    expect(store().toolSticky).toBe(true);
    store().placeWithTool({ x: 0, y: 0 }, { keepTool: false, rename: false });
    store().placeWithTool({ x: 100, y: 0 }, { keepTool: false, rename: false });
    expect(store().net.places).toHaveLength(2);
    expect(store().tool).toBe('place');
    store().setTool('select');
    expect(store().tool).toBe('select');
    expect(store().toolSticky).toBe(false);
  });

  it('falls back to Select after one element without stickiness, unless the tool is kept', () => {
    store().setTool('transition');
    store().placeWithTool({ x: 0, y: 0 }, { keepTool: true, rename: false });
    expect(store().tool).toBe('transition');
    store().placeWithTool({ x: 100, y: 0 }, { keepTool: false, rename: false });
    expect(store().tool).toBe('select');
    expect(store().net.transitions).toHaveLength(2);
  });

  it('toggles stickiness on double click and never for the select tool', () => {
    store().toggleStickyTool('arc');
    expect(store()).toMatchObject({ tool: 'arc', toolSticky: true });
    store().toggleStickyTool('arc');
    expect(store()).toMatchObject({ tool: 'arc', toolSticky: false });
    store().toggleStickyTool('select');
    expect(store().toolSticky).toBe(false);
    store().setTool('place', true);
    store().setTool('annotation');
    expect(store().toolSticky).toBe(false);
  });

  it('is turned off by loading a document and while simulating', () => {
    store().setTool('place', true);
    store().newNet();
    expect(store().toolSticky).toBe(false);
    store().setTool('place', true);
    store().startSimulation();
    expect(store()).toMatchObject({ tool: 'select', toolSticky: false });
  });
});

describe('extendFrom (Tab chain)', () => {
  it('adds a transition to the right of a place, connects and selects it, and starts renaming', () => {
    const p = store().addPlace({ x: 100, y: 100 }) as string;
    const t = store().extendFrom(p, 1);
    expect(t).not.toBeNull();
    const created = store().net.transitions.find((x) => x.id === t);
    expect(created?.position).toEqual({ x: 260, y: 100 });
    expect(store().net.arcs).toHaveLength(1);
    expect(store().net.arcs[0]).toMatchObject({ source: p, target: t });
    expect(store().selection).toEqual([t]);
    expect(store().renamingId).toBe(t);
  });

  it('adds the predecessor on the left with the arc pointing at the node', () => {
    const t = store().addTransition({ x: 300, y: 100 }) as string;
    const p = store().extendFrom(t, -1) as string;
    expect(store().net.places.find((x) => x.id === p)?.position).toEqual({ x: 140, y: 100 });
    expect(store().net.arcs[0]).toMatchObject({ source: p, target: t });
  });

  it('moves a second successor below the first', () => {
    const p = store().addPlace({ x: 0, y: 0 }) as string;
    store().extendFrom(p, 1);
    const second = store().extendFrom(p, 1) as string;
    expect(store().net.transitions.find((x) => x.id === second)?.position).toEqual({
      x: 160,
      y: 80,
    });
  });

  it('is one undo step per node, including its first name', () => {
    const p = store().addPlace({ x: 0, y: 0 }) as string;
    const before = store().past.length;
    const t = store().extendFrom(p, 1) as string;
    store().renameElement(t, 'start');
    expect(store().net.transitions.find((x) => x.id === t)?.name).toBe('start');
    expect(store().past.length).toBe(before + 1);
    store().startRename(null);
    store().undo();
    expect(store().net.transitions).toHaveLength(0);
    expect(store().net.arcs).toHaveLength(0);
    store().redo();
    expect(store().net.transitions[0]?.name).toBe('start');
  });

  it('records a later rename as its own step', () => {
    const p = store().addPlace({ x: 0, y: 0 }) as string;
    const t = store().extendFrom(p, 1) as string;
    store().startRename(null);
    const steps = store().past.length;
    store().renameElement(t, 'later');
    expect(store().past.length).toBe(steps + 1);
  });

  it('refuses notes, unknown ids and the simulation', () => {
    const note = store().addAnnotation({ x: 0, y: 0 }) as string;
    expect(store().extendFrom(note, 1)).toBeNull();
    expect(store().extendFrom('nope', 1)).toBeNull();
    const p = store().addPlace({ x: 0, y: 100 }) as string;
    store().startSimulation();
    expect(store().extendFrom(p, 1)).toBeNull();
    expect(useUiStore.getState().toasts).toHaveLength(0);
  });

  it('renames places, transitions and notes through renameElement', () => {
    const p = store().addPlace({ x: 0, y: 0 }) as string;
    const t = store().addTransition({ x: 100, y: 0 }) as string;
    const n = store().addAnnotation({ x: 0, y: 100 }) as string;
    store().renameElement(p, 'Buffer');
    store().renameElement(t, 'go');
    store().renameElement(n, 'a note');
    expect(store().net.places[0]?.name).toBe('Buffer');
    expect(store().net.transitions[0]?.name).toBe('go');
    expect(store().net.annotations?.[0]?.text).toBe('a note');
  });
});

describe('toasts', () => {
  it('shows only the latest toast', () => {
    const ui = useUiStore.getState();
    ui.notify('success', 'Saved a.pn.json');
    ui.notify('error', 'Something failed');
    const toasts = useUiStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.message).toBe('Something failed');
  });

  it('lasts 2.5 s for results and 6 s for errors and toasts with an action', () => {
    expect(toastDuration({ kind: 'success' })).toBe(2500);
    expect(toastDuration({ kind: 'info' })).toBe(2500);
    expect(toastDuration({ kind: 'error' })).toBe(6000);
    expect(toastDuration({ kind: 'info', action: { label: 'Undo', run: () => undefined } })).toBe(
      6000,
    );
  });
});
