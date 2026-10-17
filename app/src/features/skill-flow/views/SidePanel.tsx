import { useEffect, useMemo, useRef } from "react";

import { index } from "@/model/normalize";
import { allCreates } from "@/model/normalize";
import { md } from "@/lib/markdown";
import type { Edit, EditResult, FlowNode } from "@/model/types";
import { useSkillStore, type ChatMsg } from "@/features/skill-flow/store";
import { compStats, kindPill } from "@/project/analyze";
import { ovFn } from "@/project/overview";
import { useAIStore } from "@/store/ai";
import { FileIcon } from "@/components/Icons";

const KIND_NAME: Record<string, string> = {
  step: "Step",
  decision: "Decision",
  loop: "Repeats",
  parallel: "Parallel",
  stop: "Stop",
};
const KIND_COLOR: Record<string, string> = {
  step: "var(--step)",
  decision: "var(--decide)",
  loop: "var(--loop)",
  parallel: "var(--muted)",
  stop: "var(--ink)",
};

function Details() {
  const sel = useSkillStore((s) => s.sel);
  const model = useSkillStore((s) => s.model);
  const files = useSkillStore((s) => s.files);
  const goTo = useSkillStore((s) => s.goTo);
  const setHighlight = useSkillStore((s) => s.setHighlight);
  const setActiveFile = useSkillStore((s) => s.setActiveFile);
  const setTab = useSkillStore((s) => s.setTab);
  const setSide = useSkillStore((s) => s.setSide);
  const setChatScope = useSkillStore((s) => s.setChatScope);
  const sendChat = useSkillStore((s) => s.sendChat);

  const node: FlowNode | undefined = sel ? index.get(sel) : undefined;
  // allCreates() reads the module-level node index, rebuilt by normalize() per model.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const makes = useMemo(() => allCreates(), [model]);

  const ask = (which: "overview" | "explain" | "missing") => {
    setSide("chat");
    if (which === "overview") {
      setChatScope(null);
      void sendChat(
        "Walk me through this whole workflow in plain words: the main path, each decision point and what it produces.",
      );
      return;
    }
    setChatScope(node ? node.id : null);
    void sendChat(
      which === "explain"
        ? "Explain this step: what it does, why it is here, what it needs from earlier steps and what later steps depend on it."
        : "What is missing or unclear in this step? Think about cases where a condition is not met, inputs are missing, or something fails. List concrete gaps and propose the fix.",
    );
  };

  const showInSource = (n: FlowNode) => {
    setHighlight(n.source);
    const at = files.findIndex((f) => f.text.includes(n.source.trim().slice(0, 40)));
    if (at >= 0) setActiveFile(at);
    setTab("source");
  };

  return (
    <>
      <section className="sec detail" aria-live="polite">
        {!node ? (
          <>
            <h3>Step details</h3>
            <p className="empty">
              Click any box in the diagram or mind map to see what it does, what it reads and what it creates. Use ← and
              → to walk through the steps in order.
            </p>
            <div className="acts">
              <button className="btn sm" type="button" onClick={() => ask("overview")}>
                Ask AI to explain the whole flow
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="kindline">
              <span className="num">{node.num}</span>
              <span className="kind" style={{ color: KIND_COLOR[node.kind] }}>
                {KIND_NAME[node.kind]}
              </span>
            </div>
            <h4>{node.kind === "decision" ? node.question || node.title : node.title}</h4>
            {node.detail ? <p>{node.detail}</p> : null}
            {node.kind === "loop" && node.over ? (
              <div className="blk">
                <span className="eyebrow">Repeats for</span>
                <span>{node.over}</span>
              </div>
            ) : null}
            {node.branches ? (
              <div className="blk">
                <span className="eyebrow">{node.kind === "parallel" ? "Tracks" : "Outcomes"}</span>
                <ul className="plain">
                  {node.branches.map((b) => (
                    <li key={b.label}>
                      <strong style={b.implied ? { color: "var(--danger)" } : undefined}>{b.label}</strong> →{" "}
                      {b.steps.length
                        ? b.steps.map((s) => s.title).join(", then ")
                        : b.implied
                          ? "not described in the file"
                          : "continue with the next step"}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {node.creates.length ? (
              <div className="blk">
                <span className="eyebrow">Creates</span>
                <div className="chips">
                  {node.creates.map((c) => (
                    <span className="chip make" title={c.note || c.kind} key={c.name}>
                      <FileIcon />
                      {c.name}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
            {node.uses.length ? (
              <div className="blk">
                <span className="eyebrow">Reads / uses</span>
                <div className="chips">
                  {node.uses.map((u) => (
                    <span className="chip use" key={u}>
                      {u}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
            {node.source ? (
              <div className="blk">
                <span className="eyebrow">From the file</span>
                <blockquote>{node.source}</blockquote>
                <button type="button" className="linkbtn" onClick={() => showInSource(node)}>
                  Show in source
                </button>
              </div>
            ) : null}
            <div className="acts">
              <button className="btn sm primary" type="button" onClick={() => ask("explain")}>
                Ask AI about this step
              </button>
              <button className="btn sm" type="button" onClick={() => ask("missing")}>
                What&apos;s missing here?
              </button>
            </div>
          </>
        )}
      </section>

      <section className="sec">
        <h3>
          Outputs in the run flow <span className="badge n">{makes.length}</span>
        </h3>
        <ul className="makes">
          {makes.length ? (
            makes.map((c) => (
              <li key={c.name}>
                <span className="ic">
                  <FileIcon />
                </span>
                <span className="nm">{c.name}</span>
                <span className="by">
                  made in{" "}
                  {c.by.map((n, i) => (
                    <span key={n.id}>
                      {i > 0 ? ", " : ""}
                      <button type="button" onClick={() => goTo(n.id, "diagram")}>
                        step {n.num}
                      </button>
                    </span>
                  ))}
                </span>
              </li>
            ))
          ) : (
            <li className="empty">No files or outputs detected.</li>
          )}
        </ul>
      </section>

      {model.inputs.length > 0 && (
        <section className="sec">
          <h3>Prerequisites</h3>
          <ul className="plain">
            {model.inputs.map((i, n) => (
              <li key={n}>{i}</li>
            ))}
          </ul>
        </section>
      )}
      {model.notes.length > 0 && (
        <section className="sec">
          <h3>Conventions</h3>
          <ul className="plain">
            {model.notes.map((i, n) => (
              <li key={n}>{i}</li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function DiffBlock({ results, edits }: { results: EditResult[]; edits: Edit[] }) {
  const cut = (s: string) => {
    const ls = s.split("\n");
    return ls.length > 14 ? [...ls.slice(0, 14), `… ${ls.length - 14} more lines`] : ls;
  };
  return (
    <div className="diff">
      {edits.map((x, i) => {
        const r = results[i];
        const file = r?.file || x.file;
        const ok = r?.ok ?? true;
        return (
          <div key={i}>
            <div className="f">
              {file}
              {ok ? "" : " · could not find this text"}
            </div>
            {x.find
              ? cut(x.find).map((l, k) => (
                  <div className="del" key={`d${k}`}>
                    - {l}
                  </div>
                ))
              : null}
            {x.replace
              ? cut(x.replace).map((l, k) => (
                  <div className="add" key={`a${k}`}>
                    + {l}
                  </div>
                ))
              : null}
          </div>
        );
      })}
    </div>
  );
}

function MsgView({ m, i }: { m: ChatMsg; i: number }) {
  const applyMsg = useSkillStore((s) => s.applyMsg);
  const discardMsg = useSkillStore((s) => s.discardMsg);
  const undoMsg = useSkillStore((s) => s.undoMsg);
  const setTab = useSkillStore((s) => s.setTab);

  if (m.role === "user")
    return (
      <div className="msg user">
        {m.scope ? (
          <span className="sc">
            about step {m.scope.num} · {m.scope.title}
          </span>
        ) : null}
        {m.text}
      </div>
    );

  const okN = (m.results || []).filter((r) => r.ok).length;
  const bad = (m.results || []).length - okN;

  return (
    <div className={`msg assistant${m.error ? " error" : ""}`}>
      {m.pending && !m.text ? (
        <span className="typing">
          <i />
          <i />
          <i /> {m.phase === "edits" ? "Preparing changes" : "Thinking"}
        </span>
      ) : (
        <div dangerouslySetInnerHTML={{ __html: md(m.text) }} />
      )}
      {m.pending && m.text && m.phase === "edits" ? (
        <p className="typing">
          <i />
          <i />
          <i /> Preparing changes
        </p>
      ) : null}
      {m.edits && m.edits.length ? (
        <div className="change">
          <div className="change-h">
            {m.status === "applied" ? (
              <>
                <span className="ok">
                  Applied {okN} change{okN === 1 ? "" : "s"}
                </span>
                {bad ? <span className="bad"> · {bad} not found</span> : null}
              </>
            ) : m.status === "undone" ? (
              "Undone"
            ) : m.status === "discarded" ? (
              "Discarded"
            ) : m.status === "failed" ? (
              <span className="bad">Couldn&apos;t apply: the text to replace wasn&apos;t found</span>
            ) : (
              `Proposed ${m.edits.length} change${m.edits.length === 1 ? "" : "s"}`
            )}
            <span className="sp" />
            {m.status === "proposed" ? (
              <>
                <button className="btn sm primary" type="button" onClick={() => applyMsg(i)}>
                  Apply
                </button>
                <button className="btn sm" type="button" onClick={() => discardMsg(i)}>
                  Discard
                </button>
              </>
            ) : m.status === "applied" ? (
              <>
                <button className="btn sm ghost" type="button" onClick={() => setTab("changes")}>
                  All changes
                </button>
                <button className="btn sm" type="button" onClick={() => undoMsg(i)}>
                  Undo
                </button>
              </>
            ) : null}
          </div>
          <DiffBlock results={m.results || []} edits={m.edits} />
        </div>
      ) : null}
    </div>
  );
}

function Chat() {
  const chat = useSkillStore((s) => s.chat);
  const side = useSkillStore((s) => s.side);
  const chatScope = useSkillStore((s) => s.chatScope);
  const chatDraft = useSkillStore((s) => s.chatDraft);
  const autoApply = useSkillStore((s) => s.autoApply);
  const busy = useSkillStore((s) => s.busy);
  const setChatDraft = useSkillStore((s) => s.setChatDraft);
  const setAutoApply = useSkillStore((s) => s.setAutoApply);
  const setChatScope = useSkillStore((s) => s.setChatScope);
  const sendChat = useSkillStore((s) => s.sendChat);
  const stopAll = useSkillStore((s) => s.stopAll);
  const client = useAIStore((s) => s.client);
  const setSettingsOpen = useAIStore((s) => s.setSettingsOpen);
  const msgsRef = useRef<HTMLDivElement | null>(null);

  const scopeNode = chatScope ? index.get(chatScope) : undefined;

  useEffect(() => {
    if (msgsRef.current) msgsRef.current.scrollTop = msgsRef.current.scrollHeight;
  }, [chat, side]);

  const quick = scopeNode
    ? ["Explain this step", "What if this fails?", "What's missing here?", "Make this step clearer"]
    : ["Summarize the flow", "Where can this go wrong?", "Add error handling", "Tighten the wording"];

  return (
    <>
      <div className="scopebar">
        <span className="eyebrow">Talking about</span>
        <span className={`scope-pill${scopeNode ? "" : " all"}`}>
          {scopeNode
            ? `Step ${scopeNode.num} · ${scopeNode.kind === "decision" ? scopeNode.question || scopeNode.title : scopeNode.title}`
            : "Whole workflow"}
        </span>
        {scopeNode && (
          <button className="linkbtn" type="button" onClick={() => setChatScope(null)}>
            Use whole workflow
          </button>
        )}
      </div>
      <div className="msgs" ref={msgsRef}>
        {client ? (
          <div className="msg tip">
            Select a step in the diagram to talk about it, or keep &quot;Whole workflow&quot;. Ask questions, or say
            what to change, such as &quot;if the ticket isn&apos;t found, ask the user again&quot;. Changes are written
            into the file and the map redraws. Undo and Download are at the top.
          </div>
        ) : (
          <div className="msg tip">
            Chat needs an API key from Anthropic, OpenAI or Google Gemini.{" "}
            <button className="btn sm primary" type="button" onClick={() => setSettingsOpen(true)}>
              Add API key
            </button>
          </div>
        )}
        {chat.map((m, i) => (
          <MsgView m={m} i={i} key={i} />
        ))}
      </div>
      {client ? (
        <div className="quick">
          {quick.map((t) => (
            <button type="button" key={t} onClick={() => void sendChat(t)}>
              {t}
            </button>
          ))}
        </div>
      ) : null}
      <div className="composer">
        <textarea
          placeholder="Ask about the flow, or say what to fix. Example: add a step to validate the ticket ID"
          value={chatDraft}
          disabled={!client}
          onChange={(e) => setChatDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              const v = chatDraft;
              setChatDraft("");
              void sendChat(v);
            }
          }}
        />
        <div className="row">
          <label className="toggle">
            <input type="checkbox" checked={autoApply} onChange={(e) => setAutoApply(e.target.checked)} /> Apply fixes
            to the file automatically
          </label>
          <span className="grow" />
          {busy.chat && (
            <button className="btn sm" type="button" onClick={stopAll}>
              Stop
            </button>
          )}
          <button
            className="btn sm primary"
            type="button"
            disabled={!client}
            onClick={() => {
              const v = chatDraft;
              setChatDraft("");
              void sendChat(v);
            }}
          >
            Send
          </button>
        </div>
      </div>
    </>
  );
}

function Snippet({ path, line }: { path: string; line: number }) {
  const files = useSkillStore((s) => s.files);
  const setHighlight = useSkillStore((s) => s.setHighlight);
  const setActiveFile = useSkillStore((s) => s.setActiveFile);
  const setTab = useSkillStore((s) => s.setTab);
  const f = files.find((x) => x.path === path);
  if (!f || !line) return null;
  const lines = f.text.split("\n");
  const a = Math.max(0, line - 1 - 3);
  const b = Math.min(lines.length, line + 3);
  const snippet = lines.slice(a, b).join("\n");
  return (
    <div className="blk">
      <span className="eyebrow">From the file</span>
      <blockquote className="mono" style={{ whiteSpace: "pre-wrap" }}>
        {snippet}
      </blockquote>
      <button
        type="button"
        className="linkbtn"
        onClick={() => {
          const at = files.findIndex((x) => x.path === path);
          if (at >= 0) setActiveFile(at);
          setHighlight(snippet.trim().split("\n")[0] || "");
          setTab("source");
        }}
      >
        Show in source
      </button>
    </div>
  );
}

function ProjectDetails() {
  const sel = useSkillStore((s) => s.sel);
  const flowStep = useSkillStore((s) => s.flowStep);
  const ovSel = useSkillStore((s) => s.ovSel);
  const ovModel = useSkillStore((s) => s.ovModel);
  const flowSteps = useSkillStore((s) => s.flowSteps);
  const flow = useSkillStore((s) => s.flows[s.flowIdx]);
  const model = useSkillStore((s) => s.model);
  const files = useSkillStore((s) => s.files);
  const bins = useSkillStore((s) => s.bins);
  const setSide = useSkillStore((s) => s.setSide);
  const setChatScope = useSkillStore((s) => s.setChatScope);
  const sendChat = useSkillStore((s) => s.sendChat);
  const setTab = useSkillStore((s) => s.setTab);
  const openPath = useSkillStore((s) => s.openPath);
  const setFlowStep = useSkillStore((s) => s.setFlowStep);
  const setOvSel = useSkillStore((s) => s.setOvSel);
  const select = useSkillStore((s) => s.select);

  const empty = (
    <>
      <h3>Details</h3>
      <p className="empty">
        Click a step in the flow, a node in the high-level view, or a card in the architecture to see what it does and
        what it touches.
      </p>
      <div className="acts">
        <button
          className="btn sm"
          type="button"
          onClick={() => {
            setSide("chat");
            setChatScope(null);
            void sendChat(
              "Explain this whole project in plain words: what it does, its main components and how they fit together, and how a typical request flows through it.",
            );
          }}
        >
          Ask AI to explain the project
        </button>
      </div>
    </>
  );

  // 1. A traced flow step.
  if (flowStep != null && flowStep >= 0 && flowSteps[flowStep]) {
    const s = flowSteps[flowStep];
    const filePath = s.ext ? s.from : s.to;
    const where = s.ext ? s.to : s.toName ? `${s.to} · ${s.toName}()` : s.to;
    return (
      <section className="sec detail" aria-live="polite">
        <div className="kindline">
          <span className="num">{flowSteps.slice(0, flowStep + 1).filter((x) => !x.phase).length}</span>
          <span className="kind" style={{ color: s.ext ? "var(--muted)" : "var(--step)" }}>
            {s.ext ? `External · ${s.cat}` : "Flow step"}
          </span>
        </div>
        <h4>{s.entry ? s.text : s.cond ? `${ovFn(s)} when ${s.cond}` : ovFn(s)}</h4>
        <div className="blk">
          <span className="eyebrow">Where</span>
          {s.ext ? (
            <span>{where}</span>
          ) : (
            <button type="button" className="linkbtn mono" onClick={() => openPath(s.to)}>
              {s.to}
            </button>
          )}
          {s.cond ? (
            <div>
              <span className="eyebrow">Only when</span>
              <span>{s.cond}</span>
            </div>
          ) : null}
        </div>
        <Snippet path={filePath} line={s.line} />
        <div className="acts">
          <button className="btn sm primary" type="button" onClick={() => openPath(s.to)} disabled={s.ext}>
            Open in Source
          </button>
          <button
            className="btn sm"
            type="button"
            onClick={() => {
              setSide("chat");
              setChatScope(null);
              void sendChat(
                `In the flow "${flow?.name}", explain step ${flowStep + 1}: ${
                  s.from === "actor" ? flow?.actor : `${s.from} ${s.fromName}()`
                } calls ${s.ext ? `${s.toName} (${s.cat})` : `${s.to} ${s.toName}()`}${
                  s.cond ? ` when ${s.cond}` : ""
                }. What happens here, what data passes, and what could go wrong?`,
              );
            }}
          >
            Ask AI about this step
          </button>
          <button
            className="btn sm"
            type="button"
            onClick={() => {
              select(null);
              setFlowStep(-1);
            }}
          >
            Clear selection
          </button>
        </div>
      </section>
    );
  }

  // 2. A high-level overview node.
  if (ovSel && ovModel) {
    const n = ovModel.nodes.get(ovSel);
    if (n) {
      const desc =
        n.kind === "actor"
          ? "Where the flow starts, and where the result goes back to."
          : n.kind === "code"
            ? `${n.files.size} file${n.files.size === 1 ? "" : "s"}, ${n.fns.length} function${
                n.fns.length === 1 ? "" : "s"
              } used in this flow.`
            : `${n.items.length} ${n.items.length === 1 ? "connection" : "connections"} in this flow.`;
      return (
        <section className="sec detail" aria-live="polite">
          <div className="kindline">
            <span className="kind" style={{ color: n.color }}>
              {n.tag}
            </span>
          </div>
          <h4>{n.label}</h4>
          <p>{desc}</p>
          {n.kind === "code" && n.fns.length ? (
            <div className="blk">
              <span className="eyebrow">Functions used</span>
              <div className="chips">
                {n.fns.slice(0, 24).map((fn) => (
                  <span className="chip use" key={fn}>
                    {fn}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          {n.files.size ? (
            <div className="blk">
              <span className="eyebrow">Files</span>
              <ul className="ov-files">
                {[...n.files].slice(0, 12).map((p) => (
                  <li key={p}>
                    <button type="button" className="linkbtn mono" onClick={() => openPath(p)}>
                      {p}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="acts">
            <button
              className="btn sm"
              type="button"
              onClick={() => {
                setSide("chat");
                setChatScope(null);
                void sendChat(
                  `In the project, explain the part "${n.label}" (${n.tag}): what it does, how the flow uses it, what it reads or writes, and anything that could go wrong.`,
                );
              }}
            >
              Ask AI about this part
            </button>
            <button className="btn sm" type="button" onClick={() => setOvSel(null)}>
              Clear selection
            </button>
          </div>
        </section>
      );
    }
  }

  // 3. A component (from the architecture or overview).
  if (sel && sel.startsWith("c:")) {
    const name = sel.slice(2);
    const comp = (model.components || []).find((c) => c.name === name);
    if (comp) {
      const st = compStats(model.components || [], files, bins, comp);
      return (
        <section className="sec detail" aria-live="polite">
          <div className="kindline">
            <span dangerouslySetInnerHTML={{ __html: kindPill(comp.kind) }} />
            <span className="kind" style={{ color: "var(--muted)" }}>
              {st.files} file{st.files === 1 ? "" : "s"} · {st.lines.toLocaleString()} lines
            </span>
          </div>
          <h4>{comp.name}</h4>
          {comp.purpose ? <p>{comp.purpose}</p> : null}
          {comp.path ? (
            <div className="blk">
              <span className="eyebrow">Path</span>
              <span className="mono">{comp.path}</span>
            </div>
          ) : null}
          {comp.depends.length ? (
            <div className="blk">
              <span className="eyebrow">Depends on</span>
              <div className="chips">
                {comp.depends.map((d) => (
                  <button type="button" className="chip use" key={d} onClick={() => select(`c:${d}`)}>
                    {d}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="blk">
            <span className="eyebrow">Key files</span>
            <ul className="ov-files">
              {(comp.keyFiles.length ? comp.keyFiles : st.paths).slice(0, 12).map((p) => (
                <li key={p}>
                  <button type="button" className="linkbtn mono" onClick={() => openPath(p)}>
                    {p}
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className="acts">
            <button className="btn sm" type="button" onClick={() => setTab("arch")}>
              Show in Architecture
            </button>
            <button className="btn sm" type="button" onClick={() => select(null)}>
              Clear selection
            </button>
          </div>
        </section>
      );
    }
  }

  // 4. A file (from the structure tree).
  if (sel && sel.startsWith("f:")) {
    const path = sel.slice(2);
    const f = files.find((x) => x.path === path);
    const comp = (model.components || []).find((c) => c.keyFiles.includes(path) || c.path === path);
    return (
      <section className="sec detail" aria-live="polite">
        <div className="kindline">
          <span className="kind" style={{ color: "var(--muted)" }}>
            File
          </span>
        </div>
        <h4 className="mono">{path.split("/").pop()}</h4>
        <p className="mono" style={{ wordBreak: "break-all" }}>
          {path}
        </p>
        <div className="blk">
          <span className="eyebrow">Size</span>
          <span>{f ? `${(f.lines || 0).toLocaleString()} lines` : "not read (binary or skipped)"}</span>
        </div>
        {comp ? (
          <div className="blk">
            <span className="eyebrow">Part of</span>
            <button type="button" className="linkbtn" onClick={() => select(`c:${comp.name}`)}>
              {comp.name}
            </button>
          </div>
        ) : null}
        <div className="acts">
          <button className="btn sm primary" type="button" onClick={() => openPath(path)} disabled={!f}>
            Open in Source
          </button>
        </div>
      </section>
    );
  }

  return <section className="sec detail">{empty}</section>;
}

export function SidePanel() {
  const side = useSkillStore((s) => s.side);
  const setSide = useSkillStore((s) => s.setSide);
  const chat = useSkillStore((s) => s.chat);
  const appMode = useSkillStore((s) => s.appMode);
  const unread = chat.length > 0 && side !== "chat";

  return (
    <aside className="panel side">
      <div className="tabs" role="tablist">
        <button
          className="tab"
          role="tab"
          type="button"
          aria-selected={side === "details"}
          onClick={() => setSide("details")}
        >
          Details
        </button>
        <button
          className="tab"
          role="tab"
          type="button"
          aria-selected={side === "chat"}
          onClick={() => setSide("chat")}
        >
          Chat with AI <span className="badge n">{unread ? "new" : ""}</span>
        </button>
      </div>
      <div className="side-body" hidden={side !== "details"}>
        {appMode === "project" ? <ProjectDetails /> : <Details />}
      </div>
      <div className="side-body" hidden={side !== "chat"}>
        <Chat />
      </div>
    </aside>
  );
}
