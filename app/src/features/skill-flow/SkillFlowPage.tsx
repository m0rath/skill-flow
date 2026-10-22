import { useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import JSZip from "jszip";

import { AppShell } from "@/components/AppShell";
import { AISettingsModal } from "@/components/AISettingsModal";
import { DropBar } from "@/features/skill-flow/DropBar";
import { DownloadIcon, GitHubIcon } from "@/components/Icons";
import { tablistKeyDown } from "@/components/a11y";
import { ShotModal, PasteModal } from "@/features/skill-flow/modals";
import { SummaryBar } from "@/features/skill-flow/SummaryBar";
import { fileName, realFiles, useSkillStore } from "@/features/skill-flow/store";
import { readFiles, offerDownload } from "@/features/skill-flow/files";
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
  { id: "diagram", label: "Workflow Diagram" },
  { id: "mindmap", label: "Mind map" },
  { id: "suggest", label: "Suggestions" },
  { id: "changes", label: "Changes" },
  { id: "outline", label: "Outline" },
  { id: "source", label: "Source" },
];

function ToolActions() {
  const files = useSkillStore((s) => s.files);
  const original = useSkillStore((s) => s.original);
  const dirty = useSkillStore((s) => s.dirty);
  const history = useSkillStore((s) => s.history);
  const undo = useSkillStore((s) => s.undo);
  const openGitModal = useAppStore((s) => s.openGitModal);
  const toast = useAppStore((s) => s.toast);
  const keyLabel = useAIStore(currentKeyLabel);
  const setSettingsOpen = useAIStore((s) => s.setSettingsOpen);

  const real = realFiles(files);
  const label = "Download " + (real[0] ? fileName(real[0]) : ".md");

  const downloadMd = () => {
    const f = real[0];
    if (!f) return;
    offerDownload(fileName(f), f.text);
  };

  const downloadZip = async () => {
    const zip = new JSZip();
    real.forEach((f) => zip.file(f.path.replace(/^\/+/, ""), f.text));
    const blob = await zip.generateAsync({ type: "blob" });
    offerDownload("skill.zip", blob);
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
        onClick={() => openGitModal("skill-flow")}
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
        title="Undo the last change to the file"
        onClick={undo}
      >
        Undo
      </button>
      <button className="btn primary" type="button" onClick={downloadMd}>
        <DownloadIcon />
        <span>{label}</span>
        {dirty && <span className="dotmark" />}
      </button>
      {real.length >= 2 && (
        <button className="btn" type="button" onClick={() => void downloadZip()}>
          Download .zip
        </button>
      )}
      {changed > 0 && (
        <button
          className="btn sm ghost"
          type="button"
          title="Copy the unified diff of every change"
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
        <span>{mappingNote || "Mapping workflow structure and dependencies"}</span>
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

export function SkillFlowPage() {
  const store = useSkillStore;
  const tab = useSkillStore((s) => s.tab);
  const setTab = useSkillStore((s) => s.setTab);
  const files = useSkillStore((s) => s.files);
  const model = useSkillStore((s) => s.model);
  const sugg = useSkillStore((s) => s.sugg);
  const original = useSkillStore((s) => s.original);
  const error = useSkillStore((s) => s.error);
  const busy = useSkillStore((s) => s.busy);
  const focus = useSkillStore((s) => s.focus);
  const setFocus = useSkillStore((s) => s.setFocus);
  const loadFiles = useSkillStore((s) => s.loadFiles);
  const toast = useAppStore((s) => s.toast);
  const [params] = useSearchParams();
  const viewEl = useRef<HTMLElement | null>(null);

  // Restore a saved session once, then honour a ?demo= deep link.
  useEffect(() => {
    store.getState().hydrate();
    if (params.get("demo") === "pr-review") store.getState().loadExample();
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

  // Drop anywhere on the page.
  useEffect(() => {
    const over = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    };
    const drop = async (e: DragEvent) => {
      if (!e.dataTransfer?.files?.length) return;
      e.preventDefault();
      const { files: fs, error: err } = await readFiles(Array.from(e.dataTransfer.files));
      loadFiles(fs, err);
      const n = fs.filter((f) => !f.virtual).length;
      if (n) toast(`Loaded ${n} file${n === 1 ? "" : "s"}`);
    };
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, [loadFiles, toast]);

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

  return (
    <AppShell mode="skill-flow" actions={<ToolActions />}>
      <DropBar />
      {error ? (
        <div className="err" role="alert">
          {error}
        </div>
      ) : null}
      <SummaryBar />

      <div className="main">
        <section className="panel" aria-label="Workflow">
          {busy.mapping && <AiBanner />}
          <div
            className="tabs"
            role="tablist"
            aria-label="Workflow views"
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
              </button>
            ))}
          </div>

          <div className="tabpanel" role="tabpanel" id="view-panel" aria-labelledby={`tab-${tab}`}>
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

      <PasteModal />
      <ShotModal getElement={() => viewEl.current} />
      <AISettingsModal />
    </AppShell>
  );
}
