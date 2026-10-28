import { netHash } from '@pnm/domain';
import type { ChatProvider, GenerateResult, Provider, ProviderConfig } from '@pnm/llm';
import { en } from '../i18n/en';
import { useEditorStore } from '../store/editor-store';
import { useGenerationStore } from '../store/generation-store';
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
    ...(apiKey.trim() !== '' ? { apiKey: apiKey.trim() } : {}),
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
  store.patch({ open: true, description: net.name.trim() });
  void defaultCanvas().then(({ width, height }) => {
    useGenerationStore.getState().patch({ width, height });
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
  const { description, width, height } = gen;
  const abort = new AbortController();
  controller = abort;
  gen.patch({
    stage: 'running',
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
    const result: GenerateResult = await llm.generateDomainView(net, provider, {
      description,
      canvas: { width, height },
      maxRounds: MAX_ROUNDS,
      signal: abort.signal,
      onProgress: (p) => {
        useGenerationStore.getState().progress(p.round, p.phase, p.diagnostics);
      },
    });
    const record = llm.toGenerationRecord(result, { description, baseUrl: config.baseUrl });
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
