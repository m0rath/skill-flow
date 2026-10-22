import { create } from "zustand";

import { PROVIDERS, createClient, type Client, type ProviderId } from "@/ai/providers";

const AI_KEY = "skillflow:ai";
const KEYS_KEY = "skillflow:keys";
const LEGACY_KEY = "skillflow:api";

export type ProviderKeys = Partial<Record<ProviderId, string>>;

interface AIState {
  provider: ProviderId;
  keys: ProviderKeys;
  models: ProviderKeys;
  remember: boolean;
  /** Live client built from the current provider + key + model, or null when incomplete. */
  client: Client | null;
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  setProvider: (p: ProviderId) => void;
  load: () => void;
  apply: () => void;
  persist: () => void;
  configure: (cfg: { provider: ProviderId; keys: ProviderKeys; models: ProviderKeys; remember: boolean }) => void;
  forget: (provider: ProviderId) => void;
}

function readStore<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Only accept keys/ids that are real provider names, never prototype members like "constructor". */
const isProviderId = (v: unknown): v is ProviderId =>
  typeof v === "string" && Object.prototype.hasOwnProperty.call(PROVIDERS, v);

/** Coerce a stored value into a map of known provider → string, dropping anything else. */
function stringMap(v: unknown): ProviderKeys {
  const out: ProviderKeys = {};
  if (!isObj(v)) return out;
  Object.keys(v).forEach((k) => {
    const value = v[k];
    if (isProviderId(k) && typeof value === "string" && value) out[k] = value;
  });
  return out;
}

function loadInitial(): { provider: ProviderId; keys: ProviderKeys; models: ProviderKeys; remember: boolean } {
  const out = {
    provider: "anthropic" as ProviderId,
    keys: {} as ProviderKeys,
    models: {} as ProviderKeys,
    remember: false,
  };
  try {
    const raw = readStore(() => JSON.parse(localStorage.getItem(AI_KEY) || "{}") as unknown, null);
    const s = isObj(raw) ? raw : {};
    if (isProviderId(s.provider)) out.provider = s.provider;
    out.models = stringMap(s.models);
    const storedKeys = stringMap(s.keys);
    out.remember = Object.keys(storedKeys).length > 0;
    const sessionKeys = stringMap(
      readStore(() => JSON.parse(sessionStorage.getItem(KEYS_KEY) || "{}") as unknown, null),
    );
    out.keys = Object.keys(storedKeys).length ? storedKeys : sessionKeys;
    const oldRaw = readStore(() => JSON.parse(localStorage.getItem(LEGACY_KEY) || "null") as unknown, null);
    const old = isObj(oldRaw) ? oldRaw : null;
    if (old && !s.provider) {
      if (typeof old.key === "string" && old.key) {
        out.keys.anthropic = old.key;
        out.remember = true;
      }
      if (typeof old.model === "string" && old.model) out.models.anthropic = old.model;
      localStorage.removeItem(LEGACY_KEY);
    }
  } catch {
    /* storage unavailable or corrupt */
  }
  return out;
}

function clientFor(provider: ProviderId, keys: ProviderKeys, models: ProviderKeys): Client | null {
  const key = (keys[provider] || "").trim();
  const model = (models[provider] || "").trim();
  if (!key || !model) return null;
  return createClient({ provider, key, model });
}

export const useAIStore = create<AIState>()((set, get) => {
  const initial = readStore(loadInitial, {
    provider: "anthropic" as ProviderId,
    keys: {},
    models: {},
    remember: false,
  });
  return {
    ...initial,
    client: clientFor(initial.provider, initial.keys, initial.models),
    settingsOpen: false,
    setSettingsOpen: (open) => set({ settingsOpen: open }),
    setProvider: (p) => {
      set({ provider: p });
      get().persist();
      get().apply();
    },
    load: () => {
      const s = readStore(loadInitial, { provider: "anthropic", keys: {}, models: {}, remember: false });
      set(s);
      get().apply();
    },
    apply: () => {
      const { provider, keys, models } = get();
      set({ client: clientFor(provider, keys, models) });
    },
    persist: () => {
      const { provider, keys, models, remember } = get();
      try {
        const clean = Object.fromEntries(Object.entries(keys).filter(([, v]) => v)) as ProviderKeys;
        localStorage.setItem(AI_KEY, JSON.stringify({ provider, models, keys: remember ? clean : {} }));
        if (remember || !Object.keys(clean).length) sessionStorage.removeItem(KEYS_KEY);
        else sessionStorage.setItem(KEYS_KEY, JSON.stringify(clean));
      } catch {
        /* storage unavailable */
      }
    },
    configure: ({ provider, keys, models, remember }) => {
      set({ provider, keys, models, remember });
      get().persist();
      get().apply();
    },
    forget: (provider) => {
      const keys = { ...get().keys, [provider]: "" };
      set({ keys });
      get().persist();
      get().apply();
    },
  };
});

/** Current key / model label for the header button. */
export function currentKeyLabel(state: Pick<AIState, "provider" | "keys" | "models" | "client">): string {
  const key = state.keys[state.provider] || "";
  const model = state.models[state.provider] || "";
  if (key && model) return `${PROVIDERS[state.provider].short}: ${model.replace(/^(claude-|models\/)/, "")}`;
  if (key) return "Choose a model";
  return "Add API key";
}
