import { genericDomainView, type DomainView } from '@pnm/domain';
import type { ChatRequest, ChatResult, Provider, ProviderConfig } from '@pnm/llm';
import { createFakeProvider, type FakeScript } from '@pnm/llm/testing';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../../App';
import { setProviderFactory } from '../../lib/domain-generation';
import { API_KEY_KEY, DEFAULT_SETTINGS, SETTINGS_KEY } from '../../lib/llm-settings';
import { useEditorStore } from '../../store/editor-store';
import { useGenerationStore } from '../../store/generation-store';
import { useLlmStore } from '../../store/llm-store';
import { SPLIT_DEFAULT, useUiStore } from '../../store/ui-store';
import { loadExample, smallNet } from '../../test/domain-fixtures';

const editor = () => useEditorStore.getState();

/** What a model would answer for the net: a generic view without hash and provenance. */
function answerFor(view: DomainView): Record<string, unknown> {
  const { netHash: _hash, provenance: _provenance, ...rest } = view;
  return structuredClone(rest) as Record<string, unknown>;
}

interface Harness {
  /** The configs the factory was called with. */
  configs: ProviderConfig[];
  requests: ChatRequest[];
  /** Holds back the answers until `release` is called. */
  release: () => void;
}

/** Installs a provider that answers from `script`, optionally after a gate. */
function installProvider(script: FakeScript, options: { gated?: boolean } = {}): Harness {
  const fake = createFakeProvider(script);
  let release = (): void => undefined;
  const gate = options.gated
    ? new Promise<void>((resolve) => {
        release = resolve;
      })
    : Promise.resolve();
  const harness: Harness = { configs: [], requests: fake.calls, release: () => release() };
  setProviderFactory((config): Provider => {
    harness.configs.push(config);
    return {
      async chat(request: ChatRequest): Promise<ChatResult> {
        await Promise.race([
          gate,
          new Promise<void>((_resolve, reject) => {
            request.signal?.addEventListener('abort', () => {
              reject(Object.assign(new Error('Cancelled'), { kind: 'aborted' }));
            });
          }),
        ]);
        return fake.chat(request);
      },
      listModels: () => Promise.resolve(['alpha-model', 'beta-model']),
      test: () => Promise.resolve({ ok: true, message: 'Connected to alpha-model (0.1 s)' }),
    };
  });
  return harness;
}

function brokenAndFixed(): { script: FakeScript; good: DomainView } {
  const net = editor().net;
  const good = genericDomainView(net, { canvas: { width: 900, height: 500 } });
  const broken = answerFor(good);
  (broken['places'] as Record<string, unknown>)['q'] = { kind: 'slots', of: 'work' };
  return {
    good,
    script: [
      { json: broken, model: 'test-model' },
      { json: { places: { q: good.places['q'] } }, model: 'test-model' },
    ],
  };
}

beforeEach(() => {
  localStorage.clear();
  editor().newNet();
  editor().loadNet(smallNet(), 'small.pn.json');
  useUiStore.setState({
    toasts: [],
    confirm: null,
    shortcutsOpen: false,
    diagnosticsOpen: false,
    viewMode: 'domain',
    rightTab: 'domain',
    splitRatio: SPLIT_DEFAULT,
    hover: { id: null, source: null },
  });
  useGenerationStore.getState().reset();
  useGenerationStore.setState({ open: false, logOpen: false, description: '' });
  useLlmStore.setState({
    settings: { ...DEFAULT_SETTINGS, model: 'test-model' },
    apiKey: '',
    settingsOpen: false,
  });
});

afterEach(() => {
  setProviderFactory(null);
  useGenerationStore.getState().reset();
  useGenerationStore.setState({ open: false });
});

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  render(<App />);
  // The domain view and the dialog are loaded on demand.
  await user.click(await screen.findByTestId('domain-generate-llm'));
  expect(await screen.findByTestId('llm-dialog')).toHaveAttribute('data-stage', 'form');
}

async function waitForStage(stage: string) {
  await waitFor(
    () => {
      expect(screen.getByTestId('llm-dialog')).toHaveAttribute('data-stage', stage);
    },
    { timeout: 8000 },
  );
}

