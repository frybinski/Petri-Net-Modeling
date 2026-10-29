import { create } from 'zustand';
import type { ServerHealth, ShareMode } from '../lib/server-api';

/** Which project on the server the document in the editor belongs to. */
export type ServerLink =
  | {
      kind: 'project';
      id: string;
      name: string;
      /** The newest version the editor knows; a save is based on it. */
      version: number;
    }
  | {
      kind: 'shared';
      token: string;
      mode: ShareMode;
      id: string;
      name: string;
      version: number;
    };

export type ServerStatus = 'unknown' | 'absent' | 'present';

/** A save that the server refused because someone saved in between. */
export interface ConflictRequest {
  link: ServerLink;
  /** The version the changes were based on, and the one that is on the server now. */
  yours: number;
  current: number | null;
}

export type ServerDialog = 'open' | 'save' | 'versions' | 'share' | null;

interface ServerState {
  status: ServerStatus;
  health: ServerHealth | null;
  /** The project that the document belongs to; `docVersion` says for which document. */
  link: (ServerLink & { docVersion: number }) | null;
  saving: boolean;
  dialog: ServerDialog;
  /** For the save dialog: it makes a new project, as a copy if the document came from a link. */
  saveAsCopy: boolean;
  conflict: ConflictRequest | null;
  setHealth(health: ServerHealth | null): void;
  setLink(link: (ServerLink & { docVersion: number }) | null): void;
  patchLink(patch: Partial<Pick<ServerLink, 'name' | 'version'>>): void;
  setSaving(saving: boolean): void;
  openDialog(dialog: Exclude<ServerDialog, null>, options?: { asCopy?: boolean }): void;
  closeDialog(): void;
  setConflict(conflict: ConflictRequest | null): void;
}

export const useServerStore = create<ServerState>()((set, get) => ({
  status: 'unknown',
  health: null,
  link: null,
  saving: false,
  dialog: null,
  saveAsCopy: false,
  conflict: null,
  setHealth(health) {
    set({ health, status: health ? 'present' : 'absent' });
  },
  setLink(link) {
    set({ link });
  },
  patchLink(patch) {
    const link = get().link;
    if (link) set({ link: { ...link, ...patch } });
  },
  setSaving(saving) {
    set({ saving });
  },
  openDialog(dialog, options) {
    set({ dialog, saveAsCopy: options?.asCopy === true });
  },
  closeDialog() {
    set({ dialog: null });
  },
  setConflict(conflict) {
    set({ conflict });
  },
}));

/** True when the app is served by a server that offers projects. */
export function serverHasProjects(state: ServerState): boolean {
  return state.status === 'present' && state.health?.features.projects === true;
}
