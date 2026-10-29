import type { LiveEvent } from '@pnm/sim';

/** What the page offers on `window.pnm.live` while the live source is active. */
export interface LiveApi {
  /**
   * Adds events to the live replay. Each has a `case` (or `caseId`), an `activity`, optionally a
   * `lifecycle` (`start` or `complete`, default `complete`) and a `time` in seconds since the
   * replay was opened (default: now). Resolves when the events have been taken.
   */
  push(events: ReadonlyArray<ConsoleEvent>): Promise<void>;
  /** The feed has ended; what has arrived is still played. */
  close(): Promise<void>;
  /** A short description for the console. */
  help: string;
}

export interface ConsoleEvent {
  case?: string;
  caseId?: string;
  activity: string;
  lifecycle?: 'start' | 'complete';
  time?: number;
}

interface PnmWindow {
  pnm?: { live?: LiveApi } & Record<string, unknown>;
}

export const LIVE_HELP =
  'window.pnm.live.push([{ case: "C-1", activity: "Scannen", lifecycle: "complete", time: 12.5 }]) ' +
  'adds events to the live replay (lifecycle and time are optional; without a time the event happens now); ' +
  'window.pnm.live.close() ends the feed.';

/** Makes the events of the console what the replay takes. */
export function toLiveEvents(events: ReadonlyArray<ConsoleEvent>): LiveEvent[] {
  return events.map((event, index) => {
    const caseId = event.caseId ?? event.case;
    if (typeof caseId !== 'string' || caseId === '' || typeof event.activity !== 'string') {
      throw new Error(`Event ${index + 1} needs a "case" and an "activity".`);
    }
    return {
      caseId,
      activity: event.activity,
      lifecycle: event.lifecycle ?? 'complete',
      ...(event.time !== undefined && { time: event.time }),
    };
  });
}

/** Puts the live API on `window.pnm.live`. */
export function installLiveApi(handlers: {
  push(events: LiveEvent[]): Promise<void>;
  close(): Promise<void>;
}): void {
  if (typeof window === 'undefined') return;
  const host = window as unknown as PnmWindow;
  host.pnm = {
    ...host.pnm,
    live: {
      push: async (events) => {
        await handlers.push(toLiveEvents(events));
      },
      close: () => handlers.close(),
      help: LIVE_HELP,
    },
  };
}

/** Takes `window.pnm.live` away again. */
export function removeLiveApi(): void {
  if (typeof window === 'undefined') return;
  const host = window as unknown as PnmWindow;
  if (host.pnm === undefined) return;
  const { live: _live, ...rest } = host.pnm;
  if (Object.keys(rest).length === 0) delete host.pnm;
  else host.pnm = rest;
}