describe('generate dialog', () => {
  it('guides from the description through two rounds to a result that can be used and undone', async () => {
    const user = userEvent.setup();
    const { script } = brokenAndFixed();
    const harness = installProvider(script, { gated: true });
    await openDialog(user);

    // The form starts with the name of the net and shows the provider.
    const description = screen.getByTestId<HTMLTextAreaElement>('llm-description');
    expect(description).toHaveValue('Small');
    expect(screen.getByTestId('llm-provider-line')).toHaveTextContent(
      'test-model · http://localhost:11434/v1',
    );
    await user.clear(description);
    await user.type(description, 'A small workshop with one worker');
    await user.click(screen.getByTestId('llm-start'));

    // Progress: the prompt is built and the first round is waiting for the model.
    await waitForStage('running');
    await waitFor(() => {
      const steps = screen.getAllByTestId('llm-step').map((s) => s.dataset['phase']);
      expect(steps).toEqual(['prompt', 'waiting']);
    });
    expect(screen.getByTestId('llm-status')).toHaveTextContent('round 1 of 3');
    expect(screen.getByText('Round 1 of 3: waiting for the model')).toBeInTheDocument();

    harness.release();
    await waitForStage('result');
    expect(screen.getByTestId('llm-outcome')).toHaveTextContent('after 2 rounds');
    expect(screen.queryByTestId('llm-status')).toBeNull();

    // Two rounds in the log; the first one found the V4 error, the second none.
    const rounds = screen.getAllByTestId('llm-round');
    expect(rounds).toHaveLength(2);
    expect(
      within(rounds[0]!)
        .getAllByTestId('llm-finding')
        .map((f) => f.dataset['rule']),
    ).toContain('V4');
    expect(rounds[1]).toHaveTextContent('no findings');
    expect(rounds[1]).toHaveTextContent('repair');
    expect(screen.getByTestId('llm-no-findings')).toBeInTheDocument();
    expect(screen.getByTestId('summary-dropped')).toHaveTextContent('0');
    // The prompt that was sent is shown, with the description.
    expect(screen.getByTestId('llm-prompt')).toHaveTextContent('A small workshop with one worker');
    // The preview is a canvas of the size ratio of the view.
    expect(screen.getByTestId('llm-preview')).toHaveAttribute('data-aspect', '0.556');

    // The key and the settings reached the provider; nothing is in the document yet.
    expect(harness.configs[0]).toMatchObject({
      baseUrl: 'http://localhost:11434/v1',
      model: 'test-model',
    });
    expect(editor().net.domainView).toBeUndefined();

    const before = editor().past.length;
    await user.click(screen.getByTestId('llm-use'));
    await waitFor(() => {
      expect(editor().net.domainView).toBeDefined();
    });
    expect(editor().past.length).toBe(before + 1);
    const record = editor().net.domainViewGeneration as { model: string; rounds: unknown[] };
    expect(record.model).toBe('test-model');
    expect(record.rounds).toHaveLength(2);
    expect(useGenerationStore.getState().open).toBe(false);

    // The panel shows where the view comes from and the entries as the model's.
    expect(screen.getByTestId('origin-llm')).toHaveTextContent(/^[1-9]\d* LLM$/);
    expect(screen.getByTestId('domain-status')).toHaveTextContent('0 problems');
    expect(screen.getByTestId('domain-generated-by')).toHaveTextContent(
      'Generated by test-model on',
    );

    // One undo takes both back.
    editor().undo();
    expect(editor().net.domainView).toBeUndefined();
    expect(editor().net.domainViewGeneration).toBeUndefined();
  });

  it('shows the log of the stored generation and the model in the entry badge', async () => {
    const user = userEvent.setup();
    const { script } = brokenAndFixed();
    installProvider(script);
    await openDialog(user);
    await user.click(screen.getByTestId('llm-start'));
    await waitForStage('result');
    await user.click(screen.getByTestId('llm-use'));
    await waitFor(() => {
      expect(editor().net.domainView).toBeDefined();
    });

    await user.click(screen.getByTestId('domain-show-log'));
    const log = await screen.findByTestId('llm-log');
    expect(within(log).getByTestId('llm-record')).toHaveTextContent('test-model');
    expect(within(log).getAllByTestId('llm-round')).toHaveLength(2);

    editor().select(['q']);
    await waitFor(() => {
      expect(screen.getByTestId('domain-entry-badge')).toHaveTextContent('LLM (test-model)');
    });
  });

  it('cancels a running generation and returns to the form', async () => {
    const user = userEvent.setup();
    const { script } = brokenAndFixed();
    installProvider(script, { gated: true });
    await openDialog(user);
    await user.click(screen.getByTestId('llm-start'));
    await waitForStage('running');
    await user.click(screen.getByTestId('llm-cancel'));
    await waitForStage('form');
    expect(editor().net.domainView).toBeUndefined();
    expect(screen.queryByTestId('llm-status')).toBeNull();
  });

  it('can continue in the background and be reopened from the status bar', async () => {
    const user = userEvent.setup();
    const { script } = brokenAndFixed();
    const harness = installProvider(script, { gated: true });
    await openDialog(user);
    await user.click(screen.getByTestId('llm-start'));
    await waitForStage('running');
    await user.click(screen.getByTestId('llm-background'));
    await waitFor(() => {
      expect(useGenerationStore.getState().open).toBe(false);
    });
    expect(screen.getByTestId('llm-status')).toBeInTheDocument();

    harness.release();
    await waitFor(() => {
      expect(useGenerationStore.getState().stage).toBe('result');
    });
    expect(useUiStore.getState().toasts[0]?.message).toMatch(/ready for review/);
    useUiStore.getState().toasts[0]?.action?.run();
    await waitFor(() => {
      expect(useGenerationStore.getState().open).toBe(true);
    });
    await waitForStage('result');
  });

  it('stops a running generation when the simulation starts', async () => {
    const user = userEvent.setup();
    const { script } = brokenAndFixed();
    installProvider(script, { gated: true });
    await openDialog(user);
    await user.click(screen.getByTestId('llm-start'));
    await waitForStage('running');
    useEditorStore.setState({ mode: 'simulate' });
    await waitFor(() => {
      expect(useGenerationStore.getState().stage).toBe('form');
    });
    expect(editor().net.domainView).toBeUndefined();
    useEditorStore.setState({ mode: 'edit' });
  });

  it('is locked while a simulation runs', async () => {
    const user = userEvent.setup();
    installProvider([{ json: {} }]);
    render(<App />);
    useEditorStore.setState({ mode: 'simulate' });
    await user.click(await screen.findByRole('tab', { name: 'Domain view' }));
    expect(screen.getByTestId('domain-generate-llm')).toBeDisabled();
    expect(useGenerationStore.getState().open).toBe(false);
    useEditorStore.setState({ mode: 'edit' });
  });

  it('refuses to open in simulation mode when called directly', async () => {
    const { openGenerateDialog } = await import('../../lib/domain-generation');
    useEditorStore.setState({ mode: 'simulate' });
    openGenerateDialog();
    expect(useGenerationStore.getState().open).toBe(false);
    expect(useUiStore.getState().toasts[0]?.message).toMatch(/simulation/);
    useEditorStore.setState({ mode: 'edit' });
  });

  it('asks for the provider settings first', async () => {
    const user = userEvent.setup();
    useLlmStore.setState({ settings: { ...DEFAULT_SETTINGS, model: '' } });
    installProvider([{ json: {} }]);
    await openDialog(user);
    expect(screen.getByTestId('llm-not-configured')).toBeInTheDocument();
    expect(screen.getByTestId('llm-start')).toBeDisabled();
    await user.click(screen.getByTestId('llm-change-provider'));
    expect(await screen.findByTestId('llm-settings')).toBeInTheDocument();
  });

  it('reports a failing provider with a hint and lets the person go back', async () => {
    const user = userEvent.setup();
    installProvider([{ error: 'auth', message: 'The server refused the request (HTTP 401)' }]);
    await openDialog(user);
    await user.click(screen.getByTestId('llm-start'));
    await waitForStage('error');
    const failure = screen.getByTestId('llm-failure');
    expect(failure).toHaveTextContent('HTTP 401');
    expect(failure).toHaveTextContent('API key');
    await user.click(screen.getByTestId('llm-retry'));
    await waitForStage('form');
  });

  it('hints at the Ollama origin setting when the server cannot be reached', async () => {
    const user = userEvent.setup();
    installProvider([{ error: 'network', message: 'Could not reach http://localhost:11434/v1' }]);
    await openDialog(user);
    await user.click(screen.getByTestId('llm-start'));
    await waitForStage('error');
    expect(screen.getByTestId('llm-failure')).toHaveTextContent('OLLAMA_ORIGINS');
  });

  it('fills what stays invalid and says so in the result', async () => {
    const user = userEvent.setup();
    const { script } = brokenAndFixed();
    // The same broken answer in every round.
    installProvider([script[0]!], {});
    await openDialog(user);
    await user.click(screen.getByTestId('llm-start'));
    await waitForStage('result');
    expect(screen.getAllByTestId('llm-round')).toHaveLength(3);
    expect(screen.getByTestId('llm-outcome')).toHaveTextContent('filled in generically');
    expect(screen.getByTestId('summary-dropped')).toHaveTextContent('1');
    await user.click(screen.getByTestId('llm-use'));
    await waitFor(() => {
      expect(editor().net.domainView).toBeDefined();
    });
    expect(screen.getByTestId('domain-status')).toHaveTextContent('0 problems');
    expect(screen.getByTestId('origin-generic')).toHaveTextContent(/^[1-9]\d* generic$/);
  });

  it('warns that hand-made entries are replaced and leaves the old view on discard', async () => {
    const user = userEvent.setup();
    editor().loadNet(loadExample('parcel-center'), 'parcel-center.pn.json');
    const stored = editor().net.domainView;
    const net = editor().net;
    const good = genericDomainView(net);
    installProvider([{ json: answerFor(good) }]);
    await openDialog(user);
    expect(screen.getByTestId('llm-replace-note')).toBeInTheDocument();
    await user.click(screen.getByTestId('llm-start'));
    await waitForStage('result');
    await user.click(screen.getByTestId('llm-discard'));
    await waitFor(() => {
      expect(useGenerationStore.getState().open).toBe(false);
    });
    expect(editor().net.domainView).toBe(stored);
    expect(editor().net.domainViewGeneration).toBeUndefined();
  });

  it('refuses a result for a net that changed in the meantime', async () => {
    const user = userEvent.setup();
    const { script } = brokenAndFixed();
    installProvider(script);
    await openDialog(user);
    await user.click(screen.getByTestId('llm-start'));
    await waitForStage('result');
    editor().addPlace({ x: 300, y: 300 });
    await user.click(screen.getByTestId('llm-use'));
    expect(editor().net.domainView).toBeUndefined();
    expect(useUiStore.getState().toasts[0]?.message).toMatch(/net changed/);
  });
});

