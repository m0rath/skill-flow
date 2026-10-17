import { useRef } from "react";

import { readProjectFiles } from "@/features/project-flow/files";
import { useSkillStore } from "@/features/skill-flow/store";
import { useAIStore } from "@/store/ai";
import { useAppStore } from "@/store/app";

const FolderIcon = () => (
  <svg width="14" height="13" viewBox="0 0 16 14" aria-hidden="true">
    <path
      d="M1 2.5h4.5l1.5 1.8H15V12.5H1z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
    />
  </svg>
);
const UploadIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
    <path
      d="M8 11V2M4 6l4-4 4 4M2 14h12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
const GitHubIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.012 8.012 0 0016 8c0-4.42-3.58-8-8-8z" />
  </svg>
);

export function ProjectDropBar() {
  const loadProject = useSkillStore((s) => s.loadProject);
  const loadProjectExample = useSkillStore((s) => s.loadProjectExample);
  const analyze = useSkillStore((s) => s.analyze);
  const stopAll = useSkillStore((s) => s.stopAll);
  const autoMap = useSkillStore((s) => s.autoMap);
  const setAutoMap = useSkillStore((s) => s.setAutoMap);
  const status = useSkillStore((s) => s.status);
  const isExample = useSkillStore((s) => s.isExample);
  const busy = useSkillStore((s) => s.busy);
  const client = useAIStore((s) => s.client);
  const openGitModal = useAppStore((s) => s.openGitModal);
  const toast = useAppStore((s) => s.toast);
  const folderRef = useRef<HTMLInputElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const ingest = (r: Awaited<ReturnType<typeof readProjectFiles>>) => {
    const name = r.root || "Project";
    loadProject(r.files, r.bins, name);
    if (!r.files.length) return;
    toast(`Loaded ${r.files.length} text file${r.files.length === 1 ? "" : "s"}`);
  };

  return (
    <section className="drop">
      <button className="btn primary" type="button" onClick={() => folderRef.current?.click()}>
        <FolderIcon />
        Open project folder
      </button>
      <button className="btn" type="button" onClick={() => fileRef.current?.click()}>
        <UploadIcon />
        Upload files or .zip
      </button>
      <input
        ref={folderRef}
        type="file"
        // @ts-expect-error non-standard folder picker attributes
        webkitdirectory=""
        directory=""
        multiple
        hidden
        onChange={(e) => {
          const list = e.target.files;
          if (list?.length) void readProjectFiles(Array.from(list)).then(ingest);
          e.target.value = "";
        }}
      />
      <input
        ref={fileRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const list = e.target.files;
          if (list?.length) void readProjectFiles(Array.from(list)).then(ingest);
          e.target.value = "";
        }}
      />
      <button className="btn" type="button" onClick={() => openGitModal("project-flow")}>
        <GitHubIcon />
        GitHub Repo
      </button>

      <span className="toggle" style={{ color: "var(--ink)", gap: 6 }}>
        <span>Sample project:</span>
        <select
          className="jump"
          value="order-checkout"
          onChange={(e) => {
            if (e.target.value === "order-checkout") loadProjectExample("order-checkout");
          }}
        >
          <option value="order-checkout">Order &amp; Checkout API (Node.js)</option>
        </select>
      </span>

      <div className="hint">
        <strong>Open a project folder or a .zip of it.</strong> You can also drop it anywhere on the page. node_modules,
        build output and .git are skipped, and the files stay in your browser.
      </div>

      {client && (
        <label className="toggle">
          <input type="checkbox" checked={autoMap} onChange={(e) => setAutoMap(e.target.checked)} /> Map with AI
        </label>
      )}

      <span className={`status ${status.tone}`}>
        <span className="dot" />
        <span>{status.text}</span>
      </span>

      {client && !isExample && !busy.mapping && (
        <button className="btn sm" type="button" onClick={() => void analyze()}>
          Re-map with AI
        </button>
      )}
      {busy.mapping && (
        <button className="btn sm" type="button" onClick={stopAll}>
          Stop
        </button>
      )}
    </section>
  );
}
