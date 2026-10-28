import { create } from 'zustand';

export type Theme = 'light' | 'dark';

export type ToastKind = 'info' | 'success' | 'error';

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  /** Optional extra lines, for example a list of format errors. */
  details?: string[];
  action?: { label: string; run: () => void };
}

export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
}

/** The type editor dialog: `name` is the type being edited, `null` for a new type. */
export interface TypeDialogRequest {
  name: string | null;
}

/** The token editor dialog: `index` is the token being edited, `null` for a new one. */
export interface TokenDialogRequest {
  placeId: string;
  index: number | null;
}

interface UiState {
  theme: Theme;
  /** Show guards, arc inscriptions and place types on the canvas. */
  showInscriptions: boolean;
  typeDialog: TypeDialogRequest | null;
  tokenDialog: TokenDialogRequest | null;
  /** Grid is shown and nodes snap to it. */
  snapToGrid: boolean;
  showMinimap: boolean;
  toasts: Toast[];
  confirm: ConfirmRequest | null;
  shortcutsOpen: boolean;
  diagnosticsOpen: boolean;
  setTheme(theme: Theme): void;
  toggleTheme(): void;
  toggleSnap(): void;
  toggleMinimap(): void;
  toggleInscriptions(): void;
  openTypeDialog(name: string | null): void;
  closeTypeDialog(): void;
  openTokenDialog(placeId: string, index: number | null): void;
  closeTokenDialog(): void;
  notify(kind: ToastKind, message: string, extra?: Pick<Toast, 'details' | 'action'>): number;
  dismissToast(id: number): void;
  askConfirm(request: ConfirmRequest): void;
  closeConfirm(): void;
  setShortcutsOpen(open: boolean): void;
  setDiagnosticsOpen(open: boolean): void;
}

const GRID_KEY = 'pnm:snap';
const MINIMAP_KEY = 'pnm:minimap';
const THEME_KEY = 'pnm:theme';
const INSCRIPTIONS_KEY = 'pnm:inscriptions';

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage may be unavailable (private mode, blocked); preferences just do not persist.
  }
}

function initialTheme(): Theme {
  if (typeof document !== 'undefined') {
    const attr = document.documentElement.getAttribute('data-theme');
    if (attr === 'dark' || attr === 'light') return attr;
  }
  return 'light';
}

function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
}

let toastCounter = 0;

export const useUiStore = create<UiState>()((set, get) => ({
  theme: initialTheme(),
  snapToGrid: readStored(GRID_KEY) !== 'off',
  showMinimap: readStored(MINIMAP_KEY) !== 'off',
  showInscriptions: readStored(INSCRIPTIONS_KEY) !== 'off',
  typeDialog: null,
  tokenDialog: null,
  toasts: [],
  confirm: null,
  shortcutsOpen: false,
  diagnosticsOpen: false,

  setTheme(theme) {
    applyTheme(theme);
    writeStored(THEME_KEY, theme);
    set({ theme });
  },
  toggleTheme() {
    get().setTheme(get().theme === 'dark' ? 'light' : 'dark');
  },
  toggleSnap() {
    const next = !get().snapToGrid;
    writeStored(GRID_KEY, next ? 'on' : 'off');
    set({ snapToGrid: next });
  },
  toggleMinimap() {
    const next = !get().showMinimap;
    writeStored(MINIMAP_KEY, next ? 'on' : 'off');
    set({ showMinimap: next });
  },

  toggleInscriptions() {
    const next = !get().showInscriptions;
    writeStored(INSCRIPTIONS_KEY, next ? 'on' : 'off');
    set({ showInscriptions: next });
  },
  openTypeDialog(name) {
    set({ typeDialog: { name } });
  },
  closeTypeDialog() {
    set({ typeDialog: null });
  },
  openTokenDialog(placeId, index) {
    set({ tokenDialog: { placeId, index } });
  },
  closeTokenDialog() {
    set({ tokenDialog: null });
  },

  notify(kind, message, extra) {
    toastCounter += 1;
    const toast: Toast = { id: toastCounter, kind, message, ...extra };
    set((s) => ({ toasts: [...s.toasts.slice(-3), toast] }));
    return toast.id;
  },
  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },

  askConfirm(request) {
    set({ confirm: request });
  },
  closeConfirm() {
    set({ confirm: null });
  },
  setShortcutsOpen(open) {
    set({ shortcutsOpen: open });
  },
  setDiagnosticsOpen(open) {
    set({ diagnosticsOpen: open });
  },
}));

/** Notifies the user from non-React code. */
export function notify(
  kind: ToastKind,
  message: string,
  extra?: Pick<Toast, 'details' | 'action'>,
): number {
  return useUiStore.getState().notify(kind, message, extra);
}
