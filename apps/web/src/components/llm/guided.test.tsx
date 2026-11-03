import type { DomainView } from '@pnm/domain';
import type { ChatRequest, ChatResult, Provider, ProviderConfig } from '@pnm/llm';
import { createFakeProvider, type FakeScript } from '@pnm/llm/testing';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../../App';
import { setProviderFactory } from '../../lib/domain-generation';
import { DEFAULT_SETTINGS } from '../../lib/llm-settings';
import { useEditorStore } from '../../store/editor-store';
import { useGenerationStore } from '../../store/generation-store';
import { useLlmStore } from '../../store/llm-store';
import { SPLIT_DEFAULT, useUiStore } from '../../store/ui-store';
import { loadExample, smallNet } from '../../test/domain-fixtures';

const editor = () => useEditorStore.getState();

/** What a model would answer for the net: the stored view without hash and provenance. */
function answerFor(view: DomainView): Record<string, unknown> {
  const { netHash: _hash, provenance: _provenance, ...rest } = view;
  return structuredClone(rest) as Record<string, unknown>;
}

function install(script: FakeScript): { requests: ChatRequest[]; configs: ProviderConfig[] } {
  const fake = createFakeProvider(script);
  const configs: ProviderConfig[] = [];
  setProviderFactory((config): Provider => {
    configs.push(config);
    return {
      chat: (request: ChatRequest): Promise<ChatResult> => fake.chat(request),
      listModels: () => Promise.resolve([]),
      test: () => Promise.resolve({ ok: true, message: 'ok' }),
    };
  });
  return { requests: fake.calls, configs };
}

