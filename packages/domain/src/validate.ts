import { isSourceTransition, placeRoles, type Id, type PetriNet, type PlaceRole } from '@pnm/core';
import type { ZodError } from 'zod';
import { MIN_QUEUE_LENGTH, pathLength, pointInRect } from './geometry';
import { netHash } from './hash';
import {
  arcKey,
  domainViewSchema,
  type DomainView,
  type PlaceView,
  type Point,
  type Rect,
  type TransitionView,
} from './schema';

export type DomainRule = 'V1' | 'V2' | 'V3' | 'V4' | 'V5' | 'V6' | 'V7' | 'V8';

export const DOMAIN_RULES: readonly DomainRule[] = ['V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7', 'V8'];

export interface DomainDiagnostic {
  rule: DomainRule;
  severity: 'error' | 'warning';
  /** Location in the view, for example `places.p1.path[0]`. */
  path: string;
  message: string;
  /** The place, transition or arc of the net the diagnostic is about. */
  elementId?: Id;
}

export interface DomainValidation {
  /** True if there is no error (warnings do not count). */
  ok: boolean;
  /** The typed view; present as soon as the schema check (V1) passed, even if other rules failed. */
  view?: DomainView;
  diagnostics: DomainDiagnostic[];
}

/** Fields that describe behaviour. They belong into the net and are rejected in a view. */
const BEHAVIOUR_FIELDS = new Set([
  'duration',
  'durations',
  'timing',
  'time',
  'weight',
  'weights',
  'priority',
  'rate',
  'rates',
  'guard',
  'condition',
  'conditions',
  'probability',
  'delay',
  'capacity',
  'inscription',
]);

function formatPath(path: ReadonlyArray<PropertyKey>): string {
  let out = '';
  for (const part of path) {
    if (typeof part === 'number') out += `[${part}]`;
    else out += out === '' ? String(part) : `.${String(part)}`;
  }
  return out === '' ? '(root)' : out;
}

/**
 * Turns the issues of a failed schema check into diagnostics of rule V1, with the element of the
 * net they are about. Fields that describe behaviour get a message that says so.
 */
export function schemaDiagnostics(net: PetriNet, error: ZodError): DomainDiagnostic[] {
  const placeIds = new Set(net.places.map((p) => p.id));
  const transitionIds = new Set(net.transitions.map((t) => t.id));
  const out: DomainDiagnostic[] = [];
  for (const issue of error.issues.slice(0, 50)) {
    const base = formatPath(issue.path);
    const [section, key] = issue.path;
    const elementId =
      typeof key === 'string' &&
      ((section === 'places' && placeIds.has(key)) ||
        (section === 'transitions' && transitionIds.has(key)))
        ? key
        : undefined;
    const make = (path: string, message: string): DomainDiagnostic => ({
      rule: 'V1',
      severity: 'error',
      path,
      message,
      ...(elementId !== undefined && { elementId }),
    });
    if (issue.code === 'unrecognized_keys') {
      for (const name of issue.keys) {
        const prefix = base === '(root)' ? '' : `${base}.`;
        out.push(
          make(
            `${prefix}${name}`,
            BEHAVIOUR_FIELDS.has(name)
              ? `"${name}" describes behaviour and is not allowed in a domain view; behaviour belongs to the net`
              : `Unknown field "${name}"`,
          ),
        );
      }
    } else {
      out.push(make(base, issue.message));
    }
  }
  return out;
}

function inCanvas(point: Point, width: number, height: number): boolean {
  return point[0] >= 0 && point[0] <= width && point[1] >= 0 && point[1] <= height;
}

function rectProblem(rect: Rect, width: number, height: number): string | null {
  const [x, y, w, h] = rect;
  if (w <= 0 || h <= 0) return 'the rectangle has no area';
  if (x < 0 || y < 0 || x + w > width || y + h > height) return 'the rectangle leaves the canvas';
  return null;
}

type Add = (
  rule: DomainRule,
  severity: 'error' | 'warning',
  path: string,
  message: string,
  elementId?: Id,
) => void;

function checkPoint(add: Add, path: string, point: Point, view: DomainView, id?: Id): void {
  if (!inCanvas(point, view.meta.canvas.width, view.meta.canvas.height)) {
    add('V5', 'error', path, 'The point is outside the canvas', id);
  }
}

