import {
  addAnnotation as coreAddAnnotation,
  addArc as coreAddArc,
  addPlace as coreAddPlace,
  addToken as coreAddToken,
  addTransition as coreAddTransition,
  addType as coreAddType,
  alignNodes,
  canConnect,
  countsToMarking,
  createEmptyNet,
  createId,
  distributeNodes,
  enabledTransitions,
  exampleToken,
  extractFragment,
  findArc,
  fire,
  insertFragment,
  isEmptyFragment,
  markingToCounts,
  moveNodes as coreMoveNodes,
  NetOpError,
  removeElements,
  removeToken as coreRemoveToken,
  removeType as coreRemoveType,
  renameNet as coreRenameNet,
  renameType as coreRenameType,
  reverseArc as coreReverseArc,
  setInitialTokens,
  setPlaceType as corePlaceType,
  setProfile as coreSetProfile,
  setTokens as coreSetTokens,
  setWeight,
  uniqueName,
  updateAnnotation as coreUpdateAnnotation,
  updateArc as coreUpdateArc,
  updateNode,
  updateToken as coreUpdateToken,
  updateType as coreUpdateType,
  validate,
  type AlignMode,
  type Annotation,
  type Arc,
  type Diagnostic,
  type DistributeAxis,
  type Id,
  type Marking,
  type NetFragment,
  type PetriNet,
  type Place,
  type Position,
  type Profile,
  type Token,
  type Transition,
} from '@pnm/core';
import { create } from 'zustand';
import { en } from '../i18n/en';
import { notify } from './ui-store';

export type Tool = 'select' | 'place' | 'transition' | 'arc' | 'annotation';
export type Mode = 'edit' | 'simulate';

export interface SimStep {
  index: number;
  transitionId: Id;
  transitionName: string;
}

/** Maximum number of undo steps kept in memory. */
export const HISTORY_LIMIT = 200;

/** Distance between a copy and its original when pasting or duplicating. */
export const PASTE_OFFSET = 40;

export interface EditorState {
  /** The document. Only this part is covered by undo and redo. */
  net: PetriNet;
  past: PetriNet[];
  future: PetriNet[];
  /** The net as last saved or loaded; the document is dirty when `net` differs. */
  savedNet: PetriNet;
  fileName: string | null;
  /** Incremented whenever a different document is loaded; the canvas refits its view. */
  docVersion: number;

  selection: Id[];
  tool: Tool;
  mode: Mode;
  /** First click of the two-click arc tool. */
  arcSource: Id | null;
  /** Element whose name is being edited in place. */
  renamingId: Id | null;
  /** Positions of nodes while they are being dragged (not part of the document). */
  dragPositions: Record<Id, Position> | null;

  simMarking: Marking | null;
  simHistory: SimStep[];

  diagnostics: Diagnostic[];
  clipboard: NetFragment | null;
  pasteCount: number;

  // Document actions
  addPlace(position: Position): Id | null;
  addTransition(position: Position): Id | null;
  addAnnotation(position: Position): Id | null;
  addArc(source: Id, target: Id): Id | null;
  removeSelected(): void;
  updatePlace(id: Id, patch: Partial<Omit<Place, 'id'>>): void;
  updateTransition(id: Id, patch: Partial<Omit<Transition, 'id'>>): void;
  updateArc(id: Id, patch: Partial<Omit<Arc, 'id' | 'source' | 'target'>>): void;
  updateAnnotation(id: Id, patch: Partial<Omit<Annotation, 'id'>>): void;
  reverseArc(id: Id): void;
  moveNodes(moves: Record<Id, Position>): void;
  nudgeSelected(dx: number, dy: number): void;
  setTokens(placeId: Id, count: number): void;
  adjustTokens(delta: number): void;
  /** Replaces the initial tokens of a place (JSON nets). */
  setPlaceTokens(placeId: Id, tokens: Token[]): void;
  addToken(placeId: Id, token?: Token): void;
  updateToken(placeId: Id, index: number, token: Token): void;
  removeToken(placeId: Id, index: number): void;
  duplicateToken(placeId: Id, index: number): void;
  setProfile(profile: Profile): void;
  /**
   * Creates a type (`original` is `null`) or changes an existing one, including a rename.
   * One undo step. Returns false if the change was rejected.
   */
  saveType(original: string | null, name: string, schema: unknown): boolean;
  duplicateType(name: string): string | null;
  removeType(name: string): void;
  setPlaceType(placeId: Id, type: string | undefined): void;
  renameNet(name: string): void;
  align(mode: AlignMode): void;
  distribute(axis: DistributeAxis): void;
  applyLayout(positions: Record<Id, Position>): void;

