import { parseInputInscription, tryCompile } from '@pnm/expr';
import type { Id, PetriNet } from '@pnm/core';
import type { EditorDiagnostic } from '../components/editor/lazy-code-editor';
import { en } from '../i18n/en';

export type InscriptionKind = 'input' | 'output' | 'guard';

/** A variable bound by an input arc of a transition. */
export interface BoundVariable {
  name: string;
  arcId: Id;
  placeId: Id;
  placeName: string;
}

/** Variables bound by the input arcs of a transition, in arc order, without duplicates. */
export function boundVariables(net: PetriNet, transitionId: Id): BoundVariable[] {
  const seen = new Set<string>();
  const out: BoundVariable[] = [];
  for (const arc of net.arcs) {
    if (arc.target !== transitionId) continue;
    const place = net.places.find((p) => p.id === arc.source);
    if (!place || arc.inscription === undefined) continue;
    const parsed = parseInputInscription(arc.inscription);
    if (!parsed.ok) continue;
    for (const name of parsed.variables) {
      if (seen.has(name)) continue;
      seen.add(name);
      out.push({ name, arcId: arc.id, placeId: place.id, placeName: place.name });
    }
  }
  return out;
}

/** Direction of an arc as far as the model tells: into a transition, or out of one. */
export function arcDirection(net: PetriNet, arcId: Id): 'input' | 'output' | null {
  const arc = net.arcs.find((a) => a.id === arcId);
  if (!arc) return null;
  if (
    net.places.some((p) => p.id === arc.source) &&
    net.transitions.some((t) => t.id === arc.target)
  ) {
    return 'input';
  }
  if (
    net.transitions.some((t) => t.id === arc.source) &&
    net.places.some((p) => p.id === arc.target)
  ) {
    return 'output';
  }
  return null;
}

export interface InscriptionCheck {
  diagnostics: EditorDiagnostic[];
  /** Blocking problem (syntax error), shown in red. */
  error: string | null;
  /** Non-blocking problem (unbound variable), shown in amber. */
  warning: string | null;
  /** Variables the text binds (input) or refers to (output and guard). */
  variables: string[];
}

/**
 * Checks the text of an inscription or guard while it is being typed. `bound` lists the variables
 * that input arcs of the transition provide; output inscriptions and guards may only use those.
 */
export function checkInscription(
  kind: InscriptionKind,
  text: string,
  bound: readonly string[],
): InscriptionCheck {
  const empty: InscriptionCheck = { diagnostics: [], error: null, warning: null, variables: [] };
  if (text.trim() === '') return empty;

  if (kind === 'input') {
    const parsed = parseInputInscription(text);
    if (parsed.ok) return { ...empty, variables: [...new Set(parsed.variables)] };
    const { message, position = 0, end = position + 1 } = parsed.error;
    return {
      ...empty,
      error: en.inscriptions.syntaxError(message),
      diagnostics: [
        { from: position, to: Math.max(end, position + 1), severity: 'error', message },
      ],
    };
  }

  const compiled = tryCompile(text);
  if (!compiled.ok) {
    const { message, position = 0, end = position + 1 } = compiled.error;
    return {
      ...empty,
      error: en.inscriptions.syntaxError(message),
      diagnostics: [
        { from: position, to: Math.max(end, position + 1), severity: 'error', message },
      ],
    };
  }
  const variables = compiled.expr.variables;
  const unbound = variables.filter((name) => !bound.includes(name));
  if (unbound.length === 0) return { ...empty, variables };
  const message = en.inscriptions.unbound(unbound);
  const diagnostics: EditorDiagnostic[] = [];
  for (const name of unbound) {
    const pattern = new RegExp(`\\$${name}(?![\\p{L}\\p{N}_])`, 'gu');
    for (const match of text.matchAll(pattern)) {
      diagnostics.push({
        from: match.index,
        to: match.index + match[0].length,
        severity: 'warning',
        message: en.inscriptions.unbound([name]),
      });
    }
  }
  return { diagnostics, error: null, warning: message, variables };
}

/** Shortens text for labels on the canvas. */
export function truncate(text: string, max: number): string {
  const single = text.replace(/\s+/g, ' ').trim();
  return single.length <= max ? single : `${single.slice(0, max - 1)}…`;
}
