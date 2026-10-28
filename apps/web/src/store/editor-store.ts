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
  exampleToken,
  extractFragment,
  findArc,
  findEnabled,
  findEnabledPt,
  fireBinding as coreFireBinding,
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
  type Binding,
  type BindingResult,
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
import { chainPosition } from '../lib/placement';
import { getViewApi } from '../lib/view-api';
import { notify } from './ui-store';

export type Tool = 'select' | 'place' | 'transition' | 'arc' | 'annotation';
export type Mode = 'edit' | 'simulate';

export interface SimStep {
  index: number;
  transitionId: Id;
  transitionName: string;
  /** The binding that was fired; empty in P/T nets. */
  binding: Binding;
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
  /** The tool stays active after use (double click on the tool) until Escape or another tool. */
  toolSticky: boolean;
  mode: Mode;
  /** First click of the two-click arc tool. */
  arcSource: Id | null;
  /** Element whose name, weight or inscription is being edited in place. */
  renamingId: Id | null;
  /**
   * Node that Tab just added: renaming it again is merged into the step that created it, so that
   * one undo removes the node together with its first name.
   */
  amendId: Id | null;
  /** Positions of nodes while they are being dragged (not part of the document). */
  dragPositions: Record<Id, Position> | null;

  simMarking: Marking | null;
  simHistory: SimStep[];
  /** Enabled transitions with their bindings under `simMarking`. Empty while `computing`. */
  enabled: Map<Id, BindingResult>;
  /** True while the bindings of the current marking are being computed. */
  computing: boolean;
  /** Evaluation problems found while computing the bindings. */
  simDiagnostics: Diagnostic[];
  /** Transition whose list of bindings is open for the user to choose from. */
  picker: Id | null;

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
  /** Renames a place, transition or note (inline editing). */
  renameElement(id: Id, name: string): void;
  /**
   * Adds the next node of the other kind 160 px to the right (`direction` 1) or the previous
   * node to the left (-1), connects it, selects it and starts renaming it. One undo step.
   */
  extendFrom(id: Id, direction: 1 | -1): Id | null;
  /** Adds a node with the active tool; the tool falls back to Select unless it is kept. */
  placeWithTool(position: Position, options: { keepTool: boolean; rename: boolean }): Id | null;
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
  setTool(tool: Tool, sticky?: boolean): void;
  /** Double click on a tool: makes it sticky, or turns stickiness off again. */
  toggleStickyTool(tool: Tool): void;
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
  /** Fires a transition: directly if it has one binding, otherwise opens the binding list. */
  fireTransition(id: Id): void;
  fireBindingAt(id: Id, index: number): void;
  setPicker(id: Id | null): void;
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

/** The marking a simulation starts from. P/T nets only count tokens, so theirs are normalised. */
function initialSimMarking(net: PetriNet): Marking {
  return net.profile === 'pt-net'
    ? countsToMarking(markingToCounts(net.marking))
    : structuredClone(net.marking);
}

const NO_ENABLED = (): Map<Id, BindingResult> => new Map();

/** Sequence number of the latest binding computation; older results are discarded. */
let computationSeq = 0;

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
      amendId: null,
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
      toolSticky: false,
      arcSource: null,
      renamingId: null,
      amendId: null,
      dragPositions: null,
      simMarking: null,
      simHistory: [],
      enabled: NO_ENABLED(),
      computing: false,
      simDiagnostics: [],
      picker: null,
    });
  };

  /**
   * Computes the enabled transitions of the simulated marking. P/T nets are computed at once; JSON
   * nets evaluate expressions asynchronously, and a result that arrives after the marking has
   * changed again is dropped.
   */
  const recompute = (extra: Partial<EditorState> = {}): void => {
    computationSeq += 1;
    const seq = computationSeq;
    const { net, simMarking, mode } = { ...get(), ...extra };
    if (mode !== 'simulate' || simMarking === null) return;
    if (net.profile === 'pt-net') {
      const result = findEnabledPt(net, simMarking);
      set({ ...extra, enabled: result.enabled, computing: false, simDiagnostics: [] });
      return;
    }
    // The marking and the "nothing is enabled yet" state change together, so a stale
    // enabled set is never drawn next to the new marking.
    set({ ...extra, enabled: NO_ENABLED(), computing: true, simDiagnostics: [] });
    findEnabled(net, simMarking).then(
      (result) => {
        if (seq !== computationSeq || get().mode !== 'simulate') return;
        set({ enabled: result.enabled, computing: false, simDiagnostics: result.diagnostics });
      },
      (error: unknown) => {
        if (seq !== computationSeq || get().mode !== 'simulate') return;
        set({ enabled: NO_ENABLED(), computing: false });
        notify('error', error instanceof Error ? error.message : String(error));
      },
    );
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
    toolSticky: false,
    mode: 'edit',
    arcSource: null,
    renamingId: null,
    amendId: null,
    dragPositions: null,

    simMarking: null,
    simHistory: [],
    enabled: NO_ENABLED(),
    computing: false,
    simDiagnostics: [],
    picker: null,

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
        // The weight label on the canvas shows the result; no toast needed.
        return edit((net) => setWeight(net, existing.id, weight), [existing.id])
          ? existing.id
          : null;
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
    renameElement(id, name) {
      const { net, amendId } = get();
      const target =
        net.places.find((p) => p.id === id) ??
        net.transitions.find((t) => t.id === id) ??
        net.annotations?.find((a) => a.id === id);
      if (!target) return;
      if (amendId === id && get().mode === 'edit' && 'name' in target) {
        if (target.name === name) return;
        // Part of the step that created the node: change the document without a new undo step.
        const next = updateNode(net, id, { name });
        set({ net: next, diagnostics: validate(next), amendId: null });
        return;
      }
      if (net.places.some((p) => p.id === id)) get().updatePlace(id, { name });
      else if (net.transitions.some((t) => t.id === id)) get().updateTransition(id, { name });
      else get().updateAnnotation(id, { text: name });
    },
    extendFrom(id, direction) {
      const { net, mode } = get();
      if (mode === 'simulate') return null;
      const place = net.places.find((p) => p.id === id);
      const transition = net.transitions.find((t) => t.id === id);
      const from = place ?? transition;
      if (!from) return null;
      const position = chainPosition(net, from.position, direction);
      const created = createId();
      const arcId = createId();
      const ok = edit(
        (current) => {
          const next = place
            ? coreAddTransition(current, { id: created, position })
            : coreAddPlace(current, { id: created, position });
          return direction === 1
            ? coreAddArc(next, id, created, { id: arcId })
            : coreAddArc(next, created, id, { id: arcId });
        },
        [created],
      );
      if (!ok) return null;
      set({ renamingId: created, amendId: created });
      getViewApi()?.reveal([created]);
      return created;
    },
    placeWithTool(position, options) {
      const { tool, toolSticky } = get();
      const id =
        tool === 'place'
          ? get().addPlace(position)
          : tool === 'transition'
            ? get().addTransition(position)
            : tool === 'annotation'
              ? get().addAnnotation(position)
              : null;
      if (id === null) return null;
      if (tool === 'annotation' || options.rename) get().startRename(id);
      if (!toolSticky && !options.keepTool) set({ tool: 'select', toolSticky: false });
      return id;
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
        amendId: null,
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
        amendId: null,
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
    setTool(tool, sticky = false) {
      if (get().mode === 'simulate' && tool !== 'select') return;
      set({ tool, toolSticky: sticky && tool !== 'select', arcSource: null });
    },
    toggleStickyTool(tool) {
      if (tool === 'select') return;
      const { tool: active, toolSticky } = get();
      get().setTool(tool, !(active === tool && toolSticky));
    },
    setArcSource(id) {
      set({ arcSource: id });
    },
    startRename(id) {
      if (id !== null && get().mode === 'simulate') return;
      set(id === null ? { renamingId: null, amendId: null } : { renamingId: id });
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
      recompute({
        mode: 'simulate',
        tool: 'select',
        toolSticky: false,
        arcSource: null,
        renamingId: null,
        dragPositions: null,
        simMarking: initialSimMarking(net),
        simHistory: [],
        picker: null,
      });
    },
    stopSimulation() {
      computationSeq += 1; // drops a computation that is still running
      set({
        mode: 'edit',
        simMarking: null,
        simHistory: [],
        enabled: NO_ENABLED(),
        computing: false,
        simDiagnostics: [],
        picker: null,
      });
    },
    fireTransition(id) {
      const { mode, enabled, computing } = get();
      if (mode !== 'simulate' || computing) return;
      const result = enabled.get(id);
      if (!result || result.bindings.length === 0) return;
      if (result.bindings.length === 1) get().fireBindingAt(id, 0);
      else set({ picker: get().picker === id ? null : id });
    },
    fireBindingAt(id, index) {
      const { mode, net, simMarking, simHistory, enabled, computing } = get();
      if (mode !== 'simulate' || simMarking === null || computing) return;
      const chosen = enabled.get(id)?.bindings[index];
      if (!chosen) return;
      const transition = net.transitions.find((t) => t.id === id);
      let next: Marking;
      try {
        next = coreFireBinding(net, simMarking, chosen);
      } catch (error) {
        notify('error', error instanceof Error ? error.message : String(error));
        recompute();
        return;
      }
      recompute({
        simMarking: next,
        simHistory: [
          ...simHistory,
          {
            index: simHistory.length + 1,
            transitionId: id,
            transitionName: transition?.name ?? id,
            binding: chosen.binding,
          },
        ],
        picker: null,
      });
    },
    setPicker(id) {
      if (get().mode !== 'simulate') return;
      set({ picker: id });
    },
    stepRandom(random = Math.random) {
      const { mode, simMarking, enabled, computing } = get();
      if (mode !== 'simulate' || simMarking === null || computing) return null;
      const ids = [...enabled.keys()];
      if (ids.length === 0) {
        notify('info', en.messages.noEnabled);
        return null;
      }
      const pick = (length: number): number => Math.min(length - 1, Math.floor(random() * length));
      const id = ids[pick(ids.length)];
      if (id === undefined) return null;
      const count = enabled.get(id)?.bindings.length ?? 0;
      get().fireBindingAt(id, pick(count));
      return id;
    },
    resetSimulation() {
      if (get().mode !== 'simulate') return;
      recompute({
        simMarking: initialSimMarking(get().net),
        simHistory: [],
        picker: null,
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
