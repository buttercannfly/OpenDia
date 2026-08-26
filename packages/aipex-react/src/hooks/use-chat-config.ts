import {
  type AppSettings,
  DEFAULT_APP_SETTINGS,
  type KeyValueStorage,
  STORAGE_KEYS,
} from "@aipexstudio/aipex-core";
import { useCallback, useEffect, useState } from "react";
import { localStorageKeyValueAdapter } from "../lib/storage";

const DEFAULT_SETTINGS: AppSettings = {
  ...DEFAULT_APP_SETTINGS,
  aiHost: "",
  aiToken: "",
  aiModel: "gpt-4",
  providerEnabled: false,
  providerType: "openai",
  customModels: [],
};

export interface UseChatConfigOptions {
  /** Initial settings (will be overridden by stored values) */
  initialSettings?: Partial<AppSettings>;
  /** Storage adapter for persisting settings (KeyValueStorage from @aipexstudio/aipex-core) */
  storageAdapter?: KeyValueStorage<unknown>;
  /** Whether to auto-load settings from storage on mount */
  autoLoad?: boolean;
}

export interface UseChatConfigReturn {
  /** Current settings */
  settings: AppSettings;
  /** Whether settings are being loaded */
  isLoading: boolean;
  /** Update a single setting */
  updateSetting: <K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K],
  ) => Promise<void>;
  /** Update multiple settings at once */
  updateSettings: (updates: Partial<AppSettings>) => Promise<void>;
  /** Reset settings to defaults */
  resetSettings: () => Promise<void>;
  /** Reload settings from storage */
  reloadSettings: () => Promise<void>;
}

/**
 * useChatConfig - Hook for managing chat configuration/settings
 *
 * This hook handles loading, saving, and updating chat settings,
 * with support for different storage backends (localStorage, chrome.storage, etc.)
 *
 * @example
 * ```tsx
 * function SettingsPanel() {
 *   const { settings, updateSetting, isLoading } = useChatConfig({
 *     storageAdapter: chromeStorageAdapter,
 *   });
 *
 *   if (isLoading) return <Spinner />;
 *
 *   return (
 *     <input
 *       value={settings.aiModel}
 *       onChange={(e) => updateSetting('aiModel', e.target.value)}
 *     />
 *   );
 * }
 * ```
 */
export function useChatConfig(
  options: UseChatConfigOptions = {},
): UseChatConfigReturn {
  const {
    initialSettings = {},
    storageAdapter = localStorageKeyValueAdapter,
    autoLoad = true,
  } = options;

  const [settings, setSettings] = useState<AppSettings>({
    ...DEFAULT_SETTINGS,
    ...initialSettings,
  });
  const [isLoading, setIsLoading] = useState(autoLoad);

  const applyStoredSettings = useCallback((stored: unknown) => {
    setSettings((prev: AppSettings) => ({
      ...prev,
      ...(stored as Partial<AppSettings>),
      customModels:
        (stored as AppSettings).customModels ?? prev.customModels ?? [],
      providerType:
        (stored as AppSettings).providerType ?? prev.providerType ?? "openai",
      providerEnabled:
        (stored as AppSettings).providerEnabled ??
        prev.providerEnabled ??
        false,
    }));
  }, []);

  const loadSettings = useCallback(async () => {
    setIsLoading(true);
    try {
      const stored = await storageAdapter.load(STORAGE_KEYS.SETTINGS);
      if (stored) {
        applyStoredSettings(stored);
      }
    } catch (error) {
      console.error("Failed to load chat settings:", error);
    } finally {
      setIsLoading(false);
    }
  }, [storageAdapter, applyStoredSettings]);

  // Silent reload that does NOT touch isLoading, so existing UI stays mounted.
  // Used by the storage watcher to pick up changes (e.g. model switch)
  // without unmounting ChatBot.
  const reloadSettingsSilently = useCallback(async () => {
    try {
      const stored = await storageAdapter.load(STORAGE_KEYS.SETTINGS);
      if (stored) {
        applyStoredSettings(stored);
      }
    } catch (error) {
      console.error("Failed to reload chat settings:", error);
    }
  }, [storageAdapter, applyStoredSettings]);

  const saveSettings = useCallback(
    async (newSettings: AppSettings) => {
      try {
        await storageAdapter.save(STORAGE_KEYS.SETTINGS, newSettings);
      } catch (error) {
        console.error("Failed to save chat settings:", error);
      }
    },
    [storageAdapter],
  );

  useEffect(() => {
    if (autoLoad) {
      void loadSettings();
    }

    // Set up storage change listener for real-time sync.
    // Uses silent reload so the UI does not unmount (preserving chat state).
    const unwatch = storageAdapter.watch(STORAGE_KEYS.SETTINGS, () => {
      void reloadSettingsSilently();
    });

    return () => {
      unwatch();
    };
  }, [autoLoad, loadSettings, reloadSettingsSilently, storageAdapter]);

  const updateSetting = useCallback(
    async <K extends keyof AppSettings>(
      key: K,
      value: AppSettings[K],
    ): Promise<void> => {
      const newSettings = { ...settings, [key]: value };
      setSettings(newSettings);
      await saveSettings(newSettings);
    },
    [settings, saveSettings],
  );

  const updateSettings = useCallback(
    async (updates: Partial<AppSettings>): Promise<void> => {
      const newSettings = { ...settings, ...updates };
      setSettings(newSettings);
      await saveSettings(newSettings);
    },
    [settings, saveSettings],
  );

  const resetSettings = useCallback(async (): Promise<void> => {
    const newSettings = { ...DEFAULT_SETTINGS, ...initialSettings };
    setSettings(newSettings);
    await saveSettings(newSettings);
  }, [initialSettings, saveSettings]);

  const reloadSettings = useCallback(async (): Promise<void> => {
    await loadSettings();
  }, [loadSettings]);

  return {
    settings,
    isLoading,
    updateSetting,
    updateSettings,
    resetSettings,
    reloadSettings,
  };
}
