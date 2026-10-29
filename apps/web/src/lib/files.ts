import { NetFormatError, parseNetText, serializeNet, validate, type PetriNet } from '@pnm/core';
import { en } from '../i18n/en';
import { selectIsDirty, useEditorStore } from '../store/editor-store';
import { eventLog } from '../store/sim-log';
import { useExportStore } from '../store/export-store';
import { useImportStore } from '../store/import-store';
import { useReplayStore } from '../store/replay-store';
import { notify, useUiStore } from '../store/ui-store';

export const NET_EXTENSION = '.pn.json';

/** Turns a net name into a safe file name stem. */
export function fileStem(name: string): string {
  const stem = [...name.trim()]
    .filter((char) => char.charCodeAt(0) >= 32)
    .join('')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  return stem === '' ? 'net' : stem;
}

export function netFileName(name: string): string {
  return `${fileStem(name)}${NET_EXTENSION}`;
}

export function downloadText(fileName: string, text: string, mime: string): void {
  downloadBlob(fileName, new Blob([text], { type: mime }));
}

export function downloadBlob(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

export function saveNet(): void {
  const { net, markSaved } = useEditorStore.getState();
  const fileName = netFileName(net.name);
  downloadText(fileName, serializeNet(net), 'application/json');
  markSaved(fileName);
  notify('success', en.files.saved(fileName));
}

/** Downloads the net as a .pn.json file without marking it as saved (File > Export > JSON). */
export function exportJson(): void {
  const { net } = useEditorStore.getState();
  const fileName = netFileName(net.name);
  downloadText(fileName, serializeNet(net), 'application/json');
  notify('success', en.files.exported(fileName));
}

/**
 * Opens the dialog for the export of an image. In the domain view, and when the net has a valid
 * domain view, the image is of the domain view; the dialog lets the person switch.
 */
export function openExportImage(): void {
  if (useUiStore.getState().viewMode !== 'domain') {
    useExportStore.getState().openDialog('image', 'net');
    return;
  }
  // The check of the domain view is part of the domain view's chunk, which is loaded by now.
  void import('./domain-view').then(({ hasValidDomainView }) => {
    const { net } = useEditorStore.getState();
    useExportStore.getState().openDialog('image', hasValidDomainView(net) ? 'domain' : 'net');
  });
}

export function openExportPnml(): void {
  useExportStore.getState().openDialog('pnml');
}

export function openExportTikz(): void {
  useExportStore.getState().openDialog('tikz');
}

/**
 * Downloads the events of the running simulation as an event log: CSV with the columns
 * `case_id, activity, timestamp, lifecycle`, or XES.
 */
export async function exportEventLog(format: 'csv' | 'xes'): Promise<void> {
  const { net } = useEditorStore.getState();
  const events = eventLog.all();
  // The export formats are a chunk of their own.
  const { eventLogRows, toEventLogCsv, toXes } = await import('@pnm/io');
  const rows = eventLogRows(events, net).length;
  if (rows === 0) {
    notify('info', en.trace.exportEmpty);
    return;
  }
  const fileName = `${fileStem(net.name)}-events.${format}`;
  if (format === 'csv') downloadText(fileName, toEventLogCsv(events, net), 'text/csv');
  else downloadText(fileName, toXes(events, net), 'application/xml');
  notify('success', en.trace.exported(rows, fileName));
}

/** Runs `action` right away, or after the user confirms discarding unsaved changes. */
export function guardUnsaved(action: () => void): void {
  if (!selectIsDirty(useEditorStore.getState())) {
    action();
    return;
  }
  useUiStore.getState().askConfirm({
    title: en.files.discardTitle,
    message: en.files.discardMessage,
    confirmLabel: en.files.discard,
    danger: true,
    onConfirm: action,
  });
}

/** Loads a parsed net into the editor and reports problems found in it. */
export function openNet(net: PetriNet, fileName: string | null): void {
  useEditorStore.getState().loadNet(net, fileName);
  const errors = validate(net).filter((d) => d.severity === 'error').length;
  if (errors > 0) notify('error', en.files.loadedWithErrors(errors));
}

/** True for text that is PNML rather than a net file: it is XML. */
export function looksLikePnml(text: string, fileName: string): boolean {
  const first = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).trimStart().charAt(0);
  if (first === '<') return true;
  if (first === '{') return false;
  return /\.(pnml|xml)$/i.test(fileName);
}

