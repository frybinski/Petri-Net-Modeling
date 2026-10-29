import { beforeEach, describe, expect, it } from 'vitest';
import { providerConfig } from '../lib/domain-generation';
import {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  loadSettings,
  presetBaseUrl,
  presetsFor,
  saveSettings,
  serverSettings,
} from '../lib/llm-settings';
import type { ServerHealth } from '../lib/server-api';
import { useLlmStore } from './llm-store';

const health = (llm: boolean, defaultModel: string | null = 'm1'): ServerHealth => ({
  ok: true,
  app: 'petri-net-modeling',
  version: '1.2.0',
  name: 'aifb-test',
  features: { api: true, projects: true, llm, auth: false },
  llm: { models: [], defaultModel },
});

beforeEach(() => {
  localStorage.clear();
  useLlmStore.setState({ settings: { ...DEFAULT_SETTINGS }, apiKey: '', settingsOpen: false });
});

describe('the server as the language model', () => {
  it('is a preset with the proxy of the server as its address', () => {
    expect(presetBaseUrl('server')).toBe('/llm/v1');
    expect(presetsFor(true).map((p) => p.id)).toEqual(['server', 'ollama', 'lmstudio', 'custom']);
    expect(presetsFor(false).map((p) => p.id)).toEqual(['ollama', 'lmstudio', 'custom']);
    expect(serverSettings('m1')).toMatchObject({
      preset: 'server',
      baseUrl: '/llm/v1',
      model: 'm1',
    });
    expect(serverSettings(null).model).toBe('');
  });

  it('never sends a key to it, not even one that is stored for another server', () => {
    const settings = serverSettings('m1');
    expect(providerConfig(settings, 'sk-my-own-key')).not.toHaveProperty('apiKey');
    expect(providerConfig({ ...settings, preset: 'ollama' }, 'sk-my-own-key')).toMatchObject({
      apiKey: 'sk-my-own-key',
    });
  });

  it('becomes the choice when the app finds a server with a model and nothing was chosen', () => {
    useLlmStore.getState().adoptServer(health(true, 'm1'));
    expect(useLlmStore.getState().settings).toMatchObject({
      preset: 'server',
      baseUrl: '/llm/v1',
      model: 'm1',
    });
    // It is a default, not a choice: nothing is stored until the person saves.
    expect(localStorage.getItem(SETTINGS_KEY)).toBeNull();
  });

  it('does not override what the person chose', () => {
    saveSettings({
      ...DEFAULT_SETTINGS,
      preset: 'lmstudio',
      baseUrl: 'http://localhost:1234/v1',
      model: 'mine',
    });
    useLlmStore.setState({ settings: loadSettings() });
    useLlmStore.getState().adoptServer(health(true));
    expect(useLlmStore.getState().settings).toMatchObject({ preset: 'lmstudio', model: 'mine' });
  });

  it('stays out of the way on a server without a model', () => {
    useLlmStore.getState().adoptServer(health(false));
    expect(useLlmStore.getState().settings).toEqual(DEFAULT_SETTINGS);
  });

  it('falls back to the default where the stored choice was the server and there is none', () => {
    saveSettings(serverSettings('m1'));
    useLlmStore.setState({ settings: loadSettings() });
    expect(useLlmStore.getState().settings.preset).toBe('server');
    useLlmStore.getState().adoptServer(null);
    expect(useLlmStore.getState().settings).toEqual(DEFAULT_SETTINGS);
    // The stored choice is left as it is, for the day the server is back.
    expect(loadSettings().preset).toBe('server');
  });
});