describe('provider settings dialog', () => {
  it('saves the settings and the key apart from each other', async () => {
    const user = userEvent.setup();
    installProvider([{ json: {} }]);
    render(<App />);
    await user.click(screen.getByTestId('llm-settings-open'));
    expect(await screen.findByTestId('llm-settings')).toBeInTheDocument();
    expect(screen.getByTestId('llm-ollama-hint')).toHaveTextContent('OLLAMA_ORIGINS');
    expect(screen.getByTestId('llm-api-key')).toHaveAttribute('type', 'password');

    await user.selectOptions(screen.getByTestId('llm-preset'), 'lmstudio');
    expect(screen.getByTestId('llm-base-url')).toHaveValue('http://localhost:1234/v1');
    expect(screen.queryByTestId('llm-ollama-hint')).toBeNull();
    await user.clear(screen.getByTestId('llm-model'));
    await user.type(screen.getByTestId('llm-model'), 'local-model');
    await user.type(screen.getByTestId('llm-api-key'), 'sk-secret-xyz');
    await user.selectOptions(screen.getByTestId('llm-json-mode'), 'object');
    await user.click(screen.getByTestId('llm-settings-save'));

    expect(useLlmStore.getState().settingsOpen).toBe(false);
    expect(useLlmStore.getState().settings).toMatchObject({
      preset: 'lmstudio',
      baseUrl: 'http://localhost:1234/v1',
      model: 'local-model',
      jsonMode: 'object',
    });
    expect(localStorage.getItem(API_KEY_KEY)).toBe('sk-secret-xyz');
    const settings = localStorage.getItem(SETTINGS_KEY) ?? '';
    expect(settings).toContain('local-model');
    expect(settings).not.toContain('sk-secret-xyz');
  });

  it('discards the changes on cancel', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByTestId('llm-settings-open'));
    await user.type(await screen.findByTestId('llm-model'), 'changed');
    await user.click(screen.getByTestId('llm-settings-cancel'));
    expect(useLlmStore.getState().settings.model).toBe('test-model');
    expect(localStorage.getItem(SETTINGS_KEY)).toBeNull();
  });

  it('tests the connection and loads the models', async () => {
    const user = userEvent.setup();
    const harness = installProvider([{ json: {} }]);
    render(<App />);
    await user.click(screen.getByTestId('llm-settings-open'));
    await user.type(await screen.findByTestId('llm-api-key'), 'k-123456');
    await user.click(screen.getByTestId('llm-test'));
    await waitFor(() => {
      expect(screen.getByTestId('llm-test-result')).toHaveAttribute('data-state', 'ok');
    });
    expect(screen.getByTestId('llm-test-result')).toHaveTextContent('Connected to alpha-model');
    expect(harness.configs.at(-1)).toMatchObject({ apiKey: 'k-123456', model: 'test-model' });

    await user.click(screen.getByTestId('llm-load-models'));
    await waitFor(() => {
      expect(screen.getByTestId('llm-models-note')).toHaveTextContent('2 models found');
    });
    expect(document.querySelectorAll('datalist option')).toHaveLength(2);
  });

  it('shows why a connection fails', async () => {
    const user = userEvent.setup();
    setProviderFactory(() => ({
      chat: () => Promise.reject(new Error('unused')),
      listModels: () => Promise.reject(new Error('HTTP 401')),
      test: () => Promise.resolve({ ok: false, message: 'The server refused the request' }),
    }));
    render(<App />);
    await user.click(screen.getByTestId('llm-settings-open'));
    await user.click(await screen.findByTestId('llm-test'));
    await waitFor(() => {
      expect(screen.getByTestId('llm-test-result')).toHaveAttribute('data-state', 'failed');
    });
    await user.click(screen.getByTestId('llm-load-models'));
    await waitFor(() => {
      expect(screen.getByTestId('llm-models-note')).toHaveTextContent('Could not load the models');
    });
  });
});
