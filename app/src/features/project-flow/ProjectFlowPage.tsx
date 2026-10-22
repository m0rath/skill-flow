import { useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import JSZip from "jszip";

import { AppShell } from "@/components/AppShell";
import { AISettingsModal } from "@/components/AISettingsModal";
import { DownloadIcon, GitHubIcon } from "@/components/Icons";
import { tablistKeyDown } from "@/components/a11y";
import { ShotModal } from "@/features/skill-flow/modals";
import { SummaryBar } from "@/features/skill-flow/SummaryBar";
import { realFiles, useSkillStore } from "@/features/skill-flow/store";
import { offerDownload } from "@/features/skill-flow/files";
import { ArchView } from "@/features/project-flow/ArchView";
import { FlowsView } from "@/features/project-flow/FlowsView";
import { NotesView } from "@/features/project-flow/NotesView";
import { OverviewView } from "@/features/project-flow/OverviewView";
import { ProjectDropBar } from "@/features/project-flow/ProjectDropBar";
import { StructureView } from "@/features/project-flow/StructureView";
import { readProjectDrop, readProjectFiles } from "@/features/project-flow/files";
import { ChangesView } from "@/features/skill-flow/views/ChangesView";
import { FlowDiagram } from "@/features/skill-flow/views/FlowDiagram";
import { MindMap } from "@/features/skill-flow/views/MindMap";
import { OutlineView } from "@/features/skill-flow/views/OutlineView";
import { SidePanel } from "@/features/skill-flow/views/SidePanel";
import { SourceView } from "@/features/skill-flow/views/SourceView";
import { SuggestionsView } from "@/features/skill-flow/views/SuggestionsView";
import { suggCount } from "@/model/checks";
import { currentKeyLabel, useAIStore } from "@/store/ai";
import { useAppStore } from "@/store/app";
import type { SFTab } from "@/features/skill-flow/store";

const TABS: { id: SFTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "flows", label: "Flows" },
  { id: "arch", label: "Architecture" },
  { id: "structure", label: "Structure" },
  { id: "diagram", label: "How it runs" },
  { id: "mindmap", label: "Mind map" },
  { id: "suggest", label: "Suggestions" },
  { id: "changes", label: "Changes" },
  { id: "notes", label: "Notes" },
  { id: "outline", label: "Outline" },
  { id: "source", label: "Source" },
];

function ToolActions() {
  const files = useSkillStore((s) => s.files);
  const original = useSkillStore((s) => s.original);
  const dirty = useSkillStore((s) => s.dirty);
  const history = useSkillStore((s) => s.history);
  const undo = useSkillStore((s) => s.undo);
  const projectName = useSkillStore((s) => s.projectName);
  const openGitModal = useAppStore((s) => s.openGitModal);
  const toast = useAppStore((s) => s.toast);
  const keyLabel = useAIStore(currentKeyLabel);
  const setSettingsOpen = useAIStore((s) => s.setSettingsOpen);

  const real = realFiles(files);

  const downloadZip = async () => {
    const zip = new JSZip();
    real.forEach((f) => zip.file(f.path.replace(/^\/+/, ""), f.text));
    const blob = await zip.generateAsync({ type: "blob" });
    offerDownload(`${projectName || "project"}.zip`, blob);
  };

  const changed = useMemo(() => {
    const now = realFiles(files);
    const paths = [...new Set([...original.map((f) => f.path), ...now.map((f) => f.path)])];
    return paths.filter(
      (p) => (original.find((f) => f.path === p)?.text ?? "") !== (now.find((f) => f.path === p)?.text ?? ""),
    ).length;
  }, [files, original]);

  return (
    <>
      <button
        className="btn"
        type="button"
        title="Import from a public GitHub repository"
        onClick={() => openGitModal("project-flow")}
      >
        <GitHubIcon />
        <span>GitHub Repo</span>
      </button>
      <button
        className="btn keybtn"
        type="button"
        title="AI provider, API key and model"
        onClick={() => setSettingsOpen(true)}
      >
        <span className="kdot" />
        <span>{keyLabel}</span>
      </button>
      <button
        className="btn"
        type="button"
        disabled={!history.length}
        title="Undo the last change to the files"
        onClick={undo}
      >
        Undo
      </button>
      <button className="btn primary" type="button" onClick={() => void downloadZip()} disabled={!real.length}>
        <DownloadIcon />
        <span>Download {projectName || "project"}.zip</span>
        {dirty && <span className="dotmark" />}
      </button>
      {changed > 0 && (
        <button
          className="btn sm ghost"
          type="button"
          title="Copy the number of changed files"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(`${changed} file(s) changed`);
              toast("Copied");
            } catch {
              /* ignore */
            }
          }}
        >
          {changed} changed
        </button>
      )}
    </>
  );
}

function AiBanner() {
  const mappingNote = useSkillStore((s) => s.mappingNote);
  const stopAll = useSkillStore((s) => s.stopAll);
  return (
    <div className="ai-banner" role="status" aria-live="polite">
      <span className="ai-banner-spinner" aria-hidden="true" />
      <div className="ai-banner-content">
        <strong>AI is analyzing…</strong>
        <span>{mappingNote || "Mapping project structure and dependencies"}</span>
      </div>
      <button
        className="btn sm ghost"
        type="button"
        style={{ borderColor: "var(--pink-border)", color: "var(--pink)" }}
        onClick={stopAll}
      >
        Cancel
      </button>
    </div>
  );
}

