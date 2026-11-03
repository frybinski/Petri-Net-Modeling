import type { PetriNet } from '@pnm/core';
import type { DomainDiagnostic, ViewChoices } from '@pnm/domain';
import type { Concept, DomainViewGeneration, GeneratePhase, GenerateResult } from '@pnm/llm';
import { create } from 'zustand';

export type GenerationStage = 'form' | 'running' | 'result' | 'error';

/** The two ways into the dialog (N4): a form with choices, or a free description. */
export type GenerationTab = 'guided' | 'free';

/** The concepts that the model suggested for the form, with what went wrong asking for them. */
export interface ConceptState {
  busy: boolean;
  concepts: Concept[];
  notes: string[];
  error: string | null;
}

export const NO_CONCEPTS: ConceptState = { busy: false, concepts: [], notes: [], error: null };

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
  /** The way of the form (remembered between sessions). */
  tab: GenerationTab;
  description: string;
  /** The form of the guided way; `null` until the dialog was opened for a net. */
  choices: ViewChoices | null;
  /** The title of the concept that filled the form, if the person picked one. */
  concept: string | null;
  suggestions: ConceptState;
  /** The way of the generation that is under way or whose result is shown. */
  runMode: GenerationTab;
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
  tab: 'guided',
  description: '',
  choices: null,
  concept: null,
  suggestions: NO_CONCEPTS,
  runMode: 'guided',
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