beforeEach(() => {
  localStorage.clear();
  editor().newNet();
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
  useGenerationStore.setState({ open: false, logOpen: false, description: '', choices: null });
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
  await user.click(await screen.findByTestId('domain-generate-llm'));
  expect(await screen.findByTestId('llm-dialog')).toHaveAttribute('data-stage', 'form');
}

async function stage(name: string) {
  await waitFor(
    () => {
      expect(screen.getByTestId('llm-dialog')).toHaveAttribute('data-stage', name);
    },
    { timeout: 8000 },
  );
}

/** The bicycle frame example without its stored view: the form starts from the net. */
function loadBikeWithoutView(): DomainView {
  const net = loadExample('bike-frames');
  const view = structuredClone(net.domainView) as DomainView;
  delete (net as { domainView?: unknown }).domainView;
  editor().loadNet(net, 'bike-frames.pn.json');
  return view;
}

describe('the guided form (N4)', () => {
  it('is the first tab, prefilled from the net: stages in flow order, limits from the net', async () => {
    const user = userEvent.setup();
    loadBikeWithoutView();
    install([{ json: {} }]);
    await openDialog(user);
    expect(screen.getByTestId('llm-tab-guided')).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByTestId('llm-description')).toBeNull();
    const guided = await screen.findByTestId('llm-guided');

    expect(within(guided).getByTestId('guided-setting')).toHaveValue('Fahrradrahmen-Fertigung');
    // The places that hold cases, from the arrivals along the flow.
    const stageIds = within(screen.getByTestId('guided-stages'))
      .getAllByTestId(/^guided-stage-[a-z_]+$/)
      .map((row) => row.dataset['testid']?.replace('guided-stage-', ''));
    expect(stageIds.slice(0, 4)).toEqual(['p_orders', 'p_cut', 'p_welded', 'p_coated']);
    expect(stageIds).not.toContain('p_saw');
    expect(stageIds).not.toContain('p_tubes');
    // The counters: amounts and the sink of the shipped frames.
    for (const id of ['p_tubes', 'p_scrap', 'p_waste', 'p_co2', 'p_shipped']) {
      expect(screen.getByTestId(`guided-counter-${id}`)).toBeInTheDocument();
    }
    // A plain number to start with; the stock has a limit that suits its marking.
    const tubes = screen.getByTestId('guided-counter-p_tubes-style');
    expect(within(tubes).getByRole('radio', { name: /number/i })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('is prefilled from the view of the net if it has one', async () => {
    const user = userEvent.setup();
    editor().loadNet(loadExample('bike-frames'), 'bike-frames.pn.json');
    install([{ json: {} }]);
    await openDialog(user);
    await screen.findByTestId('llm-guided');
    expect(screen.getByTestId('guided-stage-p_welded-symbol')).toHaveValue('frame');
    expect(screen.getByTestId('guided-stage-p_welded-tint')).toHaveValue('neutral');
    expect(screen.getByTestId('guided-stage-p_orders-symbol')).toHaveValue('document');
    expect(screen.getByTestId('guided-counter-p_tubes-max')).toHaveValue('200');
    expect(screen.getByTestId('guided-counter-p_co2-per')).toHaveValue('50');
    expect(screen.getByTestId('guided-counter-p_co2-symbol')).toHaveValue('co2');
  });

  it('does not ask about a place that the view hides, also not after a concept', async () => {
    const user = userEvent.setup();
    editor().loadNet(loadExample('bike-frames'), 'bike-frames.pn.json');
    install([
      {
        json: {
          concepts: [
            {
              title: 'Free space',
              idea: 'Shows what the view hides.',
              entity: { singular: 'x', plural: 'xs', sprite: 'dot' },
              counters: [{ place: 'p_space', style: 'fill', max: 200 }],
            },
          ],
        },
      },
    ]);
    await openDialog(user);
    await screen.findByTestId('llm-guided');
    expect(screen.queryByTestId('guided-counter-p_space')).toBeNull();
    expect(screen.getByTestId('guided-counter-p_tubes')).toBeInTheDocument();
    await user.click(screen.getByTestId('guided-suggest'));
    await user.click(await screen.findByTestId('guided-concept-use'));
    expect(screen.queryByTestId('guided-counter-p_space')).toBeNull();
    expect(useGenerationStore.getState().choices?.counters).not.toHaveProperty('p_space');
  });

  it('remembers the last tab', async () => {
    const user = userEvent.setup();
    install([{ json: {} }]);
    editor().loadNet(smallNet(), 'small.pn.json');
    await openDialog(user);
    await user.click(screen.getByTestId('llm-tab-free'));
    expect(screen.getByTestId('llm-description')).toHaveValue('Small');
    await user.click(screen.getByTestId('llm-close'));
    await user.click(await screen.findByTestId('domain-generate-llm'));
    expect(await screen.findByTestId('llm-description')).toBeInTheDocument();
    expect(screen.getByTestId('llm-tab-free')).toHaveAttribute('aria-selected', 'true');
  });

  it('checks the fields at once, and keeps the buttons off while there is an error', async () => {
    const user = userEvent.setup();
    install([{ json: {} }]);
    editor().loadNet(smallNet(), 'small.pn.json');
    await openDialog(user);
    await screen.findByTestId('llm-guided');
    expect(screen.getByTestId('llm-start')).toBeEnabled();
    await user.selectOptions(screen.getByTestId('guided-entity-symbol'), '__emoji');
    const emoji = await screen.findByTestId('guided-entity-emoji');
    await user.clear(emoji);
    await user.type(emoji, 'ab{Enter}');
    expect(await screen.findByText(/exactly one emoji/)).toBeInTheDocument();
    await user.clear(emoji);
    await user.type(emoji, '🦄{Enter}');
    await waitFor(() => {
      expect(screen.queryByText(/exactly one emoji/)).toBeNull();
    });
    expect(screen.getByTestId('llm-start')).toBeEnabled();
    expect(screen.getByTestId('guided-apply')).toBeEnabled();
  });

  it('shows the concepts as cards, with the invalid parts left out and noted', async () => {
    const user = userEvent.setup();
    loadBikeWithoutView();
    const { requests } = install([
      {
        json: {
          concepts: [
            {
              title: 'Rainbow works',
              idea: 'Frames are rainbows.',
              setting: 'A workshop for fairy tales',
              entity: { singular: 'Rainbow', plural: 'Rainbows', emoji: '🌈' },
              stages: [
                { place: 'p_welded', emoji: '🔥' },
                { place: 'p_nope', emoji: '🔥' },
              ],
              counters: [{ place: 'p_co2', style: 'pictogram', per: 40, emoji: '🌳' }],
              layout: 'top-to-bottom',
            },
            {
              title: 'Plain',
              idea: 'Just frames.',
              entity: { singular: 'x', plural: 'xs', emoji: 'ab' },
            },
          ],
        },
      },
    ]);
    await openDialog(user);
    await screen.findByTestId('llm-guided');
    await user.click(screen.getByTestId('guided-suggest'));
    const cards = await screen.findAllByTestId('guided-concept');
    expect(cards.map((c) => c.dataset['title'])).toEqual(['Rainbow works', 'Plain']);
    expect(within(cards[0]!).getByTestId('guided-concept-dropped')).toHaveTextContent(
      '1 invalid part left out',
    );
    expect(within(cards[1]!).getByTestId('guided-concept-dropped')).toHaveTextContent(
      '1 invalid part left out',
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]!.user).toContain('"id":"p_welded"');

    // A click fills the form; the person's additions stay.
    await user.type(screen.getByTestId('guided-additions'), 'Keep it friendly');
    await user.click(within(cards[0]!).getByTestId('guided-concept-use'));
    expect(screen.getByTestId('guided-setting')).toHaveValue('A workshop for fairy tales');
    expect(screen.getByTestId('guided-entity-emoji')).toHaveValue('🌈');
    expect(screen.getByTestId('guided-stage-p_welded-emoji')).toHaveValue('🔥');
    expect(screen.getByTestId('guided-counter-p_co2-emoji')).toHaveValue('🌳');
    expect(screen.getByTestId('guided-counter-p_co2-per')).toHaveValue('40');
    expect(screen.getByTestId('guided-additions')).toHaveValue('Keep it friendly');
    expect(useGenerationStore.getState().concept).toBe('Rainbow works');
  });

  it('tells when the model could not be asked', async () => {
    const user = userEvent.setup();
    install([{ error: 'network', message: 'no connection' }]);
    editor().loadNet(smallNet(), 'small.pn.json');
    await openDialog(user);
    await screen.findByTestId('llm-guided');
    await user.click(screen.getByTestId('guided-suggest'));
    expect(await screen.findByTestId('guided-suggest-error')).toHaveTextContent('no connection');
  });

  it('generates with binding choices: what the model wrote differently is replaced and noted', async () => {
    const user = userEvent.setup();
    const stored = loadBikeWithoutView();
    const { requests } = install([{ json: answerFor(stored), model: 'test-model' }]);
    await openDialog(user);
    await screen.findByTestId('llm-guided');
    await user.selectOptions(screen.getByTestId('guided-entity-symbol'), '__emoji');
    const emoji = await screen.findByTestId('guided-entity-emoji');
    await user.clear(emoji);
    await user.type(emoji, '🦄{Enter}');
    await user.selectOptions(screen.getByTestId('guided-stage-p_welded-symbol'), '__emoji');
    await user.click(screen.getByTestId('llm-start'));
    await stage('result');

    expect(requests[0]!.user).toContain('## Binding choices');
    expect(requests[0]!.user).toContain('"emoji" "🦄"');
    const notes = screen.getByTestId('llm-notes');
    expect(notes).toHaveTextContent('Choice applied');
    expect(notes).toHaveTextContent('🦄');
    expect(screen.queryByTestId('llm-model-notes')).toBeNull();

    await user.click(screen.getByTestId('llm-use'));
    await waitFor(() => {
      expect(editor().net.domainView).toBeDefined();
    });
    const view = editor().net.domainView as DomainView;
    expect(view.meta.entity).toMatchObject({ emoji: '🦄' });
    expect((view.places['p_welded'] as { appearance?: unknown }).appearance).toEqual({
      emoji: '⭐',
    });
    const record = editor().net.domainViewGeneration as { mode: string; choices: unknown };
    expect(record.mode).toBe('guided');
    expect(record.choices).toBeDefined();

    // The log shows the way and the choices.
    await user.click(screen.getByTestId('domain-show-log'));
    const log = await screen.findByTestId('llm-log');
    expect(within(log).getByTestId('llm-record')).toHaveTextContent('Guided');
    expect(within(log).getByTestId('llm-log-choices')).toBeInTheDocument();
  });
});

describe('Apply without LLM (N4)', () => {
  it('sets the choices on the current view, keeps the geometry and takes one undo step', async () => {
    const user = userEvent.setup();
    editor().loadNet(loadExample('bike-frames'), 'bike-frames.pn.json');
    const before = editor().net.domainView as DomainView;
    const { requests } = install([{ json: {} }]);
    await openDialog(user);
    await screen.findByTestId('llm-guided');
    await user.selectOptions(screen.getByTestId('guided-stage-p_welded-symbol'), '__emoji');
    const emoji = await screen.findByTestId('guided-stage-p_welded-emoji');
    await user.clear(emoji);
    await user.type(emoji, '🔥{Enter}');
    const pastBefore = editor().past.length;
    await user.click(screen.getByTestId('guided-apply'));

    await waitFor(() => {
      expect(useGenerationStore.getState().open).toBe(false);
    });
    expect(requests).toHaveLength(0);
    expect(editor().past.length).toBe(pastBefore + 1);
    const view = editor().net.domainView as DomainView;
    expect((view.places['p_welded'] as { appearance?: unknown }).appearance).toEqual({
      emoji: '🔥',
    });
    expect(view.provenance['places.p_welded']?.source).toBe('user');
    expect(view.provenance['places.p_saw']).toEqual(before.provenance['places.p_saw']);
    // The geometry is the one it was.
    expect(view.transitions).toEqual(before.transitions);
    expect(view.decor).toEqual(before.decor);
    expect(view.places['p_welded']).toMatchObject({
      kind: (before.places['p_welded'] as { kind: string }).kind,
      path: (before.places['p_welded'] as { path: unknown }).path,
    });
    editor().undo();
    expect(editor().net.domainView).toEqual(before);
  });

  it('works on the generic view when the net has none, and without a model that is set up', async () => {
    const user = userEvent.setup();
    loadBikeWithoutView();
    useLlmStore.setState({ settings: { ...DEFAULT_SETTINGS, model: '' } });
    install([{ json: {} }]);
    await openDialog(user);
    await screen.findByTestId('llm-guided');
    expect(screen.getByTestId('llm-start')).toBeDisabled();
    await user.selectOptions(screen.getByTestId('guided-entity-symbol'), '__emoji');
    const emoji = await screen.findByTestId('guided-entity-emoji');
    await user.clear(emoji);
    await user.type(emoji, '🦄{Enter}');
    await user.click(screen.getByTestId('guided-apply'));
    await waitFor(() => {
      expect(editor().net.domainView).toBeDefined();
    });
    const view = editor().net.domainView as DomainView;
    expect(view.meta.entity).toMatchObject({ emoji: '🦄' });
    expect(Object.values(view.provenance).some((p) => p.source === 'generic')).toBe(true);
    expect(editor().net.domainViewGeneration).toBeUndefined();
    editor().undo();
    expect(editor().net.domainView).toBeUndefined();
  });
});

describe('the free way and the notes of the model (N4)', () => {
  it('shows the notes above the preview, and keeps them in the log', async () => {
    const user = userEvent.setup();
    const stored = loadBikeWithoutView();
    const answer = answerFor(stored);
    (answer['meta'] as { entity: unknown }).entity = {
      singular: 'Unicorn',
      plural: 'Unicorns',
      emoji: '🦄',
    };
    answer['notes'] = ['Pink is not available; the tint “danger” was used instead.'];
    install([{ json: answer, model: 'test-model' }]);
    await openDialog(user);
    await user.click(screen.getByTestId('llm-tab-free'));
    const description = screen.getByTestId('llm-description');
    await user.clear(description);
    await user.type(description, 'The frames are unicorns in pink');
    await user.click(screen.getByTestId('llm-start'));
    await stage('result');

    const notes = screen.getByTestId('llm-model-notes');
    expect(within(notes).getByTestId('llm-model-note')).toHaveTextContent('Pink is not available');
    const preview = screen.getByTestId('llm-preview');
    expect(notes.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await user.click(screen.getByTestId('llm-use'));
    await waitFor(() => {
      expect(editor().net.domainView).toBeDefined();
    });
    const view = editor().net.domainView as DomainView;
    expect(view.meta.entity).toMatchObject({ emoji: '🦄' });
    expect(JSON.stringify(view)).not.toContain('Pink is not available');
    const record = editor().net.domainViewGeneration as { mode: string; modelNotes: string[] };
    expect(record.mode).toBe('free');
    expect(record.modelNotes).toEqual([
      'Pink is not available; the tint “danger” was used instead.',
    ]);
    await user.click(screen.getByTestId('domain-show-log'));
    expect(await screen.findByTestId('llm-log-model-notes')).toHaveTextContent('Pink is not');
  });

  it('has no notes section when the model says nothing', async () => {
    const user = userEvent.setup();
    const stored = loadBikeWithoutView();
    install([{ json: answerFor(stored), model: 'test-model' }]);
    await openDialog(user);
    await user.click(screen.getByTestId('llm-tab-free'));
    await user.click(screen.getByTestId('llm-start'));
    await stage('result');
    expect(screen.queryByTestId('llm-model-notes')).toBeNull();
  });

  it('names wishes in the placeholder and the hint of the description', async () => {
    const user = userEvent.setup();
    install([{ json: {} }]);
    editor().loadNet(smallNet(), 'small.pn.json');
    await openDialog(user);
    await user.click(screen.getByTestId('llm-tab-free'));
    expect(screen.getByTestId('llm-description')).toHaveAttribute(
      'placeholder',
      'A bakery with two ovens. Show the loaves as 🍞.',
    );
  });
});