export function ProjectFlowPage() {
  const store = useSkillStore;
  const tab = useSkillStore((s) => s.tab);
  const setTab = useSkillStore((s) => s.setTab);
  const files = useSkillStore((s) => s.files);
  const model = useSkillStore((s) => s.model);
  const sugg = useSkillStore((s) => s.sugg);
  const notes = useSkillStore((s) => s.notes);
  const original = useSkillStore((s) => s.original);
  const error = useSkillStore((s) => s.error);
  const busy = useSkillStore((s) => s.busy);
  const focus = useSkillStore((s) => s.focus);
  const setFocus = useSkillStore((s) => s.setFocus);
  const loadProject = useSkillStore((s) => s.loadProject);
  const codeErr = useSkillStore((s) => s.codeErr);
  const toast = useAppStore((s) => s.toast);
  const [params] = useSearchParams();
  const viewEl = useRef<HTMLElement | null>(null);

  // Restore a saved project session once, then honour a ?demo= deep link.
  useEffect(() => {
    store.getState().hydrate("project");
    const demo = params.get("demo");
    if (demo === "order-checkout" || demo === "express") store.getState().loadProjectExample(demo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    document.body.classList.toggle("focus", focus);
    return () => document.body.classList.remove("focus");
  }, [focus]);

  // Escape leaves focus mode (as in the legacy app); an open dialog owns Escape first.
  useEffect(() => {
    if (!focus) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || document.querySelector('[role="dialog"]')) return;
      setFocus(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focus, setFocus]);

  // Drop folders / files anywhere on the page.
  useEffect(() => {
    const over = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    };
    const drop = async (e: DragEvent) => {
      e.preventDefault();
      const items = e.dataTransfer?.items;
      try {
        if (items && items.length && typeof items[0].webkitGetAsEntry === "function") {
          const r = await readProjectDrop(items);
          if (r.files.length) {
            loadProject(r.files, r.bins, r.root || "Project");
            toast(`Loaded ${r.files.length} text file${r.files.length === 1 ? "" : "s"}`);
            return;
          }
        }
      } catch {
        /* fall through to plain files */
      }
      if (e.dataTransfer?.files?.length) {
        const r = await readProjectFiles(Array.from(e.dataTransfer.files));
        if (r.files.length) {
          loadProject(r.files, r.bins, r.root || "Project");
          toast(`Loaded ${r.files.length} text file${r.files.length === 1 ? "" : "s"}`);
        }
      }
    };
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, [loadProject, toast]);

  const gaps = useMemo(
    () => suggCount({ files, model, dismissed: sugg.dismissed, claude: sugg.claude }),
    [files, model, sugg],
  );
  const changedCount = useMemo(() => {
    // Map both sides once: .find() per path made this quadratic on large projects.
    const before = new Map(original.map((f) => [f.path, f.text] as const));
    const after = new Map(realFiles(files).map((f) => [f.path, f.text] as const));
    let n = 0;
    new Set([...before.keys(), ...after.keys()]).forEach((p) => {
      if ((before.get(p) ?? "") !== (after.get(p) ?? "")) n++;
    });
    return n;
  }, [files, original]);
  const openNotes = notes.filter((n) => n.status === "open").length;

  return (
    <AppShell mode="project-flow" actions={<ToolActions />}>
      <ProjectDropBar />
      {error ? (
        <div className="err" role="alert">
          {error}
        </div>
      ) : null}
      {codeErr ? (
        <div className="err" role="alert">
          Some files could not be parsed: {codeErr}
        </div>
      ) : null}
      <SummaryBar />

      <div className="main">
        <section className="panel" aria-label="Project">
          {busy.mapping && <AiBanner />}
          <div
            className="tabs"
            role="tablist"
            aria-label="Project views"
            onKeyDown={(e) => tablistKeyDown(e, (id) => setTab(id as SFTab))}
          >
            {TABS.map((t) => (
              <button
                key={t.id}
                className="tab"
                role="tab"
                type="button"
                id={`tab-${t.id}`}
                data-tab-id={t.id}
                aria-controls="view-panel"
                aria-selected={tab === t.id}
                tabIndex={tab === t.id ? 0 : -1}
                onClick={() => setTab(t.id)}
              >
                {t.label}
                {t.id === "suggest" && gaps > 0 && <span className="badge">{gaps}</span>}
                {t.id === "changes" && changedCount > 0 && <span className="badge n">{changedCount}</span>}
                {t.id === "notes" && openNotes > 0 && <span className="badge n">{openNotes}</span>}
              </button>
            ))}
          </div>

          <div className="tabpanel" role="tabpanel" id="view-panel" aria-labelledby={`tab-${tab}`}>
            {tab === "overview" && (
              <div className="scroll">
                <OverviewView />
              </div>
            )}
            {tab === "flows" && <FlowsView onElement={(el) => (viewEl.current = el)} />}
            {tab === "arch" && <ArchView onElement={(el) => (viewEl.current = el)} />}
            {tab === "structure" && <StructureView />}
            {tab === "diagram" && (
              <div>
                <FlowDiagram onElement={(el) => (viewEl.current = el)} />
              </div>
            )}
            {tab === "mindmap" && (
              <div>
                <MindMap onElement={(el) => (viewEl.current = el)} />
              </div>
            )}
            {tab === "suggest" && <SuggestionsView />}
            {tab === "changes" && <ChangesView />}
            {tab === "notes" && <NotesView />}
            {tab === "outline" && <OutlineView />}
            {tab === "source" && <SourceView />}
          </div>
        </section>

        <SidePanel />
      </div>

      {focus && (
        <button
          className="btn sm"
          type="button"
          style={{ position: "fixed", right: 14, bottom: 14, zIndex: 7 }}
          onClick={() => setFocus(false)}
        >
          Exit focus
        </button>
      )}

      <ShotModal getElement={() => viewEl.current} />
      <AISettingsModal />
    </AppShell>
  );
}
