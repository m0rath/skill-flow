import { initChat, renderChat } from "./ai/chat.js";
import { initMapping } from "./ai/mapping.js";
import { applyKeyState, initSettings, loadSettings } from "./ai/settings.js";
import { initFiles } from "./app/files.js";
import { initHistory } from "./app/history.js";
import { EXAMPLE_MD, EXAMPLE_MODEL } from "./data/example.js";
import { $ } from "./lib/dom.js";
import { normalize } from "./model/normalize.js";
import { quickParse } from "./model/quick-parse.js";
import { S, baselineOf, emptySuggestions, loadSaved } from "./state.js";
import { initChanges } from "./ui/changes.js";
import { initDiagram } from "./ui/diagram.js";
import { initExport } from "./ui/export.js";
import { initMindmap } from "./ui/mindmap.js";
import { initNavigation, setSide } from "./ui/navigation.js";
import { renderAll } from "./ui/render.js";
import { initSide } from "./ui/side.js";
import { initSource } from "./ui/source.js";
import { setStatus } from "./ui/status.js";
import { initSuggestions } from "./ui/suggestions.js";
import { initTheme } from "./ui/theme.js";
import { dView, initViewports } from "./ui/viewport.js";

/** Restore the last session from localStorage. Returns false if there is none or it is unreadable. */
function restoreSession() {
  const d = loadSaved();
  if (!d || !d.files?.length) return false;
  try {
    S.files = d.files;
    // Sessions saved before the Changes tab existed have no baseline, so they start with no changes.
    S.original = d.original || baselineOf(d.files);
    S.rawModel = d.rawModel || null;
    S.mode = d.rawModel ? "claude" : "quick";
    S.dirty = !!d.dirty;
    S.model = normalize(S.rawModel || quickParse(S.files));
    S.chat = (d.chat || []).map((m) => ({ ...m, status: m.status === "applied-old" ? "applied" : m.status, snap: -1 }));
    S.links = d.links || [];
    S.mmPos = d.mmPos || {};
    S.sugg = d.sugg || emptySuggestions();
    setStatus(
      S.mode === "claude" ? "claude" : "quick",
      S.mode === "claude" ? "Mapped by AI · last file" : "Quick map · last file",
    );
    return true;
  } catch (e) {
    console.warn("Could not restore the saved session", e);
    return false;
  }
}

function showExample() {
  S.files = [{ path: "SKILL.md", text: EXAMPLE_MD }];
  S.original = baselineOf(S.files);
  S.dirty = false;
  S.chat = [];
  S.links = [];
  S.mmPos = {};
  S.sugg = emptySuggestions();
  S.rawModel = EXAMPLE_MODEL;
  S.model = normalize(EXAMPLE_MODEL);
  S.mode = "claude";
  setStatus("example", "Example · upload your own file");
}

initTheme($("themeBtn"));
initViewports();
initNavigation();
initDiagram();
initMindmap();
initSource();
initChanges();
initExport();
initSide();
initSuggestions();
initHistory();
initFiles();
initMapping();
initChat();
initSettings();

if (!restoreSession()) showExample();
renderAll();
requestAnimationFrame(() => {
  S.fitted.diagram = dView.fit("width");
});
loadSettings();
applyKeyState();
renderChat();
setSide("details");
