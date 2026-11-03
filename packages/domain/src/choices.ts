import { placeRoles, type Id, type PetriNet, type PlaceRole } from '@pnm/core';
import { z } from 'zod';
import { emojiProblem } from './emoji';
import { genericDomainView } from './generic';
import {
  DISPLAY_ICONS,
  SPRITES,
  TINTS,
  provenanceKey,
  type Appearance,
  type CounterDisplay,
  type DisplayIcon,
  type DomainView,
  type EntityLook,
  type PlaceView,
  type Provenance,
} from './schema';
import { allowedIcons, iconAllowed, roleHoldsCases } from './validate';

/**
 * The choices of the guided way (N4): what a person picks in a form instead of describing it in
 * words. They are binding: after a view was made, `applyChoices` sets the entity, the looks of the
 * stages and the displays of the counters to exactly this, whatever a model has written. They
 * can also be applied to a view without a model. Geometry is never touched.
 */

export const LAYOUT_CHOICES = ['left-to-right', 'top-to-bottom', 'editor'] as const;
export type LayoutChoice = (typeof LAYOUT_CHOICES)[number];

export const EQUIPMENT_CHOICES = ['plain', 'zones', 'floorplan'] as const;
export type EquipmentChoice = (typeof EQUIPMENT_CHOICES)[number];

/** How a counter (a place of an amount, or a sink of cases) shows its amount. */
export interface CounterChoice {
  style: CounterDisplay['style'];
  /** The count at which a container is full (style `fill`). */
  max: number;
  /** How many tokens one symbol stands for (style `pictogram`). */
  per: number;
  /** A built-in symbol, or: */
  icon?: DisplayIcon;
  /** an emoji; never both. Neither: the default symbol. */
  emoji?: string;
  /** A small curve over the simulated time. */
  history: boolean;
}

export interface ViewChoices {
  /** The setting: theme of the view and the first sentence of the description. */
  setting: string;
  viewName: string;
  entity: { singular: string; plural: string } & EntityLook;
  /** For every place that holds cases: how its cases look; `null` means like the entity. */
  stages: Record<Id, Appearance | null>;
  counters: Record<Id, CounterChoice>;
  layout: LayoutChoice;
  equipment: EquipmentChoice;
  /** Free text for the model (the guided way allows it as an addition). */
  additions: string;
}

// --- Schema (for files, concepts and the generation log) ---------------------------------------

const looseAppearance = z.strictObject({
  sprite: z.enum(SPRITES as [string, ...string[]]).optional(),
  emoji: z.string().optional(),
  tint: z.enum(TINTS as [string, ...string[]]).optional(),
});

/** Schema of `ViewChoices`; a symbol is exactly one of sprite, icon or emoji, checked by `choiceProblems`. */
export const viewChoicesSchema = z.strictObject({
  setting: z.string(),
  viewName: z.string(),
  entity: z.strictObject({
    singular: z.string(),
    plural: z.string(),
    sprite: z.enum(SPRITES as [string, ...string[]]).optional(),
    emoji: z.string().optional(),
  }),
  stages: z.record(z.string(), looseAppearance.nullable()),
  counters: z.record(
    z.string(),
    z.strictObject({
      style: z.enum(['number', 'fill', 'pictogram']),
      max: z.number().positive(),
      per: z.number().positive(),
      icon: z.enum(DISPLAY_ICONS as [string, ...string[]]).optional(),
      emoji: z.string().optional(),
      history: z.boolean(),
    }),
  ),
  layout: z.enum(LAYOUT_CHOICES),
  equipment: z.enum(EQUIPMENT_CHOICES),
  additions: z.string(),
}) as unknown as z.ZodType<ViewChoices, unknown>;

// --- The order of the stages -------------------------------------------------------------------

/**
 * The places of a net in the order of the flow: from the places without a producer along the
 * arcs, breadth first; what the flow does not reach follows by position from left to right.
 */
