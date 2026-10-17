import { create } from "zustand";

import { applyEdit, parseReply, FENCE } from "@/ai/edits";
import { errCopy } from "@/ai/errors";
import { chatInstructions, mapPrompt, reviewPrompt } from "@/ai/prompts";
import type { Client } from "@/ai/providers";
import { EXAMPLE_MD, EXAMPLE_MODEL } from "@/data/example";
import { localChecks } from "@/model/checks";
import { index, normalize, numIndex, ordered } from "@/model/normalize";
import { quickParse } from "@/model/quick-parse";
import type { Edit, EditResult, FileItem, FlowNode, MindMapLink, Model, Suggestion } from "@/model/types";
import { useAIStore } from "@/store/ai";
import { useAppStore } from "@/store/app";

export const STORAGE_KEY = "skillflow:v2";

export type SFTab = "diagram" | "mindmap" | "suggest" | "changes" | "outline" | "source";
export type SFSide = "details" | "chat";
export type LoadMode = "example" | "quick" | "claude";
export type StatusTone = "example" | "quick" | "claude" | "busy" | "error";

export type ChatStatus =
  "proposed" | "applied" | "applied-old" | "pending" | "discarded" | "undone" | "failed" | "error";

export interface ChatMsg {
  role: "user" | "assistant";
  text: string;
  scope?: { num: string; title: string } | null;
  edits?: Edit[] | null;
  results?: EditResult[] | null;
  status?: ChatStatus;
  error?: boolean;
  pending?: boolean;
  phase?: string;
  snap?: number;
}

interface HistoryEntry {
  files: FileItem[];
  rawModel: unknown;
  mode: LoadMode;
}

interface SavedSession {
  files?: FileItem[];
  original?: FileItem[];
  rawModel?: unknown;
  mode?: LoadMode;
  dirty?: boolean;
  chat?: ChatMsg[];
  links?: MindMapLink[];
  mmPos?: Record<string, { x: number; y: number }>;
  sugg?: { claude: Suggestion[] | null; stale: boolean; dismissed: string[] };
}

// Abort controllers live outside React state; only one of each flow runs at a time.
let mapCtl: AbortController | null = null;
let suggCtl: AbortController | null = null;
let chatCtl: AbortController | null = null;

const cleanSugg = () => ({ claude: null as Suggestion[] | null, stale: false, dismissed: [] as string[] });

export function realFiles(files: FileItem[]): FileItem[] {
  return files.filter((f) => !f.virtual);
}

export function fileName(f: FileItem): string {
  let b = f.path.split("/").pop() || f.path;
  if (!/\.(md|txt)$/i.test(b)) b = b.replace(/\.(mdx|markdown)$/i, "") + ".md";
  return b;
}

export function baselineOf(files: FileItem[]): FileItem[] {
  return files.filter((f) => !f.virtual).map((f) => ({ path: f.path, text: f.text }));
}

export interface SuggestionWithNode extends Suggestion {
  num?: string;
}

interface SkillState {
  files: FileItem[];
  original: FileItem[];
  activeFile: number;
  rawModel: unknown;
  model: Model;
  mode: LoadMode;
  isExample: boolean;
  sel: string | null;
  collapsed: string[];
  tab: SFTab;
  side: SFSide;
  highlight: string | null;
  history: HistoryEntry[];
  dirty: boolean;
  chat: ChatMsg[];
  chatScope: string | null;
  chatDraft: string;
  autoApply: boolean;
  autoMap: boolean;
  links: MindMapLink[];
  mmPos: Record<string, { x: number; y: number }>;
  mmOpts: { out: boolean; use: boolean; flow: boolean };
  mmLink: number | null;
  sugg: { claude: Suggestion[] | null; stale: boolean; dismissed: string[] };
  editing: boolean;
  status: { tone: StatusTone; text: string };
  error: string;
  busy: { mapping: boolean; sugg: boolean; chat: boolean };
  mappingNote: string;
  hydrated: boolean;
  /** During image export: temporarily expand collapsed branches and/or show gap markers. */
  exportMode: { expand: boolean; flags: boolean } | null;
  setExportMode: (m: { expand: boolean; flags: boolean } | null) => void;
  /** Distraction-free mode. */
  focus: boolean;
  setFocus: (v: boolean) => void;
  /** Screenshot dialog target. */
  shot: { open: boolean; view: "diagram" | "mindmap" };
  openShot: (view: "diagram" | "mindmap") => void;
  closeShot: () => void;
  /** Paste-Markdown dialog. */
  pasteOpen: boolean;
  setPasteOpen: (v: boolean) => void;

