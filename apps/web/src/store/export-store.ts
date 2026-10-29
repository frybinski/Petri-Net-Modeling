import { create } from 'zustand';
import type { PngScale } from '../lib/export-image';

export type ExportKind = 'image' | 'pnml' | 'tikz';
/** What an image is made of: the net editor's drawing, or the domain view. */
export type ExportSource = 'net' | 'domain';

export interface ImageSettings {
  format: 'svg' | 'png';
  scale: PngScale;
  theme: 'light' | 'dark';
  background: 'theme' | 'transparent';
  inscriptions: boolean;
}

export interface TikzSettings {
  standalone: boolean;
  labels: 'names' | 'ids' | 'none';
  inscriptions: boolean;
  tokens: 'dots' | 'count' | 'none';
  styles: 'inline' | 'external';
  grayscale: boolean;
  /** Centimetres per editor pixel. */
  scale: number;
}

export interface PnmlSettings {
  toolspecific: boolean;
}

interface ExportState {
  open: { kind: ExportKind; source: ExportSource } | null;
  image: ImageSettings;
  tikz: TikzSettings;
  pnml: PnmlSettings;
  openDialog(kind: ExportKind, source?: ExportSource): void;
  close(): void;
  setImage(patch: Partial<ImageSettings>): void;
  setTikz(patch: Partial<TikzSettings>): void;
  setPnml(patch: Partial<PnmlSettings>): void;
}

const KEY = 'pnm:export';

export const DEFAULT_IMAGE: ImageSettings = {
  format: 'png',
  scale: 2,
  theme: 'light',
  background: 'theme',
  inscriptions: true,
};
export const DEFAULT_TIKZ: TikzSettings = {
  standalone: false,
  labels: 'names',
  inscriptions: true,
  tokens: 'dots',
  styles: 'inline',
  grayscale: true,
  scale: 0.02,
};
export const DEFAULT_PNML: PnmlSettings = { toolspecific: true };

interface Stored {
  image: ImageSettings;
  tikz: TikzSettings;
  pnml: PnmlSettings;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Keeps only the fields of `stored` that have the type of the default, so a damaged entry is harmless. */
function merge<T extends object>(defaults: T, stored: unknown): T {
  if (!isRecord(stored)) return defaults;
  const out = { ...defaults } as Record<string, unknown>;
  for (const [key, value] of Object.entries(defaults as Record<string, unknown>)) {
    if (typeof stored[key] === typeof value) out[key] = stored[key];
  }
  return out as T;
}

function readStored(): Stored {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw === null ? null : JSON.parse(raw);
    const data = isRecord(parsed) ? parsed : {};
    const image = merge(DEFAULT_IMAGE, data['image']);
    return {
      image: {
        ...image,
        format: image.format === 'svg' ? 'svg' : 'png',
        scale: image.scale === 1 || image.scale === 3 ? image.scale : 2,
        theme: image.theme === 'dark' ? 'dark' : 'light',
        background: image.background === 'transparent' ? 'transparent' : 'theme',
      },
      tikz: merge(DEFAULT_TIKZ, data['tikz']),
      pnml: merge(DEFAULT_PNML, data['pnml']),
    };
  } catch {
    return { image: DEFAULT_IMAGE, tikz: DEFAULT_TIKZ, pnml: DEFAULT_PNML };
  }
}

function persist(state: Stored): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // The settings just do not outlive the page.
  }
}

/** State of the export dialogs; the options are remembered between sessions. */
export const useExportStore = create<ExportState>()((set, get) => ({
  open: null,
  ...readStored(),
  openDialog(kind, source = 'net') {
    set({ open: { kind, source } });
  },
  close() {
    set({ open: null });
  },
  setImage(patch) {
    set({ image: { ...get().image, ...patch } });
    persist(get());
  },
  setTikz(patch) {
    set({ tikz: { ...get().tikz, ...patch } });
    persist(get());
  },
  setPnml(patch) {
    set({ pnml: { ...get().pnml, ...patch } });
    persist(get());
  },
}));
