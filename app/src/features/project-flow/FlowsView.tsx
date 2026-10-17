import { useEffect, useMemo, useRef, useState } from "react";

import { useSkillStore } from "@/features/skill-flow/store";
import { type ViewportControls, useViewport } from "@/features/skill-flow/viewport";
import { compOfPath, KIND_COLOR } from "@/project/analyze";
import { traceText } from "@/project/flows";
import { CAT_COLOR, fpVerb, layoutOverview, OV_HIDE, ovFn } from "@/project/overview";
import { dirOf } from "@/project/paths";
import type { FlowStep, OvNode } from "@/project/types";
import { useAppStore } from "@/store/app";

const pathD = (c: number[]) => `M${c[0]},${c[1]} C${c[2]},${c[3]} ${c[4]},${c[5]} ${c[6]},${c[7]}`;

/** The label shown on a sequence/tree row. */
const stepLabel = (s: FlowStep): string =>
  s.entry ? s.text : s.toName + (s.ext || s.load || s.reg || s.render ? "" : "()");

interface ToolbarProps {
  playing: boolean;
  onTogglePlay: () => void;
  onRestart: () => void;
  speed: number;
  setSpeed: (v: number) => void;
  zoom: number;
  controls: ViewportControls;
}

function Toolbar({ playing, onTogglePlay, onRestart, speed, setSpeed, zoom, controls }: ToolbarProps) {
  const flows = useSkillStore((s) => s.flows);
  const flowIdx = useSkillStore((s) => s.flowIdx);
  const flowMode = useSkillStore((s) => s.flowMode);
  const flowSteps = useSkillStore((s) => s.flowSteps);
  const flowLive = useSkillStore((s) => s.flowLive);
  const setFlowLive = useSkillStore((s) => s.setFlowLive);
  const setFlowIdx = useSkillStore((s) => s.setFlowIdx);
  const setFlowMode = useSkillStore((s) => s.setFlowMode);
  const removeCustomFlow = useSkillStore((s) => s.removeCustomFlow);
  const openShot = useSkillStore((s) => s.openShot);
  const setTab = useSkillStore((s) => s.setTab);
  const setSide = useSkillStore((s) => s.setSide);
  const setChatScope = useSkillStore((s) => s.setChatScope);
  const sendChat = useSkillStore((s) => s.sendChat);
  const code = useSkillStore((s) => s.code);
  const focus = useSkillStore((s) => s.focus);
  const setFocus = useSkillStore((s) => s.setFocus);
  const toast = useAppStore((s) => s.toast);
  const [pickOpen, setPickOpen] = useState(false);
  const [pick, setPick] = useState("");
  const addCustomFlow = useSkillStore((s) => s.addCustomFlow);
  const findEntryPoints = useSkillStore((s) => s.findEntryPoints);
  const busy = useSkillStore((s) => s.busy);

  const flow = flows[flowIdx];

  const groups = useMemo(() => {
    const m = new Map<string, { f: (typeof flows)[number]; i: number }[]>();
    flows.forEach((f, i) => {
      const list = m.get(f.group) || [];
      list.push({ f, i });
      m.set(f.group, list);
    });
    return [...m.entries()];
  }, [flows]);

  const symOptions = useMemo(() => {
    if (!code) return [];
    return [...code.SY.values()]
      .filter((s) => s.kind !== "module" && (s.fn || s.name))
      .slice(0, 400)
      .map((s) => `${s.file || ""}#${s.fn || s.name}`);
  }, [code]);

  const submitPick = () => {
    const v = pick.trim();
    if (!v) return;
    const [file, fn] = v.includes("#") ? v.split("#") : [v, undefined];
    addCustomFlow(file, fn);
    setPick("");
    setPickOpen(false);
  };

  const copyTrace = async () => {
    try {
      await navigator.clipboard.writeText(flowSteps.map((s) => `${"  ".repeat(s.depth)}${stepLabel(s)}`).join("\n"));
      toast("Trace copied");
    } catch {
      toast("The clipboard is blocked here");
    }
  };

  return (
    <>
      <div className="toolbar">
        <button
          className="btn sm primary"
          type="button"
          aria-pressed={playing}
          title="Watch the data move through the flow (Space)"
          onClick={onTogglePlay}
        >
          {playing ? "⏸ Pause data flow" : "▶ Play data flow"}
        </button>
        <button className="ib" type="button" title="Start over" onClick={onRestart}>
          Restart
        </button>
        <label className="toggle" style={{ color: "var(--ink)" }}>
          Flow
          <select
            className="jump"
            aria-label="Choose a flow"
            style={{ maxWidth: 360 }}
            value={String(flowIdx)}
            onChange={(e) => setFlowIdx(Number(e.target.value))}
          >
            {flows.length ? (
              groups.map(([g, list]) => (
                <optgroup label={g} key={g}>
                  {list.map(({ f, i }) => (
                    <option value={i} key={i}>
                      {f.name}
                    </option>
                  ))}
                </optgroup>
              ))
            ) : (
              <option>No entry points found</option>
            )}
          </select>
        </label>
        <span className="segtabs">
          <button
            type="button"
            aria-pressed={flowMode === "overview"}
            title="The big picture: the main parts and where data goes"
            onClick={() => setFlowMode("overview")}
          >
            High level
          </button>
          <button
            type="button"
            aria-pressed={flowMode === "seq"}
            title="Every call, in order"
            onClick={() => setFlowMode("seq")}
          >
            Detailed
          </button>
          <button type="button" aria-pressed={flowMode === "tree"} onClick={() => setFlowMode("tree")}>
            Call tree
          </button>
        </span>
        <button className="ib" type="button" onClick={() => controls.fitMin(flowMode === "overview" ? 0.5 : 0.8)}>
          Fit
        </button>
        <div className="zoom">
          <button className="ib" type="button" aria-label="Zoom out" onClick={() => controls.zoomBy(1 / 1.2)}>
            −
          </button>
          <span className="zval">{zoom}%</span>
          <button className="ib" type="button" aria-label="Zoom in" onClick={() => controls.zoomBy(1.2)}>
            +
          </button>
        </div>
        <select
          className="jump"
          aria-label="Playback speed"
          title="Playback speed"
          value={String(speed)}
          onChange={(e) => setSpeed(Number(e.target.value))}
        >
          <option value="0.5">0.5×</option>
          <option value="1">1×</option>
          <option value="2">2×</option>
          <option value="4">4×</option>
        </select>
        <button
          className="ib"
          type="button"
          aria-pressed={flowLive !== false}
          title="Show data moving along the wires"
          onClick={() => setFlowLive(flowLive === false)}
        >
          Live dots
        </button>
        <span className="grow" />
        <button className="ib" type="button" title="Copy the call trace as text" onClick={() => void copyTrace()}>
          Copy trace
        </button>
        <button className="ib" type="button" onClick={() => openShot("flows")} title="Save this flow as an image">
          Screenshot
        </button>
        <button
          className="ib"
          type="button"
          title="Start a trace from any file or function"
          onClick={() => setPickOpen((v) => !v)}
        >
          Trace from…
        </button>
        {flow?.custom && (
          <button className="ib" type="button" onClick={() => removeCustomFlow(flow.file || "", undefined)}>
            Remove this starting point
          </button>
        )}
        <button
          className="ib"
          type="button"
          onClick={() => {
            setSide("chat");
            setChatScope(null);
            void sendChat(
              `Walk me through the flow "${flow?.name || ""}" from start to end in plain words: what triggers it, what each file does in order, which decisions change the path, what it reads or writes, and how it ends. Point out anything that can fail without being handled.\n\nCall trace found in the code:\n${code && flow ? traceText(code, flow, flowSteps) : ""}`,
            );
          }}
        >
          Explain this flow with AI
        </button>
        <button className={`ib focusBtn${focus ? " on" : ""}`} type="button" onClick={() => setFocus(!focus)}>
          Focus
        </button>
      </div>

      {pickOpen && (
        <div className="toolbar">
          <span className="hintline" style={{ color: "var(--ink)" }}>
            Start a trace from
          </span>
          <input
            list="pfSymList"
            placeholder="file path, or path#functionName"
            aria-label="File or function to trace from"
            style={{
              flex: 1,
              minWidth: 220,
              maxWidth: 460,
              height: 28,
              border: "1px solid var(--line)",
              borderRadius: 6,
              background: "var(--surface-2)",
              padding: "0 8px",
            }}
            value={pick}
            onChange={(e) => setPick(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitPick()}
          />
          <datalist id="pfSymList">
            {symOptions.map((o) => (
              <option value={o} key={o} />
            ))}
          </datalist>
          <button className="btn sm primary" type="button" onClick={submitPick}>
            Trace
          </button>
          <button className="btn sm" type="button" disabled={busy.mapping} onClick={() => void findEntryPoints()}>
            Ask AI to find the entry points
          </button>
          <button className="btn sm ghost" type="button" onClick={() => setPickOpen(false)}>
            Close
          </button>
        </div>
      )}

      <div className="toolbar">
        <span className="hintline" style={{ color: "var(--muted)" }}>
          {flow && flowSteps.length ? infoLine(flow.name, flowSteps) : ""}
        </span>
        <span className="grow" />
        <span className="hintline">
          Traced from the code. High level groups it into parts; Detailed shows every call. Click anything for the code.
        </span>
        <button className="ib" type="button" onClick={() => setTab("overview")}>
          Project overview
        </button>
      </div>
    </>
  );
}

function infoLine(name: string, steps: FlowStep[]) {
  const real = steps.filter((s) => !s.phase);
  const files = new Set(real.filter((s) => !s.ext).map((s) => s.to));
  const exts = new Set(real.filter((s) => s.ext).map((s) => s.cat));
  return `${name} · ${real.length} step${real.length === 1 ? "" : "s"} across ${files.size} file${
    files.size === 1 ? "" : "s"
  }${exts.size ? ` · reaches ${[...exts].filter(Boolean).join(", ")}` : ""}${
    steps.length >= 160 ? " · trimmed at 160 steps" : ""
  }`;
}

/* ------------------------------ overview ------------------------------ */

function OverviewBody({ onElement }: { onElement: (el: HTMLElement | null) => void }) {
  const flow = useSkillStore((s) => s.flows[s.flowIdx]);
  const ovModel = useSkillStore((s) => s.ovModel);
  const flowLive = useSkillStore((s) => s.flowLive);
  const setFlowStep = useSkillStore((s) => s.setFlowStep);
  const flowStep = useSkillStore((s) => s.flowStep);
  const setOvSel = useSkillStore((s) => s.setOvSel);
  const ovSel = useSkillStore((s) => s.ovSel);
  const setSide = useSkillStore((s) => s.setSide);
  const setTab = useSkillStore((s) => s.setTab);
  const setActiveFile = useSkillStore((s) => s.setActiveFile);
  const files = useSkillStore((s) => s.files);
  const layerRef = useRef<HTMLDivElement | null>(null);

  const layout = useMemo(() => (ovModel && flow ? layoutOverview(flow, ovModel) : null), [ovModel, flow]);

  useEffect(() => {
    onElement(layerRef.current);
  }, [layout, onElement]);

  if (!layout || !ovModel) return null;

  const openCode = (path: string) => {
    const at = files.findIndex((f) => f.path === path);
    if (at >= 0) setActiveFile(at);
    setTab("source");
  };

  return (
    <div className="mm-layer" ref={layerRef} style={{ width: layout.W, height: layout.H }}>
      <svg className="mm-svg" width={layout.W} height={layout.H}>
        <defs>
          <marker id="arOv" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0,0L10,5L0,10z" style={{ fill: "var(--wire)" }} />
          </marker>
          <marker id="arOvOn" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0,0L10,5L0,10z" style={{ fill: "var(--step)" }} />
          </marker>
        </defs>
        {layout.edges.map((e) => {
          const to = ovModel.nodes.get(e.to);
          const cls = `ove${to && to.kind !== "code" && to.kind !== "actor" ? " ext" : ""}${
            e.resp ? " back" : ""
          }${flowStep != null && flowStep === e.first ? " lit" : ""}`;
          return (
            <g key={e.id}>
              <path id={`ove${e.id}`} className={cls} d={pathD(e.c || [])} markerEnd="url(#arOv)" />
              {flowLive !== false &&
                [0, 1].map((d) => (
                  <circle className="amb" r="3.2" key={d}>
                    <animateMotion
                      dur={`${(2.6 + (e.id % 3) * 0.4).toFixed(1)}s`}
                      begin={`${(d * 1.3 + e.id * 0.17).toFixed(2)}s`}
                      repeatCount="indefinite"
                      rotate="auto"
                    >
                      <mpath href={`#ove${e.id}`} />
                    </animateMotion>
                  </circle>
                ))}
            </g>
          );
        })}
      </svg>

      <div className="ovj" style={{ maxWidth: layout.W - 60 }}>
        <span className="k">Starts</span>
        <span className="c">{layout.journey.actor}</span>
        {layout.journey.codes.length > 0 && (
          <>
            <span className="ar">→</span>
            <span className="k">Runs through</span>
            {layout.journey.codes.slice(0, 6).map((n) => (
              <span className="c" key={n.key}>
                {n.label}
              </span>
            ))}
            {layout.journey.codes.length > 6 && <span className="c">+{layout.journey.codes.length - 6}</span>}
          </>
        )}
        {layout.journey.outs.length > 0 && (
          <>
            <span className="ar">→</span>
            <span className="k">Data goes to</span>
            {layout.journey.outs.map((n) => (
              <span className="c" key={n.key}>
                {n.label}
                {n.writes ? " · writes" : n.reads ? " · reads" : n.queries ? " · queries" : ""}
              </span>
            ))}
          </>
        )}
        {layout.journey.resp && (
          <>
            <span className="ar">→</span>
            <span className="k">Ends</span>
            <span className="c">Result sent back</span>
          </>
        )}
      </div>

      {layout.edges.map((e) => {
        const c = e.c || [];
        const mx = (c[0] + 3 * c[2] + 3 * c[4] + c[6]) / 8;
        const my = (c[1] + 3 * c[3] + 3 * c[5] + c[7]) / 8;
        const names = e.names.slice(0, 2).join(", ") + (e.names.length > 2 ? ` +${e.names.length - 2}` : "");
        return (
          <button
            type="button"
            className="ovl"
            key={e.id}
            style={{ left: mx, top: my }}
            title={e.names.join(", ") + (e.conds.length ? "\nonly if: " + e.conds.join("; ") : "")}
            onClick={() => {
              setFlowStep(e.first);
              setOvSel(null);
              setSide("details");
            }}
          >
            <span className="n">{layout.orderNum.get(e.id)}</span>
            {e.conds.length ? <span className="cond">if</span> : null}
            {names}
            {e.n > 1 ? <span className="x">×{e.n}</span> : null}
          </button>
        );
      })}

      {[...ovModel.nodes.values()].map((n) => {
        const g = layout.geo.get(n.key);
        if (!g) return null;
        const sub = nodeSub(n, flow?.name || "");
        const meta = n.kind === "code" ? `${n.files.size} file${n.files.size === 1 ? "" : "s"}` : "";
        return (
          <div
            className={`ovn ${n.kind}${ovSel === n.key ? " sel" : ""}`}
            key={n.key}
            tabIndex={0}
            role="button"
            style={
              {
                left: g.x,
                top: g.y,
                width: g.w,
                height: g.h,
                "--lc": n.color,
              } as React.CSSProperties
            }
            onClick={(ev) => {
              if ((ev.target as HTMLElement).closest("button")) return;
              setOvSel(n.key);
              setFlowStep(-1);
              setSide("details");
            }}
            onDoubleClick={() => {
              const p = [...n.files][0];
              if (p) openCode(p);
            }}
          >
            <div className="ovn-h">
              <span dangerouslySetInnerHTML={{ __html: n.icon }} />
              <b title={n.label}>{n.label}</b>
              {meta ? <span className="meta">{meta}</span> : null}
            </div>
            <span className="tag">{n.tag}</span>
            <span className="fns" title={sub}>
              {sub}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function nodeSub(n: OvNode, flowName: string): string {
  if (n.kind === "actor") return flowName;
  if (n.kind === "code")
    return (
      n.fns.slice(0, 3).join(", ") + (n.fns.length > 3 ? ` +${n.fns.length - 3}` : "") ||
      [...n.files].map((f) => f.split("/").pop()).join(", ")
    );
  const bits = [
    n.writes ? `${n.writes} write${n.writes === 1 ? "" : "s"}` : "",
    n.reads ? `${n.reads} read${n.reads === 1 ? "" : "s"}` : "",
    n.queries ? `${n.queries} quer${n.queries === 1 ? "y" : "ies"}` : "",
    n.calls ? `${n.calls} call${n.calls === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  const kinds = [...new Set(n.items.map((x) => x[1].split(" · ")[1]))].slice(0, 2).join(", ");
  return bits.join(" · ") + (kinds ? " — " + kinds : "");
}

/* ------------------------------ sequence ------------------------------ */

function SequenceBody({ onElement }: { onElement: (el: HTMLElement | null) => void }) {
  const steps = useSkillStore((s) => s.flowSteps);
  const flow = useSkillStore((s) => s.flows[s.flowIdx]);
  const flowStep = useSkillStore((s) => s.flowStep);
  const setFlowStep = useSkillStore((s) => s.setFlowStep);
  const setSide = useSkillStore((s) => s.setSide);
  const setTab = useSkillStore((s) => s.setTab);
  const setActiveFile = useSkillStore((s) => s.setActiveFile);
  const files = useSkillStore((s) => s.files);
  const model = useSkillStore((s) => s.model);
  const layerRef = useRef<HTMLDivElement | null>(null);

  const parts = useMemo(() => {
    const list = ["actor"];
    steps
      .filter((s) => !s.phase)
      .forEach((s) => {
        [s.from, s.to].forEach((p) => {
          if (!list.includes(p)) list.push(p);
        });
      });
    return list;
  }, [steps]);

  const LW = 160;
  const X0 = 24;
  const Y0 = 92;
  const RH = 44;
  const order = useMemo(
    () => [
      "actor",
      ...parts.filter((p) => p !== "actor" && !p.startsWith("ext:")),
      ...parts.filter((p) => p.startsWith("ext:")),
    ],
    [parts],
  );
  const col = useMemo(() => new Map(order.map((p, i) => [p, X0 + i * LW + LW / 2])), [order]);
  const W = X0 * 2 + order.length * LW;
  const H = Y0 + steps.length * RH + 50;

  useEffect(() => {
    onElement(layerRef.current);
  }, [onElement, steps, W, H]);

  const openFile = (path: string) => {
    const at = files.findIndex((f) => f.path === path);
    if (at >= 0) setActiveFile(at);
    setTab("source");
  };

  return (
    <div className="mm-layer" ref={layerRef} style={{ width: W, height: H }}>
      <svg className="mm-svg" width={W} height={H}>
        <defs>
          <marker id="arSeq" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0,0L10,5L0,10z" style={{ fill: "var(--ink)" }} />
          </marker>
          <marker id="arSeqX" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0,0L10,5L0,10z" style={{ fill: "var(--muted)" }} />
          </marker>
        </defs>
        {order.map((p) => (
          <path key={p} className="lifeline" d={`M${col.get(p)},${Y0 - 20} L${col.get(p)},${H - 20}`} />
        ))}
        {steps.map((s, i) => {
          const y = Y0 + i * RH + 18;
          const a = col.get(s.from);
          const b = col.get(s.to);
          if (s.phase) return <path key={i} className="phase-rule" d={`M${X0},${y + 4} L${W - X0},${y + 4}`} />;
          if (a == null || b == null) return null;
          const d =
            a === b
              ? `M${a},${y - 6} C${a + 56},${y - 10} ${a + 56},${y + 16} ${a + 4},${y + 12}`
              : `M${a},${y} L${b + (b > a ? -4 : 4)},${y}`;
          return (
            <path
              key={i}
              className={`msg${s.ext ? " ext" : ""}${flowStep === i ? " on" : ""}`}
              d={d}
              markerEnd={`url(#${s.ext ? "arSeqX" : "arSeq"})`}
            />
          );
        })}
      </svg>

      {order.map((p) => {
        const x = (col.get(p) as number) - LW / 2 + 8;
        const w = LW - 16;
        if (p === "actor")
          return (
            <div className="lane actor" key={p} style={{ left: x, width: w, top: 24 }}>
              <b>{flow?.actor}</b>
              <span>{flow?.route ? `${flow.route.method} ${flow.route.path}` : ""}</span>
            </div>
          );
        if (p.startsWith("ext:")) {
          const cat = p.slice(4);
          return (
            <div
              className="lane ext"
              key={p}
              style={{ left: x, width: w, top: 24, "--lc": CAT_COLOR[cat] || "var(--wire)" } as React.CSSProperties}
            >
              <b>{cat}</b>
              <span>
                {[...new Set(steps.filter((s) => s.to === p).map((s) => (s.toName || "").split(".")[0]))]
                  .slice(0, 3)
                  .join(", ")}
              </span>
            </div>
          );
        }
        const c = compOfPath(model.components || [], p);
        return (
          <div
            className="lane file"
            key={p}
            title={`Open ${p}`}
            style={
              {
                left: x,
                width: w,
                top: 24,
                "--lc": c ? KIND_COLOR[c.kind] || "var(--wire)" : "var(--wire)",
              } as React.CSSProperties
            }
            onClick={() => openFile(p)}
          >
            <b>{p.split("/").pop()}</b>
            <span>
              {dirOf(p) || "project root"}
              {c ? " · " + c.name : ""}
            </span>
          </div>
        );
      })}

      {steps.map((s, i) => {
        const y = Y0 + i * RH + 18;
        const a = col.get(s.from);
        const b = col.get(s.to);
        if (s.phase)
          return (
            <div className="phase" key={i} style={{ left: X0, top: y - 16 }}>
              <b>{s.title}</b>
              <span>{s.sub}</span>
            </div>
          );
        if (a == null || b == null) return null;
        const lx = a === b ? a + 14 : Math.min(a, b) + 10;
        const lw = a === b ? LW - 30 : Math.abs(b - a) - 20;
        return (
          <button
            type="button"
            className={`msgl${flowStep === i ? " on" : ""}${s.ext ? " ext" : ""}`}
            key={i}
            style={{ left: lx, top: y - 22, maxWidth: Math.max(120, lw) }}
            onClick={() => {
              setFlowStep(i);
              setSide("details");
            }}
          >
            <span className="n">{steps.slice(0, i + 1).filter((x) => !x.phase).length}</span>
            {s.cond ? <span className="cond">{s.cond}</span> : null}
            {stepLabel(s)}
            {s.recursive ? " ↺" : ""}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------ call tree ------------------------------ */

function TreeBody({ onElement }: { onElement: (el: HTMLElement | null) => void }) {
  const steps = useSkillStore((s) => s.flowSteps);
  const flowStep = useSkillStore((s) => s.flowStep);
  const setFlowStep = useSkillStore((s) => s.setFlowStep);
  const setSide = useSkillStore((s) => s.setSide);
  const listRef = useRef<HTMLOListElement | null>(null);

  useEffect(() => {
    onElement(listRef.current);
  }, [onElement, steps]);

  useEffect(() => {
    if (flowStep == null || flowStep < 0) return;
    const el = listRef.current?.querySelector(`[data-fstep="${flowStep}"]`);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [flowStep]);

  let num = 0;
  return (
    <div className="scroll pf-tree">
      <ol className="ftree" ref={listRef}>
        {steps.map((s, i) => {
          if (s.phase)
            return (
              <li className="phase-li" key={i}>
                <b>{s.title}</b> <span>{s.sub}</span>
              </li>
            );
          num++;
          const n = num;
          return (
            <li key={i} style={{ "--d": s.depth } as React.CSSProperties} className={s.ext ? "ext" : ""}>
              <button
                type="button"
                data-fstep={i}
                className={flowStep === i ? "on" : ""}
                onClick={() => {
                  setFlowStep(i);
                  setSide("details");
                }}
              >
                <span className="n">{n}</span>
                {s.cond ? <span className="cond">{s.cond}</span> : null}
                <b>{stepLabel(s)}</b>
                {s.ext ? (
                  <span
                    className="cat"
                    style={{ "--lc": CAT_COLOR[s.cat || ""] || "var(--wire)" } as React.CSSProperties}
                  >
                    {s.cat}
                  </span>
                ) : (
                  <span className="where mono">{s.to}</span>
                )}
                {s.recursive ? <span className="where">already shown above</span> : null}
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/* ------------------------------ player ------------------------------ */

function Player({ playing, idx }: { playing: boolean; idx: number }) {
  const steps = useSkillStore((s) => s.flowSteps);
  const flow = useSkillStore((s) => s.flows[s.flowIdx]);

  const total = steps.filter((s) => !s.phase).length;
  const done = !playing && idx >= steps.length;
  const k = steps.slice(0, Math.max(0, idx)).filter((s) => !s.phase).length;

  let msg: React.ReactNode = "";
  const s = steps[idx];
  if (playing && s) {
    if (s.phase)
      msg = (
        <>
          <b>Next: {s.title}</b> <span style={{ color: "var(--muted)" }}>{s.sub}</span>
        </>
      );
    else if (s.entry)
      msg = (
        <>
          <b>{flow?.actor}</b> starts the flow: <code>{s.text}</code> enters <b>{partLabel(s.to, flow?.name)}</b>
        </>
      );
    else {
      const v = fpVerb(s);
      msg = (
        <>
          <b>{partLabel(s.from, flow?.name)}</b> {v}{" "}
          <b>{s.cat === "Response to caller" ? flow?.actor : s.ext ? s.cat : partLabel(s.to, flow?.name)}</b>:{" "}
          <code>{ovFn(s)}</code>
          {s.cond ? (
            <span className="cond">
              {/^(if|for|while|else|switch|case|try|catch)\b/.test(s.cond) ? "" : "when "}
              {s.cond}
            </span>
          ) : null}
        </>
      );
    }
  }

  const finish = done ? finishText(steps, flow?.name || "") : null;

  return (
    <div className="fcap" aria-live="polite" hidden={!playing && !done}>
      <span className="n">{done ? "Done" : `${k}/${total}`}</span>
      <span className="txt">{done ? finish : msg}</span>
      <span className="grow" />
      <span className="bar">
        <i style={{ width: `${Math.round(((done ? total : k) / Math.max(1, total)) * 100)}%` }} />
      </span>
    </div>
  );
}

function partLabel(path: string, flowName: string): string {
  if (path === "actor") return flowName;
  if (path.startsWith("ext:")) return path.slice(4);
  return path.split("/").pop() || path;
}

function finishText(steps: FlowStep[], flowName: string): React.ReactNode {
  const real = steps.filter((s) => !s.phase);
  const files = [...new Set(real.filter((s) => !s.ext && s.to !== "actor").map((s) => s.to))];
  const outs = new Map<string, Set<string>>();
  real
    .filter((s) => s.ext && !OV_HIDE.has(s.cat || "") && s.cat !== "Response to caller")
    .forEach((s) => {
      const v = fpVerb(s);
      const set = outs.get(s.cat || "") || new Set<string>();
      set.add(v);
      outs.set(s.cat || "", set);
    });
  const PAST: Record<string, string> = {
    "writes to": "wrote to",
    "reads from": "read from",
    queries: "queried",
    "sends a request to": "called",
    "reads settings from": "read settings from",
    uses: "used",
    calls: "called",
  };
  const outList = [...outs.entries()].map(([c, vs]) => `${[...vs].map((v) => PAST[v] || v).join(" and ")} ${c}`);
  const outTxt =
    outList.length > 1 ? outList.slice(0, -1).join(", ") + " and " + outList[outList.length - 1] : outList.join("");
  return (
    <>
      Started at <b>{flowName}</b>, passed through {files.length} file{files.length === 1 ? "" : "s"} in {real.length}{" "}
      step{real.length === 1 ? "" : "s"}
      {outTxt ? `; it ${outTxt}` : ""}
      {real.some((s) => s.cat === "Response to caller") ? ", then sent the result back" : ""}.
    </>
  );
}

/* ------------------------------ root ------------------------------ */

export function FlowsView({ onElement }: { onElement: (el: HTMLElement | null) => void }) {
  const flows = useSkillStore((s) => s.flows);
  const flowMode = useSkillStore((s) => s.flowMode);
  const flowSteps = useSkillStore((s) => s.flowSteps);
  const flowIdx = useSkillStore((s) => s.flowIdx);
  const setFlowStep = useSkillStore((s) => s.setFlowStep);
  const ovModel = useSkillStore((s) => s.ovModel);
  const { vpRef, innerRef, zoom, controls } = useViewport();
  const [playing, setPlaying] = useState(false);
  const [idx, setIdx] = useState(-1);
  const [speed, setSpeed] = useState(1);

  const step = flowSteps[idx];
  const playing2 = playing && idx < flowSteps.length && !!step;

  const togglePlay = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (idx >= flowSteps.length) {
      setIdx(-1);
      setFlowStep(-1);
    }
    setPlaying(true);
  };
  const restart = () => {
    setPlaying(false);
    setIdx(-1);
    setFlowStep(-1);
  };

  // Fit whenever the flow, mode or layout size changes. The diagram's size can change for a
  // frame or two while the SVG and fonts settle, so keep an eye on the layer and re-fit until
  // it stops changing. Overview fits the whole shape; the sequence fits its width so the
  // starting actor is never clipped.
  useEffect(() => {
    if (flowMode === "tree") return;
    const apply = () => (flowMode === "overview" ? controls.fitMin(0.5) : controls.fit("width"));
    let last = "";
    const run = () => {
      const inner = innerRef.current;
      if (!inner) return;
      const key = `${inner.offsetWidth}x${inner.offsetHeight}`;
      if (!inner.offsetWidth || key === last) return;
      last = key;
      apply();
    };
    const ids = [0, 90, 320].map((d) => window.setTimeout(run, d));
    const inner = innerRef.current;
    const ro = inner && typeof ResizeObserver !== "undefined" ? new ResizeObserver(run) : null;
    if (inner && ro) ro.observe(inner);
    const onResize = () => {
      last = "";
      window.setTimeout(run, 120);
    };
    window.addEventListener("resize", onResize);
    return () => {
      ids.forEach((id) => window.clearTimeout(id));
      ro?.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, [flowIdx, flowMode, flowSteps.length, ovModel, controls, innerRef]);

  // Highlight the current step as the player advances.
  useEffect(() => {
    if (idx < 0) return;
    setFlowStep(idx >= flowSteps.length ? -1 : idx);
  }, [idx, flowSteps.length, setFlowStep]);

  // Advance the player on a timer.
  useEffect(() => {
    if (!playing) return;
    if (idx >= flowSteps.length) {
      setPlaying(false);
      return;
    }
    const s = flowSteps[idx];
    const sp = speed;
    const wait = s?.phase ? 900 / sp : flowMode === "tree" ? 700 / sp : flowMode === "overview" ? 1620 / sp : 1070 / sp;
    const t = window.setTimeout(() => setIdx((i) => i + 1), wait);
    return () => window.clearTimeout(t);
  }, [playing, idx, flowSteps, flowMode, speed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest("input,textarea,select,button")) return;
      if (e.key === " ") {
        e.preventDefault();
        if (playing) setPlaying(false);
        else {
          if (idx >= flowSteps.length) setIdx(-1);
          setPlaying(true);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [playing, idx, flowSteps.length]);

  const toolbar = (
    <Toolbar
      playing={playing}
      onTogglePlay={togglePlay}
      onRestart={restart}
      speed={speed}
      setSpeed={setSpeed}
      zoom={zoom}
      controls={controls}
    />
  );

  if (!flows.length) {
    return (
      <div id="view-flows">
        {toolbar}
        <p className="empty" style={{ padding: 24 }}>
          No entry points were found in the code. Map with AI, or check that the project&apos;s main files are included.
        </p>
      </div>
    );
  }

  return (
    <div id="view-flows">
      {toolbar}
      <Player playing={playing2} idx={idx} />

      <div className="viewport" ref={vpRef}>
        <div className="vp-inner" ref={innerRef}>
          {flowMode === "overview" ? <OverviewBody onElement={onElement} /> : null}
          {flowMode === "seq" ? <SequenceBody onElement={onElement} /> : null}
        </div>
      </div>
      {flowMode === "tree" ? <TreeBody onElement={onElement} /> : null}
    </div>
  );
}
