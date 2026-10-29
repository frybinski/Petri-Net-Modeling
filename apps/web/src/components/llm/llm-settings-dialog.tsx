import { CheckCircle2, Eye, EyeOff, Loader2, XCircle } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { en } from '../../i18n/en';
import { makeProvider, providerConfig } from '../../lib/domain-generation';
import {
  JSON_MODES,
  insecureFromSecurePage,
  isConfigured,
  presetBaseUrl,
  presetsFor,
  type LlmSettings,
} from '../../lib/llm-settings';
import { useLlmStore } from '../../store/llm-store';
import { useServerStore } from '../../store/server-store';
import { notify } from '../../store/ui-store';
import { Button, IconButton } from '../ui/button';
import { Dialog } from '../ui/dialog';
import { NumberField, SelectField, inputClass } from '../ui/fields';

type Probe = { state: 'idle' } | { state: 'busy' } | { state: 'ok' | 'failed'; message: string };

function SettingsForm() {
  const settings = useLlmStore((s) => s.settings);
  const storedKey = useLlmStore((s) => s.apiKey);
  const save = useLlmStore((s) => s.save);
  const close = useLlmStore((s) => s.closeSettings);

  const serverModel = useServerStore(
    (s) => s.status === 'present' && s.health?.features.llm === true,
  );
  const serverDefault = useServerStore((s) => s.health?.llm.defaultModel ?? null);
  const presets = presetsFor(serverModel);
  const [draft, setDraft] = useState<LlmSettings>(settings);
  const [apiKey, setApiKey] = useState(storedKey);
  const [showKey, setShowKey] = useState(false);
  const [probe, setProbe] = useState<Probe>({ state: 'idle' });
  const [models, setModels] = useState<string[]>([]);
  const [modelsNote, setModelsNote] = useState<{ ok: boolean; text: string } | null>(null);
  const run = useRef(0);
  const urlId = useId();
  const modelId = useId();
  const keyId = useId();
  const listId = useId();
  const keyHintId = useId();

  const change = (patch: Partial<LlmSettings>): void => {
    setDraft((d) => ({ ...d, ...patch }));
    setProbe({ state: 'idle' });
  };

  const isServer = draft.preset === 'server';

  const choosePreset = (value: string): void => {
    const preset = presets.find((p) => p.id === value)?.id;
    if (!preset) return;
    // Presets bring their address; the custom entry keeps what was typed.
    const baseUrl = preset === 'custom' ? draft.baseUrl : presetBaseUrl(preset);
    change({
      preset,
      baseUrl,
      // The model of the server is proposed; a name from another server would not be known there.
      ...(preset === 'server' && { model: serverDefault ?? '' }),
    });
    setModels([]);
    setModelsNote(null);
  };

  const config = () => providerConfig(draft, apiKey);

  const test = async (): Promise<void> => {
    const id = ++run.current;
    setProbe({ state: 'busy' });
    try {
      const provider = await makeProvider(config());
      const result = await provider.test();
      if (id === run.current) {
        setProbe({ state: result.ok ? 'ok' : 'failed', message: result.message });
      }
    } catch (error) {
      if (id === run.current) {
        setProbe({
          state: 'failed',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  };

  const loadModels = async (): Promise<void> => {
    setModelsNote(null);
    try {
      const provider = await makeProvider(config());
      const list = await provider.listModels();
      setModels(list);
      setModelsNote({ ok: true, text: en.llm.modelsLoaded(list.length) });
      // On the server there is nothing to type: take the first model if none is chosen.
      if (isServer && list[0] !== undefined) {
        setDraft((d) =>
          d.preset === 'server' && d.model.trim() === '' ? { ...d, model: list[0] ?? '' } : d,
        );
      }
    } catch (error) {
      setModelsNote({
        ok: false,
        text: en.llm.modelsFailed(error instanceof Error ? error.message : String(error)),
      });
    }
  };

  // The models of the server are listed when the dialog opens on that preset.
  const loadOnOpen = useRef(isServer);
  useEffect(() => {
    if (!loadOnOpen.current) return;
    loadOnOpen.current = false;
    void loadModels();
    // Once, when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = (): void => {
    save({ ...draft, baseUrl: draft.baseUrl.trim(), model: draft.model.trim() }, apiKey);
    notify('success', en.llm.saved);
    close();
  };

  return (
    <Dialog
      open
      title={en.llm.settingsTitle}
      onClose={close}
      width="max-w-xl"
      footer={
        <>
          <Button onClick={close} data-testid="llm-settings-cancel">
            {en.llm.cancel}
          </Button>
          <Button variant="primary" onClick={submit} data-testid="llm-settings-save">
            {en.llm.save}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        data-testid="llm-settings"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <p className="m-0 text-xs text-muted">{en.llm.settingsIntro}</p>

        <SelectField
          label={en.llm.preset}
          value={draft.preset}
          options={presets.map((p) => ({ value: p.id, label: en.llm.presets[p.id] ?? p.id }))}
          onChange={choosePreset}
          data-testid="llm-preset"
        />

        <div className="flex flex-col gap-1">
          <label htmlFor={urlId} className="text-xs font-medium text-muted">
            {en.llm.baseUrl}
          </label>
          <input
            id={urlId}
            type="text"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            value={draft.baseUrl}
            placeholder={en.llm.baseUrlPlaceholder}
            readOnly={isServer}
            className={`${inputClass} font-mono text-xs`}
            data-testid="llm-base-url"
            onChange={(event) => {
              change({
                baseUrl: event.target.value,
                preset:
                  presets.find((p) => p.id !== 'server' && p.baseUrl === event.target.value.trim())
                    ?.id ?? 'custom',
              });
            }}
          />
          <p className="m-0 text-[11px] text-muted">
            {isServer ? en.llm.baseUrlServerHint : en.llm.baseUrlHint}
          </p>
        </div>

        {insecureFromSecurePage(draft.baseUrl) ? (
          <p
            className="m-0 rounded-md bg-surface-2 px-2.5 py-2 text-[11px] leading-4 text-warn"
            role="status"
            data-testid="llm-https-hint"
          >
            {en.llm.httpsHint}
          </p>
        ) : null}

        {isServer ? (
          <p
            className="m-0 rounded-md bg-surface-2 px-2.5 py-2 text-[11px] leading-4 text-muted"
            data-testid="llm-server-hint"
          >
            {en.llm.serverHint}
          </p>
        ) : null}

        {draft.preset === 'ollama' ? (
          <p
            className="m-0 rounded-md bg-surface-2 px-2.5 py-2 text-[11px] leading-4 text-muted"
            data-testid="llm-ollama-hint"
          >
            {en.llm.ollamaHint}
          </p>
        ) : null}

        <div className="flex flex-col gap-1">
          <label htmlFor={modelId} className="text-xs font-medium text-muted">
            {en.llm.model}
          </label>
          <div className="flex gap-2">
            <input
              id={modelId}
              type="text"
              list={listId}
              autoComplete="off"
              spellCheck={false}
              value={draft.model}
              placeholder={en.llm.modelPlaceholder}
              className={`${inputClass} font-mono text-xs`}
              data-testid="llm-model"
              onChange={(event) => {
                change({ model: event.target.value });
              }}
            />
            <datalist id={listId}>
              {models.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
            <Button
              onClick={() => {
                void loadModels();
              }}
              disabled={draft.baseUrl.trim() === ''}
              data-testid="llm-load-models"
            >
              {en.llm.loadModels}
            </Button>
          </div>
          {modelsNote ? (
            <p
              className={`m-0 text-[11px] ${modelsNote.ok ? 'text-muted' : 'text-danger'}`}
              role="status"
              data-testid="llm-models-note"
            >
              {modelsNote.text}
            </p>
          ) : null}
        </div>

        {isServer ? null : (
          <div className="flex flex-col gap-1">
            <label htmlFor={keyId} className="text-xs font-medium text-muted">
              {en.llm.apiKey}
            </label>
            <div className="flex items-center gap-1">
              <input
                id={keyId}
                type={showKey ? 'text' : 'password'}
                autoComplete="off"
                spellCheck={false}
                value={apiKey}
                aria-describedby={keyHintId}
                className={`${inputClass} font-mono text-xs`}
                data-testid="llm-api-key"
                onChange={(event) => {
                  setApiKey(event.target.value);
                  setProbe({ state: 'idle' });
                }}
              />
              <IconButton
                label={showKey ? en.llm.apiKeyHide : en.llm.apiKeyShow}
                pressed={showKey}
                onClick={() => {
                  setShowKey((v) => !v);
                }}
              >
                {showKey ? (
                  <EyeOff size={16} aria-hidden="true" />
                ) : (
                  <Eye size={16} aria-hidden="true" />
                )}
              </IconButton>
            </div>
            <p id={keyHintId} className="m-0 text-[11px] text-muted">
              {en.llm.apiKeyHint}
            </p>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <NumberField
            label={en.llm.temperature}
            value={draft.temperature}
            min={0}
            max={2}
            step={0.1}
            decimals={2}
            onCommit={(value) => {
              if (value !== undefined) change({ temperature: value });
            }}
            data-testid="llm-temperature"
          />
          <SelectField
            label={en.llm.jsonMode}
            value={draft.jsonMode}
            options={JSON_MODES.map((m) => ({ value: m, label: en.llm.jsonModes[m] ?? m }))}
            onChange={(value) => {
              const mode = JSON_MODES.find((m) => m === value);
              if (mode) change({ jsonMode: mode });
            }}
            data-testid="llm-json-mode"
          />
        </div>

        <p className="m-0 text-[11px] text-muted">
          {isServer ? en.llm.privacyServer : en.llm.privacy}
        </p>

        <div className="flex items-center gap-3">
          <Button
            onClick={() => {
              void test();
            }}
            disabled={!isConfigured(draft) || probe.state === 'busy'}
            icon={
              probe.state === 'busy' ? (
                <Loader2 size={14} className="animate-spin" aria-hidden="true" />
              ) : undefined
            }
            data-testid="llm-test"
          >
            {probe.state === 'busy' ? en.llm.testing : en.llm.testConnection}
          </Button>
          <span
            className="flex min-w-0 items-center gap-1.5 text-xs"
            role="status"
            data-testid="llm-test-result"
            data-state={probe.state}
          >
            {probe.state === 'ok' ? (
              <>
                <CheckCircle2 size={14} aria-hidden="true" className="shrink-0 text-ok" />
                <span className="break-words">{probe.message}</span>
              </>
            ) : probe.state === 'failed' ? (
              <>
                <XCircle size={14} aria-hidden="true" className="shrink-0 text-danger" />
                <span className="break-words text-danger">{probe.message}</span>
              </>
            ) : null}
          </span>
        </div>
      </form>
    </Dialog>
  );
}

/** The dialog for the language model server; mounted once, it renders while it is open. */
export function LlmSettingsDialog() {
  const open = useLlmStore((s) => s.settingsOpen);
  return open ? <SettingsForm /> : null;
}
