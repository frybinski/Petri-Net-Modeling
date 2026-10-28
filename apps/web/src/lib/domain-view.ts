import type { PetriNet } from '@pnm/core';
import {
  fillMissing,
  genericDomainViewWithLayout,
  normalizeDomainView,
  removeStale,
  validateDomainView,
  withNetHash,
  type DomainDiagnostic,
  type DomainMeta,
  type DomainValidation,
  type DomainView,
  type ProvenanceSource,
} from '@pnm/domain';
import { en } from '../i18n/en';
import { useEditorStore } from '../store/editor-store';
import { notify, useUiStore } from '../store/ui-store';
import { parseJson } from './json-text';

export interface DomainAnalysis {
  /** The net has a `domainView` field. */
  present: boolean;
  validation: DomainValidation | null;
}

/** What is known about the domain view of a net: whether there is one and what is wrong with it. */
export function analyseDomainView(net: PetriNet): DomainAnalysis {
  if (net.domainView === undefined) return { present: false, validation: null };
  return { present: true, validation: validateDomainView(net, net.domainView) };
}

export function countSeverities(diagnostics: readonly DomainDiagnostic[]): {
  errors: number;
  warnings: number;
} {
  const errors = diagnostics.filter((d) => d.severity === 'error').length;
  return { errors, warnings: diagnostics.length - errors };
}

/** How many entries of the view come from which source. */
export function originCounts(view: DomainView): Record<ProvenanceSource, number> {
  const counts: Record<ProvenanceSource, number> = { llm: 0, user: 0, generic: 0 };
  for (const entry of Object.values(view.provenance)) counts[entry.source] += 1;
  return counts;
}

/** The text shown in the JSON editor. */
export function viewToText(view: unknown): string {
  return `${JSON.stringify(view, null, 2)}\n`;
}

function entriesOf(view: DomainView): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const [id, entry] of Object.entries(view.places)) out.set(`places.${id}`, entry);
  for (const [id, entry] of Object.entries(view.transitions)) out.set(`transitions.${id}`, entry);
  for (const [key, entry] of Object.entries(view.arcs ?? {})) out.set(`arcs.${key}`, entry);
  return out;
}

/**
 * The provenance after the user edited the view as text: every entry that is new or changed gets
 * the source `user` (unless the user wrote its provenance entry themselves), and provenance of
 * entries that no longer exist is dropped.
 */
export function stampEdited(previous: DomainView | null, next: DomainView, at: string): DomainView {
  const before = previous ? entriesOf(previous) : new Map<string, unknown>();
  const after = entriesOf(next);
  const provenance = { ...next.provenance };
  for (const [key, entry] of after) {
    const changed = !before.has(key) || JSON.stringify(before.get(key)) !== JSON.stringify(entry);
    const provenanceEdited =
      JSON.stringify(previous?.provenance[key]) !== JSON.stringify(next.provenance[key]);
    if (changed && !provenanceEdited) provenance[key] = { source: 'user', at };
  }
  for (const key of Object.keys(provenance)) {
    if (!after.has(key)) delete provenance[key];
  }
  return { ...next, provenance };
}

export type ApplyResult =
  | { ok: true; view: DomainView; diagnostics: DomainDiagnostic[] }
  | { ok: false; message: string; diagnostics: DomainDiagnostic[] };

/** Checks the text of a view. It can be applied when the result is `ok`. */
export function checkViewText(net: PetriNet, text: string): ApplyResult {
  const parsed = parseJson(text);
  if (!parsed.ok) return { ok: false, message: parsed.message, diagnostics: [] };
  const result = validateDomainView(net, parsed.value);
  if (!result.view) {
    return { ok: false, message: en.domain.invalidSchema, diagnostics: result.diagnostics };
  }
  return { ok: true, view: result.view, diagnostics: result.diagnostics };
}

function editable(): boolean {
  if (useEditorStore.getState().mode === 'simulate') {
    notify('info', en.messages.editLocked);
    return false;
  }
  return true;
}

/** The valid domain view of the document, or `null` if there is none or it has errors. */
export function getDomainView(): DomainView | null {
  const analysis = analyseDomainView(useEditorStore.getState().net);
  return analysis.validation?.view ?? null;
}