  hydrate: () => void;
  setTab: (t: SFTab) => void;
  setSide: (s: SFSide) => void;
  setActiveFile: (i: number) => void;
  setHighlight: (h: string | null) => void;
  setChatDraft: (v: string) => void;
  setAutoApply: (v: boolean) => void;
  setAutoMap: (v: boolean) => void;

  loadFiles: (files: FileItem[], error?: string) => void;
  loadText: (text: string) => void;
  loadExample: () => void;

  analyze: () => Promise<void>;
  stopAll: () => void;

  select: (id: string | null, opts?: { scope?: boolean }) => void;
  goTo: (id: string, tab?: SFTab) => void;
  step: (delta: number) => void;
  fold: (id: string) => void;
  collapseAll: () => void;
  expandAll: () => void;

  setEditing: (v: boolean) => void;
  saveEditText: (text: string) => void;
  afterFileChange: (why: string) => void;
  restoreOriginal: (path: string) => void;
  undo: () => void;

  runSuggestions: () => Promise<void>;
  dismissSuggestion: (id: string) => void;
  fixSuggestion: (s: Suggestion) => void;
  askSuggestion: (s: Suggestion) => void;

  setChatScope: (id: string | null) => void;
  sendChat: (text: string) => Promise<void>;
  applyMsg: (i: number, rerender?: boolean) => void;
  discardMsg: (i: number) => void;
  undoMsg: (i: number) => void;
  clearChat: () => void;

  addLink: (from: string, to: string) => void;
  selectLink: (i: number | null) => void;
  setLinkLabel: (i: number, label: string) => void;
  removeLink: (i: number) => void;
  setMmOpt: (key: "out" | "use" | "flow", value: boolean) => void;
  setMmPos: (key: string, pos: { x: number; y: number } | null) => void;
  resetMmPositions: () => void;
}

function savedSession(): SavedSession | null {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") as SavedSession | null;
  } catch {
    return null;
  }
}

