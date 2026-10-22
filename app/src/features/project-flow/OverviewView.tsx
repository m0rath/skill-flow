import { memo, useMemo } from "react";

import { traceFlow } from "@/project/flows";
import { useSkillStore } from "@/features/skill-flow/store";

function FileListImpl({ title, list, empty }: { title: string; list: string[]; empty: string }) {
  const openFile = useSkillStore((s) => s.openPath);
  return (
    <div className="ov-card">
      <h4>
        {title} <span className="badge n">{list.length}</span>
      </h4>
      {list.length ? (
        <ul className="ov-files">
          {list.slice(0, 12).map((p) => (
            <li key={p}>
              <button type="button" className="linkbtn mono" onClick={() => openFile(p)}>
                {p}
              </button>
            </li>
          ))}
          {list.length > 12 ? <li className="empty">and {list.length - 12} more</li> : null}
        </ul>
      ) : (
        <p className="empty">{empty}</p>
      )}
    </div>
  );
}

const FileList = memo(FileListImpl);

export function OverviewView() {
  const model = useSkillStore((s) => s.model);
  const project = useSkillStore((s) => s.project);
  const flows = useSkillStore((s) => s.flows);
  const code = useSkillStore((s) => s.code);
  const setTab = useSkillStore((s) => s.setTab);
  const setFlowIdx = useSkillStore((s) => s.setFlowIdx);
  const select = useSkillStore((s) => s.select);
  const setSide = useSkillStore((s) => s.setSide);
  const setChatScope = useSkillStore((s) => s.setChatScope);
  const sendChat = useSkillStore((s) => s.sendChat);
  const openPath = useSkillStore((s) => s.openPath);

  const stepCounts = useMemo(() => {
    if (!code) return flows.map(() => 0);
    return flows.map((f) => {
      try {
        return traceFlow(flows, code, f, 160, 9).filter((s) => !s.phase).length;
      } catch {
        return 0;
      }
    });
  }, [flows, code]);

  const cidList = useMemo(() => (project ? [...new Set([...project.ci, ...project.docker])] : []), [project]);

  if (!project) return null;
  const P = project;
  const totalL = P.langs.reduce((a, l) => a + l.lines, 0) || 1;
  const cmds = (model.commands || []).slice(0, 12);
  const comps = model.components || [];

  const readme = P.readmes[0];

  return (
    <div id="overview">
      <div className="ov-grid">
        <div className="ov-card ov-wide">
          <h4>What it is</h4>
          <p className="ov-lead">{model.summary || "Map with AI to get a plain-language summary of this project."}</p>
          {model.trigger ? (
            <p>
              <strong>Used by:</strong> {model.trigger}
            </p>
          ) : null}
          {(model.stack || []).length ? (
            <div className="chips" style={{ marginTop: 8 }}>
              {(model.stack || []).map((s) => (
                <span className="chip use" key={s}>
                  {s}
                </span>
              ))}
            </div>
          ) : null}
          <div className="acts" style={{ marginTop: 12 }}>
            <button
              className="btn sm primary"
              type="button"
              onClick={() => {
                setSide("chat");
                setChatScope(null);
                void sendChat(
                  "Explain this whole project in plain words: what it does, its main components and how they fit together, and how a typical run or request flows through it.",
                );
              }}
            >
              Explain the project to me
            </button>
            <button className="btn sm" type="button" onClick={() => setTab("flows")}>
              See the flows, start to end
            </button>
            <button className="btn sm" type="button" onClick={() => setTab("arch")}>
              See which files call which
            </button>
            <button className="btn sm" type="button" onClick={() => setTab("diagram")}>
              See how it runs
            </button>
            {readme ? (
              <button className="btn sm" type="button" onClick={() => openPath(readme)}>
                Read the README with me
              </button>
            ) : null}
          </div>
        </div>

        <div className="ov-card ov-wide">
          <h4>
            Flows found in the code <span className="badge n">{flows.filter((f) => !f.all).length}</span>
          </h4>
          {flows.length ? (
            <ul className="ov-flows">
              {flows.map((f, i) => (
                <li key={f.id}>
                  <button
                    type="button"
                    className="linkbtn"
                    onClick={() => {
                      setFlowIdx(i);
                      setTab("flows");
                    }}
                  >
                    {f.name}
                  </button>
                  <span>
                    {f.group}
                    {f.all ? "" : ` · ${stepCounts[i]} steps`}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty">No entry points found. Map with AI, or open the main file in Source.</p>
          )}
        </div>

        <div className="ov-card ov-wide">
          <h4>
            Languages{" "}
            <span className="empty" style={{ fontWeight: 400 }}>
              {P.lines.toLocaleString()} lines in {P.files.toLocaleString()} text files
              {P.bins ? `, ${P.bins.toLocaleString()} other files` : ""}
            </span>
          </h4>
          <div className="langbar">
            {P.langs.slice(0, 8).map((l) => (
              <span
                key={l.name}
                style={{ width: `${((l.lines / totalL) * 100).toFixed(2)}%`, background: l.color }}
                title={`${l.name}: ${l.lines.toLocaleString()} lines`}
              />
            ))}
          </div>
          <div className="langlegend">
            {P.langs.slice(0, 8).map((l) => (
              <span key={l.name}>
                <i style={{ background: l.color }} />
                {l.name} <b>{Math.round((l.lines / totalL) * 100)}%</b>
              </span>
            ))}
          </div>
        </div>

        <div className="ov-card">
          <h4>How to run it</h4>
          {cmds.length ? (
            <ul className="ov-cmds">
              {cmds.map((c) => (
                <li key={c.cmd}>
                  <code>{c.cmd}</code>
                  {c.purpose ? <span>{c.purpose}</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty">No commands found in the README or manifests.</p>
          )}
          {(model.inputs || []).length ? (
            <>
              <h5>You&apos;ll need</h5>
              <ul className="plain">
                {(model.inputs || []).map((i, n) => (
                  <li key={n}>{i}</li>
                ))}
              </ul>
            </>
          ) : null}
          {P.envVars.length ? (
            <>
              <h5>Environment variables read by the code</h5>
              <div className="chips">
                {P.envVars.slice(0, 24).map((v) => (
                  <span className="chip use" key={v}>
                    {v}
                  </span>
                ))}
              </div>
            </>
          ) : null}
        </div>

        <div className="ov-card">
          <h4>
            Components <span className="badge n">{comps.length}</span>
          </h4>
          <ul className="ov-comps">
            {comps.map((c) => (
              <li key={c.name}>
                <button
                  type="button"
                  className="linkbtn"
                  onClick={() => {
                    select(`c:${c.name}`);
                    setSide("details");
                    setTab("arch");
                  }}
                >
                  {c.name}
                </button>{" "}
                <span className={`kpill k-${c.kind}`}>{c.kind}</span>
                <span>{c.purpose}</span>
              </li>
            ))}
            {!comps.length && <li className="empty">No components found yet.</li>}
          </ul>
        </div>

        <FileList title="READMEs" list={P.readmes} empty="No README found." />
        <FileList title="Entry points" list={P.entries} empty="No obvious entry point found." />
        <FileList title="Manifests and build files" list={P.manifests} empty="No manifest found." />
        <FileList title="Docs" list={P.docs} empty="No other docs." />
        <FileList title="CI/CD and deployment" list={cidList} empty="No CI or deployment files." />
        <FileList title="Tests" list={P.tests} empty="No tests found." />

        {P.todos.length > 0 && (
          <div className="ov-card">
            <h4>
              Unfinished work <span className="badge n">{P.todos.reduce((a, t) => a + t.n, 0)}</span>
            </h4>
            <ul className="ov-files">
              {P.todos.slice(0, 12).map((t) => (
                <li key={t.path}>
                  <button type="button" className="linkbtn mono" onClick={() => openPath(t.path)}>
                    {t.path}
                  </button>{" "}
                  <span className="empty">{t.n} TODO/FIXME</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {P.big.length > 0 && (
          <div className="ov-card">
            <h4>Largest files</h4>
            <ul className="ov-files">
              {P.big.slice(0, 10).map((b) => (
                <li key={b.path}>
                  <button type="button" className="linkbtn mono" onClick={() => openPath(b.path)}>
                    {b.path}
                  </button>{" "}
                  <span className="empty">{b.lines.toLocaleString()} lines</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
