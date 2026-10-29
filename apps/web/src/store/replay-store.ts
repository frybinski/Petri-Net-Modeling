import type { ActivityMapping, CompleteOnly } from '@pnm/sim';
import { create } from 'zustand';
import type { ReplayLog } from '../lib/replay-log';

/** Where time 0 of the log is: its first event, the start time of the net, or a time of the person's choice. */
export type TimeOriginChoice = 'first' | 'net' | 'custom';

/** The columns of a CSV log; empty means that the usual names are looked for. */
export interface ColumnChoice {
  case: string;
  activity: string;
  time: string;
  lifecycle: string;
}

/** What the mapping dialog edits: a log file as text and the choices made for it. */
export interface LogDraft {
  fileName: string;
  text: string;
  format: 'csv' | 'xes';
  columns: ColumnChoice;
  timeOrigin: TimeOriginChoice;
  customOrigin: string;
  /** The person's choices; an activity without one follows the automatic match. */
  mapping: ActivityMapping;
  completeOnly: CompleteOnly;
  strict: boolean;
  /** Seconds left out of the key figures; `undefined` is the warm-up of the net. */
  warmup: number | undefined;
}

interface ReplayState {
  /** The dialog is open. */
  open: boolean;
  draft: LogDraft | null;
  /** The log that was applied last; the Log source starts it again. */
  log: ReplayLog | null;
  /** Starts a draft from the text of a file and opens the dialog. */
  openText(fileName: string, text: string): void;
  /** Opens the dialog for the draft that is there (the choices made for the log in use). */
  reopen(): void;
  update(patch: Partial<LogDraft>): void;
  close(): void;
  setLog(log: ReplayLog | null): void;
  /** Forgets the log and the draft (another net was loaded). */
  clear(): void;
}

export const useReplayStore = create<ReplayState>()((set, get) => ({
  open: false,
  draft: null,
  log: null,
  openText(fileName, text) {
    const xes = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).trimStart().startsWith('<');
    set({
      open: true,
      draft: {
        fileName,
        text,
        format: xes ? 'xes' : 'csv',
        columns: { case: '', activity: '', time: '', lifecycle: '' },
        timeOrigin: 'first',
        customOrigin: '',
        mapping: {},
        completeOnly: 'zero',
        strict: false,
        warmup: undefined,
      },
    });
  },
  reopen() {
    if (get().draft !== null) set({ open: true });
  },
  update(patch) {
    const draft = get().draft;
    if (draft) set({ draft: { ...draft, ...patch } });
  },
  close() {
    set({ open: false });
  },
  setLog(log) {
    set({ log });
  },
  clear() {
    set({ open: false, draft: null, log: null });
  },
}));