export function flowOrder(net: PetriNet): Id[] {
  const placeIds = new Set(net.places.map((p) => p.id));
  const consumers = new Map<Id, Id[]>();
  const producers = new Map<Id, Id[]>();
  for (const arc of net.arcs) {
    if (placeIds.has(arc.source)) {
      consumers.set(arc.source, [...(consumers.get(arc.source) ?? []), arc.target]);
    } else {
      producers.set(arc.target, [...(producers.get(arc.target) ?? []), arc.source]);
    }
  }
  const order: Id[] = [];
  const seenPlaces = new Set<Id>();
  const seenTransitions = new Set<Id>();
  const byX = (a: Id, b: Id): number =>
    (net.places.find((p) => p.id === a)?.position.x ?? 0) -
    (net.places.find((p) => p.id === b)?.position.x ?? 0);
  const starts = net.places
    .map((p) => p.id)
    .filter((id) => !net.arcs.some((a) => a.target === id && !placeIds.has(a.source)));
  const queue: Id[] = [...starts].sort(byX);
  const visit = (start: Id): void => {
    const pending = [start];
    while (pending.length > 0) {
      const id = pending.shift()!;
      if (seenPlaces.has(id)) continue;
      seenPlaces.add(id);
      order.push(id);
      for (const t of consumers.get(id) ?? []) {
        if (seenTransitions.has(t)) continue;
        seenTransitions.add(t);
        for (const next of net.arcs.filter((a) => a.source === t).map((a) => a.target)) {
          if (placeIds.has(next) && !seenPlaces.has(next)) pending.push(next);
        }
      }
    }
  };
  for (const id of queue) visit(id);
  for (const id of net.places.map((p) => p.id).sort(byX)) visit(id);
  return order;
}

/** The places that have stages: those that hold cases (the roles case and source), in flow order. */
export function stagePlaces(net: PetriNet): Id[] {
  const roles = placeRoles(net);
  return flowOrder(net).filter((id) => {
    const role = roles.get(id);
    return role === 'case' || role === 'source';
  });
}

/** The places that have counters: amounts and sinks, in flow order. */
export function counterPlaces(net: PetriNet): Id[] {
  const roles = placeRoles(net);
  return flowOrder(net).filter((id) => {
    const role = roles.get(id);
    return role === 'quantity' || role === 'sink';
  });
}

// --- The default choices -----------------------------------------------------------------------