function checkRect(add: Add, path: string, rect: Rect, view: DomainView, id?: Id): void {
  const problem = rectProblem(rect, view.meta.canvas.width, view.meta.canvas.height);
  if (problem) add('V5', 'error', path, `Invalid rectangle: ${problem}`, id);
}

function checkPath(add: Add, path: string, points: Point[], view: DomainView, id?: Id): void {
  if (points.length < 2) add('V5', 'error', path, 'A path needs at least two points', id);
  else if (pathLength(points) <= 0) add('V5', 'error', path, 'The path has no length', id);
  points.forEach((point, i) => {
    checkPoint(add, `${path}[${i}]`, point, view, id);
  });
}

/** True if a place with this role may be drawn as `kind` (rule V4). */
export function roleAllows(role: PlaceRole, kind: PlaceView['kind']): boolean {
  switch (role) {
    case 'resource':
      return kind === 'slots' || kind === 'pool' || kind === 'hidden';
    case 'sink':
      return kind === 'sink' || kind === 'hidden';
    case 'source':
      return (
        kind === 'source' ||
        kind === 'queue' ||
        kind === 'conveyor' ||
        kind === 'buffer' ||
        kind === 'hidden'
      );
    case 'case':
      return kind !== 'slots';
  }
}

function allowedKinds(role: PlaceRole): string {
  switch (role) {
    case 'resource':
      return 'slots, pool or hidden';
    case 'sink':
      return 'sink or hidden';
    case 'source':
      return 'source, queue, conveyor, buffer or hidden';
    case 'case':
      return 'any kind except slots';
  }
}

/** The transitions that a place forms a loop with (it is taken and given back by them). */
export function loopTransitions(net: PetriNet, placeId: Id): Id[] {
  const arcKeys = new Set(net.arcs.map((a) => arcKey(a.source, a.target)));
  return net.transitions
    .filter((t) => arcKeys.has(arcKey(placeId, t.id)) && arcKeys.has(arcKey(t.id, placeId)))
    .map((t) => t.id);
}

const PLACE_KINDS: ReadonlyArray<Exclude<PlaceView['kind'], 'hidden'>> = [
  'queue',
  'conveyor',
  'buffer',
  'source',
  'sink',
  'pool',
  'slots',
];

const TRANSITION_KINDS: ReadonlyArray<Exclude<TransitionView['kind'], 'hidden'>> = [
  'station',
  'machine',
  'gate',
  'area',
  'rooms',
  'door',
  'dock',
  'waypoint',
];

/**
 * The kinds that rule V4 allows for a place, without `hidden` (that is a separate action). The
 * kind `slots` only counts when the place forms a loop with some transition.
 */
export function allowedPlaceKinds(
  net: PetriNet,
  placeId: Id,
): Array<Exclude<PlaceView['kind'], 'hidden'>> {
  const role = placeRoles(net).get(placeId) ?? 'case';
  const loops = loopTransitions(net, placeId).length > 0;
  return PLACE_KINDS.filter((kind) => roleAllows(role, kind) && (kind !== 'slots' || loops));
}

/** The kinds that rule V4 allows for a transition, without `hidden`. */
export function allowedTransitionKinds(
  net: PetriNet,
  transitionId: Id,
): Array<Exclude<TransitionView['kind'], 'hidden'>> {
  if (isSourceTransition(net, transitionId)) return ['door', 'dock'];
  return [...TRANSITION_KINDS];
}

function slotsOfTransition(view: TransitionView | undefined): Point[] | undefined {
  if (!view) return undefined;
  switch (view.kind) {
    case 'station':
    case 'machine':
    case 'gate':
    case 'area':
    case 'rooms':
      return view.slots;
    case 'door':
    case 'dock':
    case 'waypoint':
    case 'hidden':
      return undefined;
  }
}

/**
 * Checks a domain view against its net (rules V1 to V8). `view` is untrusted input: anything
 * that was parsed from JSON. Errors make the view unusable for a faithful picture; warnings point
 * out things that look wrong (too few slots, stale hash, short queues).
 */