/** Replaces the view by what the user wrote. Returns false if the text is not a valid view. */
export function applyViewText(text: string, at = new Date().toISOString()): boolean {
  if (!editable()) return false;
  const state = useEditorStore.getState();
  const checked = checkViewText(state.net, text);
  if (!checked.ok) {
    notify('error', checked.message);
    return false;
  }
  const edited = stampEdited(getDomainView(), normalizeDomainView(checked.view), at);
  state.setDomainView(normalizeDomainView(edited));
  const { errors, warnings } = countSeverities(checked.diagnostics);
  notify(
    errors > 0 ? 'info' : 'success',
    errors + warnings === 0
      ? en.domain.applied
      : `${en.domain.applied} ${en.status.problems(errors, warnings)}.`,
  );
  return true;
}

/** True if some entry was written by a person or a language model. */
export function hasHandMadeEntries(view: DomainView | null): boolean {
  if (!view) return false;
  return Object.values(view.provenance).some((p) => p.source === 'user' || p.source === 'llm');
}

async function generate(): Promise<void> {
  const state = useEditorStore.getState();
  try {
    const view = await genericDomainViewWithLayout(state.net);
    // A generic view is not the result of a generation: the record of an earlier one goes.
    useEditorStore.getState().replaceDomainView(normalizeDomainView(view), undefined);
    notify('success', en.domain.generated);
  } catch (error) {
    notify('error', error instanceof Error ? error.message : String(error));
  }
}

/** Makes a generic view of the net, after confirmation if the current one has hand-made entries. */
export function generateGenericView(): void {
  if (!editable()) return;
  const view = getDomainView();
  if (hasHandMadeEntries(view)) {
    useUiStore.getState().askConfirm({
      title: en.domain.replaceTitle,
      message: en.domain.replaceMessage,
      confirmLabel: en.domain.replaceConfirm,
      danger: true,
      onConfirm: () => {
        void generate();
      },
    });
    return;
  }
  void generate();
}

/** Adds generic entries for what the view lacks and drops entries of removed elements. */
export function fillMissingEntries(): void {
  if (!editable()) return;
  const view = getDomainView();
  if (!view) return;
  const state = useEditorStore.getState();
  state.setDomainView(normalizeDomainView(fillMissing(state.net, view)));
  notify('success', en.domain.filled);
}

/** Adds generic entries for what the view lacks. Entries of removed elements stay. */
export function fillMissingOnly(): void {
  if (!editable()) return;
  const view = getDomainView();
  if (!view) return;
  const state = useEditorStore.getState();
  state.setDomainView(normalizeDomainView(fillMissing(state.net, view, { dropStale: false })));
  notify('success', en.domain.filled);
}

/** Drops the entries of elements that the net no longer has. */
export function removeStaleEntries(): void {
  if (!editable()) return;
  const view = getDomainView();
  if (!view) return;
  const state = useEditorStore.getState();
  state.setDomainView(normalizeDomainView(removeStale(state.net, view)));
  notify('success', en.domain.staleRemoved);
}

/** Records the current structure of the net as the one the view is made for. */
export function updateViewHash(): void {
  if (!editable()) return;
  const view = getDomainView();
  if (!view) return;
  const state = useEditorStore.getState();
  state.setDomainView(normalizeDomainView(withNetHash(state.net, view)));
  notify('success', en.domain.hashUpdated);
}

export function removeDomainView(): void {
  if (!editable()) return;
  useEditorStore.getState().setDomainView(undefined);
  notify('info', en.domain.removed);
}

/** Changes the header of the view (theme, name, entity, canvas size). */
export function updateViewMeta(patch: (meta: DomainMeta) => DomainMeta): void {
  if (!editable()) return;
  const view = getDomainView();
  if (!view) return;
  const next = { ...view, meta: patch(view.meta) };
  const state = useEditorStore.getState();
  const result = validateDomainView(state.net, next);
  if (!result.view) {
    notify('error', result.diagnostics[0]?.message ?? en.domain.invalidSchema);
    return;
  }
  state.setDomainView(normalizeDomainView(next));
}
