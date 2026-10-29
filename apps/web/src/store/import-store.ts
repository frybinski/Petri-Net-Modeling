import { create } from 'zustand';

/** What the PNML import has to say about a file, shown in a dialog. */
export interface ImportReport {
  fileName: string;
  netName: string;
  places: number;
  transitions: number;
  arcs: number;
  /** The positions come from the automatic layout. */
  laidOut: boolean;
  warnings: string[];
}

interface ImportState {
  report: ImportReport | null;
  show(report: ImportReport): void;
  close(): void;
}

export const useImportStore = create<ImportState>()((set) => ({
  report: null,
  show(report) {
    set({ report });
  },
  close() {
    set({ report: null });
  },
}));
