import { create } from 'zustand';
import {
  DEFAULT_SETTINGS,
  hasStoredSettings,
  isConfigured,
  loadApiKey,
  loadSettings,
  saveApiKey,
  saveSettings,
  serverSettings,
  type LlmSettings,
} from '../lib/llm-settings';
import type { ServerHealth } from '../lib/server-api';

interface LlmState {
  settings: LlmSettings;
  /** Kept in memory and in its own localStorage entry; never part of a document or a log. */
  apiKey: string;
  settingsOpen: boolean;
  /** Stores new settings and key. */
  save(settings: LlmSettings, apiKey: string): void;
  openSettings(): void;
  closeSettings(): void;
  /**
   * Called when it is known whether the app is served by a server. With a language model on the
   * server and nothing chosen yet, the server is the preset; where there is no server a stored
   * choice of the server preset is replaced by the default (in memory; nothing is overwritten).
   */
  adoptServer(health: ServerHealth | null): void;
}

export const useLlmStore = create<LlmState>()((set, get) => ({
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
  adoptServer(health) {
    const current = get().settings;
    if (health === null || !health.features.llm) {
      if (current.preset === 'server') set({ settings: { ...DEFAULT_SETTINGS } });
      return;
    }
    if (!hasStoredSettings()) set({ settings: serverSettings(health.llm.defaultModel) });
  },
}));

export function selectConfigured(state: LlmState): boolean {
  return isConfigured(state.settings);
}
