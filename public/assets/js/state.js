import { EXAMPLE_MD } from "./data/example.js";
import { store, toast } from "./lib/dom.js";

export const STORAGE_KEY = "skillflow:v2";

export const emptySuggestions = () => ({ claude: null, stale: false, dismissed: [] });

/** App state. Modules read and mutate it in place, then call the render functions they need. */
export const S = {
  files: [{ path: "SKILL.md", text: EXAMPLE_MD }],
  /** The files as they were first loaded, so the Changes tab can diff against them. */
  original: [{ path: "SKILL.md", text: EXAMPLE_MD }],
  activeFile: 0,
  rawModel: null,
  model: null,
  mode: "example",
  sel: null,
  collapsed: new Set(),
  tab: "diagram",
  side: "details",
  highlight: null,
  history: [],
  dirty: false,
  chat: [],
  chatScope: null,
  links: [],
  mmPos: {},
  mmOpts: { out: true, use: false, flow: true },
  mmLink: null,
  sugg: emptySuggestions(),
  editing: false,
  fitted: { diagram: false, mindmap: false },
};
/** Copy the real (non-virtual) files, to use as the baseline for the Changes tab. */
export const baselineOf = (files) => files.filter((f) => !f.virtual).map((f) => ({ path: f.path, text: f.text }));

/** The active AI client (see ai/providers.js), or null when no key and model are set. */
export const ai = { client: null };

/** Debounced write of the current session to localStorage so a reload restores it. */
let saveT = null,
  warnedFull = false;
export function save() {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    const ok = store.set(
      STORAGE_KEY,
      JSON.stringify({
        files: S.files
          .slice(0, 26)
          .map((f) => ({ path: f.path, text: f.text.slice(0, 80000), edited: !!f.edited, virtual: !!f.virtual })),
        original: S.original.slice(0, 26).map((f) => ({ path: f.path, text: f.text.slice(0, 80000) })),
        rawModel: S.rawModel,
        mode: S.mode,
        dirty: S.dirty,
        chat: S.chat
          .filter((m) => !m.pending)
          .slice(-40)
          .map((m) => ({
            role: m.role,
            text: m.text,
            scope: m.scope,
            edits: m.edits,
            results: m.results,
            status: m.status === "applied" ? "applied-old" : m.status,
            error: m.error,
          })),
        links: S.links,
        mmPos: S.mmPos,
        sugg: S.sugg,
      }),
    );
    // Warn once: the work is still in the tab, but a reload would lose it.
    if (!ok && !warnedFull) {
      warnedFull = true;
      toast("This browser couldn't save your session. Download your file before closing the tab.");
    }
    if (ok) warnedFull = false;
  }, 400);
}
export function loadSaved() {
  try {
    return JSON.parse(store.get(STORAGE_KEY) || "null");
  } catch (e) {
    return null;
  }
}
