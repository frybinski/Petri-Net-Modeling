import { create } from 'zustand';
import {
  isConfigured,
  loadApiKey,
  loadSettings,
  saveApiKey,
  saveSettings,
  type LlmSettings,
} from '../lib/llm-settings';

interface LlmState {
  settings: LlmSettings;
  /** Kept in memory and in its own localStorage entry; never part of a document or a log. */
  apiKey: string;
  settingsOpen: boolean;
  /** Stores new settings and key. */
  save(settings: LlmSettings, apiKey: string): void;
  openSettings(): void;
  closeSettings(): void;
}

export const useLlmStore = create<LlmState>()((set) => ({
  settings: loadSettings(),
  apiKey: loadApiKey(),
  settingsOpen: false,
  save(settings, apiKey) {
    saveSettings(settings);
    saveApiKey(apiKey);
    set({ settings, apiKey: apiKey.trim() });
  },
  openSettings() {
    set({ settingsOpen: true });
  },
  closeSettings() {
    set({ settingsOpen: false });
  },
}));

export function selectConfigured(state: LlmState): boolean {
  return isConfigured(state.settings);
}