export function validateDomainView(net: PetriNet, view: unknown): DomainValidation {
  const parsed = domainViewSchema.safeParse(view);
  if (!parsed.success) {
    return { ok: false, diagnostics: schemaDiagnostics(net, parsed.error) };
  }
  const data = parsed.data;
  const diagnostics: DomainDiagnostic[] = [];
  const add: Add = (rule, severity, path, message, elementId) => {
    diagnostics.push({
      rule,
      severity,
      path,
      message,
      ...(elementId !== undefined && { elementId }),
    });
  };

  const placeIds = new Set(net.places.map((p) => p.id));
  const transitionIds = new Set(net.transitions.map((t) => t.id));
  const arcKeys = new Set(net.arcs.map((a) => arcKey(a.source, a.target)));
  const arcIdByKey = new Map(net.arcs.map((a) => [arcKey(a.source, a.target), a.id]));

  // V2: every key exists in the net.
  for (const id of Object.keys(data.places)) {
    if (!placeIds.has(id)) add('V2', 'error', `places.${id}`, `The net has no place "${id}"`);
  }
  for (const id of Object.keys(data.transitions)) {
    if (!transitionIds.has(id)) {
      add('V2', 'error', `transitions.${id}`, `The net has no transition "${id}"`);
    }
  }
  for (const key of Object.keys(data.arcs ?? {})) {
    if (!arcKeys.has(key)) {
      add('V2', 'error', `arcs.${key}`, `The net has no arc "${key}" (source>target)`);
    }
  }
  for (const key of Object.keys(data.provenance)) {
    const dot = key.indexOf('.');
    const section = dot < 0 ? '' : key.slice(0, dot);
    const rest = dot < 0 ? '' : key.slice(dot + 1);
    const known =
      (section === 'places' && placeIds.has(rest)) ||
      (section === 'transitions' && transitionIds.has(rest)) ||
      (section === 'arcs' && arcKeys.has(rest));
    if (!known) {
      add(
        'V2',
        'error',
        `provenance.${key}`,
        `The provenance key "${key}" names no element of the net`,
      );
    }
  }

  // V3: every place and transition has an entry.
  for (const place of net.places) {
    if (!(place.id in data.places)) {
      add('V3', 'error', `places.${place.id}`, `Place "${place.name}" has no entry`, place.id);
    }
  }
  for (const transition of net.transitions) {
    if (!(transition.id in data.transitions)) {
      add(
        'V3',
        'error',
        `transitions.${transition.id}`,
        `Transition "${transition.name}" has no entry`,
        transition.id,
      );
    }
  }

  // V4: the kind fits the role.
  const roles = placeRoles(net);
  const loops = (placeId: Id, transitionId: Id): boolean =>
    arcKeys.has(arcKey(placeId, transitionId)) && arcKeys.has(arcKey(transitionId, placeId));
  for (const place of net.places) {
    const entry = data.places[place.id];
    if (!entry) continue;
    const role = roles.get(place.id) ?? 'case';
    if (!roleAllows(role, entry.kind)) {
      add(
        'V4',
        'error',
        `places.${place.id}.kind`,
        `Place "${place.name}" is a ${role} place; its kind must be ${allowedKinds(role)}, not "${entry.kind}"`,
        place.id,
      );
    }
    if (entry.kind === 'slots' && role === 'resource') {
      if (!transitionIds.has(entry.of) || !loops(place.id, entry.of)) {
        add(
          'V4',
          'error',
          `places.${place.id}.of`,
          `"${entry.of}" is not a transition that place "${place.name}" forms a loop with`,
          place.id,
        );
      }
    }
  }
  for (const transition of net.transitions) {
    const entry = data.transitions[transition.id];
    if (!entry) continue;
    if (
      isSourceTransition(net, transition.id) &&
      !(entry.kind === 'door' || entry.kind === 'dock' || entry.kind === 'hidden')
    ) {
      add(
        'V4',
        'error',
        `transitions.${transition.id}.kind`,
        `Transition "${transition.name}" has no input place; its kind must be door, dock or hidden, not "${entry.kind}"`,
        transition.id,
      );
    }
  }

  // V5: geometry.
  for (const place of net.places) {
    const entry = data.places[place.id];
    if (!entry) continue;
    const base = `places.${place.id}`;
    switch (entry.kind) {
      case 'queue':
      case 'conveyor':
      case 'buffer':
        checkPath(add, `${base}.path`, entry.path, data, place.id);
        break;
      case 'pool':
        checkPoint(add, `${base}.pos`, entry.pos, data, place.id);
        break;
      case 'source':
      case 'sink':
        checkRect(add, `${base}.box`, entry.box, data, place.id);
        break;
      case 'slots':
      case 'hidden':
        break;
    }
  }
  for (const transition of net.transitions) {
    const entry = data.transitions[transition.id];
    if (!entry) continue;
    const base = `transitions.${transition.id}`;
    switch (entry.kind) {
      case 'station':
      case 'machine':
      case 'gate':
      case 'area':
      case 'rooms':
        checkRect(add, `${base}.box`, entry.box, data, transition.id);
        (entry.slots ?? []).forEach((slot, i) => {
          checkPoint(add, `${base}.slots[${i}]`, slot, data, transition.id);
          if (!pointInRect(slot, entry.box)) {
            add(
              'V5',
              'error',
              `${base}.slots[${i}]`,
              'The slot lies outside the box',
              transition.id,
            );
          }
        });
        if (entry.kind === 'area' || entry.kind === 'rooms') {
          (entry.rooms ?? []).forEach((room, i) => {
            checkRect(add, `${base}.rooms[${i}]`, room, data, transition.id);
          });
        }
        break;
      case 'door':
      case 'dock':
      case 'waypoint':
        checkPoint(add, `${base}.pos`, entry.pos, data, transition.id);
        break;
      case 'hidden':
        break;
    }
  }
  for (const [key, arc] of Object.entries(data.arcs ?? {})) {
    if (arcKeys.has(key)) checkPath(add, `arcs.${key}.path`, arc.path, data, arcIdByKey.get(key));
    else checkPath(add, `arcs.${key}.path`, arc.path, data);
  }
  (data.decor ?? []).forEach((decor, i) => {
    const base = `decor[${i}]`;
    switch (decor.kind) {
      case 'room':
      case 'zone':
      case 'furniture':
        checkRect(add, `${base}.rect`, decor.rect, data);
        break;
      case 'wall':
        decor.segs.forEach((seg, j) => {
          checkPoint(add, `${base}.segs[${j}]`, [seg[0], seg[1]], data);
          checkPoint(add, `${base}.segs[${j}]`, [seg[2], seg[3]], data);
        });
        break;
      case 'label':
        checkPoint(add, `${base}.pos`, decor.pos, data);
        break;
      case 'scale':
        checkPoint(add, `${base}.pos`, decor.pos, data);
        checkPoint(add, `${base}.pos`, [decor.pos[0] + decor.px, decor.pos[1]], data);
        break;
    }
  });

  // V6: room for the resources and for a queue (warnings).
  for (const place of net.places) {
    const entry = data.places[place.id];
    if (!entry) continue;
    if (entry.kind === 'slots') {
      const initial = net.marking[place.id]?.length ?? 0;
      const target = data.transitions[entry.of];
      const available = slotsOfTransition(target)?.length ?? 0;
      if (
        target &&
        transitionIds.has(entry.of) &&
        loops(place.id, entry.of) &&
        available < initial
      ) {
        add(
          'V6',
          'warning',
          `transitions.${entry.of}.slots`,
          `"${place.name}" starts with ${initial} resources but transition "${entry.of}" has only ${available} slots`,
          entry.of,
        );
      }
    }
    if (
      (entry.kind === 'queue' || entry.kind === 'conveyor' || entry.kind === 'buffer') &&
      entry.path.length >= 2 &&
      pathLength(entry.path) < MIN_QUEUE_LENGTH
    ) {
      add(
        'V6',
        'warning',
        `places.${place.id}.path`,
        `The path of "${place.name}" is ${Math.round(pathLength(entry.path))} px long; ${MIN_QUEUE_LENGTH} px hold ten tokens`,
        place.id,
      );
    }
  }

  // V7: the view belongs to this net.
  const expected = netHash(net);
  if (data.netHash !== expected) {
    add(
      'V7',
      'warning',
      'netHash',
      'The net has changed since the view was made (elements added, removed or reconnected)',
    );
  }

  // V8: queues of cases should be visible.
  for (const place of net.places) {
    const entry = data.places[place.id];
    if (entry?.kind === 'hidden' && roles.get(place.id) === 'case') {
      add(
        'V8',
        'warning',
        `places.${place.id}`,
        `Place "${place.name}" holds cases and should not be hidden`,
        place.id,
      );
    }
  }

  const order = (d: DomainDiagnostic): number => DOMAIN_RULES.indexOf(d.rule);
  diagnostics.sort((a, b) => order(a) - order(b));
  return {
    ok: !diagnostics.some((d) => d.severity === 'error'),
    view: data,
    diagnostics,
  };
}