export const useSkillStore = create<SkillState>()((set, get) => {
  const model = normalize(EXAMPLE_MODEL);

  let saveT: number | null = null;
  let warnedFull = false;
  const persist = () => {
    if (saveT) window.clearTimeout(saveT);
    saveT = window.setTimeout(() => {
      const s = get();
      try {
        const payload: SavedSession = {
          files: s.files
            .slice(0, 26)
            .map((f) => ({ path: f.path, text: f.text.slice(0, 80000), edited: !!f.edited, virtual: !!f.virtual })),
          original: s.original.slice(0, 26).map((f) => ({ path: f.path, text: f.text.slice(0, 80000) })),
          rawModel: s.rawModel,
          mode: s.mode,
          dirty: s.dirty,
          chat: s.chat
            .filter((m) => !m.pending)
            .slice(-40)
            .map((m) => ({ ...m, status: m.status === "applied" ? "applied-old" : m.status })),
          links: s.links,
          mmPos: s.mmPos,
          sugg: s.sugg,
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
        warnedFull = false;
      } catch {
        if (!warnedFull) {
          warnedFull = true;
          useAppStore.getState().toast("This browser couldn't save your session. Download your file before closing.");
        }
      }
    }, 400);
  };

  const client = (): Client | null => useAIStore.getState().client;
  const openSettings = (code?: string) => {
    if (code && ["invalid_key", "no_key", "model_not_found"].includes(code))
      window.setTimeout(() => useAIStore.getState().setSettingsOpen(true), 50);
  };

  const applyMsgInternal = (i: number) => {
    const s = get();
    const m = s.chat[i];
    if (!m || !m.edits) return;
    const before = s.files.map((f) => ({ ...f }));
    const files = s.files.map((f) => ({ ...f }));
    const results: EditResult[] = m.edits.map((ed) => {
      const f =
        files.find((x) => x.path === ed.file) ||
        files.find((x) => ed.file && x.path.endsWith(ed.file.replace(/^\.?\//, ""))) ||
        files.find((x) => !x.virtual && x.text.includes(ed.find)) ||
        realFiles(files)[0];
      if (!f || f.virtual) return { file: ed.file, find: ed.find, ok: false };
      const out = applyEdit(f.text, ed.find, ed.replace);
      if (out == null) return { file: f.path, find: ed.find, ok: false };
      f.text = out;
      f.edited = true;
      return { file: f.path, find: ed.find, ok: true };
    });
    if (!results.some((r) => r.ok)) {
      const chat = s.chat.slice();
      chat[i] = { ...m, results, status: "failed" };
      set({ chat });
      persist();
      return;
    }
    const history = [...s.history, { files: before, rawModel: s.rawModel, mode: s.mode }].slice(-25);
    const chat = s.chat.slice();
    chat[i] = { ...m, results, status: "applied", snap: history.length };
    set({ files, history, dirty: true, chat });
    persist();
    get().afterFileChange("File updated");
    useAppStore.getState().toast("File updated · redrawing the map");
  };

  return {
    files: [{ path: "SKILL.md", text: EXAMPLE_MD }],
    original: [{ path: "SKILL.md", text: EXAMPLE_MD }],
    activeFile: 0,
    rawModel: EXAMPLE_MODEL,
    model,
    mode: "example",
    isExample: true,
    sel: null,
    collapsed: [],
    tab: "diagram",
    side: "details",
    highlight: null,
    history: [],
    dirty: false,
    chat: [],
    chatScope: null,
    chatDraft: "",
    autoApply: true,
    autoMap: true,
    links: [],
    mmPos: {},
    mmOpts: { out: true, use: false, flow: true },
    mmLink: null,
    sugg: cleanSugg(),
    editing: false,
    status: { tone: "example", text: "Example skill · PR Review Playbook" },
    error: "",
    busy: { mapping: false, sugg: false, chat: false },
    mappingNote: "",
    hydrated: false,
    exportMode: null,
    setExportMode: (exportMode) => set({ exportMode }),
    focus: false,
    setFocus: (focus) => set({ focus }),
    shot: { open: false, view: "diagram" },
    openShot: (view) => set({ shot: { open: true, view } }),
    closeShot: () => set((s) => ({ shot: { ...s.shot, open: false } })),
    pasteOpen: false,
    setPasteOpen: (pasteOpen) => set({ pasteOpen }),

    hydrate: () => {
      if (get().hydrated) return;
      const saved = savedSession();
      if (saved && saved.files && saved.files.length) {
        const rawModel = saved.rawModel ?? quickParse(saved.files);
        set({
          files: saved.files,
          original: saved.original || baselineOf(saved.files),
          rawModel,
          model: normalize(rawModel),
          mode: saved.mode || "quick",
          isExample: false,
          dirty: !!saved.dirty,
          chat: (saved.chat as ChatMsg[]) || [],
          links: saved.links || [],
          mmPos: saved.mmPos || {},
          sugg: saved.sugg || cleanSugg(),
          status: {
            tone: saved.mode === "claude" ? "claude" : "quick",
            text: saved.mode === "claude" ? "Mapped by AI" : "Quick map",
          },
          hydrated: true,
        });
      } else {
        set({ hydrated: true });
      }
    },

    setTab: (tab) => set({ tab }),
    setSide: (side) => set({ side }),
    setActiveFile: (activeFile) => set({ activeFile }),
    setHighlight: (highlight) => set({ highlight }),
    setChatDraft: (chatDraft) => set({ chatDraft }),
    setAutoApply: (autoApply) => set({ autoApply }),
    setAutoMap: (autoMap) => set({ autoMap }),

    loadFiles: (files, error = "") => {
      const usable = files.filter((f) => f.text && f.text.trim());
      if (!realFiles(usable).length) {
        set({ error: error || "That file is empty or not text. Upload a .md, .txt, or a zipped skill folder." });
        return;
      }
      usable.sort(
        (a, b) =>
          Number(!!a.virtual) - Number(!!b.virtual) ||
          Number(/(^|\/)skill\.md$/i.test(b.path)) - Number(/(^|\/)skill\.md$/i.test(a.path)),
      );
      const rawModel = quickParse(usable);
      set({
        files: usable,
        original: baselineOf(usable),
        activeFile: 0,
        rawModel,
        model: normalize(rawModel),
        mode: "quick",
        isExample: false,
        sel: null,
        collapsed: [],
        highlight: null,
        history: [],
        dirty: false,
        chat: [],
        chatScope: null,
        links: [],
        mmPos: {},
        mmLink: null,
        sugg: cleanSugg(),
        editing: false,
        error,
        tab: "diagram",
        status: { tone: "quick", text: "Quick map (approximate)" },
        hydrated: true,
      });
      persist();
      if (client() && get().autoMap) void get().analyze();
    },

    loadText: (text) => get().loadFiles([{ path: "pasted.md", text }]),

    loadExample: () => {
      const rawModel = EXAMPLE_MODEL;
      set({
        files: [{ path: "SKILL.md", text: EXAMPLE_MD }],
        original: [{ path: "SKILL.md", text: EXAMPLE_MD }],
        activeFile: 0,
        rawModel,
        model: normalize(rawModel),
        mode: "example",
        isExample: true,
        sel: null,
        collapsed: [],
        highlight: null,
        history: [],
        dirty: false,
        chat: [],
        chatScope: null,
        links: [],
        mmPos: {},
        mmLink: null,
        sugg: cleanSugg(),
        editing: false,
        error: "",
        tab: "diagram",
        status: { tone: "example", text: "Example skill · PR Review Playbook" },
      });
      persist();
    },

    analyze: async () => {
      const c = client();
      if (!c) return;
      mapCtl?.abort();
      mapCtl = new AbortController();
      const my = mapCtl;
      set({
        error: "",
        busy: { ...get().busy, mapping: true },
        mappingNote: "AI is reading the file…",
        status: { tone: "busy", text: "AI is reading the file…" },
      });
      const update = (t: string) => {
        const text = t.length > 0 ? `AI is mapping the flow… ${(t.length / 1000).toFixed(1)}k chars` : t;
        set({ mappingNote: text, status: { tone: "busy", text: t || "AI is reading the file…" } });
      };
      try {
        const data = await c.json(mapPrompt(get().files), {
          signal: my.signal,
          onText: ({ text }) => {
            if (my === mapCtl) update(text);
          },
        });
        if (my !== mapCtl) return;
        set({
          rawModel: data,
          model: normalize(data),
          mode: "claude",
          isExample: false,
          sugg: { ...get().sugg, stale: !!get().sugg.claude },
          status: { tone: "claude", text: "Mapped by AI" },
        });
        persist();
      } catch (e) {
        if (my !== mapCtl) return;
        const code = (e as { code?: string }).code;
        if (code === "cancelled") {
          set({ status: { tone: get().mode === "claude" ? "claude" : "quick", text: "Mapping stopped" } });
        } else {
          set({ error: errCopy(code, "AI mapping failed. Try again or reload the file.") });
          openSettings(code);
        }
      } finally {
        if (my === mapCtl) set({ busy: { ...get().busy, mapping: false }, mappingNote: "" });
      }
    },

    stopAll: () => {
      mapCtl?.abort();
      suggCtl?.abort();
      chatCtl?.abort();
    },

    select: (id, opts) => {
      set({ sel: id });
      if (get().side === "chat" || opts?.scope) set({ chatScope: id });
    },

    goTo: (id, tab) => {
      if (tab) set({ tab });
      get().select(id);
    },

    step: (delta) => {
      const list = ordered();
      if (!list.length) return;
      const at = list.findIndex((n) => n.id === get().sel);
      const next = list[Math.max(0, Math.min(list.length - 1, (at < 0 ? -1 : at) + delta))];
      if (next) get().select(next.id);
    },

    fold: (id) => {
      const c = get().collapsed;
      set({ collapsed: c.includes(id) ? c.filter((x) => x !== id) : [...c, id] });
    },
    collapseAll: () => {
      const ids = ordered()
        .filter((n) => (n.branches || n.kind === "loop") && n.parent)
        .map((n) => n.id);
      set({ collapsed: ids });
    },
    expandAll: () => set({ collapsed: [] }),

    setEditing: (editing) => set({ editing }),
    saveEditText: (text) => {
      const s = get();
      const f = s.files[s.activeFile];
      set({ editing: false });
      if (!f || text === f.text) return;
      const files = s.files.map((x, i) => (i === s.activeFile ? { ...x, text, edited: true } : x));
      const history = [...s.history, { files: s.files, rawModel: s.rawModel, mode: s.mode }].slice(-25);
      set({ files, history, dirty: true });
      get().afterFileChange("Edited by hand");
    },

    afterFileChange: (why) => {
      set({ sugg: { ...get().sugg, stale: true } });
      if (client() && get().autoMap) {
        persist();
        void get().analyze();
      } else {
        const rawModel = quickParse(get().files);
        set({
          rawModel,
          model: normalize(rawModel),
          mode: "quick",
          status: { tone: "quick", text: `${why} · quick map` },
        });
        persist();
      }
    },

    restoreOriginal: (path) => {
      const s = get();
      const orig = s.original.find((x) => x.path === path);
      const f = s.files.find((x) => x.path === path);
      if (!orig || !f) return;
      const files = s.files.map((x) => (x.path === path ? { ...x, text: orig.text, edited: false } : x));
      const history = [...s.history, { files: s.files, rawModel: s.rawModel, mode: s.mode }].slice(-25);
      set({ files, history, dirty: files.some((x) => x.edited) });
      useAppStore.getState().toast(`Restored the original ${path}`);
      get().afterFileChange("Original restored");
    },

    undo: () => {
      const s = get();
      const h = s.history[s.history.length - 1];
      if (!h) return;
      const history = s.history.slice(0, -1);
      const files = h.files.map((f) => ({ ...f }));
      set({
        files,
        history,
        rawModel: h.rawModel,
        model: normalize(h.rawModel || quickParse(files)),
        mode: h.mode,
        dirty: files.some((f) => f.edited),
        sugg: { ...s.sugg, stale: true },
        status: { tone: h.mode === "claude" ? "claude" : "quick", text: "Change undone" },
      });
      persist();
      useAppStore.getState().toast("Undid the last change");
    },

    runSuggestions: async () => {
      const c = client();
      if (!c) return;
      suggCtl?.abort();
      suggCtl = new AbortController();
      const my = suggCtl;
      set({ busy: { ...get().busy, sugg: true }, error: "" });
      const prompt = reviewPrompt({ steps: get().model.steps, files: get().files });
      try {
        const data = (await c.json(prompt, { signal: my.signal })) as
          | {
              title?: unknown;
              severity?: unknown;
              category?: unknown;
              step?: unknown;
              whatIf?: unknown;
              suggestion?: unknown;
            }[]
          | { items?: unknown[]; suggestions?: unknown[] };
        if (my !== suggCtl) return;
        const raw = Array.isArray(data)
          ? data
          : (data as { items?: unknown[]; suggestions?: unknown[] }).items ||
            (data as { suggestions?: unknown[] }).suggestions ||
            [];
        const list = raw
          .filter((x): x is Record<string, unknown> => !!x && !!(x as { title?: unknown }).title)
          .slice(0, 15)
          .map((x, i): Suggestion => {
            const sevRaw = String(x.severity || "").toLowerCase();
            const sev = (["high", "medium", "low"].includes(sevRaw) ? sevRaw : "medium") as Suggestion["sev"];
            return {
              id: "c-" + Date.now() + "-" + i,
              sev,
              cat: String(x.category || "Other"),
              title: String(x.title),
              whatIf: String(x.whatIf || ""),
              suggestion: String(x.suggestion || ""),
              nodeId: numIndex.get(String(x.step || "").trim()) || null,
            };
          });
        set({ sugg: { claude: list, stale: false, dismissed: get().sugg.dismissed } });
        persist();
      } catch (e) {
        if (my !== suggCtl) return;
        const code = (e as { code?: string }).code;
        if (code !== "cancelled") set({ error: errCopy(code, "AI's review failed. Try again.") });
        openSettings(code);
      } finally {
        if (my === suggCtl) set({ busy: { ...get().busy, sugg: false } });
      }
    },

    dismissSuggestion: (id) => {
      const sugg = { ...get().sugg, dismissed: [...get().sugg.dismissed, id] };
      set({ sugg });
      persist();
    },

    fixSuggestion: (s) => {
      set({ chatScope: s.nodeId || null, side: "chat" });
      void get().sendChat(`Fix this gap in the file: ${s.title}. ${s.whatIf || ""} Suggested change: ${s.suggestion}`);
    },

    askSuggestion: (s) => {
      set({
        chatScope: s.nodeId || null,
        side: "chat",
        chatDraft: `About this gap: ${s.title}. ${s.whatIf || ""} `,
      });
    },

    setChatScope: (id) => set({ chatScope: id }),

    sendChat: async (text) => {
      text = String(text || "").trim();
      const c = client();
      if (!text || !c) return;
      const s = get();
      const scopeNode = (s.chatScope ? index.get(s.chatScope) : null) ?? null;
      const history = s.chat.filter((m) => !m.pending && !m.error).slice(-10);
      const userMsg: ChatMsg = {
        role: "user",
        text,
        scope: scopeNode
          ? {
              num: scopeNode.num,
              title: scopeNode.kind === "decision" ? scopeNode.question || scopeNode.title : scopeNode.title,
            }
          : null,
      };
      const reply: ChatMsg = { role: "assistant", text: "", pending: true };
      const chat = [...s.chat, userMsg, reply];
      const idx = chat.length - 1;
      set({ chat, chatDraft: "", busy: { ...get().busy, chat: true }, error: "" });

      chatCtl?.abort();
      chatCtl = new AbortController();
      const my = chatCtl;

      const turns: { role: "user" | "assistant"; content: string }[] = [
        { role: "user", content: chatInstructions({ steps: s.model.steps, files: s.files, scope: scopeNode }) },
      ];
      let budget = 12000;
      const hist: { role: "user" | "assistant"; content: string }[] = [];
      for (let k = history.length - 1; k >= 0; k--) {
        const m = history[k];
        const content =
          m.role === "user"
            ? (m.scope ? `[Scope: step ${m.scope.num} "${m.scope.title}"] ` : "") + m.text
            : (m.text || "(no text)") +
              (m.status === "applied"
                ? "\n[These edits were applied to the file.]"
                : m.edits
                  ? "\n[Edits proposed but not applied.]"
                  : "");
        budget -= content.length;
        if (budget < 0) break;
        hist.unshift({ role: m.role, content });
      }
      while (hist.length && hist[0].role === "assistant") hist.shift();
      if (hist.length)
        turns.push({ role: "assistant", content: "Understood. I have the outline and the current files." }, ...hist);
      turns.push({
        role: "user",
        content:
          (scopeNode
            ? `[Scope: step ${scopeNode.num} "${scopeNode.kind === "decision" ? scopeNode.question || scopeNode.title : scopeNode.title}"] `
            : "[Scope: whole workflow] ") + text,
      });

      const patch = (fn: (m: ChatMsg) => ChatMsg) => {
        const cur = get().chat.slice();
        if (!cur[idx]) return;
        cur[idx] = fn(cur[idx]);
        set({ chat: cur });
      };

      try {
        const res = await c(turns, {
          signal: my.signal,
          onText: ({ text: t }) =>
            patch((m) => ({ ...m, text: parseReply(t).display, phase: t.includes(FENCE + "edits") ? "edits" : "" })),
        });
        const p = parseReply(res.text);
        let status: ChatStatus | undefined;
        if (p.edits && p.edits.length) status = get().autoApply ? "applied" : "proposed";
        patch((m) => ({
          ...m,
          text:
            (p.display || (p.edits ? "Here are the changes." : res.text)) +
            (res.truncated ? "\n\n(The answer was cut short. Ask for a smaller change.)" : ""),
          pending: false,
          phase: "",
          edits: p.edits && p.edits.length ? p.edits : m.edits,
          status,
        }));
        persist();
        if (p.edits && p.edits.length && get().autoApply) applyMsgInternal(idx);
      } catch (e) {
        const err = e as { code?: string; text?: string };
        patch((m) => ({
          ...m,
          pending: false,
          phase: "",
          error: err.code !== "cancelled",
          text:
            (err.text ? parseReply(err.text).display + "\n\n" : "") +
            (err.code === "cancelled" ? "(Stopped)" : errCopy(err.code, "AI couldn't answer. Try again.")),
        }));
        persist();
        openSettings(err.code);
      } finally {
        if (my === chatCtl) set({ busy: { ...get().busy, chat: false } });
      }
    },

    applyMsg: (i) => applyMsgInternal(i),

    discardMsg: (i) => {
      const chat = get().chat.slice();
      if (chat[i]) chat[i] = { ...chat[i], status: "discarded" };
      set({ chat });
      persist();
    },

    undoMsg: (i) => {
      const s = get();
      const m = s.chat[i];
      if (m && m.snap === s.history.length) {
        get().undo();
        const chat = get().chat.slice();
        if (chat[i]) chat[i] = { ...chat[i], status: "undone" };
        set({ chat });
        persist();
      }
    },

    clearChat: () => {
      set({ chat: [] });
      persist();
    },

    addLink: (from, to) => {
      if (from === to) return;
      const links = [...get().links, { from, to, label: "" }];
      set({ links, mmLink: links.length - 1 });
      persist();
    },
    selectLink: (mmLink) => set({ mmLink }),
    setLinkLabel: (i, label) => {
      const links = get().links.slice();
      if (!links[i]) return;
      links[i] = { ...links[i], label };
      set({ links });
      persist();
    },
    removeLink: (i) => {
      const links = get().links.filter((_, k) => k !== i);
      set({ links, mmLink: null });
      persist();
    },
    setMmOpt: (key, value) => set({ mmOpts: { ...get().mmOpts, [key]: value } }),
    setMmPos: (key, pos) => {
      const mmPos = { ...get().mmPos };
      if (pos) mmPos[key] = pos;
      else delete mmPos[key];
      set({ mmPos });
      persist();
    },
    resetMmPositions: () => {
      set({ mmPos: {} });
      persist();
    },
  };
});

/** Suggestions (local + AI) for the current state, minus dismissed ones. */
export function currentSuggestions(s: Pick<SkillState, "files" | "model" | "sugg">): Suggestion[] {
  const local = localChecks({ files: s.files, model: s.model, dismissed: s.sugg.dismissed });
  const ai = (s.sugg.claude || []).filter((x) => !s.sugg.dismissed.includes(x.id));
  return [...local, ...ai];
}

export function findNode(id: string | null | undefined): FlowNode | undefined {
  return id ? index.get(id) : undefined;
}
