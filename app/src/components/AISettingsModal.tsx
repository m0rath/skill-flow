import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import { errCopy } from "@/ai/errors";
import { PROVIDERS, listModels, preferModel, type ModelInfo, type ProviderId } from "@/ai/providers";
import { useDialog } from "@/components/a11y";
import { usePrefersReducedMotion } from "@/hooks/useMediaQuery";
import { useAIStore, type ProviderKeys } from "@/store/ai";
import { useAppStore } from "@/store/app";

interface Draft {
  provider: ProviderId;
  keys: ProviderKeys;
  models: ProviderKeys;
  remember: boolean;
}

export function AISettingsModal() {
  const open = useAIStore((s) => s.settingsOpen);
  const setOpen = useAIStore((s) => s.setSettingsOpen);
  const provider = useAIStore((s) => s.provider);
  const keys = useAIStore((s) => s.keys);
  const models = useAIStore((s) => s.models);
  const remember = useAIStore((s) => s.remember);
  const configure = useAIStore((s) => s.configure);
  const forget = useAIStore((s) => s.forget);
  const toast = useAppStore((s) => s.toast);

  const [draft, setDraft] = useState<Draft>({ provider, keys: { ...keys }, models: { ...models }, remember });
  const [modelList, setModelList] = useState<ModelInfo[]>([]);
  const [msg, setMsg] = useState<{ text: string; cls: "" | "ok" | "bad" }>({ text: "", cls: "" });
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);

  const reduce = usePrefersReducedMotion();
  const dialogRef = useDialog(open, () => setOpen(false), { closeOnEscape: !testing });

  // Reset the draft each time the dialog opens.
  useEffect(() => {
    if (open) {
      setDraft({ provider, keys: { ...keys }, models: { ...models }, remember });
      setModelList([]);
      setMsg({
        text: keys[provider] ? "" : "Paste your key, then press Test key to load the models it can use.",
        cls: "",
      });
      setShowKey(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const info = PROVIDERS[draft.provider];
  const note = useMemo(
    () =>
      `Chat, AI mapping and gap review call ${info.label} directly from your browser with your own key. The key is sent only to ${info.host}; this site has no server. Get a key at ${info.keySite}.` +
      (draft.provider === "gemini"
        ? " Gemini has a free tier; on it, Google may use prompts to improve its products, so avoid confidential files."
        : draft.provider === "openai"
          ? " A ChatGPT Plus subscription does not include API usage; the API is billed separately."
          : " Set a spend limit on the key."),
    [info, draft.provider],
  );

  const curKey = draft.keys[draft.provider] || "";
  const curModel = draft.models[draft.provider] || "";

  const stash = (next: Partial<Draft> = {}): Draft => {
    const merged: Draft = { ...draft, ...next };
    merged.keys = { ...draft.keys, ...(next.keys || {}) };
    merged.models = { ...draft.models, ...(next.models || {}) };
    setDraft(merged);
    return merged;
  };

  const testKey = async () => {
    const key = (draft.keys[draft.provider] || "").trim();
    if (!key) {
      setMsg({ text: "Paste a key first.", cls: "bad" });
      return;
    }
    setMsg({ text: "Checking the key…", cls: "" });
    setTesting(true);
    try {
      const list = await listModels(draft.provider, key);
      setModelList(list);
      const pick = list.find((m) => m.id === curModel) || preferModel(draft.provider, list);
      if (pick) setDraft((d) => ({ ...d, models: { ...d.models, [d.provider]: pick.id } }));
      setMsg({ text: `Key works. ${list.length} models available.`, cls: "ok" });
    } catch (e) {
      setMsg({ text: errCopy((e as { code?: string }).code, "Couldn't check the key."), cls: "bad" });
    } finally {
      setTesting(false);
    }
  };

  const close = () => setOpen(false);

  const onSave = () => {
    if (curKey && !curModel) {
      setMsg({ text: "Press Test key to load models, or type a model ID.", cls: "bad" });
      return;
    }
    configure({ provider: draft.provider, keys: draft.keys, models: draft.models, remember: draft.remember });
    close();
    toast(curKey ? `Using ${info.label}` : "Settings saved");
  };

  // While a key check is in flight, do not let a stray backdrop click dismiss the dialog.
  const onBackdrop = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && !testing) close();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="modal"
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={reduce ? { duration: 0 } : { duration: 0.15 }}
          onClick={onBackdrop}
        >
          <motion.div
            ref={dialogRef}
            className="box settings"
            role="dialog"
            aria-modal="true"
            aria-labelledby="setTitle"
            aria-busy={testing}
            tabIndex={-1}
            style={{ width: "min(580px, 100%)" }}
            initial={reduce ? false : { opacity: 0, y: 10, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.99 }}
            transition={reduce ? { duration: 0 } : { duration: 0.18, ease: "easeOut" }}
          >
            <strong id="setTitle">AI settings</strong>

            <label className="f" htmlFor="provSel">
              Provider
              <select
                id="provSel"
                value={draft.provider}
                onChange={(e) => {
                  const next = stash({ provider: e.target.value as ProviderId });
                  setModelList([]);
                  setMsg({
                    text: next.keys[next.provider] ? "" : "Paste your key, then press Test key.",
                    cls: "",
                  });
                }}
              >
                <option value="anthropic">Anthropic (Claude)</option>
                <option value="openai">OpenAI (ChatGPT)</option>
                <option value="gemini">Google Gemini</option>
              </select>
            </label>
            <p className="note">
              {note}{" "}
              <a href={info.keyUrl} target="_blank" rel="noopener noreferrer">
                {info.keySite}
              </a>
            </p>

            <label className="f" htmlFor="apiKey">
              <span>{info.label} API key</span>
              <span className="inrow">
                <input
                  type={showKey ? "text" : "password"}
                  id="apiKey"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={info.keyHint}
                  value={curKey}
                  onChange={(e) => setDraft((d) => ({ ...d, keys: { ...d.keys, [d.provider]: e.target.value } }))}
                />
                <button className="btn sm" type="button" onClick={() => setShowKey((v) => !v)}>
                  {showKey ? "Hide" : "Show"}
                </button>
              </span>
            </label>

            <label className="toggle" style={{ color: "var(--ink)" }}>
              <input
                type="checkbox"
                checked={draft.remember}
                onChange={(e) => setDraft((d) => ({ ...d, remember: e.target.checked }))}
              />{" "}
              Remember keys on this device (stored in this browser's local storage)
            </label>

            <label className="f" htmlFor="modelSel">
              Model
              <span className="inrow">
                <select
                  id="modelSel"
                  value={curModel}
                  onChange={(e) => setDraft((d) => ({ ...d, models: { ...d.models, [d.provider]: e.target.value } }))}
                >
                  {!curModel && <option value="">Test the key to load your models</option>}
                  {modelList.length
                    ? modelList.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name === m.id ? m.id : `${m.name} (${m.id})`}
                        </option>
                      ))
                    : curModel && <option value={curModel}>{curModel}</option>}
                </select>
                <button className="btn sm" type="button" onClick={testKey} disabled={testing}>
                  {testing ? "Checking…" : "Test key"}
                </button>
              </span>
            </label>

            <label className="f" htmlFor="modelCustom">
              Or type a model ID
              <input
                type="text"
                id="modelCustom"
                spellCheck={false}
                autoComplete="off"
                placeholder="Model ID"
                value={curModel}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, models: { ...d.models, [d.provider]: e.target.value.trim() } }))
                }
              />
            </label>

            <div className={`msgline ${msg.cls}`} role="status" aria-live="polite">
              {msg.text}
            </div>

            <div className="row">
              <button
                className="btn"
                type="button"
                onClick={() => {
                  setDraft((d) => ({ ...d, keys: { ...d.keys, [d.provider]: "" } }));
                  forget(draft.provider);
                  setMsg({ text: "This key was removed from this browser.", cls: "ok" });
                }}
              >
                Remove this key
              </button>
              <span style={{ flex: 1 }} />
              <button className="btn" type="button" onClick={close}>
                Cancel
              </button>
              <button className="btn primary" type="button" onClick={onSave}>
                Save
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
