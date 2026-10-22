import { useRef } from "react";

import { GitHubIcon, UploadIcon } from "@/components/Icons";
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
        <UploadIcon />
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
        <GitHubIcon />
        GitHub Repo
      </button>

      <span className="toggle" style={{ color: "var(--ink)", gap: 6 }}>
        <span>Sample skill:</span>
        <select
          className="jump"
          aria-label="Sample skill"
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
