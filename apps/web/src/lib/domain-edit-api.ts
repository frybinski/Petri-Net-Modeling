import type { EntryRef } from '@pnm/domain';
import { useEditorStore } from '../store/editor-store';
import { useUiStore } from '../store/ui-store';

/**
 * What the keyboard commands need from the editing of the domain view. The editing itself
 * (`domain-edit.ts` and the package `@pnm/domain` behind it) is part of the domain view's chunk,
 * which registers itself here when it loads, so that the commands do not pull it into the start.
 */
export interface DomainEditApi {
  /** True if the document has a domain view without errors, which edits can apply to. */
  hasView(): boolean;
  /** The entry that the selection stands for. */
  selectedEntry(): EntryRef | null;
  /** "Delete" in the mode "Edit layout". */
  deleteSelected(): boolean;
  /** Moves the selected entry. */
  nudgeSelected(dx: number, dy: number): boolean;
  /** Opens the label of the entry for editing, if it has one. */
  startLabel(entry: EntryRef): void;
}

let current: DomainEditApi | null = null;

export function registerDomainEditApi(api: DomainEditApi | null): void {
  current = api;
}

export function getDomainEditApi(): DomainEditApi | null {
  return current;
}

/** True while handles show and edits apply: the mode "Edit layout" of a valid view. */
export function domainEditActive(): boolean {
  return (
    useUiStore.getState().domainEdit &&
    useUiStore.getState().viewMode !== 'net' &&
    useEditorStore.getState().mode === 'edit' &&
    (current?.hasView() ?? false)
  );
}
