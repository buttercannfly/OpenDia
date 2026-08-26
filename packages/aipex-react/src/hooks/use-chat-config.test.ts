/**
 * Tests for useChatConfig hook
 *
 * Covers how `applyStoredSettings` merges a freshly-loaded storage
 * snapshot into the settings already held in memory. `customModels`,
 * `providerType` and `providerEnabled` used to fall back to a hardcoded
 * default whenever a snapshot omitted them, instead of falling back to
 * the previous in-memory value like every other field in the same
 * merge does (via the `...prev` spread).
 */

import type {
  AppSettings,
  KeyValueStorage,
  WatchCallback,
} from "@aipexstudio/aipex-core";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useChatConfig } from "./use-chat-config";

/** Minimal in-memory KeyValueStorage with a controllable `watch` trigger. */
function createFakeStorage(): KeyValueStorage<unknown> & {
  emit: (key: string, value: unknown) => void;
} {
  const store = new Map<string, unknown>();
  const watchers = new Map<string, Set<WatchCallback<unknown>>>();

  return {
    async save(key, data) {
      store.set(key, data);
    },
    async load(key) {
      return store.has(key) ? (store.get(key) as unknown) : null;
    },
    async delete(key) {
      store.delete(key);
    },
    async listAll() {
      return Array.from(store.values());
    },
    async query(predicate) {
      return Array.from(store.values()).filter(predicate);
    },
    watch(key, callback) {
      let set = watchers.get(key);
      if (!set) {
        set = new Set();
        watchers.set(key, set);
      }
      set.add(callback);
      return () => set?.delete(callback);
    },
    // Test helper: simulate a storage change notification (e.g. another
    // extension page writing to the same key) and update the backing
    // store so a subsequent `load()` sees it, mirroring how
    // chrome.storage.onChanged pairs with chrome.storage.local.get.
    emit(key, value) {
      store.set(key, value);
      for (const cb of watchers.get(key) ?? []) {
        cb({ newValue: value as unknown });
      }
    },
  };
}

const customModel = {
  id: "custom-1",
  providerType: "openai" as const,
  aiToken: "token",
  aiModel: "gpt-4o",
  enabled: true,
};

describe("useChatConfig", () => {
  it("keeps previously loaded customModels when a later storage snapshot omits the field", async () => {
    const storage = createFakeStorage();
    await storage.save("aipex_settings", {
      aiModel: "gpt-4",
      customModels: [customModel],
    } satisfies AppSettings);

    const { result } = renderHook(() =>
      useChatConfig({ storageAdapter: storage }),
    );

    await waitFor(() => {
      expect(result.current.settings.customModels).toEqual([customModel]);
    });

    // The storage watcher fires with a partial snapshot (this test's own
    // fixture, standing in for whatever the next stored payload turns out
    // to be) that says nothing about customModels.
    act(() => {
      storage.emit("aipex_settings", { aiModel: "gpt-4o-mini" });
    });

    await waitFor(() => {
      expect(result.current.settings.aiModel).toBe("gpt-4o-mini");
    });

    // customModels must survive: it was known in memory and the new
    // snapshot simply didn't say anything about it.
    expect(result.current.settings.customModels).toEqual([customModel]);
  });

  it("prefers the stored value over the previous one when the snapshot provides it", async () => {
    const storage = createFakeStorage();
    await storage.save("aipex_settings", {
      customModels: [],
    } satisfies AppSettings);

    const { result } = renderHook(() =>
      useChatConfig({ storageAdapter: storage }),
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    act(() => {
      storage.emit("aipex_settings", { customModels: [customModel] });
    });

    await waitFor(() => {
      expect(result.current.settings.customModels).toEqual([customModel]);
    });
  });

  it("resetSettings explicitly clears customModels back to the default", async () => {
    const storage = createFakeStorage();
    await storage.save("aipex_settings", {
      customModels: [customModel],
    } satisfies AppSettings);

    const { result } = renderHook(() =>
      useChatConfig({ storageAdapter: storage }),
    );

    await waitFor(() => {
      expect(result.current.settings.customModels).toEqual([customModel]);
    });

    await act(async () => {
      await result.current.resetSettings();
    });

    expect(result.current.settings.customModels).toEqual([]);
  });
});
