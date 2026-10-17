import { create } from "zustand";

import { applyEdit, parseReply, FENCE } from "@/ai/edits";
import { errCopy } from "@/ai/errors";
import { chatInstructions, mapPrompt, projectMapPrompt, reviewPrompt } from "@/ai/prompts";
import type { Client } from "@/ai/providers";
import { EXAMPLE_MD, EXAMPLE_MODEL } from "@/data/example";
import { EXAMPLE_PROJECT, EXAMPLE_PROJECT_MODEL } from "@/data/example-project";
import { importProjectFromGitHub } from "@/lib/github";
import { localChecks } from "@/model/checks";
import { index, normalize, numIndex, ordered } from "@/model/normalize";
import { quickParse } from "@/model/quick-parse";
import type { Edit, EditResult, FileItem, FlowNode, MindMapLink, Model, Suggestion } from "@/model/types";
import { analyzeProject, componentsFromLocal } from "@/project/analyze";
import { buildCodeIndex } from "@/project/code";
import { allTracesText, findFlows, traceFlow } from "@/project/flows";
import { buildOverview } from "@/project/overview";
import type { BinFile, CodeIndex, Flow, FlowStep, OvModel, Project, ProjectFile } from "@/project/types";
import { useAIStore } from "@/store/ai";
import { useAppStore } from "@/store/app";

export const STORAGE_KEY = "skillflow:v2";
export const PROJECT_KEY = "projectflow:v1";

export type AppMode = "skill" | "project";
export type ProjectTab = "overview" | "flows" | "arch" | "structure" | "notes";
export type SFTab = ProjectTab | "diagram" | "mindmap" | "suggest" | "changes" | "outline" | "source";
export type FlowMode = "overview" | "seq" | "tree";
export type ArchLevel = "files" | "components";
export type ShotView = "diagram" | "mindmap" | "flows" | "arch";
export interface ProjectNote {
  id: string;
  file: string;
  text: string;
  status: "open" | "done";
}
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

interface SavedProjectSession {
  files?: ProjectFile[];
  bins?: BinFile[];
  original?: ProjectFile[];
  rawModel?: unknown;
  mode?: LoadMode;
  dirty?: boolean;
  projectName?: string;
  projectRoot?: string | null;
  customFlows?: { file: string; fn?: string }[];
  notes?: ProjectNote[];
  chat?: ChatMsg[];
}