/**
 * Imports PNML text as a new document. The document counts as unsaved, because the file is not a
 * `.pn.json` yet. Remarks of the import are shown in a dialog; a clean import only gets a toast.
 */
export async function importPnmlText(text: string, fileName: string): Promise<void> {
  const { fromPnml } = await import('@pnm/io');
  const result = await fromPnml(text);
  useEditorStore.getState().loadNet(result.net, null, { unsaved: true });
  const { net, warnings, laidOut } = result;
  if (warnings.length === 0 && !laidOut) {
    notify('success', en.files.imported(fileName));
    return;
  }
  notify('info', en.files.importedWithWarnings(fileName, warnings.length));
  useImportStore.getState().show({
    fileName,
    netName: net.name,
    places: net.places.length,
    transitions: net.transitions.length,
    arcs: net.arcs.length,
    laidOut,
    warnings,
  });
}

/** Reads and opens a file chosen by the user: a net file or PNML. Shows an error message for invalid files. */
export async function openFile(file: File): Promise<void> {
  try {
    const text = await file.text();
    if (looksLikePnml(text, file.name)) {
      await importPnmlText(text, file.name);
      return;
    }
    openNet(parseNetText(text), file.name);
  } catch (error) {
    if (error instanceof NetFormatError) {
      notify('error', en.files.openFailed(file.name), { details: error.issues });
    } else {
      notify('error', en.files.openFailed(file.name), {
        details: [error instanceof Error ? error.message : String(error)],
      });
    }
  }
}

let fileInput: HTMLInputElement | null = null;

/** Registers the hidden file input that `chooseFile` opens. */
export function registerFileInput(input: HTMLInputElement | null): void {
  fileInput = input;
}

/** Opens the browser's file chooser. Unsaved changes are checked once a file was picked. */
export function chooseFile(): void {
  fileInput?.click();
}

/** True for the names of event logs: CSV, TSV, plain text and XES. */
export function looksLikeEventLog(fileName: string): boolean {
  return /\.(csv|tsv|txt|xes)$/i.test(fileName);
}

/** Reads an event log file and opens the dialog that maps its activities to the transitions. */
export async function openLogFile(file: File): Promise<void> {
  try {
    useReplayStore.getState().openText(file.name, await file.text());
  } catch (error) {
    notify('error', en.replay.readFailed(file.name), {
      details: [error instanceof Error ? error.message : String(error)],
    });
  }
}

let logInput: HTMLInputElement | null = null;

/** Registers the hidden file input that `chooseLogFile` opens. */
export function registerLogFileInput(input: HTMLInputElement | null): void {
  logInput = input;
}

/** Opens the browser's file chooser for an event log. */
export function chooseLogFile(): void {
  logInput?.click();
}

/**
 * Opens a dropped or chosen file after confirming that unsaved changes may be discarded. An event
 * log (CSV, XES) is not a net: it opens the replay dialog and leaves the document alone.
 */
export function openFileGuarded(file: File): void {
  if (looksLikeEventLog(file.name)) {
    void openLogFile(file);
    return;
  }
  guardUnsaved(() => {
    void openFile(file);
  });
}

export function newNetGuarded(): void {
  guardUnsaved(() => {
    useEditorStore.getState().newNet();
  });
}

export function openExampleGuarded(net: PetriNet): void {
  guardUnsaved(() => {
    useEditorStore.getState().loadNet(net, null);
  });
}
