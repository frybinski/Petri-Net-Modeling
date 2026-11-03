import type { Id } from '@pnm/core';
import { netHash, type DomainView, type ViewChoices } from '@pnm/domain';
import type { ChatProvider, GenerateResult, Provider, ProviderConfig } from '@pnm/llm';
import { en } from '../i18n/en';
import { useEditorStore } from '../store/editor-store';
import { NO_CONCEPTS, useGenerationStore, type GenerationTab } from '../store/generation-store';
import { useLlmStore } from '../store/llm-store';
import { notify } from '../store/ui-store';
import { isConfigured, type LlmSettings } from './llm-settings';

/** How the provider is created; tests replace it. */
export type ProviderFactory = (config: ProviderConfig) => Provider;

let factory: ProviderFactory | null = null;

/** Replaces the provider factory (tests); `null` restores the real one. */
export function setProviderFactory(next: ProviderFactory | null): void {
  factory = next;
}

/** The config for a provider from the stored settings and the key. */
export function providerConfig(settings: LlmSettings, apiKey: string): ProviderConfig {
  return {
    baseUrl: settings.baseUrl.trim(),
    model: settings.model.trim(),
    temperature: settings.temperature,
    jsonMode: settings.jsonMode,
    // The key of the server is on the server; the browser never sends one to it.
    ...(settings.preset !== 'server' && apiKey.trim() !== '' ? { apiKey: apiKey.trim() } : {}),
  };
}

/** The provider for a config. The package is loaded on first use, not with the editor. */
export async function makeProvider(config: ProviderConfig): Promise<Provider> {
  if (factory) return factory(config);
  const { createProvider } = await import('@pnm/llm');
  return createProvider(config);
}

let controller: AbortController | null = null;

/** The number of rounds at most, as in the plan. */
export const MAX_ROUNDS = 3;

function editLocked(): boolean {
  if (useEditorStore.getState().mode === 'simulate') {
    notify('info', en.llm.locked);
    return true;
  }
  return false;
}

/** The size of the canvas to start with: that of the current view, else what a generic view uses. */
async function defaultCanvas(): Promise<{ width: number; height: number }> {
  const { genericDomainView, validateDomainView } = await import('@pnm/domain');
  const net = useEditorStore.getState().net;
  const view = validateDomainView(net, net.domainView).view;
  return view ? view.meta.canvas : genericDomainView(net).meta.canvas;
}

const TAB_KEY = 'pnm.llm.generate-tab';

/** The way that was used last (`guided` the first time). */
export function storedTab(): GenerationTab {
  try {
    return localStorage.getItem(TAB_KEY) === 'free' ? 'free' : 'guided';
  } catch {
    return 'guided';
  }
}

/** Switches between the guided and the free way, and remembers the choice. */
export function chooseTab(tab: GenerationTab): void {
  useGenerationStore.getState().patch({ tab });
  try {
    localStorage.setItem(TAB_KEY, tab);
  } catch {
    // The choice is only a convenience.
  }
}

/** The upper limits of places that an up-to-date analysis knows (invariants, coverability). */
export async function knownBounds(): Promise<Record<Id, number>> {
  // The analysis loads on demand, so it is not imported for the start of the app.
  const [{ useAnalysisStore }, { analysisKey }] = await Promise.all([
    import('../store/analysis-store'),
    import('./analysis-key'),
  ]);
  const net = useEditorStore.getState().net;
  const analysis = useAnalysisStore.getState();
  const key = analysisKey(net);
  const bounds: Record<Id, number> = {};
  if (analysis.invariants?.key === key) Object.assign(bounds, analysis.invariants.value.bounds);
  const coverability = analysis.space?.key === key ? analysis.space.value.coverability : null;
  for (const [id, bound] of Object.entries(coverability?.bounds ?? {})) {
    if (typeof bound === 'number') bounds[id] = Math.min(bound, bounds[id] ?? bound);
  }
  return bounds;
}

/** The view of the net if it has a valid one, else `null` (the choices then start from the net). */
async function currentView(): Promise<DomainView | null> {
  const { validateDomainView } = await import('@pnm/domain');
  const net = useEditorStore.getState().net;
  return validateDomainView(net, net.domainView).view ?? null;
}