/** The next round number (1, 2 or 5 times a power of ten) that is not below `n`. */
function niceCeil(n: number): number {
  if (!(n > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(n));
  for (const factor of [1, 2, 5, 10]) {
    if (factor * power >= n) return factor * power;
  }
  return 10 * power;
}

/** The amount that a counter is expected to reach, for the limits of its display. */
function expectedAmount(
  net: PetriNet,
  placeId: Id,
  bounds: Readonly<Record<Id, number>> | undefined,
): number {
  const bound = bounds?.[placeId];
  if (bound !== undefined && Number.isFinite(bound) && bound > 0) return bound;
  const capacity = net.places.find((p) => p.id === placeId)?.capacity;
  if (capacity !== undefined && capacity > 0) return capacity;
  const initial = net.marking[placeId]?.length ?? 0;
  return initial > 0 ? initial : 100;
}

/** The choice for a counter before the person decides: a plain number, with limits that fit. */
export function defaultCounterChoice(
  net: PetriNet,
  placeId: Id,
  bounds?: Readonly<Record<Id, number>>,
): CounterChoice {
  const place = net.places.find((p) => p.id === placeId);
  const initial = net.marking[placeId]?.length ?? 0;
  const bound = bounds?.[placeId];
  const expected = expectedAmount(net, placeId, bounds);
  // `max` is the capacity if there is one, else the bound that the analysis knows, else a round
  // number above twice what the place starts with.
  const max =
    place?.capacity !== undefined && place.capacity > 0
      ? place.capacity
      : bound !== undefined && Number.isFinite(bound) && bound > 0
        ? bound
        : niceCeil(Math.max(10, 2 * initial));
  // `per` makes about ten to twenty symbols at the expected amount.
  const per = Math.max(1, niceCeil(expected / 15));
  return { style: 'number', max, per, history: false };
}

/** The choice that a counter display stands for (the other numbers come from the defaults). */
function choiceOfDisplay(display: CounterDisplay, base: CounterChoice): CounterChoice {
  return {
    style: display.style,
    max: display.style === 'fill' ? display.max : base.max,
    per: display.style === 'pictogram' ? display.per : base.per,
    ...(display.icon !== undefined && { icon: display.icon }),
    ...(display.emoji !== undefined && { emoji: display.emoji }),
    history: display.history === true,
  };
}

/**
 * The choices to start from: the view if there is one, else the generic view of the net. `bounds`
 * are the known upper limits of places (from the analysis), used for the limit of a container.
 */
export function defaultChoices(
  net: PetriNet,
  view?: DomainView | null,
  bounds?: Readonly<Record<Id, number>>,
): ViewChoices {
  const base = view ?? genericDomainView(net, { at: '1970-01-01T00:00:00.000Z' });
  const entity = base.meta.entity;
  const stages: Record<Id, Appearance | null> = {};
  for (const id of stagePlaces(net)) {
    const entry = base.places[id];
    stages[id] =
      view && entry && 'appearance' in entry && entry.appearance !== undefined
        ? entry.appearance
        : null;
  }
  const counters: Record<Id, CounterChoice> = {};
  for (const id of counterPlaces(net)) {
    const entry = base.places[id];
    const fallback = defaultCounterChoice(net, id, bounds);
    counters[id] =
      view && entry && 'display' in entry && entry.display !== undefined
        ? choiceOfDisplay(entry.display, fallback)
        : fallback;
  }
  return {
    setting: base.meta.theme === '' ? net.name : base.meta.theme,
    viewName: view ? view.meta.viewName : '',
    entity: {
      singular: entity.singular,
      plural: entity.plural,
      ...(entity.emoji !== undefined ? { emoji: entity.emoji } : { sprite: entity.sprite }),
    } as ViewChoices['entity'],
    stages,
    counters,
    layout: 'editor',
    equipment: 'plain',
    additions: '',
  };
}

// --- Checking the choices ----------------------------------------------------------------------

export interface ChoiceProblem {
  /** Where the problem is, for example `entity.emoji`, `stages.p1.emoji` or `counters.c.icon`. */
  path: string;
  rule: 'V10' | 'V11' | 'V12';
  message: string;
}

/** Checks choices against the net, with the rules V10 to V12, so that a form shows errors at once. */
export function choiceProblems(net: PetriNet, choices: ViewChoices): ChoiceProblem[] {
  const problems: ChoiceProblem[] = [];
  const roles = placeRoles(net);
  const names = new Map(net.places.map((p) => [p.id, p.name]));
  if (choices.entity.emoji !== undefined) {
    const problem = emojiProblem(choices.entity.emoji);
    if (problem !== null) problems.push({ path: 'entity.emoji', rule: 'V12', message: problem });
  }
  for (const [id, look] of Object.entries(choices.stages)) {
    if (look === null) continue;
    const role: PlaceRole | undefined = roles.get(id);
    if (role === undefined) continue;
    if (!roleHoldsCases(role)) {
      problems.push({
        path: `stages.${id}`,
        rule: 'V11',
        message: `Place "${names.get(id) ?? id}" holds no cases and has no appearance`,
      });
    }
    if (look.emoji !== undefined) {
      const problem = emojiProblem(look.emoji);
      if (problem !== null) {
        problems.push({ path: `stages.${id}.emoji`, rule: 'V12', message: problem });
      }
    }
  }
  for (const [id, counter] of Object.entries(choices.counters)) {
    const role: PlaceRole = roles.get(id) ?? 'case';
    if (counter.emoji !== undefined) {
      const problem = emojiProblem(counter.emoji);
      if (problem !== null) {
        problems.push({ path: `counters.${id}.emoji`, rule: 'V12', message: problem });
      }
      if (counter.icon !== undefined) {
        problems.push({
          path: `counters.${id}.emoji`,
          rule: 'V12',
          message: 'Write either an icon or an emoji, not both',
        });
      }
    } else if (counter.icon !== undefined && !iconAllowed(role, counter.icon)) {
      problems.push({
        path: `counters.${id}.icon`,
        rule: 'V10',
        message: `The symbol "${counter.icon}" does not fit the ${role} place "${names.get(id) ?? id}"; use one of ${allowedIcons(role).join(', ')}`,
      });
    }
    if (counter.style === 'fill' && !(counter.max > 0)) {
      problems.push({ path: `counters.${id}.max`, rule: 'V10', message: '"max" must be positive' });
    }
    if (counter.style === 'pictogram' && !(counter.per > 0)) {
      problems.push({ path: `counters.${id}.per`, rule: 'V10', message: '"per" must be positive' });
    }
  }
  return problems;
}

// --- Applying the choices ----------------------------------------------------------------------

/** The display that a choice stands for, on top of the display the place has (unit and size stay). */
export function displayOfChoice(
  choice: CounterChoice,
  previous: CounterDisplay | undefined,
): CounterDisplay | undefined {
  const symbol =
    choice.emoji !== undefined
      ? { emoji: choice.emoji }
      : choice.icon !== undefined
        ? { icon: choice.icon }
        : {};
  const extras = {
    ...symbol,
    ...(previous?.unit !== undefined && { unit: previous.unit }),
    ...(choice.history && { history: true as const }),
  };
  if (choice.style === 'number') {
    return Object.keys(extras).length === 0 ? undefined : { style: 'number', ...extras };
  }
  const size = previous !== undefined && previous.style !== 'number' ? previous.size : undefined;
  const sized = size !== undefined ? { size } : {};
  if (choice.style === 'fill') {
    const low = previous?.style === 'fill' ? previous.low : undefined;
    return {
      style: 'fill',
      max: choice.max,
      ...(low !== undefined && low <= choice.max && { low }),
      ...sized,
      ...extras,
    };
  }
  return { style: 'pictogram', per: choice.per, ...sized, ...extras };
}

type CounterEntry = Extract<PlaceView, { kind: 'pool' | 'source' | 'sink' }>;
type StageEntry = Extract<PlaceView, { kind: 'queue' | 'conveyor' | 'buffer' | 'source' | 'sink' }>;

function isCounterEntry(entry: PlaceView | undefined): entry is CounterEntry {
  return entry?.kind === 'pool' || entry?.kind === 'source' || entry?.kind === 'sink';
}

function isStageEntry(entry: PlaceView | undefined): entry is StageEntry {
  return (
    entry !== undefined &&
    (entry.kind === 'queue' ||
      entry.kind === 'conveyor' ||
      entry.kind === 'buffer' ||
      entry.kind === 'source' ||
      entry.kind === 'sink')
  );
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** A display that only says "a number" is the same as none. */
function canonDisplay(display: CounterDisplay | undefined): CounterDisplay | undefined {
  return display?.style === 'number' && Object.keys(display).length === 1 ? undefined : display;
}

export interface ApplyOptions {
  /** Timestamp for the provenance of changed entries. */
  at: string;
  /**
   * Whose work the changed entries count as afterwards: `user` (default; the person applied the
   * choices) or `keep` (they stay as they were, as after a generation).
   */
  provenance?: 'user' | 'keep';
}

export interface ApplyResult {
  view: DomainView;
  /** Provenance keys of the entries whose look or display changed. */
  changed: string[];
}

function entityOf(choices: ViewChoices): DomainView['meta']['entity'] {
  const { singular, plural } = choices.entity;
  return choices.entity.emoji !== undefined
    ? { singular, plural, emoji: choices.entity.emoji }
    : { singular, plural, sprite: choices.entity.sprite ?? 'dot' };
}

/**
 * Sets the entity of the view, the looks of the stages and the displays of the counters to the
 * choices. Geometry, labels, kinds and everything else stay as they are; a place whose entry
 * cannot carry the look or the display (hidden, slots, a belt as a counter) is skipped.
 */
export function applyChoices(
  net: PetriNet,
  view: DomainView,
  choices: ViewChoices,
  options: ApplyOptions,
): ApplyResult {
  const changed: string[] = [];
  const places: DomainView['places'] = { ...view.places };
  const roles = placeRoles(net);
  for (const [id, look] of Object.entries(choices.stages)) {
    const entry = places[id];
    const role = roles.get(id);
    if (!isStageEntry(entry) || role === undefined || !roleHoldsCases(role)) continue;
    const current = entry.appearance;
    const next = look ?? undefined;
    if (sameValue(current, next)) continue;
    const { appearance: _old, ...rest } = entry;
    places[id] = (next === undefined ? rest : { ...rest, appearance: next }) as PlaceView;
    changed.push(provenanceKey.place(id));
  }
  for (const [id, choice] of Object.entries(choices.counters)) {
    const entry = places[id];
    if (!isCounterEntry(entry)) continue;
    const next = displayOfChoice(choice, entry.display);
    if (sameValue(canonDisplay(entry.display), next)) continue;
    const { display: _old, ...rest } = entry;
    places[id] = (next === undefined ? rest : { ...rest, display: next }) as PlaceView;
    changed.push(provenanceKey.place(id));
  }
  const meta = {
    ...view.meta,
    theme: choices.setting.trim() === '' ? view.meta.theme : choices.setting.trim(),
    viewName: choices.viewName.trim() === '' ? view.meta.viewName : choices.viewName.trim(),
    entity: entityOf(choices),
  };
  const provenance: Record<string, Provenance> = { ...view.provenance };
  if (options.provenance !== 'keep') {
    for (const key of changed) provenance[key] = { source: 'user', at: options.at };
  }
  return { view: { ...view, meta, places, provenance }, changed };
}

// --- What a model did differently --------------------------------------------------------------

function describeLook(look: Appearance | null | undefined): string {
  if (look === null || look === undefined) return 'like the entity';
  if (look.emoji !== undefined) return look.emoji;
  return look.tint !== undefined ? `${look.sprite} (${look.tint})` : String(look.sprite);
}

function describeCounter(choice: CounterChoice | CounterDisplay | undefined): string {
  if (choice === undefined) return 'a plain number';
  const symbol = choice.emoji ?? choice.icon;
  const detail =
    choice.style === 'fill'
      ? ` up to ${'max' in choice ? choice.max : ''}`
      : choice.style === 'pictogram'
        ? ` with ${'per' in choice ? choice.per : ''} per symbol`
        : '';
  return `${choice.style === 'number' ? 'a number' : choice.style}${detail}${symbol !== undefined ? `, symbol ${symbol}` : ''}${choice.history === true ? ', with a curve' : ''}`;
}

/**
 * The notes for everything the model wrote differently from the choices ("Choice applied: ...").
 * Call it with the view of the model before `applyChoices`.
 */
export function choiceDeviations(
  net: PetriNet,
  modelView: DomainView,
  choices: ViewChoices,
): string[] {
  const notes: string[] = [];
  const names = new Map(net.places.map((p) => [p.id, p.name]));
  const own = modelView.meta.entity;
  const wanted = entityOf(choices);
  if (own.sprite !== wanted.sprite || own.emoji !== wanted.emoji) {
    notes.push(
      `Choice applied: the ${wanted.singular.toLowerCase()} is shown as ${wanted.emoji ?? wanted.sprite} (the model wrote ${own.emoji ?? own.sprite}).`,
    );
  }
  const roles = placeRoles(net);
  for (const [id, look] of Object.entries(choices.stages)) {
    const entry = modelView.places[id];
    const role = roles.get(id);
    if (!isStageEntry(entry) || role === undefined || !roleHoldsCases(role)) continue;
    if (!sameValue(entry.appearance, look ?? undefined)) {
      notes.push(
        `Choice applied: the cases on "${names.get(id) ?? id}" look ${describeLook(look)} (the model wrote ${describeLook(entry.appearance)}).`,
      );
    }
  }
  for (const [id, choice] of Object.entries(choices.counters)) {
    const entry = modelView.places[id];
    if (!isCounterEntry(entry)) continue;
    const wantedDisplay = displayOfChoice(choice, entry.display);
    if (!sameValue(canonDisplay(entry.display), wantedDisplay)) {
      notes.push(
        `Choice applied: "${names.get(id) ?? id}" is shown as ${describeCounter(choice)} (the model wrote ${describeCounter(entry.display)}).`,
      );
    }
  }
  return notes;
}
