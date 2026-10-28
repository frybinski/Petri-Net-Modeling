import { NetFormatError, parseNetText, serializeNet, validate, type PetriNet } from '@pnm/core';
import { eventLogRows, toEventLogCsv, toXes } from '@pnm/io';
import { en } from '../i18n/en';
import { selectIsDirty, useEditorStore } from '../store/editor-store';
import { eventLog } from '../store/sim-log';
import { notify, useUiStore } from '../store/ui-store';
import { netToSvg } from './svg-export';

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
  const blob = new Blob([text], { type: mime });
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

export function exportSvg(): void {
  const { net, mode, simMarking } = useEditorStore.getState();
  const dark = useUiStore.getState().theme === 'dark';
  const fileName = `${fileStem(net.name)}.svg`;
  const svg = netToSvg(net, {
    dark,
    inscriptions: useUiStore.getState().showInscriptions,
    ...(mode === 'simulate' && simMarking ? { marking: simMarking } : {}),
  });
  downloadText(fileName, svg, 'image/svg+xml');
  notify('success', en.files.exported(fileName));
}

/**
 * Downloads the events of the running simulation as an event log: CSV with the columns
 * `case_id, activity, timestamp, lifecycle`, or XES.
 */
export function exportEventLog(format: 'csv' | 'xes'): void {
  const { net } = useEditorStore.getState();
  const events = eventLog.all();
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

/** Reads and opens a file chosen by the user. Shows an error message for invalid files. */
export async function openFile(file: File): Promise<void> {
  try {
    const net = parseNetText(await file.text());
    openNet(net, file.name);
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

/** Opens a dropped or chosen file after confirming that unsaved changes may be discarded. */
export function openFileGuarded(file: File): void {
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
