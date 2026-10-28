import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  API_KEY_KEY,
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  isConfigured,
  loadApiKey,
  loadSettings,
  presetBaseUrl,
  saveApiKey,
  saveSettings,
  type LlmSettings,
} from './llm-settings';

beforeEach(() => {
  localStorage.clear();
});

const custom: LlmSettings = {
  preset: 'custom',
  baseUrl: 'https://api.example.com/v1',
  model: 'some-model',
  temperature: 0.7,
  jsonMode: 'object',
};

describe('settings', () => {
  it('start with the Ollama preset, no model and automatic JSON mode', () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.baseUrl).toBe('http://localhost:11434/v1');
    expect(DEFAULT_SETTINGS.model).toBe('');
    expect(DEFAULT_SETTINGS.jsonMode).toBe('auto');
    expect(isConfigured(DEFAULT_SETTINGS)).toBe(false);
  });

  it('know the addresses of the presets', () => {
    expect(presetBaseUrl('ollama')).toBe('http://localhost:11434/v1');
    expect(presetBaseUrl('lmstudio')).toBe('http://localhost:1234/v1');
    expect(presetBaseUrl('custom')).toBe('');
  });

  it('are saved and read back', () => {
    saveSettings(custom);
    expect(loadSettings()).toEqual(custom);
    expect(isConfigured(custom)).toBe(true);
    expect(isConfigured({ ...custom, model: '  ' })).toBe(false);
  });

  it('fall back to the defaults for malformed or unknown values', () => {
    localStorage.setItem(SETTINGS_KEY, '{not json');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ preset: 'x', baseUrl: 5, model: 'm', temperature: 99, jsonMode: 'y' }),
    );
    expect(loadSettings()).toEqual({ ...DEFAULT_SETTINGS, model: 'm' });
  });

  it('survive storage that throws', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(loadApiKey()).toBe('');
    expect(() => {
      saveSettings(custom);
      saveApiKey('k');
    }).not.toThrow();
    get.mockRestore();
    set.mockRestore();
  });
});

describe('API key', () => {
  it('is kept in its own entry and never among the settings', () => {
    saveSettings(custom);
    saveApiKey('sk-secret-123');
    expect(loadApiKey()).toBe('sk-secret-123');
    expect(localStorage.getItem(API_KEY_KEY)).toBe('sk-secret-123');
    expect(localStorage.getItem(SETTINGS_KEY)).not.toContain('sk-secret-123');
    expect(localStorage.getItem(SETTINGS_KEY)).not.toMatch(/key/i);
  });

  it('is removed by saving an empty one', () => {
    saveApiKey('abc');
    saveApiKey('   ');
    expect(localStorage.getItem(API_KEY_KEY)).toBeNull();
    expect(loadApiKey()).toBe('');
  });
});
