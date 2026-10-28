import type { Id, PetriNet } from './model';
import { formatIssues, netSchema } from './schema';

export type Severity = 'error' | 'warning';

export type DiagnosticCode =
  | 'SCHEMA_INVALID'
  | 'DUPLICATE_ID'
  | 'ARC_DANGLING'
  | 'ARC_NOT_BIPARTITE'
  | 'ARC_WEIGHT_INVALID'
  | 'CAPACITY_INVALID'
  | 'MARKING_UNKNOWN_PLACE'
  | 'MARKING_EXCEEDS_CAPACITY'
  | 'DUPLICATE_NAME'
  | 'ISOLATED_NODE'
  | 'MULTIPLE_ARCS';

export interface Diagnostic {
  severity: Severity;
  code: DiagnosticCode;
  message: string;
  elementId?: Id;
}

/**
 * Checks the structure of a net. Errors mean the net violates the model
 * (it may not behave as expected); warnings point at likely mistakes.
 */
export function validate(net: PetriNet): Diagnostic[] {
  const schemaResult = netSchema.safeParse(net);
  if (!schemaResult.success) {
    return formatIssues(schemaResult.error).map((message) => ({
      severity: 'error',
      code: 'SCHEMA_INVALID',
      message,
    }));
  }

  const out: Diagnostic[] = [];
  const push = (d: Diagnostic): void => {
    out.push(d);
  };

  // Unique ids across all element kinds.
  const seen = new Set<Id>();
  const reported = new Set<Id>();
  const everything = [
    ...net.places.map((e) => e.id),
    ...net.transitions.map((e) => e.id),
    ...net.arcs.map((e) => e.id),
    ...(net.annotations ?? []).map((e) => e.id),
  ];
  for (const id of everything) {
    if (seen.has(id) && !reported.has(id)) {
      reported.add(id);
      push({
        severity: 'error',
        code: 'DUPLICATE_ID',
        message: `The id "${id}" is used by more than one element.`,
        elementId: id,
      });
    }
    seen.add(id);
  }

  const placeById = new Map(net.places.map((p) => [p.id, p]));
  const transitionById = new Map(net.transitions.map((t) => [t.id, t]));

  // Arcs.
  for (const arc of net.arcs) {
    const sourceIsPlace = placeById.has(arc.source);
    const sourceIsTransition = transitionById.has(arc.source);
    const targetIsPlace = placeById.has(arc.target);
    const targetIsTransition = transitionById.has(arc.target);
    if (!(sourceIsPlace || sourceIsTransition) || !(targetIsPlace || targetIsTransition)) {
      push({
        severity: 'error',
        code: 'ARC_DANGLING',
        message: 'This arc refers to a node that does not exist.',
        elementId: arc.id,
      });
    } else if (sourceIsPlace === targetIsPlace) {
      push({
        severity: 'error',
        code: 'ARC_NOT_BIPARTITE',
        message: sourceIsPlace
          ? 'An arc must not connect two places.'
          : 'An arc must not connect two transitions.',
        elementId: arc.id,
      });
    }
    if (!Number.isInteger(arc.weight) || arc.weight < 1) {
      push({
        severity: 'error',
        code: 'ARC_WEIGHT_INVALID',
        message: `Arc weight must be an integer of at least 1 (found ${arc.weight}).`,
        elementId: arc.id,
      });
    }
  }

  // Capacities and marking.
  for (const place of net.places) {
    if (place.capacity !== undefined && (!Number.isInteger(place.capacity) || place.capacity < 1)) {
      push({
        severity: 'error',
        code: 'CAPACITY_INVALID',
        message: `Capacity of "${place.name}" must be an integer of at least 1 (found ${place.capacity}).`,
        elementId: place.id,
      });
    }
  }
  for (const [placeId, tokens] of Object.entries(net.marking)) {
    const place = placeById.get(placeId);
    if (!place) {
      push({
        severity: 'error',
        code: 'MARKING_UNKNOWN_PLACE',
        message: `The marking refers to an unknown place "${placeId}".`,
        elementId: placeId,
      });
    } else if (place.capacity !== undefined && tokens.length > place.capacity) {
      push({
        severity: 'error',
        code: 'MARKING_EXCEEDS_CAPACITY',
        message: `"${place.name}" holds ${tokens.length} tokens but has capacity ${place.capacity}.`,
        elementId: place.id,
      });
    }
  }

  // Duplicate names (per kind, empty names are ignored).
  for (const group of [net.places, net.transitions]) {
    const byName = new Map<string, Id[]>();
    for (const node of group) {
      if (node.name.trim() === '') continue;
      byName.set(node.name, [...(byName.get(node.name) ?? []), node.id]);
    }
    for (const [name, ids] of byName) {
      if (ids.length < 2) continue;
      for (const id of ids) {
        push({
          severity: 'warning',
          code: 'DUPLICATE_NAME',
          message: `The name "${name}" is used by ${ids.length} elements.`,
          elementId: id,
        });
      }
    }
  }

  // Isolated nodes.
  const connected = new Set<Id>();
  for (const arc of net.arcs) {
    connected.add(arc.source);
    connected.add(arc.target);
  }
  for (const node of [...net.places, ...net.transitions]) {
    if (!connected.has(node.id)) {
      push({
        severity: 'warning',
        code: 'ISOLATED_NODE',
        message: `"${node.name}" is not connected to any arc.`,
        elementId: node.id,
      });
    }
  }

  // Parallel arcs of the same direction.
  const firstArc = new Map<string, Id>();
  for (const arc of net.arcs) {
    const key = JSON.stringify([arc.source, arc.target]);
    const first = firstArc.get(key);
    if (first === undefined) {
      firstArc.set(key, arc.id);
    } else {
      push({
        severity: 'warning',
        code: 'MULTIPLE_ARCS',
        message:
          'There is already an arc in this direction between the same nodes. Increase its weight instead.',
        elementId: arc.id,
      });
    }
  }

  return out;
}

export function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === 'error');
}
