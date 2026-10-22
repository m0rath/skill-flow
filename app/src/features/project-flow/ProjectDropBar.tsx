import { useRef } from "react";

import { FolderIcon, GitHubIcon, UploadIcon } from "@/components/Icons";
import { readProjectFiles } from "@/features/project-flow/files";
import { useSkillStore } from "@/features/skill-flow/store";
import { useAIStore } from "@/store/ai";
import { useAppStore } from "@/store/app";

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
          aria-label="Sample project"
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

      <span className={`status ${status.tone}`} role="status" aria-live="polite">
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
