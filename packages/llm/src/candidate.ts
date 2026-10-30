import type { Id, PetriNet } from '@pnm/core';
import {
  arcKey,
  domainViewSchema,
  genericDomainView,
  netHash,
  provenanceKey,
  schemaDiagnostics,
  validateDomainView,
  type DomainDiagnostic,
  type DomainMeta,
  type DomainView,
  type Provenance,
} from '@pnm/domain';
import { z } from 'zod';
import type { Canvas } from './prompt';

/**
 * What the model has written so far, as loosely typed data. It is merged from the answers of the
 * rounds and only turned into a `DomainView` after every entry was checked.
 */
export interface Candidate {
  meta?: unknown;
  places: Record<string, unknown>;
  transitions: Record<string, unknown>;
  arcs: Record<string, unknown>;
  decor?: unknown[];
}

export function emptyCandidate(): Candidate {
  return { places: {}, transitions: {}, arcs: {} };
}

export function isEmpty(candidate: Candidate): boolean {
  return (
    candidate.meta === undefined &&
    Object.keys(candidate.places).length === 0 &&
    Object.keys(candidate.transitions).length === 0 &&
    Object.keys(candidate.arcs).length === 0 &&
    (candidate.decor?.length ?? 0) === 0
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const SECTIONS = ['meta', 'places', 'transitions', 'arcs', 'decor'] as const;

/** Models sometimes wrap the answer, for example in `{ "domainView": { ... } }`. */
function unwrap(json: unknown): Record<string, unknown> | null {
  if (!isRecord(json)) return null;
  if (SECTIONS.some((key) => key in json)) return json;
  const inner = Object.values(json);
  const only = inner.length === 1 ? inner[0] : undefined;
  if (isRecord(only) && SECTIONS.some((key) => key in only)) return only;
  return json;
}

export interface MergeResult {
  candidate: Candidate;
  /** False if the answer was no JSON object or had nothing to take over. */
  usable: boolean;
  /** Paths of the entries this answer wrote. */
  written: string[];
}

/**
 * Takes over an answer. With `replace` it replaces everything (the first answer); otherwise the
 * entries it contains replace the old ones and the rest stays (answers to a repair request).
 * Unknown keys, `netHash` and `provenance` are ignored.
 */
export function mergeAnswer(previous: Candidate, json: unknown, replace: boolean): MergeResult {
  const answer = unwrap(json);
  if (!answer) return { candidate: previous, usable: false, written: [] };
  const base: Candidate = replace
    ? emptyCandidate()
    : {
        ...(previous.meta !== undefined && { meta: previous.meta }),
        places: { ...previous.places },
        transitions: { ...previous.transitions },
        arcs: { ...previous.arcs },
        ...(previous.decor !== undefined && { decor: [...previous.decor] }),
      };
  const written: string[] = [];
  if ('meta' in answer) {
    base.meta = answer['meta'];
    written.push('meta');
  }
  for (const section of ['places', 'transitions', 'arcs'] as const) {
    const entries = answer[section];
    if (!isRecord(entries)) continue;
    for (const [key, entry] of Object.entries(entries)) {
      base[section][key] = entry;
      written.push(`${section}.${key}`);
    }
  }
  if (Array.isArray(answer['decor'])) {
    base.decor = answer['decor'];
    written.push('decor');
  }
  return { candidate: base, usable: written.length > 0, written };
}

const PLACEHOLDER_DECOR = { kind: 'furniture', rect: [0, 0, 1, 1] };

const candidateSchema = z.strictObject({
  meta: domainViewSchema.shape.meta,
  places: domainViewSchema.shape.places,
  transitions: domainViewSchema.shape.transitions,
  arcs: domainViewSchema.shape.arcs,
  decor: domainViewSchema.shape.decor,
});

export interface Inspection {
  /** All findings: the schema problems of single entries and the rules V2 to V9 on the rest. */
  diagnostics: DomainDiagnostic[];
  /** The candidate without the entries that break the schema; it passes the schema check. */
  view: DomainView;
  /** Paths of entries that were left out because they break the schema. */
  invalid: string[];
  /**
   * Indices into the `decor` of the candidate that break the schema. They are kept in `view` as a
   * harmless placeholder, so that the indices in the findings stay the ones of the candidate.
   */
  invalidDecor: number[];
  /** True if `meta` was replaced by a generic one. */
  metaReplaced: boolean;
}

/** Keys of the provenance for the entries of a candidate that belong to the net. */
function provenanceFor(
  net: PetriNet,
  view: Pick<DomainView, 'places' | 'transitions' | 'arcs'>,
  entry: Provenance,
): Record<string, Provenance> {
  const placeIds = new Set(net.places.map((p) => p.id));
  const transitionIds = new Set(net.transitions.map((t) => t.id));
  const arcKeys = new Set(net.arcs.map((a) => arcKey(a.source, a.target)));
  const out: Record<string, Provenance> = {};
  for (const id of Object.keys(view.places)) {
    if (placeIds.has(id)) out[provenanceKey.place(id)] = entry;
  }
  for (const id of Object.keys(view.transitions)) {
    if (transitionIds.has(id)) out[provenanceKey.transition(id)] = entry;
  }
  for (const key of Object.keys(view.arcs ?? {})) {
    if (arcKeys.has(key)) out[provenanceKey.arc(key)] = entry;
  }
  return out;
}

/**
 * Checks a candidate against the net. Entries that break the schema are reported (rule V1) and
 * left out, so that the rules V2 to V9 can still be checked on everything else; one round then
 * reports all findings and not only the first kind.
 */
export function inspect(
  net: PetriNet,
  candidate: Candidate,
  provenance: Provenance,
  canvas: Canvas,
): Inspection {
  const input = {
    ...(candidate.meta !== undefined && { meta: candidate.meta }),
    places: candidate.places,
    transitions: candidate.transitions,
    arcs: candidate.arcs,
    ...(candidate.decor !== undefined && { decor: candidate.decor }),
  };
  const parsed = candidateSchema.safeParse(input);
  const v1: DomainDiagnostic[] = [];
  const badPlaces = new Set<Id>();
  const badTransitions = new Set<Id>();
  const badArcs = new Set<string>();
  const badDecor = new Set<number>();
  let badMeta = false;
  let badSections = new Set<string>();
  if (!parsed.success) {
    v1.push(...schemaDiagnostics(net, parsed.error));
    badSections = new Set();
    for (const issue of parsed.error.issues) {
      const [section, key] = issue.path;
      if (section === 'meta') badMeta = true;
      else if (section === 'places' || section === 'transitions' || section === 'arcs') {
        if (typeof key !== 'string') badSections.add(section);
        else if (section === 'places') badPlaces.add(key);
        else if (section === 'transitions') badTransitions.add(key);
        else badArcs.add(key);
      } else if (section === 'decor') {
        if (typeof key === 'number') badDecor.add(key);
        else badSections.add('decor');
      }
    }
  }

  const generic = genericDomainView(net, { canvas, at: provenance.at });
  const without = <T>(entries: Record<string, T>, bad: Set<string>, whole: boolean) =>
    whole ? {} : Object.fromEntries(Object.entries(entries).filter(([key]) => !bad.has(key)));
  const meta: DomainMeta =
    badMeta || candidate.meta === undefined ? generic.meta : (candidate.meta as DomainMeta);
  const places = without(candidate.places, badPlaces, badSections.has('places'));
  const transitions = without(
    candidate.transitions,
    badTransitions,
    badSections.has('transitions'),
  );
  const arcs = without(candidate.arcs, badArcs, badSections.has('arcs'));
  const decor: unknown[] = badSections.has('decor')
    ? []
    : (candidate.decor ?? []).map((item, i) => (badDecor.has(i) ? PLACEHOLDER_DECOR : item));
  const partial = {
    schemaVersion: 1 as const,
    netHash: netHash(net),
    meta,
    places,
    transitions,
    arcs,
    ...(decor.length > 0 || candidate.decor !== undefined ? { decor } : {}),
  } as unknown as DomainView;
  const view: DomainView = { ...partial, provenance: provenanceFor(net, partial, provenance) };

  const rest = validateDomainView(net, view);
  const invalidIds = new Set([...badPlaces, ...badTransitions]);
  // A missing entry is no news for an entry that was reported as broken.
  const others = rest.diagnostics.filter(
    (d) => !(d.rule === 'V3' && d.elementId !== undefined && invalidIds.has(d.elementId)),
  );
  const order = (d: DomainDiagnostic): number => Number(d.rule.slice(1));
  const diagnostics = [...v1, ...others].sort((a, b) => order(a) - order(b));

  const invalid = [
    ...(badMeta ? ['meta'] : []),
    ...[...badPlaces].map((id) => provenanceKey.place(id)),
    ...[...badTransitions].map((id) => provenanceKey.transition(id)),
    ...[...badArcs].map((key) => provenanceKey.arc(key)),
    ...[...badDecor].sort((a, b) => a - b).map((i) => `decor[${i}]`),
    ...[...badSections],
  ];
  return {
    diagnostics,
    view: rest.view ?? view,
    invalid,
    invalidDecor: [...badDecor].sort((a, b) => a - b),
    metaReplaced: badMeta || candidate.meta === undefined,
  };
}