/** The project equivalent of quickParse: build a flow from the README + local analysis. */
export function quickParseProject(files: ProjectFile[], project: Project): Record<string, unknown> {
  const readme =
    files.find((f) => /(^|\/)readme(\.[a-z]+)?$/i.test(f.path) && !f.path.includes("/")) ||
    files.find((f) => /(^|\/)readme(\.[a-z]+)?$/i.test(f.path)) ||
    files.find((f) => f.path.endsWith(".md"));
  let flow: Record<string, unknown> = { steps: [] };
  if (readme) {
    try {
      flow = quickParse([{ path: readme.path, text: readme.text }]);
    } catch {
      flow = { steps: [] };
    }
  }
  const rawSteps = Array.isArray(flow.steps) ? (flow.steps as Record<string, unknown>[]) : [];
  const steps = rawSteps.filter((s) => s && s.title !== "No clear steps found");
  const firstPara = readme
    ? readme.text
        .replace(/^---[\s\S]*?\n---/, "")
        .split(/\n\s*\n/)
        .map((x) => x.trim())
        .find((x) => x && !x.startsWith("#") && !x.startsWith("!") && !x.startsWith("[")) || ""
    : "";
  const headingMatch = readme ? readme.text.match(/^#\s+(.+)$/m) : null;
  return {
    title: (headingMatch && headingMatch[1]) || flow.title || project.name,
    summary: (flow.summary as string) || firstPara.replace(/\s+/g, " ").slice(0, 300),
    trigger: flow.trigger || "",
    stack: project.stack,
    inputs: flow.inputs || [],
    notes: flow.notes || [],
    commands: project.commands,
    components: componentsFromLocal(project),
    steps: steps.length
      ? steps
      : rawSteps.length
        ? rawSteps
        : [
            {
              kind: "step",
              title: "No run instructions found",
              detail:
                "The README doesn't describe how to install or run the project. Map with AI to infer the flow from the code.",
            },
          ],
  };
}

// Abort controllers live outside React state; only one of each flow runs at a time.
let mapCtl: AbortController | null = null;
let suggCtl: AbortController | null = null;
let chatCtl: AbortController | null = null;
let entryCtl: AbortController | null = null;

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
  /** Every loaded file. `ProjectFile` is a superset of `FileItem`, so both modes share this list. */
  files: ProjectFile[];
  original: ProjectFile[];
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
  shot: { open: boolean; view: ShotView };
  openShot: (view: ShotView) => void;
  closeShot: () => void;
  /** Paste-Markdown dialog. */
  pasteOpen: boolean;
  setPasteOpen: (v: boolean) => void;

  /* ---------- project-flow slice (shares this store so the views can be reused) ---------- */
  appMode: AppMode;
  project: Project | null;
  projectName: string;
  projectRoot: string | null;
  bins: BinFile[];
  code: CodeIndex | null;
  codeErr: string;
  flows: Flow[];
  flowIdx: number;
  flowMode: FlowMode;
  flowSteps: FlowStep[];
  ovModel: OvModel | null;
  flowLive: boolean;
  archLevel: ArchLevel;
  customFlows: { file: string; fn?: string }[];
  aiEntries: { file: string; function?: string; name?: string; trigger?: string }[];
  notes: ProjectNote[];
  treeOpen: string[];
  treeFilter: string;
  /** Which sample project is loaded ("order-checkout" | "express" | null). */
  exampleId: string | null;
  /** Which flow the player is currently lighting up. */
  flowStep: number;
  /** Selected high-level overview node key (Project Flow → Flows → High level). */
  ovSel: string | null;

  setAppMode: (m: AppMode) => void;
  setFlowIdx: (i: number) => void;
  setFlowMode: (m: FlowMode) => void;
  setArchLevel: (l: ArchLevel) => void;
  setFlowLive: (v: boolean) => void;
  setTreeFilter: (v: string) => void;
  setTreeOpen: (v: string[]) => void;
  toggleTreeDir: (p: string) => void;
  loadProject: (files: ProjectFile[], bins: BinFile[], name: string, error?: string) => void;
  loadProjectExample: (which: "order-checkout" | "express") => void;
  reanalyzeProject: () => void;
  recomputeFlow: () => void;
  setFlowStep: (i: number) => void;
  setOvSel: (v: string | null) => void;
  /** Ask the AI to find the entry points (routes, commands, jobs) and retrace the flows. */
  findEntryPoints: () => Promise<void>;
  addCustomFlow: (file: string, fn?: string) => void;
  removeCustomFlow: (file: string, fn?: string) => void;
  addNote: (file: string, text: string) => void;
  toggleNote: (id: string) => void;
  removeNote: (id: string) => void;

  hydrate: (mode?: AppMode) => void;
  setTab: (t: SFTab) => void;
  setSide: (s: SFSide) => void;
  setActiveFile: (i: number) => void;
  /** Open a file (by path) in the Source tab. */
  openPath: (path: string) => void;
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

function savedProjectSession(): SavedProjectSession | null {
  try {
    return JSON.parse(localStorage.getItem(PROJECT_KEY) || "null") as SavedProjectSession | null;
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
        if (s.appMode === "project") {
          const payload: SavedProjectSession = {
            files: s.files
              .slice(0, 60)
              .map((f) => ({ path: f.path, text: f.text.slice(0, 60000), edited: !!f.edited })),
            bins: s.bins,
            original: s.original.slice(0, 60).map((f) => ({ path: f.path, text: f.text.slice(0, 60000) })),
            rawModel: s.rawModel,
            mode: s.mode,
            dirty: s.dirty,
            projectName: s.projectName,
            projectRoot: s.projectRoot,
            customFlows: s.customFlows,
            notes: s.notes,
            chat: s.chat
              .filter((m) => !m.pending)
              .slice(-40)
              .map((m) => ({ ...m, status: m.status === "applied" ? "applied-old" : m.status })),
          };
          localStorage.setItem(PROJECT_KEY, JSON.stringify(payload));
          warnedFull = false;
          return;
        }
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

    appMode: "skill",
    project: null,
    projectName: "",
    projectRoot: null,
    bins: [],
    code: null,
    codeErr: "",
    flows: [],
    flowIdx: 0,
    flowMode: "overview",
    flowSteps: [],
    ovModel: null,
    flowLive: true,
    archLevel: "components",
    customFlows: [],
    aiEntries: [],
    notes: [],
    treeOpen: [],
    treeFilter: "",
    exampleId: null,
    flowStep: -1,
    ovSel: null,

    setAppMode: (appMode) => set({ appMode }),
    setFlowIdx: (flowIdx) => {
      set({ flowIdx });
      get().recomputeFlow();
    },
    setFlowMode: (flowMode) => {
      set({ flowMode });
      get().recomputeFlow();
    },
    setArchLevel: (archLevel) => set({ archLevel }),
    setFlowLive: (flowLive) => set({ flowLive }),
    setTreeFilter: (treeFilter) => set({ treeFilter }),
    setTreeOpen: (treeOpen) => set({ treeOpen }),
    toggleTreeDir: (p) => {
      const open = new Set(get().treeOpen);
      if (open.has(p)) open.delete(p);
      else open.add(p);
      set({ treeOpen: [...open] });
    },
    setFlowStep: (flowStep) => set({ flowStep }),
    setOvSel: (ovSel) => set({ ovSel }),

    reanalyzeProject: () => {
      const s = get();
      const usable = s.files.filter((f) => f.text && f.text.trim());
      if (!usable.length) return;
      const project = analyzeProject(usable, s.bins, s.projectName);
      let code: CodeIndex | null = null;
      let codeErr = "";
      try {
        code = buildCodeIndex(usable);
      } catch (e) {
        codeErr = (e as Error)?.message || String(e);
      }
      let flows: Flow[] = [];
      try {
        flows = code ? findFlows(usable, project, code, s.customFlows, s.aiEntries) : [];
      } catch (e) {
        codeErr = codeErr || (e as Error)?.message || String(e);
      }
      set({ project, code, codeErr, flows, flowIdx: Math.min(s.flowIdx, Math.max(0, flows.length - 1)), flowStep: -1 });
      get().recomputeFlow();
    },

    recomputeFlow: () => {
      const s = get();
      const flow = s.flows[s.flowIdx];
      if (!flow || !s.code) {
        set({ flowSteps: [], ovModel: null });
        return;
      }
      let steps: FlowStep[] = [];
      try {
        steps = traceFlow(s.flows, s.code, flow, flow.all ? 320 : 160, flow.all ? 6 : 9);
      } catch {
        steps = [];
      }
      let ovModel: OvModel | null = null;
      if (s.flowMode === "overview") {
        try {
          ovModel = buildOverview(s.model, flow, steps);
        } catch {
          ovModel = null;
        }
      }
      set({ flowSteps: steps, ovModel, flowStep: -1 });
    },

    loadProject: (files, bins, name, error = "") => {
      const usable = files.filter((f) => f.text && f.text.trim());
      if (!usable.length) {
        set({ error: error || "No readable files were found. Open the project's root folder." });
        return;
      }
      const rawModel = quickParseProject(usable, analyzeProject(usable, bins, name || "Project"));
      set({
        files: usable,
        bins,
        projectName: name || "Project",
        projectRoot: null,
        original: baselineOf(usable),
        activeFile: Math.max(
          0,
          usable.findIndex((f) => /(^|\/)readme(\.[a-z]+)?$/i.test(f.path)),
        ),
        rawModel,
        model: normalize(rawModel),
        mode: "quick",
        isExample: false,
        exampleId: null,
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
        notes: [],
        customFlows: [],
        treeOpen: [],
        treeFilter: "",
        status: { tone: "quick", text: "Project analysed locally" },
        hydrated: true,
      });
      get().reanalyzeProject();
      set({ tab: get().flows.some((f) => !f.all && !/^Other starting/.test(f.group)) ? "flows" : "overview" });
      persist();
    },

    loadProjectExample: (which) => {
      if (which === "express") {
        void (async () => {
          const s = get();
          set({ busy: { ...s.busy, mapping: true }, mappingNote: "Loading Express repository…" });
          try {
            const files = await importProjectFromGitHub("https://github.com/expressjs/express", ({ text }) =>
              set({ mappingNote: text }),
            );
            const usable = files.filter((f) => f.text && f.text.trim());
            const rawModel = quickParseProject(usable, analyzeProject(usable, [], "express"));
            set({
              files: usable,
              bins: [],
              projectName: "express",
              projectRoot: null,
              original: baselineOf(usable),
              activeFile: Math.max(
                0,
                usable.findIndex((f) => /(^|\/)readme(\.[a-z]+)?$/i.test(f.path)),
              ),
              rawModel,
              model: normalize(rawModel),
              mode: "quick",
              isExample: true,
              exampleId: "express",
              error: "",
              chat: [],
              notes: [],
              customFlows: [],
              aiEntries: [],
              status: { tone: "example", text: "Example project · Express framework" },
              hydrated: true,
            });
            get().reanalyzeProject();
            set({ tab: get().flows.some((f) => !f.all && !/^Other starting/.test(f.group)) ? "flows" : "overview" });
            persist();
          } catch (e) {
            set({ error: (e as Error)?.message || "Could not load the Express repository." });
          } finally {
            set({ busy: { ...get().busy, mapping: false }, mappingNote: "" });
          }
        })();
        return;
      }
      const files = EXAMPLE_PROJECT.map((f) => ({ path: f.path, text: f.text, size: f.text.length }));
      const project = analyzeProject(files, [], "order-checkout-api");
      set({
        files,
        bins: [],
        projectName: "order-checkout-api",
        projectRoot: null,
        original: files.map((f) => ({ path: f.path, text: f.text })),
        activeFile: Math.max(
          0,
          files.findIndex((f) => f.path === "README.md"),
        ),
        rawModel: EXAMPLE_PROJECT_MODEL,
        model: normalize(EXAMPLE_PROJECT_MODEL),
        project,
        mode: "quick",
        isExample: true,
        exampleId: "order-checkout",
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
        notes: [],
        customFlows: [],
        treeOpen: [],
        treeFilter: "",
        codeErr: "",
        status: { tone: "example", text: "Example project · open your own folder" },
        hydrated: true,
      });
      get().reanalyzeProject();
      set({ tab: get().flows.some((f) => !f.all && !/^Other starting/.test(f.group)) ? "flows" : "overview" });
      persist();
    },

    addCustomFlow: (file, fn) => {
      const customFlows = [...get().customFlows.filter((c) => !(c.file === file && c.fn === fn)), { file, fn }];
      set({ customFlows });
      get().reanalyzeProject();
      persist();
    },

    findEntryPoints: async () => {
      const c = client();
      if (!c) {
        openSettings("no_key");
        useAppStore.getState().toast("Add an API key to use AI entry points");
        return;
      }
      const s = get();
      entryCtl?.abort();
      entryCtl = new AbortController();
      const my = entryCtl;
      set({ busy: { ...s.busy, mapping: true }, mappingNote: "Finding entry points…" });
      try {
        const list = s.files
          .slice(0, 500)
          .map((f) => f.path)
          .join("\n");
        const data = await c.json(
          `You are given a project's file list. Find the entry points: the places execution starts (HTTP routes, CLI commands, jobs, event handlers, main functions, scheduled tasks).\n\nReply with ONLY a JSON array (max 12), most important first:\n[{"file":"exact path from the list","function":"function or handler name, or empty","name":"short human name","trigger":"what starts it"}]\n\nFiles:\n${list}`,
          { signal: my.signal },
        );
        if (my !== entryCtl) return;
        const arr = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
        const aiEntries = arr
          .filter((x) => x && typeof x.file === "string")
          .map((x) => ({
            file: String(x.file),
            function: x.function ? String(x.function) : undefined,
            name: x.name ? String(x.name) : undefined,
            trigger: x.trigger ? String(x.trigger) : undefined,
          }));
        set({ aiEntries });
        get().reanalyzeProject();
        useAppStore
          .getState()
          .toast(
            aiEntries.length
              ? `Found ${aiEntries.length} entry point${aiEntries.length === 1 ? "" : "s"}`
              : "No entry points found",
          );
      } catch (e) {
        if (my !== entryCtl) return;
        const code = (e as { code?: string } | null)?.code;
        set({ error: errCopy(code, "Could not find the entry points. Try again.") });
        openSettings(code);
      } finally {
        if (my === entryCtl) set({ busy: { ...get().busy, mapping: false }, mappingNote: "" });
      }
    },
    removeCustomFlow: (file, fn) => {
      set({ customFlows: get().customFlows.filter((c) => !(c.file === file && (fn ? c.fn === fn : !c.fn))) });
      get().reanalyzeProject();
      persist();
    },

    addNote: (file, text) => {
      const t = text.trim();
      if (!t) return;
      const notes = [...get().notes, { id: "note-" + Date.now().toString(36), file, text: t, status: "open" as const }];
      set({ notes });
      persist();
    },
    toggleNote: (id) => {
      const notes = get().notes.map((n) =>
        n.id === id ? { ...n, status: n.status === "open" ? ("done" as const) : ("open" as const) } : n,
      );
      set({ notes });
      persist();
    },
    removeNote: (id) => {
      set({ notes: get().notes.filter((n) => n.id !== id) });
      persist();
    },

    hydrate: (mode) => {
      if (mode && get().appMode !== mode) set({ appMode: mode });
      if (get().hydrated) return;
      if (mode === "project" || get().appMode === "project") {
        const saved = savedProjectSession();
        if (saved && saved.files && saved.files.length) {
          const rawModel =
            saved.rawModel ??
            quickParseProject(
              saved.files,
              analyzeProject(saved.files, saved.bins || [], saved.projectName || "Project"),
            );
          set({
            files: saved.files,
            bins: saved.bins || [],
            projectName: saved.projectName || "Project",
            projectRoot: saved.projectRoot ?? null,
            original: saved.original || baselineOf(saved.files),
            rawModel,
            model: normalize(rawModel),
            mode: saved.mode || "quick",
            isExample: false,
            dirty: !!saved.dirty,
            chat: (saved.chat as ChatMsg[]) || [],
            customFlows: saved.customFlows || [],
            notes: saved.notes || [],
            status: {
              tone: saved.mode === "claude" ? "claude" : "quick",
              text: saved.mode === "claude" ? "Mapped by AI" : "Project analysed locally",
            },
            hydrated: true,
          });
          get().reanalyzeProject();
        } else {
          set({ hydrated: true });
        }
        return;
      }
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
    openPath: (path) => {
      const at = get().files.findIndex((f) => f.path === path || f.path.endsWith("/" + path));
      if (at >= 0) set({ activeFile: at, tab: "source" });
      else useAppStore.getState().toast("That file is not in the loaded set");
    },
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
        const s0 = get();
        const isProject = s0.appMode === "project";
        const prompt = isProject
          ? projectMapPrompt({
              files: s0.files,
              traces: s0.code ? allTracesText(s0.code, s0.flows, 11000) : "",
              deps: s0.project
                ? s0.project.compEdges
                    .slice(0, 60)
                    .map((e) => `${e.from} → ${e.to}`)
                    .join("\n")
                : "",
            })
          : mapPrompt(s0.files);
        const data = await c.json(prompt, {
          signal: my.signal,
          onText: ({ text }) => {
            if (my === mapCtl) update(text);
          },
        });
        if (my !== mapCtl) return;
        const raw = data as { components?: unknown };
        const nextModel = normalize(data);
        if (Array.isArray(raw?.components) && raw.components.length) {
          nextModel.components = raw.components as NonNullable<Model["components"]>;
        } else if (get().project) {
          nextModel.components = componentsFromLocal(get().project as Project);
        }
        set({
          rawModel: data,
          model: nextModel,
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
      entryCtl?.abort();
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
        return;
      }
      if (get().appMode === "project") {
        const s = get();
        const rawModel = s.rawModel ?? quickParseProject(s.files, analyzeProject(s.files, s.bins, s.projectName));
        set({
          rawModel,
          model: normalize(rawModel),
          mode: "quick",
          status: { tone: "quick", text: `${why} · re-analysed` },
        });
        get().reanalyzeProject();
        persist();
        return;
      }
      const rawModel = quickParse(get().files);
      set({
        rawModel,
        model: normalize(rawModel),
        mode: "quick",
        status: { tone: "quick", text: `${why} · quick map` },
      });
      persist();
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
      if (get().appMode === "project") get().reanalyzeProject();
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
