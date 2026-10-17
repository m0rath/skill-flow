import { useState } from "react";

import { offerDownload } from "@/features/skill-flow/files";
import { useSkillStore } from "@/features/skill-flow/store";
import { useAppStore } from "@/store/app";

function notesText(notes: { file: string; text: string; status: string }[]): string {
  return notes.map((n) => `- [${n.status === "open" ? " " : "x"}] ${n.file}: ${n.text}`).join("\n");
}

export function NotesView() {
  const notes = useSkillStore((s) => s.notes);
  const addNote = useSkillStore((s) => s.addNote);
  const toggleNote = useSkillStore((s) => s.toggleNote);
  const removeNote = useSkillStore((s) => s.removeNote);
  const files = useSkillStore((s) => s.files);
  const model = useSkillStore((s) => s.model);
  const openPath = useSkillStore((s) => s.openPath);
  const setSide = useSkillStore((s) => s.setSide);
  const setChatScope = useSkillStore((s) => s.setChatScope);
  const sendChat = useSkillStore((s) => s.sendChat);
  const toast = useAppStore((s) => s.toast);

  const [file, setFile] = useState("");
  const [text, setText] = useState("");

  const open = notes.filter((n) => n.status === "open");
  const done = notes.filter((n) => n.status !== "open");

  const add = () => {
    if (!text.trim()) return;
    addNote(file || files[0]?.path || "", text);
    setText("");
  };

  return (
    <div className="scroll" style={{ padding: "0 16px 24px" }} id="view-notes">
      <div className="sugg-head">
        <p>
          Jot down review notes against a file. Open notes are visible to the AI in every chat, and you can ask the AI
          to fix them.
        </p>
      </div>
      <div className="sugg-head">
        <button
          className="btn primary"
          type="button"
          disabled={!open.length}
          onClick={() => {
            setSide("chat");
            setChatScope(null);
            void sendChat(
              `Apply ${open.length === 1 ? "this reviewer note" : "these reviewer notes"} to the files. Make the edits and keep everything else unchanged.\n\n${notesText(open)}`,
            );
          }}
        >
          Fix all open notes with AI
        </button>
        <button
          className="btn"
          type="button"
          disabled={!notes.length}
          onClick={() => {
            void navigator.clipboard.writeText(notesText(notes)).then(
              () => toast("Notes copied"),
              () => toast("The clipboard is blocked here"),
            );
          }}
        >
          Copy notes for an AI
        </button>
        <button
          className="btn"
          type="button"
          disabled={!notes.length}
          onClick={() =>
            offerDownload(
              `${(model.title || "project").toLowerCase().replace(/\s+/g, "-")}-review-notes.md`,
              notesText(notes),
            )
          }
        >
          Download notes (.md)
        </button>
      </div>

      <div className="toolbar" style={{ padding: "8px 0" }}>
        <select className="jump" aria-label="File" value={file} onChange={(e) => setFile(e.target.value)}>
          <option value="">(pick a file)</option>
          {files.slice(0, 300).map((f) => (
            <option value={f.path} key={f.path}>
              {f.path}
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder="What needs attention?"
          aria-label="Note"
          style={{
            flex: 1,
            minWidth: 220,
            height: 28,
            border: "1px solid var(--line)",
            borderRadius: 6,
            background: "var(--surface-2)",
            padding: "0 8px",
          }}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <button className="btn sm primary" type="button" onClick={add} disabled={!text.trim()}>
          Add note
        </button>
      </div>

      <h3>
        Open <span className="badge n">{open.length}</span>
      </h3>
      {open.length ? (
        <div className="notecards">
          {open.map((n) => (
            <NoteCard
              n={n}
              key={n.id}
              fileName={n.file}
              text={n.text}
              onToggle={() => toggleNote(n.id)}
              onDelete={() => removeNote(n.id)}
              onGo={() => openPath(n.file)}
            />
          ))}
        </div>
      ) : (
        <p className="empty">No open notes yet.</p>
      )}

      {done.length ? (
        <>
          <h3>
            Resolved <span className="badge n">{done.length}</span>
          </h3>
          <div className="notecards">
            {done.map((n) => (
              <NoteCard
                n={n}
                key={n.id}
                fileName={n.file}
                text={n.text}
                onToggle={() => toggleNote(n.id)}
                onDelete={() => removeNote(n.id)}
                onGo={() => openPath(n.file)}
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function NoteCard({
  n,
  fileName,
  text,
  onToggle,
  onDelete,
  onGo,
}: {
  n: { id: string; status: string };
  fileName: string;
  text: string;
  onToggle: () => void;
  onDelete: () => void;
  onGo: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  return (
    <div className={`ncard${n.status !== "open" ? " resolved" : ""}`}>
      <div className="nhead">
        <span className="ntype note">Note</span>
        <span className="nmeta">{fileName}</span>
      </div>
      <div className="ntext">{text}</div>
      <div className="acts">
        <button className="btn sm" type="button" onClick={onGo}>
          Go to file
        </button>
        <button className="btn sm" type="button" onClick={onToggle}>
          {n.status === "open" ? "Resolve" : "Reopen"}
        </button>
        <button
          className="btn sm ghost"
          type="button"
          onClick={() => {
            if (!confirm) {
              setConfirm(true);
              window.setTimeout(() => setConfirm(false), 3000);
              return;
            }
            onDelete();
          }}
        >
          {confirm ? "Click again to delete" : "Delete"}
        </button>
      </div>
    </div>
  );
}
