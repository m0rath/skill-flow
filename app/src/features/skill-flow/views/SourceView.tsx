import { useEffect, useMemo, useRef, useState } from "react";

import { parseMdBlocks } from "@/lib/md-blocks";
import { browserVoices, readAloudVoices, useReadWithMe, type UseReadWithMe } from "@/features/skill-flow/readWithMe";
import { useSkillStore } from "@/features/skill-flow/store";
import { MarkdownRead } from "@/features/skill-flow/views/MarkdownRead";
import { useAIStore } from "@/store/ai";
import { useAppStore } from "@/store/app";

function ReadBar({ rwm, onClose }: { rwm: UseReadWithMe; onClose: () => void }) {
  const client = useAIStore((s) => s.client);
  const keys = useAIStore((s) => s.keys);
  const [question, setQuestion] = useState("");
  const [showLog, setShowLog] = useState(false);
  const logRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [rwm.log, showLog]);

  const playing = rwm.status === "playing";
  const voices = rwm.engine === "browser" ? browserVoices() : [];

  return (
    <div className={`rc${rwm.status !== "idle" ? " talking" : ""}`}>
      <div className="rc-row">
        <button
          className="btn sm primary"
          type="button"
          onClick={() => (playing ? rwm.pause() : rwm.status === "paused" ? rwm.resume() : rwm.start())}
        >
          {playing ? "Pause" : rwm.status === "paused" ? "Resume" : "Start reading"}
        </button>
        <button className="btn sm" type="button" onClick={rwm.stop} disabled={rwm.status === "idle"}>
          Stop
        </button>
        <span className="segtabs">
          <button
            type="button"
            aria-pressed={rwm.mode === "guided"}
            title="She explains each section in plain words, like a colleague walking you through it"
            onClick={() => rwm.setMode("guided")}
          >
            Explain as we go
          </button>
          <button
            type="button"
            aria-pressed={rwm.mode === "verbatim"}
            title="Reads the text exactly as written"
            onClick={() => rwm.setMode("verbatim")}
          >
            Word for word
          </button>
        </span>
        {client && (
          <select
            aria-label="Voice engine"
            value={rwm.engine}
            onChange={(e) => rwm.setEngine(e.target.value as "browser" | "openai" | "gemini")}
          >
            <option value="browser">Browser voice (free)</option>
            <option value="openai" disabled={!keys.openai}>
              OpenAI natural voice
            </option>
            <option value="gemini" disabled={!keys.gemini}>
              Gemini natural voice
            </option>
          </select>
        )}
        <select aria-label="Voice" value={rwm.voice} onChange={(e) => rwm.setVoice(e.target.value)}>
          {rwm.engine === "browser" ? (
            <>
              <option value="">Best match (auto)</option>
              {voices.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name} ({v.lang})
                </option>
              ))}
            </>
          ) : rwm.engine === "openai" ? (
            readAloudVoices.openai.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))
          ) : (
            readAloudVoices.gemini.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))
          )}
        </select>
        <label className="toggle">
          Speed
          <select aria-label="Reading speed" value={rwm.rate} onChange={(e) => rwm.setRate(Number(e.target.value))}>
            <option value={0.85}>Slower</option>
            <option value={1}>Normal</option>
            <option value={1.15}>A bit faster</option>
            <option value={1.3}>Faster</option>
          </select>
        </label>
        <span style={{ flex: 1 }} />
        <button className="btn sm ghost" type="button" aria-expanded={showLog} onClick={() => setShowLog((v) => !v)}>
          Transcript
        </button>
        <button className="btn sm ghost" type="button" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="rc-cap">
        <div className="rc-av" aria-hidden="true">
          <span>
            <i />
            <i />
            <i />
            <i />
          </span>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="who">
            <span>{rwm.who}</span>
            <span>{rwm.now}</span>
          </div>
          <p className={rwm.status === "idle" ? "muted" : ""}>{rwm.caption}</p>
        </div>
      </div>
      {showLog && (
        <div className="rc-log" ref={logRef} role="log" aria-live="polite" aria-label="Reading transcript">
          {rwm.log.length ? (
            rwm.log.map((e) => (
              <div className={`e ${e.who}`} key={e.id}>
                {e.who === "reader" ? (
                  <span className="t">{e.title || "Reading"}</span>
                ) : e.who === "answer" ? (
                  <span className="t">Answer</span>
                ) : null}
                {e.text}
              </div>
            ))
          ) : (
            <p className="empty" style={{ margin: 0 }}>
              Nothing yet. What I read and your questions will appear here.
            </p>
          )}
        </div>
      )}
      <form
        className="rc-ask"
        onSubmit={(e) => {
          e.preventDefault();
          rwm.ask(question);
          setQuestion("");
        }}
      >
        <input
          type="text"
          autoComplete="off"
          placeholder="Ask about what you're hearing. Reading pauses while I answer"
          aria-label="Ask a question"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <button className="btn sm primary" type="submit">
          Ask
        </button>
      </form>
    </div>
  );
}

