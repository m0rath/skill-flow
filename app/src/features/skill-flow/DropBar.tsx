import { useRef } from "react";

import { readFiles } from "@/features/skill-flow/files";
import { useSkillStore } from "@/features/skill-flow/store";
import { useAIStore } from "@/store/ai";
import { useAppStore } from "@/store/app";

export function DropBar() {
  const loadFiles = useSkillStore((s) => s.loadFiles);
  const loadExample = useSkillStore((s) => s.loadExample);
  const analyze = useSkillStore((s) => s.analyze);
  const stopAll = useSkillStore((s) => s.stopAll);
  const setPasteOpen = useSkillStore((s) => s.setPasteOpen);
  const autoMap = useSkillStore((s) => s.autoMap);
  const setAutoMap = useSkillStore((s) => s.setAutoMap);
  const status = useSkillStore((s) => s.status);
  const isExample = useSkillStore((s) => s.isExample);
  const busy = useSkillStore((s) => s.busy);
  const client = useAIStore((s) => s.client);
  const openGitModal = useAppStore((s) => s.openGitModal);
  const toast = useAppStore((s) => s.toast);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const onPick = async (list: FileList | null) => {
    if (!list || !list.length) return;
    const { files, error } = await readFiles(Array.from(list));
    loadFiles(files, error);
    const n = files.filter((f) => !f.virtual).length;
    if (n) toast(`Loaded ${n} file${n === 1 ? "" : "s"}`);
  };

  return (
    <section className="drop">
      <button className="btn" type="button" onClick={() => inputRef.current?.click()}>
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
        Upload .md / .skill
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".md,.mdx,.markdown,.txt,.zip,.skill"
        hidden
        onChange={(e) => {
          void onPick(e.target.files);
          e.target.value = "";
        }}
      />
      <button className="btn" type="button" onClick={() => setPasteOpen(true)}>
        Paste text
      </button>
      <button className="btn" type="button" onClick={() => openGitModal("skill-flow")}>
        <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.012 8.012 0 0016 8c0-4.42-3.58-8-8-8z" />
        </svg>
        GitHub Repo
      </button>

      <span className="toggle" style={{ color: "var(--ink)", gap: 6 }}>
        <span>Sample skill:</span>
        <select
          className="jump"
          value="pr-review"
          onChange={(e) => {
            if (e.target.value === "pr-review") loadExample();
          }}
        >
          <option value="pr-review">PR Review Playbook</option>
        </select>
      </span>

      <div className="hint">
        <strong>Upload a Claude skill (.md), playbook or .zip</strong>, paste text, or load a public GitHub skill. Drop
        it anywhere on the page — the files stay in your browser.
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
