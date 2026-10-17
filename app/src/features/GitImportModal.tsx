import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import { useSkillStore } from "@/features/skill-flow/store";
import { importProjectFromGitHub, importSkillFromGitHub, parseGitHubUrl } from "@/lib/github";
import { useAppStore } from "@/store/app";

export function GitImportModal() {
  const gitModal = useAppStore((s) => s.gitModal);
  const closeGitModal = useAppStore((s) => s.closeGitModal);
  const toast = useAppStore((s) => s.toast);
  const loadFiles = useSkillStore((s) => s.loadFiles);
  const loadProject = useSkillStore((s) => s.loadProject);

  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    if (gitModal.open) {
      setUrl("");
      setNote("");
      setError("");
      setPercent(0);
      setBusy(false);
    }
  }, [gitModal.open]);

  if (!gitModal.open) return null;
  const tool = gitModal.tool;
  const isProject = tool === "project-flow";

  const run = async () => {
    if (!url.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const target = parseGitHubUrl(url);
      if (isProject) {
        const files = await importProjectFromGitHub(url, ({ text, percent: p }) => {
          setNote(text);
          setPercent(p);
        });
        closeGitModal();
        loadProject(files, [], target?.repo || "project");
        toast(`Imported ${files.length} file${files.length === 1 ? "" : "s"} from ${target?.fullName || "GitHub"}`);
      } else {
        const files = await importSkillFromGitHub(url, ({ text, percent: p }) => {
          setNote(text);
          setPercent(p);
        });
        closeGitModal();
        loadFiles(files);
        toast(`Imported ${files[0]?.path || "skill"} from ${target?.fullName || "GitHub"}`);
      }
    } catch (e) {
      setError((e as Error)?.message || "Import failed.");
      setBusy(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        className="modal"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        onClick={(e) => e.target === e.currentTarget && !busy && closeGitModal()}
      >
        <motion.div
          className="box"
          role="dialog"
          aria-modal="true"
          aria-labelledby="gitTitle"
          initial={{ opacity: 0, y: 10, scale: 0.99 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.99 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
        >
          <strong id="gitTitle">Import from GitHub</strong>
          <p className="empty" style={{ margin: 0 }}>
            {isProject
              ? "Paste a public repository URL. The most relevant source files are fetched and mapped."
              : "Paste a public repository URL. The main Markdown or SKILL.md file is fetched."}
          </p>
          <input
            type="text"
            autoFocus
            placeholder="https://github.com/owner/repo"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void run()}
            style={{
              height: 32,
              border: "1px solid var(--line)",
              borderRadius: 6,
              background: "var(--surface-2)",
              padding: "0 10px",
            }}
            disabled={busy}
          />
          {busy && (
            <div>
              <div className="msgline" style={{ fontSize: 13, minHeight: "1.2em" }}>
                {note || "Fetching…"}
              </div>
              <div
                className="bar"
                style={{ height: 4, background: "var(--surface-2)", borderRadius: 2, overflow: "hidden" }}
              >
                <i style={{ display: "block", height: "100%", width: `${percent}%`, background: "var(--pink)" }} />
              </div>
            </div>
          )}
          {error && <div className="err">{error}</div>}
          <div className="row">
            <button className="btn" type="button" onClick={closeGitModal} disabled={busy}>
              Cancel
            </button>
            <button className="btn primary" type="button" onClick={() => void run()} disabled={busy || !url.trim()}>
              {busy ? "Importing…" : "Import"}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
