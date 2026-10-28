import { parseInputInscription, referencedVariables, tryCompile } from '@pnm/expr';
import type { Diagnostic } from './diagnostic';
import type { Arc, Id, PetriNet, Place } from './model';
import { formatIssues, netSchema } from './schema';
import { tokenLabel } from './token';
import { compileType, validateTypeName } from './types';

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

  validateHigher(net, push);

  return out;
}

const identifier = (text: string): string => `"${text}"`;

/** Describes where in an inscription a problem is, for messages. */
function atPosition(message: string, position: number | undefined): string {
  return position === undefined ? message : `${message} (at position ${position + 1})`;
}

/** Checks for types, inscriptions and guards. P/T nets only get a hint that these are ignored. */
function validateHigher(net: PetriNet, push: (d: Diagnostic) => void): void {
  if (net.profile === 'pt-net') {
    const ignored = (what: string, name: string, id: Id): void => {
      push({
        severity: 'warning',
        code: 'INSCRIPTION_ON_PT_NET',
        message: `${what} of ${identifier(name)} is ignored because this is a place/transition net.`,
        elementId: id,
      });
    };
    for (const place of net.places) {
      if (place.type !== undefined) ignored('The type', place.name, place.id);
    }
    for (const transition of net.transitions) {
      if (!isBlank(transition.guard)) ignored('The guard', transition.name, transition.id);
    }
    const nodeName = new Map<Id, string>([
      ...net.places.map((p): [Id, string] => [p.id, p.name]),
      ...net.transitions.map((t): [Id, string] => [t.id, t.name]),
    ]);
    for (const arc of net.arcs) {
      if (!isBlank(arc.inscription)) {
        ignored(
          'The inscription',
          `the arc from ${nodeName.get(arc.source) ?? arc.source}`,
          arc.id,
        );
      }
    }
    return;
  }

  // Types.
  const usedTypes = new Set(net.places.flatMap((p) => (p.type === undefined ? [] : [p.type])));
  for (const name of Object.keys(net.types)) {
    if (!validateTypeName(name)) {
      push({
        severity: 'error',
        code: 'TYPE_NAME_INVALID',
        message: `The type name ${identifier(name)} must start with a letter and contain only letters, digits and _.`,
        typeName: name,
      });
    }
    const compiled = compileType(net.types[name]);
    if (!compiled.ok) {
      push({
        severity: 'error',
        code: 'TYPE_SCHEMA_INVALID',
        message: `The schema of type ${identifier(name)} is invalid: ${compiled.error}`,
        typeName: name,
      });
    }
    if (!usedTypes.has(name)) {
      push({
        severity: 'warning',
        code: 'TYPE_UNUSED',
        message: `The type ${identifier(name)} is not used by any place.`,
        typeName: name,
      });
    }
  }
  for (const place of net.places) {
    if (place.type !== undefined && !Object.hasOwn(net.types, place.type)) {
      push({
        severity: 'error',
        code: 'TYPE_UNKNOWN',
        message: `${identifier(place.name)} has the type ${identifier(place.type)}, which does not exist.`,
        elementId: place.id,
        typeName: place.type,
      });
    }
  }
  for (const place of net.places) validateInitialTokens(net, place, push);

  // Inscriptions and guards.
  const placeIds = new Set(net.places.map((p) => p.id));
  const transitionIds = new Set(net.transitions.map((t) => t.id));
  const boundVariables = new Map<Id, Set<string>>();
  const inputOf = (arc: Arc): boolean => placeIds.has(arc.source) && transitionIds.has(arc.target);
  const outputOf = (arc: Arc): boolean => transitionIds.has(arc.source) && placeIds.has(arc.target);

  for (const arc of net.arcs) {
    if (isBlank(arc.inscription)) continue;
    if (arc.weight > 1) {
      push({
        severity: 'warning',
        code: 'WEIGHT_IGNORED',
        message: `The weight ${arc.weight} is ignored because the arc has an inscription; the inscription decides how many tokens are moved.`,
        elementId: arc.id,
      });
    }
    if (inputOf(arc)) {
      const parsed = parseInputInscription(arc.inscription!);
      if (parsed.ok) {
        const set = boundVariables.get(arc.target) ?? new Set<string>();
        for (const name of parsed.variables) set.add(name);
        boundVariables.set(arc.target, set);
      } else {
        push({
          severity: 'error',
          code: 'INSCRIPTION_SYNTAX',
          message: atPosition(`Input inscription: ${parsed.error.message}`, parsed.error.position),
          elementId: arc.id,
        });
      }
    }
  }

  const unbound = (
    names: readonly string[],
    transitionId: Id,
    transitionName: string,
    elementId: Id,
    where: string,
  ): void => {
    const bound = boundVariables.get(transitionId) ?? new Set<string>();
    for (const name of names) {
      if (bound.has(name)) continue;
      push({
        severity: 'error',
        code: 'VARIABLE_UNBOUND',
        message: `${where} uses $${name}, which no input arc of ${identifier(transitionName)} binds.`,
        elementId,
      });
    }
  };

  for (const transition of net.transitions) {
    if (isBlank(transition.guard)) continue;
    const compiled = tryCompile(transition.guard!);
    if (!compiled.ok) {
      push({
        severity: 'error',
        code: 'GUARD_SYNTAX',
        message: atPosition(
          `Guard of ${identifier(transition.name)}: ${compiled.error.message}`,
          compiled.error.position,
        ),
        elementId: transition.id,
      });
    } else {
      unbound(
        referencedVariables(compiled.expr),
        transition.id,
        transition.name,
        transition.id,
        'The guard',
      );
    }
  }

  for (const arc of net.arcs) {
    if (isBlank(arc.inscription) || !outputOf(arc)) continue;
    const compiled = tryCompile(arc.inscription!);
    if (!compiled.ok) {
      push({
        severity: 'error',
        code: 'INSCRIPTION_SYNTAX',
        message: atPosition(
          `Output inscription: ${compiled.error.message}`,
          compiled.error.position,
        ),
        elementId: arc.id,
      });
    } else {
      const transition = net.transitions.find((t) => t.id === arc.source)!;
      unbound(
        referencedVariables(compiled.expr),
        transition.id,
        transition.name,
        arc.id,
        'The output inscription',
      );
    }
  }
}

function validateInitialTokens(net: PetriNet, place: Place, push: (d: Diagnostic) => void): void {
  const tokens = net.marking[place.id];
  if (place.type === undefined || !tokens || !Object.hasOwn(net.types, place.type)) return;
  const compiled = compileType(net.types[place.type]);
  if (!compiled.ok) return; // reported as TYPE_SCHEMA_INVALID
  const failures: string[] = [];
  tokens.forEach((token, index) => {
    const verdict = compiled.check(token);
    if (!verdict.ok) {
      failures.push(`token ${index + 1} ${tokenLabel(token, 30)}: ${verdict.errors.join('; ')}`);
    }
  });
  if (failures.length === 0) return;
  const shown = failures.slice(0, 3).join(' | ');
  const more = failures.length > 3 ? ` (and ${failures.length - 3} more)` : '';
  push({
    severity: 'error',
    code: 'TOKEN_TYPE_MISMATCH',
    message: `${failures.length} initial ${failures.length === 1 ? 'token' : 'tokens'} on ${identifier(place.name)} violate the type ${identifier(place.type)}: ${shown}${more}`,
    elementId: place.id,
    typeName: place.type,
  });
}

function isBlank(text: string | undefined): boolean {
  return text === undefined || text.trim() === '';
}
