/** Settings of the LLM provider. The API key lives apart from them, only in this browser. */

export type JsonMode = 'auto' | 'schema' | 'object' | 'none';
export type ProviderPreset = 'ollama' | 'lmstudio' | 'custom';

export interface LlmSettings {
  preset: ProviderPreset;
  baseUrl: string;
  /** Free text; the models of a server are listed on request. */
  model: string;
  temperature: number;
  jsonMode: JsonMode;
}

export const SETTINGS_KEY = 'pnm:llm';
export const API_KEY_KEY = 'pnm:llm-key';

export const PRESETS: ReadonlyArray<{ id: ProviderPreset; baseUrl: string }> = [
  { id: 'ollama', baseUrl: 'http://localhost:11434/v1' },
  { id: 'lmstudio', baseUrl: 'http://localhost:1234/v1' },
  { id: 'custom', baseUrl: '' },
];

export const JSON_MODES: readonly JsonMode[] = ['auto', 'schema', 'object', 'none'];

export const DEFAULT_SETTINGS: LlmSettings = {
  preset: 'ollama',
  baseUrl: 'http://localhost:11434/v1',
  model: '',
  temperature: 0.2,
  jsonMode: 'auto',
};

export function presetBaseUrl(preset: ProviderPreset): string {
  return PRESETS.find((p) => p.id === preset)?.baseUrl ?? '';
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage may be unavailable (private mode, blocked); the settings then last for the session.
  }
}

function isPreset(value: unknown): value is ProviderPreset {
  return PRESETS.some((p) => p.id === value);
}

function isJsonMode(value: unknown): value is JsonMode {
  return JSON_MODES.some((m) => m === value);
}

/** Reads the stored settings; anything missing or malformed falls back to the defaults. */
export function loadSettings(): LlmSettings {
  const raw = read(SETTINGS_KEY);
  if (raw === null) return { ...DEFAULT_SETTINGS };
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    const temperature = typeof data['temperature'] === 'number' ? data['temperature'] : NaN;
    return {
      preset: isPreset(data['preset']) ? data['preset'] : DEFAULT_SETTINGS.preset,
      baseUrl: typeof data['baseUrl'] === 'string' ? data['baseUrl'] : DEFAULT_SETTINGS.baseUrl,
      model: typeof data['model'] === 'string' ? data['model'] : DEFAULT_SETTINGS.model,
      temperature:
        Number.isFinite(temperature) && temperature >= 0 && temperature <= 2
          ? temperature
          : DEFAULT_SETTINGS.temperature,
      jsonMode: isJsonMode(data['jsonMode']) ? data['jsonMode'] : DEFAULT_SETTINGS.jsonMode,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** Stores the settings, without the API key. */
export function saveSettings(settings: LlmSettings): void {
  write(
    SETTINGS_KEY,
    JSON.stringify({
      preset: settings.preset,
      baseUrl: settings.baseUrl,
      model: settings.model,
      temperature: settings.temperature,
      jsonMode: settings.jsonMode,
    }),
  );
}

export function loadApiKey(): string {
  return read(API_KEY_KEY) ?? '';
}

/** Stores the key under its own entry; an empty key removes it. */
export function saveApiKey(key: string): void {
  write(API_KEY_KEY, key.trim() === '' ? null : key.trim());
}

/** True if the settings are enough to send a request. */
export function isConfigured(settings: LlmSettings): boolean {
  return settings.baseUrl.trim() !== '' && settings.model.trim() !== '';
}

/**
 * True for an `http://` address on a page that is served over HTTPS: browsers may refuse such a
 * request (mixed content), which is the case for the deployed app and a local provider.
 */
export function insecureFromSecurePage(baseUrl: string): boolean {
  return (
    typeof window !== 'undefined' &&
    window.location.protocol === 'https:' &&
    /^http:\/\//i.test(baseUrl.trim())
  );
}