/** The form of the guided way, prefilled from the net and its view. */
async function prefilledChoices(): Promise<ViewChoices> {
  const { defaultChoices } = await import('@pnm/domain');
  return defaultChoices(useEditorStore.getState().net, await currentView(), await knownBounds());
}

/** Opens the dialog; a job that is still running is shown as it is. */
export function openGenerateDialog(): void {
  if (editLocked()) return;
  const store = useGenerationStore.getState();
  if (store.stage === 'running' || store.stage === 'result' || store.stage === 'error') {
    store.setOpen(true);
    return;
  }
  const net = useEditorStore.getState().net;
  store.reset();
  store.patch({
    open: true,
    description: net.name.trim(),
    tab: storedTab(),
    choices: null,
    concept: null,
    suggestions: NO_CONCEPTS,
  });
  void defaultCanvas().then(({ width, height }) => {
    useGenerationStore.getState().patch({ width, height });
  });
  void prefilledChoices().then((choices) => {
    // The person may have closed the dialog or the net may have changed in the meantime.
    const now = useGenerationStore.getState();
    if (now.open && now.choices === null && useEditorStore.getState().net === net) {
      now.patch({ choices });
    }
  });
}

/** Closes the dialog. A running job continues in the background; anything else is discarded. */
export function closeGenerateDialog(): void {
  const store = useGenerationStore.getState();
  if (store.stage === 'running') {
    store.setOpen(false);
    return;
  }
  store.setOpen(false);
  store.reset();
}

/** Stops the job. */
export function cancelGeneration(): void {
  controller?.abort();
}

/** Back to the form after a result or a failure. */
export function backToForm(): void {
  useGenerationStore.getState().reset();
}

/** What the person is told when the provider fails, per kind of failure. */
export function failureHint(kind: string | undefined, settings: LlmSettings): string | null {
  switch (kind) {
    case 'network':
      return settings.preset === 'ollama' ? en.llm.hintNetworkOllama : en.llm.hintNetwork;
    case 'auth':
      return en.llm.hintAuth;
    case 'timeout':
      return en.llm.hintTimeout;
    case 'rate-limit':
      return en.llm.hintRateLimit;
    default:
      return null;
  }
}

/** Runs the generation for the form of the dialog. */
export async function startGeneration(): Promise<void> {
  if (editLocked()) return;
  const gen = useGenerationStore.getState();
  if (gen.stage === 'running') return;
  const { settings, apiKey } = useLlmStore.getState();
  if (!isConfigured(settings)) {
    gen.patch({ stage: 'error', failure: { message: en.llm.notConfigured, kind: 'config' } });
    return;
  }
  const net = useEditorStore.getState().net;
  const { width, height } = gen;
  const guided = gen.tab === 'guided' && gen.choices !== null;
  const choices = guided ? gen.choices : null;
  const abort = new AbortController();
  controller = abort;
  gen.patch({
    stage: 'running',
    runMode: guided ? 'guided' : 'free',
    steps: [],
    failure: null,
    result: null,
    round: 1,
    maxRounds: MAX_ROUNDS,
  });
  const config = providerConfig(settings, apiKey);
  try {
    const llm = await import('@pnm/llm');
    const provider: ChatProvider = await makeProvider(config);
    // In the guided way the description is made of the form; the choices are binding.
    const description = choices ? llm.composeDescription(choices) : gen.description;
    const result: GenerateResult = await llm.generateDomainView(net, provider, {
      description,
      canvas: { width, height },
      maxRounds: MAX_ROUNDS,
      signal: abort.signal,
      ...(choices ? { choices } : {}),
      onProgress: (p) => {
        useGenerationStore.getState().progress(p.round, p.phase, p.diagnostics);
      },
    });
    const concept = useGenerationStore.getState().concept;
    const record = llm.toGenerationRecord(result, {
      description,
      baseUrl: config.baseUrl,
      mode: choices ? 'guided' : 'free',
      ...(choices ? { choices } : {}),
      ...(choices && concept !== null ? { concept } : {}),
    });
    const store = useGenerationStore.getState();
    store.patch({ stage: 'result', result: { generation: result, record, net } });
    if (!store.open) {
      notify('success', en.llm.finishedBackground, {
        action: { label: en.llm.review, run: openGenerateDialog },
      });
    }
  } catch (error) {
    const store = useGenerationStore.getState();
    const kind = (error as { kind?: unknown } | null)?.kind;
    if (kind === 'aborted') {
      store.reset();
      if (!store.open) notify('info', en.llm.cancelled);
    } else {
      store.patch({
        stage: 'error',
        failure: {
          message: error instanceof Error ? error.message : String(error),
          ...(typeof kind === 'string' ? { kind } : {}),
        },
      });
      if (!store.open) {
        notify('error', en.llm.failedBackground, {
          action: { label: en.llm.review, run: openGenerateDialog },
        });
      }
    }
  } finally {
    if (controller === abort) controller = null;
  }
}