  // History
  undo(): void;
  redo(): void;

  // Clipboard
  copy(): void;
  cut(): void;
  paste(): void;
  duplicate(): void;

  // Selection and tools
  select(ids: Id[]): void;
  selectAll(): void;
  clearSelection(): void;
  setTool(tool: Tool): void;
  setArcSource(id: Id | null): void;
  startRename(id: Id | null): void;
  setDragPositions(positions: Record<Id, Position> | null): void;

  // Files
  newNet(): void;
  loadNet(net: PetriNet, fileName?: string | null): void;
  markSaved(fileName: string): void;

  // Simulation
  startSimulation(): void;
  stopSimulation(): void;
  fireTransition(id: Id): void;
  stepRandom(random?: () => number): Id | null;
  resetSimulation(): void;
}

function freshNet(name: string = en.app.untitled): PetriNet {
  return createEmptyNet(name);
}

function allIds(net: PetriNet): Id[] {
  return [
    ...net.places.map((p) => p.id),
    ...net.transitions.map((t) => t.id),
    ...net.arcs.map((a) => a.id),
    ...(net.annotations ?? []).map((a) => a.id),
  ];
}

function prune(selection: Id[], net: PetriNet): Id[] {
  const existing = new Set(allIds(net));
  const kept = selection.filter((id) => existing.has(id));
  return kept.length === selection.length ? selection : kept;
}

/** True if applying `patch` would not change `target`. */
function isNoop(target: object, patch: object): boolean {
  const current = target as Record<string, unknown>;
  return Object.entries(patch).every(([key, value]) => {
    const existing = current[key];
    if (typeof value === 'object' && value !== null) {
      return JSON.stringify(existing) === JSON.stringify(value);
    }
    return existing === value;
  });
}

const initialNet = freshNet();

