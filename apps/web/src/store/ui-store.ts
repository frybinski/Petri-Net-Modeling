import type { Position } from '@pnm/core';
import { create } from 'zustand';

export type Theme = 'light' | 'dark';

export type SimTab = 'enabled' | 'trace' | 'metrics';

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

/** What was right-clicked on the canvas; the context menu shows the entries for it. */
export interface MenuTarget {
  kind: 'node' | 'edge' | 'pane' | 'selection';
  id?: string;
  /** Model coordinates of the click, for "Add place here". */
  position?: Position;
}

/** How long a toast stays: results for 2.5 s, errors and toasts with an action for 6 s. */
export const TOAST_MS = 2500;
export const TOAST_LONG_MS = 6000;

/** How long a toast stays before it disappears on its own. */
export function toastDuration(toast: Pick<Toast, 'kind' | 'action' | 'details'>): number {
  return toast.kind === 'error' || toast.action || toast.details?.length ? TOAST_LONG_MS : TOAST_MS;
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
  /** The mouse wheel zooms instead of panning (Ctrl or Cmd with the wheel always zooms). */
  scrollToZoom: boolean;
  menuTarget: MenuTarget | null;
  /** Queue lengths at which a place gets a yellow or red ring while simulating. */
  bottleneckWarn: number;
  bottleneckCritical: number;
  /** The tab of the simulation panel. */
  simTab: SimTab;
  /** At most one toast is visible; a new one replaces the old one. */
  toasts: Toast[];
  confirm: ConfirmRequest | null;
  shortcutsOpen: boolean;
  diagnosticsOpen: boolean;
  setTheme(theme: Theme): void;
  toggleTheme(): void;
  toggleSnap(): void;
  toggleMinimap(): void;
  toggleScrollToZoom(): void;
  setBottleneckThresholds(warn: number, critical: number): void;
  setSimTab(tab: SimTab): void;
  setMenuTarget(target: MenuTarget | null): void;
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
const SCROLL_ZOOM_KEY = 'pnm:scroll-zoom';
const THEME_KEY = 'pnm:theme';
const INSCRIPTIONS_KEY = 'pnm:inscriptions';
const BOTTLENECK_KEY = 'pnm:bottleneck';

/** Queue lengths for the yellow and red ring on the canvas. */
export const DEFAULT_BOTTLENECK = { warn: 6, critical: 10 };

function readBottleneck(): { warn: number; critical: number } {
  const raw = readStored(BOTTLENECK_KEY);
  if (raw !== null) {
    const [warn, critical] = raw.split(',').map(Number);
    if (warn !== undefined && critical !== undefined && warn >= 1 && critical >= warn) {
      return { warn, critical };
    }
  }
  return DEFAULT_BOTTLENECK;
}

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
  scrollToZoom: readStored(SCROLL_ZOOM_KEY) === 'on',
  menuTarget: null,
  bottleneckWarn: readBottleneck().warn,
  bottleneckCritical: readBottleneck().critical,
  simTab: 'enabled',
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
  toggleScrollToZoom() {
    const next = !get().scrollToZoom;
    writeStored(SCROLL_ZOOM_KEY, next ? 'on' : 'off');
    set({ scrollToZoom: next });
  },
  setBottleneckThresholds(warn, critical) {
    const low = Math.max(1, Math.round(warn));
    const high = Math.max(low, Math.round(critical));
    writeStored(BOTTLENECK_KEY, `${low},${high}`);
    set({ bottleneckWarn: low, bottleneckCritical: high });
  },
  setSimTab(tab) {
    set({ simTab: tab });
  },
  setMenuTarget(target) {
    set({ menuTarget: target });
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
    set({ toasts: [toast] });
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