export function SourceView() {
  const files = useSkillStore((s) => s.files);
  const activeFile = useSkillStore((s) => s.activeFile);
  const editing = useSkillStore((s) => s.editing);
  const modelTitle = useSkillStore((s) => s.model.title);
  const setActiveFile = useSkillStore((s) => s.setActiveFile);
  const setEditing = useSkillStore((s) => s.setEditing);
  const saveEditText = useSkillStore((s) => s.saveEditText);
  const highlight = useSkillStore((s) => s.highlight);
  const setChatDraft = useSkillStore((s) => s.setChatDraft);
  const setSide = useSkillStore((s) => s.setSide);
  const toast = useAppStore((s) => s.toast);

  const [srcMode, setSrcMode] = useState<"read" | "raw">("read");
  const [draft, setDraft] = useState("");
  const [showRead, setShowRead] = useState(false);
  const [selection, setSelection] = useState<string | null>(null);
  const [speakingRange, setSpeakingRange] = useState<{ l: number; le: number } | null>(null);
  const preRef = useRef<HTMLPreElement | null>(null);

  const file = files[activeFile] || files[0];
  const blocks = useMemo(() => parseMdBlocks(file?.text || ""), [file?.text]);
  const rwm = useReadWithMe({
    blocks,
    fileText: file?.text || "",
    title: modelTitle,
    onSpeakRange: setSpeakingRange,
  });

  useEffect(() => {
    if (editing) setDraft(file?.text || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const mode = editing ? "raw" : srcMode;

  useEffect(() => {
    if (!highlight || mode !== "raw") return;
    preRef.current?.querySelector("#hl")?.scrollIntoView({ block: "center" });
  }, [highlight, mode]);

  const rawHtml = useMemo(() => {
    const esc = (s: string) =>
      s.replace(
        /[&<>"']/g,
        (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
      );
    const text = file?.text || "";
    if (!highlight) return esc(text);
    const q = highlight.trim().slice(0, 80);
    let at = q.length > 4 ? text.indexOf(q) : -1;
    if (at < 0 && q.length > 4) at = text.toLowerCase().indexOf(q.replace(/`/g, "").toLowerCase());
    if (at < 0) return esc(text);
    const len = Math.min(highlight.trim().length, text.length - at);
    return (
      esc(text.slice(0, at)) + '<mark id="hl">' + esc(text.slice(at, at + len)) + "</mark>" + esc(text.slice(at + len))
    );
  }, [file?.text, highlight]);

  return (
    <div className="source">
      <div className="filetabs">
        <span style={{ display: "contents" }}>
          {files.length > 1 ? (
            files.map((f, i) => (
              <button type="button" key={f.path} aria-pressed={i === activeFile} onClick={() => setActiveFile(i)}>
                {f.path}
                {f.edited ? <span className="edited"> •</span> : null}
              </button>
            ))
          ) : (
            <span className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>
              {file?.path}
              {file?.edited ? <span className="edited"> • edited</span> : null}
            </span>
          )}
        </span>
        <span style={{ flex: 1 }} />
        <span className="segtabs">
          <button type="button" aria-pressed={srcMode === "read"} onClick={() => setSrcMode("read")} disabled={editing}>
            Read
          </button>
          <button type="button" aria-pressed={srcMode === "raw"} onClick={() => setSrcMode("raw")}>
            Raw
          </button>
        </span>
        <button
          className="btn sm"
          type="button"
          title="Have the file read to you and ask questions as you go"
          onClick={() => {
            setSrcMode("read");
            setShowRead(true);
          }}
        >
          Read with me
        </button>
        {!editing ? (
          <button className="btn sm" type="button" onClick={() => setEditing(true)} disabled={!!file?.virtual}>
            Edit
          </button>
        ) : (
          <>
            <button className="btn sm primary" type="button" onClick={() => saveEditText(draft)}>
              Save &amp; re-map
            </button>
            <button className="btn sm" type="button" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </>
        )}
      </div>

      {showRead && (
        <ReadBar
          rwm={rwm}
          onClose={() => {
            setShowRead(false);
            rwm.stop();
          }}
        />
      )}

      <div className="scroll">
        {mode === "read" ? (
          <MarkdownRead blocks={blocks} speakingRange={speakingRange} onSelect={setSelection} />
        ) : editing ? (
          <textarea
            aria-label="Edit file"
            spellCheck={false}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        ) : (
          <pre ref={preRef} dangerouslySetInnerHTML={{ __html: rawHtml }} />
        )}
      </div>

      {selection && (
        <div className="selbar" role="toolbar" aria-label="Selection actions">
          <button
            type="button"
            onClick={() => {
              setShowRead(true);
              rwm.speakText(selection);
              setSelection(null);
            }}
          >
            Read this
          </button>
          <button
            type="button"
            onClick={() => {
              setChatDraft(`About this part of the file: "${selection.slice(0, 400)}"\n`);
              setSide("chat");
              setSelection(null);
              toast("Selection added to the chat box");
            }}
          >
            Ask about this
          </button>
          <button type="button" onClick={() => setSelection(null)}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
