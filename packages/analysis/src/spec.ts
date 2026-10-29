import type { Id, PetriNet } from '@pnm/core';
import {
  DECLARE_TEMPLATES,
  declareDfa,
  declareFormula,
  describeDeclare,
  formatDeclare,
  validateDeclare,
  TEMPLATE_INFO,
  type DeclareSpec,
  type DeclareTemplate,
} from './declare';
import type { Dfa } from './dfa';
import {
  LtlfSyntaxError,
  LtlfTooLarge,
  ltlfAtoms,
  ltlfToDfa,
  parseLtlf,
  evaluateLtlf,
  type Ltlf,
  type LtlfDfaOptions,
} from './ltlf';

/**
 * A property to check, as it is stored in the `properties` list of the net document: a DECLARE
 * template with its activities or a free LTLf formula. Activities are transition names.
 */
export type PropertySpec =
  | {
      id: string;
      name?: string;
      kind: 'declare';
      template: DeclareTemplate;
      activities: string[];
      n?: number;
    }
  | { id: string; name?: string; kind: 'ltlf'; formula: string };

export interface ParsedProperties {
  properties: PropertySpec[];
  /** One message per entry that was dropped. */
  errors: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads the `properties` field of a net document. Entries that are not valid are left out and
 * reported; a value that is not a list reads as empty.
 */
export function parseProperties(value: unknown): ParsedProperties {
  const properties: PropertySpec[] = [];
  const errors: string[] = [];
  if (value === undefined) return { properties, errors };
  if (!Array.isArray(value)) return { properties, errors: ['properties must be a list.'] };
  const ids = new Set<string>();
  value.forEach((entry: unknown, index) => {
    const where = `properties[${index}]`;
    if (!isRecord(entry)) {
      errors.push(`${where}: must be an object.`);
      return;
    }
    const { id, kind, name } = entry;
    if (typeof id !== 'string' || id === '') {
      errors.push(`${where}: needs an id.`);
      return;
    }
    if (ids.has(id)) {
      errors.push(`${where}: the id "${id}" is used twice.`);
      return;
    }
    if (name !== undefined && typeof name !== 'string') {
      errors.push(`${where}: name must be text.`);
      return;
    }
    const label = typeof name === 'string' && name !== '' ? { name } : {};
    if (kind === 'ltlf') {
      if (typeof entry.formula !== 'string') {
        errors.push(`${where}: an LTLf property needs a formula.`);
        return;
      }
      ids.add(id);
      properties.push({ id, kind, ...label, formula: entry.formula });
      return;
    }
    if (kind === 'declare') {
      const template = entry.template;
      if (
        typeof template !== 'string' ||
        !(DECLARE_TEMPLATES as readonly string[]).includes(template)
      ) {
        errors.push(`${where}: unknown template ${JSON.stringify(template)}.`);
        return;
      }
      const activities = entry.activities;
      if (!Array.isArray(activities) || !activities.every((a) => typeof a === 'string')) {
        errors.push(`${where}: activities must be a list of names.`);
        return;
      }
      if (entry.n !== undefined && typeof entry.n !== 'number') {
        errors.push(`${where}: n must be a number.`);
        return;
      }
      ids.add(id);
      properties.push({
        id,
        kind,
        ...label,
        template: template as DeclareTemplate,
        activities: activities as string[],
        ...(entry.n !== undefined && { n: entry.n }),
      });
      return;
    }
    errors.push(`${where}: kind must be "declare" or "ltlf".`);
  });
  return { properties, errors };
}

/** The DECLARE part of a property. */
export function declareOf(spec: Extract<PropertySpec, { kind: 'declare' }>): DeclareSpec {
  return {
    template: spec.template,
    activities: spec.activities,
    ...(spec.n !== undefined && { n: spec.n }),
  };
}

/** Short text of a property: `response(Approve, Create invoice)` or the formula. */
export function propertyText(spec: PropertySpec): string {
  return spec.kind === 'declare' ? formatDeclare(declareOf(spec)) : spec.formula.trim();
}

/** The name given to the property, else its text. */
export function propertyTitle(spec: PropertySpec): string {
  return spec.name !== undefined && spec.name !== '' ? spec.name : propertyText(spec);
}

/** A sentence for the property: the meaning of the template, or the formula itself. */
export function propertyMeaning(spec: PropertySpec): string {
  return spec.kind === 'declare'
    ? describeDeclare(declareOf(spec))
    : `Every run satisfies ${spec.formula.trim()}.`;
}

// --- activities of a net ----------------------------------------------------------------------

export interface ActivityLabels {
  /** The activity name of every transition. */
  labelOf: Map<Id, string>;
  /** The transitions that carry an activity name. */
  transitionsOf: Map<string, Id[]>;
  /** Activity names in the order of the transitions. */
  labels: string[];
}

/**
 * The activity of a transition is its name; if the name is empty or several transitions share it,
 * the id stands in, so that every activity names exactly one transition.
 */
export function activityLabels(net: PetriNet): ActivityLabels {
  const uses = new Map<string, number>();
  for (const t of net.transitions) uses.set(t.name, (uses.get(t.name) ?? 0) + 1);
  const labelOf = new Map<Id, string>();
  const transitionsOf = new Map<string, Id[]>();
  const labels: string[] = [];
  for (const t of net.transitions) {
    const label = t.name !== '' && uses.get(t.name) === 1 ? t.name : t.id;
    labelOf.set(t.id, label);
    labels.push(label);
    const list = transitionsOf.get(label);
    if (list) list.push(t.id);
    else transitionsOf.set(label, [t.id]);
  }
  return { labelOf, transitionsOf, labels };
}

// --- compiling a property ---------------------------------------------------------------------

export interface CompiledProperty {
  spec: PropertySpec;
  /** The automaton, if it could be built (always for DECLARE; LTLf within the size limits). */
  dfa: Dfa | null;
  /** The LTLf formula of the property (the definition of the template for DECLARE). */
  formula: Ltlf | null;
  /** Why the property cannot be checked, if it cannot. */
  error: string | null;
  /** The automaton is missing only because the formula is too large; traces can still be evaluated. */
  tooLarge: boolean;
}

/**
 * Parses and translates a property. `activities` (the names in the net) is used to find activities
 * that do not exist; pass `null` to skip that check (logs may contain other activities).
 */
export function compileProperty(
  spec: PropertySpec,
  activities: readonly string[] | null,
  options: LtlfDfaOptions = {},
): CompiledProperty {
  const fail = (
    error: string,
    tooLarge = false,
    formula: Ltlf | null = null,
  ): CompiledProperty => ({
    spec,
    dfa: null,
    formula,
    error,
    tooLarge,
  });
  let mentioned: string[];
  let formula: Ltlf;
  if (spec.kind === 'declare') {
    const declare = declareOf(spec);
    const problem = validateDeclare(declare);
    if (problem) return fail(problem);
    mentioned = declare.activities;
    formula = declareFormula(declare);
  } else {
    try {
      formula = parseLtlf(spec.formula);
    } catch (error) {
      if (error instanceof LtlfSyntaxError) return fail(error.message);
      throw error;
    }
    mentioned = ltlfAtoms(formula);
  }
  if (activities !== null) {
    const unknown = mentioned.filter((a) => !activities.includes(a));
    if (unknown.length > 0) {
      return fail(
        `Unknown ${unknown.length === 1 ? 'activity' : 'activities'}: ${unknown.map((a) => `"${a}"`).join(', ')}. Activities are the names of the transitions.`,
        false,
        formula,
      );
    }
  }
  if (spec.kind === 'declare') {
    return { spec, dfa: declareDfa(declareOf(spec)), formula, error: null, tooLarge: false };
  }
  try {
    return { spec, dfa: ltlfToDfa(formula, options), formula, error: null, tooLarge: false };
  } catch (error) {
    if (error instanceof LtlfTooLarge) return fail(error.message, true, formula);
    throw error;
  }
}

/** True if a trace satisfies the property (DECLARE via its automaton, LTLf by direct evaluation). */
export function satisfies(compiled: CompiledProperty, trace: readonly string[]): boolean {
  if (compiled.dfa !== null) return compiled.dfa.accepts(trace);
  if (compiled.formula !== null) return evaluateLtlf(compiled.formula, trace);
  throw new Error(compiled.error ?? 'The property cannot be evaluated.');
}

export { TEMPLATE_INFO };