/** Applies the form to the current view, or to the generic one if there is none: no model. */
export async function applyChoicesWithoutLlm(): Promise<boolean> {
  if (editLocked()) return false;
  const { choices } = useGenerationStore.getState();
  if (!choices) return false;
  const domain = await import('@pnm/domain');
  const editor = useEditorStore.getState();
  const net = editor.net;
  const at = new Date().toISOString();
  const base = (await currentView()) ?? domain.genericDomainView(net, { at });
  if (domain.choiceProblems(net, choices).length > 0) {
    notify('error', en.llm.guided.problems);
    return false;
  }
  const { view, changed } = domain.applyChoices(net, base, choices, { at, provenance: 'user' });
  const normalized = domain.normalizeDomainView(view);
  if (
    changed.length === 0 &&
    net.domainView !== undefined &&
    sameJson(net.domainView, normalized)
  ) {
    notify('info', en.llm.guided.nothingToApply);
    return false;
  }
  // One undo step; the record of an earlier generation stays with the net.
  editor.setDomainView(normalized);
  const store = useGenerationStore.getState();
  store.setOpen(false);
  store.reset();
  notify('success', en.llm.guided.applied(changed.length));
  return true;
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Asks the model for concepts that fill the form. The form is not changed until one is picked. */
export async function suggestConceptsNow(): Promise<void> {
  const gen = useGenerationStore.getState();
  if (gen.suggestions.busy || !gen.choices) return;
  const { settings, apiKey } = useLlmStore.getState();
  if (!isConfigured(settings)) {
    gen.patch({ suggestions: { ...NO_CONCEPTS, error: en.llm.notConfigured } });
    return;
  }
  const net = useEditorStore.getState().net;
  const { choices } = gen;
  gen.patch({ suggestions: { ...NO_CONCEPTS, busy: true } });
  try {
    const llm = await import('@pnm/llm');
    const provider = await makeProvider(providerConfig(settings, apiKey));
    const result = await llm.suggestConcepts(provider, {
      net,
      setting: choices.setting,
      additions: choices.additions,
    });
    useGenerationStore.getState().patch({
      suggestions: { busy: false, concepts: result.concepts, notes: result.notes, error: null },
    });
  } catch (error) {
    useGenerationStore.getState().patch({
      suggestions: {
        ...NO_CONCEPTS,
        error: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

/** Fills the form from a concept; everything stays editable. */
export function pickConcept(index: number): void {
  const gen = useGenerationStore.getState();
  const concept = gen.suggestions.concepts[index];
  if (!concept) return;
  // What the person wrote as additions stays; the rest of the form is the concept's.
  const additions = gen.choices?.additions ?? concept.choices.additions;
  gen.patch({ choices: { ...concept.choices, additions }, concept: concept.title });
}

/** Puts the generated view and its record into the document, as one undo step. */
export function applyGeneratedView(): boolean {
  if (editLocked()) return false;
  const { result } = useGenerationStore.getState();
  if (!result) return false;
  const editor = useEditorStore.getState();
  if (netHash(editor.net) !== result.generation.view.netHash) {
    notify('error', en.llm.netChanged);
    return false;
  }
  editor.replaceDomainView(result.generation.view, result.record);
  const store = useGenerationStore.getState();
  store.setOpen(false);
  store.reset();
  notify('success', en.llm.applied);
  return true;
}

// The model never runs during a simulation: starting one stops a job that is under way.
useEditorStore.subscribe((state, previous) => {
  if (state.mode === 'simulate' && previous.mode !== 'simulate') {
    const gen = useGenerationStore.getState();
    if (gen.stage === 'running') cancelGeneration();
  }
});
