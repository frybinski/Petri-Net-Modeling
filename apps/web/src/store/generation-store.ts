import type { PetriNet } from '@pnm/core';
import type { DomainDiagnostic } from '@pnm/domain';
import type { DomainViewGeneration, GeneratePhase, GenerateResult } from '@pnm/llm';
import { create } from 'zustand';

export type GenerationStage = 'form' | 'running' | 'result' | 'error';

/** One line of the progress list: a phase of a round, with its duration. */
export interface StepRow {
  id: number;
  round: number;
  phase: GeneratePhase;
  /** Milliseconds since the epoch. */
  startedAt: number;
  endedAt: number | null;
  diagnostics?: DomainDiagnostic[];
}

export interface GenerationFailure {
  message: string;
  /** The `LlmError` kind, if the provider failed. */
  kind?: string;
}

interface GenerationState {
  open: boolean;
  /** The log of the generation stored with the net is shown. */
  logOpen: boolean;
  stage: GenerationStage;
  description: string;
  width: number;
  height: number;
  maxRounds: number;
  /** The round under way, from 1. */
  round: number;
  steps: StepRow[];
  /** What came out, with the net it was made for. */
  result: { generation: GenerateResult; record: DomainViewGeneration; net: PetriNet } | null;
  failure: GenerationFailure | null;
  setOpen(open: boolean): void;
  setLogOpen(open: boolean): void;
  patch(
    patch: Partial<
      Omit<GenerationState, 'setOpen' | 'setLogOpen' | 'patch' | 'progress' | 'reset'>
    >,
  ): void;
  /** Records a progress event: closes the open step and starts the next. */
  progress(round: number, phase: GeneratePhase, diagnostics?: DomainDiagnostic[]): void;
  reset(): void;
}

let stepCounter = 0;

const FORM: Pick<
  GenerationState,
  'stage' | 'round' | 'steps' | 'result' | 'failure' | 'maxRounds'
> = {
  stage: 'form',
  round: 1,
  steps: [],
  result: null,
  failure: null,
  maxRounds: 3,
};

export const useGenerationStore = create<GenerationState>()((set, get) => ({
  open: false,
  logOpen: false,
  description: '',
  width: 1200,
  height: 700,
  ...FORM,
  setOpen(open) {
    set({ open });
  },
  setLogOpen(logOpen) {
    set({ logOpen });
  },
  patch(patch) {
    set(patch);
  },
  progress(round, phase, diagnostics) {
    const now = Date.now();
    const steps = get().steps.map((s) => (s.endedAt === null ? { ...s, endedAt: now } : s));
    stepCounter += 1;
    const row: StepRow = {
      id: stepCounter,
      round,
      phase,
      startedAt: now,
      endedAt: phase === 'done' ? now : null,
      ...(diagnostics ? { diagnostics } : {}),
    };
    set({ round, steps: [...steps, row] });
  },
  reset() {
    set({ ...FORM });
  },
}));