export const useEditorStore = create<EditorState>()((set, get) => {
  /** Replaces the document by `next` and records an undo step. */
  const commit = (next: PetriNet, selection?: Id[]): void => {
    const { net, past } = get();
    if (next === net) return;
    set({
      net: next,
      past: [...past.slice(-(HISTORY_LIMIT - 1)), net],
      future: [],
      diagnostics: validate(next),
      selection: prune(selection ?? get().selection, next),
    });
  };

  /** Runs a document edit if the editor is not locked; reports operation errors. */
  const edit = (change: (net: PetriNet) => PetriNet, selection?: Id[]): boolean => {
    if (get().mode === 'simulate') {
      notify('info', en.messages.editLocked);
      return false;
    }
    try {
      commit(change(get().net), selection);
      return true;
    } catch (error) {
      if (error instanceof NetOpError) {
        notify('error', error.message);
        return false;
      }
      throw error;
    }
  };

  const replaceDocument = (net: PetriNet, fileName: string | null): void => {
    set({
      net,
      savedNet: net,
      fileName,
      past: [],
      future: [],
      docVersion: get().docVersion + 1,
      selection: [],
      diagnostics: validate(net),
      mode: 'edit',
      tool: 'select',
      arcSource: null,
      renamingId: null,
      dragPositions: null,
      simMarking: null,
      simHistory: [],
    });
  };

  return {
    net: initialNet,
    past: [],
    future: [],
    savedNet: initialNet,
    fileName: null,
    docVersion: 0,

    selection: [],
    tool: 'select',
    mode: 'edit',
    arcSource: null,
    renamingId: null,
    dragPositions: null,

    simMarking: null,
    simHistory: [],

    diagnostics: validate(initialNet),
    clipboard: null,
    pasteCount: 0,

    addPlace(position) {
      const id = createId();
      return edit((net) => coreAddPlace(net, { id, position }), [id]) ? id : null;
    },
    addTransition(position) {
      const id = createId();
      return edit((net) => coreAddTransition(net, { id, position }), [id]) ? id : null;
    },
    addAnnotation(position) {
      const id = createId();
      return edit((net) => coreAddAnnotation(net, { id, position }), [id]) ? id : null;
    },
    addArc(source, target) {
      const check = canConnect(get().net, source, target);
      if (!check.ok) {
        notify('error', check.reason);
        return null;
      }
      const existing = findArc(get().net, source, target);
      if (existing) {
        const weight = existing.weight + 1;
        if (edit((net) => setWeight(net, existing.id, weight), [existing.id])) {
          notify('info', en.messages.arcExistsWeight(weight));
          return existing.id;
        }
        return null;
      }
      const id = createId();
      return edit((net) => coreAddArc(net, source, target, { id }), [id]) ? id : null;
    },
    removeSelected() {
      const { selection } = get();
      if (selection.length === 0) return;
      edit((net) => removeElements(net, selection), []);
    },
    updatePlace(id, patch) {
      const place = get().net.places.find((p) => p.id === id);
      if (!place || isNoop(place, patch)) return;
      edit((net) => updateNode(net, id, patch));
    },
    updateTransition(id, patch) {
      const transition = get().net.transitions.find((t) => t.id === id);
      if (!transition || isNoop(transition, patch)) return;
      edit((net) => updateNode(net, id, patch));
    },
    updateArc(id, patch) {
      const arc = get().net.arcs.find((a) => a.id === id);
      if (!arc || isNoop(arc, patch)) return;
      edit((net) => coreUpdateArc(net, id, patch));
    },
    updateAnnotation(id, patch) {
      const annotation = get().net.annotations?.find((a) => a.id === id);
      if (!annotation || isNoop(annotation, patch)) return;
      edit((net) => coreUpdateAnnotation(net, id, patch));
    },
    reverseArc(id) {
      edit((net) => coreReverseArc(net, id));
    },
    moveNodes(moves) {
      const { net } = get();
      const items = [...net.places, ...net.transitions, ...(net.annotations ?? [])];
      const changed = items.some((item) => {
        const to = moves[item.id];
        return to !== undefined && (to.x !== item.position.x || to.y !== item.position.y);
      });
      if (!changed) return;
      edit((current) => coreMoveNodes(current, moves));
    },
    nudgeSelected(dx, dy) {
      const { net, selection } = get();
      const selected = new Set(selection);
      const moves: Record<Id, Position> = {};
      for (const item of [...net.places, ...net.transitions, ...(net.annotations ?? [])]) {
        if (selected.has(item.id)) {
          moves[item.id] = { x: item.position.x + dx, y: item.position.y + dy };
        }
      }
      if (Object.keys(moves).length > 0) get().moveNodes(moves);
    },
    setTokens(placeId, count) {
      const place = get().net.places.find((p) => p.id === placeId);
      if (!place) return;
      let target = Math.max(0, Math.round(count));
      if (place.capacity !== undefined && target > place.capacity) {
        target = place.capacity;
        notify('info', en.messages.capacityReached(place.capacity));
      }
      if ((get().net.marking[placeId]?.length ?? 0) === target) return;
      edit((net) => setInitialTokens(net, placeId, target));
    },
    adjustTokens(delta) {
      const { net, selection } = get();
      const places = net.places.filter((p) => selection.includes(p.id));
      if (places.length === 0) return;
      edit((current) => {
        let next = current;
        for (const place of places) {
          const tokens = current.marking[place.id] ?? [];
          let target = Math.max(0, tokens.length + delta);
          if (place.capacity !== undefined) target = Math.min(target, place.capacity);
          if (current.profile === 'json-net') {
            // Typed tokens keep their values: drop the last ones or add a starting value.
            const sample = exampleToken(
              place.type === undefined ? undefined : current.types[place.type],
            );
            const adjusted = [...tokens.slice(0, target)];
            while (adjusted.length < target) adjusted.push(structuredClone(sample));
            next = coreSetTokens(next, place.id, adjusted);
          } else {
            next = setInitialTokens(next, place.id, target);
          }
        }
        return next;
      });
    },
    setPlaceTokens(placeId, tokens) {
      edit((net) => coreSetTokens(net, placeId, tokens));
    },
    addToken(placeId, token) {
      const { net } = get();
      const place = net.places.find((p) => p.id === placeId);
      if (!place) return;
      if (place.capacity !== undefined && (net.marking[placeId]?.length ?? 0) >= place.capacity) {
        notify('info', en.messages.capacityReached(place.capacity));
        return;
      }
      const value =
        token ?? exampleToken(place.type === undefined ? undefined : net.types[place.type]);
      edit((current) => coreAddToken(current, placeId, value));
    },
    updateToken(placeId, index, token) {
      edit((net) => coreUpdateToken(net, placeId, index, token));
    },
    removeToken(placeId, index) {
      edit((net) => coreRemoveToken(net, placeId, index));
    },
    duplicateToken(placeId, index) {
      const token = get().net.marking[placeId]?.[index];
      if (token !== undefined) get().addToken(placeId, structuredClone(token));
    },
    setProfile(profile) {
      if (profile === get().net.profile) return;
      edit((net) => coreSetProfile(net, profile));
    },
    saveType(original, name, schema) {
      const trimmed = name.trim();
      return edit((net) => {
        let next = net;
        if (original === null) return coreAddType(next, trimmed, schema);
        if (original !== trimmed) next = coreRenameType(next, original, trimmed);
        return coreUpdateType(next, trimmed, schema);
      });
    },
    duplicateType(name) {
      const schema = get().net.types[name];
      if (schema === undefined) return null;
      const copy = uniqueName(Object.keys(get().net.types), `${name}Copy`);
      return edit((net) => coreAddType(net, copy, structuredClone(schema))) ? copy : null;
    },
    removeType(name) {
      edit((net) => coreRemoveType(net, name));
    },
    setPlaceType(placeId, type) {
      const place = get().net.places.find((p) => p.id === placeId);
      if (!place || place.type === type) return;
      edit((net) => corePlaceType(net, placeId, type));
    },
    renameNet(name) {
      if (name === get().net.name) return;
      edit((net) => coreRenameNet(net, name));
    },
    align(mode) {
      edit((net) => alignNodes(net, get().selection, mode));
    },
    distribute(axis) {
      edit((net) => distributeNodes(net, get().selection, axis));
    },
    applyLayout(positions) {
      get().moveNodes(positions);
    },

    undo() {
      const { past, future, net, mode } = get();
      const previous = past[past.length - 1];
      if (mode === 'simulate' || previous === undefined) return;
      set({
        net: previous,
        past: past.slice(0, -1),
        future: [net, ...future],
        diagnostics: validate(previous),
        selection: prune(get().selection, previous),
        renamingId: null,
      });
    },
    redo() {
      const { past, future, net, mode } = get();
      const next = future[0];
      if (mode === 'simulate' || next === undefined) return;
      set({
        net: next,
        past: [...past, net],
        future: future.slice(1),
        diagnostics: validate(next),
        selection: prune(get().selection, next),
        renamingId: null,
      });
    },

    copy() {
      const fragment = extractFragment(get().net, get().selection);
      if (isEmptyFragment(fragment)) return;
      set({ clipboard: fragment, pasteCount: 0 });
    },
    cut() {
      if (get().mode === 'simulate') return;
      get().copy();
      get().removeSelected();
    },
    paste() {
      const { clipboard, pasteCount } = get();
      if (!clipboard) return;
      const step = pasteCount + 1;
      let inserted: Id[] = [];
      const ok = edit((net) => {
        const result = insertFragment(net, clipboard, {
          x: PASTE_OFFSET * step,
          y: PASTE_OFFSET * step,
        });
        inserted = result.ids;
        return result.net;
      });
      if (ok) {
        set({ pasteCount: step });
        set({ selection: inserted });
      }
    },
    duplicate() {
      const fragment = extractFragment(get().net, get().selection);
      if (isEmptyFragment(fragment)) return;
      let inserted: Id[] = [];
      edit((net) => {
        const result = insertFragment(net, fragment, { x: PASTE_OFFSET, y: PASTE_OFFSET });
        inserted = result.ids;
        return result.net;
      });
      if (inserted.length > 0) set({ selection: inserted });
    },

    select(ids) {
      const current = get().selection;
      if (ids.length === current.length && ids.every((id, i) => id === current[i])) return;
      set({ selection: ids });
    },
    selectAll() {
      set({ selection: allIds(get().net) });
    },
    clearSelection() {
      if (get().selection.length > 0) set({ selection: [] });
    },
    setTool(tool) {
      if (get().mode === 'simulate' && tool !== 'select') return;
      set({ tool, arcSource: null });
    },
    setArcSource(id) {
      set({ arcSource: id });
    },
    startRename(id) {
      if (id !== null && get().mode === 'simulate') return;
      set({ renamingId: id });
    },
    setDragPositions(positions) {
      set({ dragPositions: positions });
    },

    newNet() {
      replaceDocument(freshNet(), null);
    },
    loadNet(net, fileName = null) {
      replaceDocument(net, fileName);
    },
    markSaved(fileName) {
      set({ savedNet: get().net, fileName });
    },

    startSimulation() {
      const { net } = get();
      set({
        mode: 'simulate',
        tool: 'select',
        arcSource: null,
        renamingId: null,
        dragPositions: null,
        simMarking: countsToMarking(markingToCounts(net.marking)),
        simHistory: [],
      });
    },
    stopSimulation() {
      set({ mode: 'edit', simMarking: null, simHistory: [] });
    },
    fireTransition(id) {
      const { mode, net, simMarking, simHistory } = get();
      if (mode !== 'simulate' || simMarking === null) return;
      if (!enabledTransitions(net, simMarking).includes(id)) return;
      const transition = net.transitions.find((t) => t.id === id);
      set({
        simMarking: fire(net, simMarking, id),
        simHistory: [
          ...simHistory,
          {
            index: simHistory.length + 1,
            transitionId: id,
            transitionName: transition?.name ?? id,
          },
        ],
      });
    },
    stepRandom(random = Math.random) {
      const { mode, net, simMarking } = get();
      if (mode !== 'simulate' || simMarking === null) return null;
      const enabled = enabledTransitions(net, simMarking);
      if (enabled.length === 0) {
        notify('info', en.messages.noEnabled);
        return null;
      }
      const picked = enabled[Math.min(enabled.length - 1, Math.floor(random() * enabled.length))];
      if (picked === undefined) return null;
      get().fireTransition(picked);
      return picked;
    },
    resetSimulation() {
      if (get().mode !== 'simulate') return;
      set({
        simMarking: countsToMarking(markingToCounts(get().net.marking)),
        simHistory: [],
      });
    },
  };
});

export const selectIsDirty = (s: EditorState): boolean => s.net !== s.savedNet;
export const selectCanUndo = (s: EditorState): boolean => s.past.length > 0 && s.mode === 'edit';
export const selectCanRedo = (s: EditorState): boolean => s.future.length > 0 && s.mode === 'edit';

/** The marking shown on the canvas: the simulated one while simulating, otherwise the initial one. */
export function currentMarking(s: Pick<EditorState, 'net' | 'mode' | 'simMarking'>): Marking {
  return s.mode === 'simulate' && s.simMarking ? s.simMarking : s.net.marking;
}
