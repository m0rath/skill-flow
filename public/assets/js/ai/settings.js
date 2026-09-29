import { renderChat } from "./chat.js";
import { errCopy } from "./errors.js";
import { PROVIDERS, createClient, listModels, preferModel } from "./providers.js";
import { $, toast } from "../lib/dom.js";
import { esc } from "../lib/util.js";
import { S, ai } from "../state.js";
import { renderSuggest } from "../ui/suggestions.js";

export const API = { provider: "anthropic", keys: {}, models: {}, remember: false };
export const curKey = () => API.keys[API.provider] || "",
  curModel = () => API.models[API.provider] || "";
export function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem("skillflow:ai") || "{}");
    API.provider = PROVIDERS[s.provider] ? s.provider : "anthropic";
    API.models = s.models || {};
    API.remember = !!(s.keys && Object.keys(s.keys).length);
    API.keys = s.keys || JSON.parse(sessionStorage.getItem("skillflow:keys") || "{}");
    const old = JSON.parse(localStorage.getItem("skillflow:api") || "null");
    if (old && !s.provider) {
      if (old.key) {
        API.keys.anthropic = old.key;
        API.remember = true;
      }
      if (old.model) API.models.anthropic = old.model;
      localStorage.removeItem("skillflow:api");
    }
  } catch (e) {}
}
export function persistSettings() {
  try {
    const keys = Object.fromEntries(Object.entries(API.keys).filter(([, v]) => v));
    localStorage.setItem(
      "skillflow:ai",
      JSON.stringify({ provider: API.provider, models: API.models, keys: API.remember ? keys : {} }),
    );
    if (API.remember || !Object.keys(keys).length) sessionStorage.removeItem("skillflow:keys");
    else sessionStorage.setItem("skillflow:keys", JSON.stringify(keys));
  } catch (e) {}
}
export function applyKeyState() {
  const on = !!(curKey() && curModel());
  ai.client = on ? createClient({ provider: API.provider, key: curKey(), model: curModel() }) : null;
  $("keyBtn").classList.toggle("on", on);
  $("keyLabel").textContent = on
    ? `${PROVIDERS[API.provider].short}: ${curModel().replace(/^(claude-|models\/)/, "")}`
    : curKey()
      ? "Choose a model"
      : "Add API key";
  $("aiBtn").hidden = !on;
  $("aiToggleWrap").hidden = !on;
  renderChat();
  if (S.tab === "suggest") renderSuggest();
}
const SETTINGS_ERRORS = ["invalid_key", "no_key", "model_not_found"];
/** Open the settings dialog when an AI error can only be fixed there. */
export function openSettingsIfNeeded(code) {
  if (SETTINGS_ERRORS.includes(code)) setTimeout(openSettings, 50);
}
/* settings dialog: edits a draft, saved on Save */
let draft = null;
export function fillModels(models, current) {
  const sel = $("modelSel");
  sel.innerHTML = models.length
    ? models
        .map((m) => `<option value="${esc(m.id)}">${esc(m.name === m.id ? m.id : m.name + " (" + m.id + ")")}</option>`)
        .join("")
    : `<option value="">No models returned</option>`;
  const pick = models.find((m) => m.id === current) || preferModel(draft.provider, models);
  if (pick) sel.value = pick.id;
}
export function setMsg(t, cls) {
  const m = $("setMsg");
  m.textContent = t || "";
  m.className = "msgline " + (cls || "");
}
export function showProvider() {
  const pv = PROVIDERS[draft.provider];
  $("provSel").value = draft.provider;
  $("keyTitle").textContent = pv.label + " API key";
  $("apiKey").placeholder = pv.keyHint;
  $("apiKey").value = draft.keys[draft.provider] || "";
  $("apiKey").type = "password";
  $("showKey").textContent = "Show";
  $("provNote").innerHTML =
    `Chat, AI mapping and gap review call ${esc(pv.label)} directly from your browser with your own key. The key is sent only to <span class="mono">${esc(pv.host)}</span>; this site has no server. Get a key at <a href="${pv.keyUrl}" target="_blank" rel="noopener">${esc(pv.keySite)}</a>.` +
    (draft.provider === "gemini"
      ? " Gemini has a free tier; on it, Google may use prompts to improve its products, so avoid confidential files."
      : draft.provider === "openai"
        ? " A ChatGPT Plus subscription does not include API usage; the API is billed separately."
        : " Set a spend limit on the key.");
  const m = draft.models[draft.provider] || "";
  $("modelSel").innerHTML = m
    ? `<option value="${esc(m)}">${esc(m)}</option>`
    : `<option value="">Test the key to load your models</option>`;
  $("modelCustom").value = "";
  setMsg(draft.keys[draft.provider] ? "" : "Paste your key, then press Test key to load the models it can use.");
}
export function stash() {
  if (!draft) return;
  draft.keys[draft.provider] = $("apiKey").value.trim();
  const m = $("modelCustom").value.trim() || $("modelSel").value;
  if (m) draft.models[draft.provider] = m;
}
export function openSettings() {
  draft = { provider: API.provider, keys: { ...API.keys }, models: { ...API.models } };
  $("rememberKey").checked = API.remember;
  showProvider();
  $("settings").hidden = false;
  $("apiKey").focus();
}
export function initSettings() {
  $("keyBtn").onclick = openSettings;
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-open-settings]")) openSettings();
  });
  $("provSel").onchange = (e) => {
    stash();
    draft.provider = e.target.value;
    showProvider();
  };
  $("showKey").onclick = () => {
    const i = $("apiKey");
    i.type = i.type === "password" ? "text" : "password";
    $("showKey").textContent = i.type === "password" ? "Show" : "Hide";
  };
  $("loadModels").onclick = async () => {
    const key = $("apiKey").value.trim();
    if (!key) {
      setMsg("Paste a key first.", "bad");
      return;
    }
    setMsg("Checking the key…");
    $("loadModels").disabled = true;
    try {
      const models = await listModels(draft.provider, key);
      fillModels(models, draft.models[draft.provider]);
      setMsg(`Key works. ${models.length} models available.`, "ok");
    } catch (e) {
      setMsg(errCopy(e.code, "Couldn't check the key."), "bad");
    } finally {
      $("loadModels").disabled = false;
    }
  };
  $("setSave").onclick = () => {
    stash();
    if (draft.keys[draft.provider] && !draft.models[draft.provider]) {
      setMsg("Press Test key to load models, or type a model ID.", "bad");
      return;
    }
    API.provider = draft.provider;
    API.keys = draft.keys;
    API.models = draft.models;
    API.remember = $("rememberKey").checked;
    persistSettings();
    applyKeyState();
    $("settings").hidden = true;
    toast(curKey() ? `Using ${PROVIDERS[API.provider].label}` : "Settings saved");
  };
  $("forgetKey").onclick = () => {
    draft.keys[draft.provider] = "";
    $("apiKey").value = "";
    API.keys[draft.provider] = "";
    persistSettings();
    applyKeyState();
    setMsg("This key was removed from this browser.", "ok");
  };
  $("setCancel").onclick = () => {
    $("settings").hidden = true;
  };
}
