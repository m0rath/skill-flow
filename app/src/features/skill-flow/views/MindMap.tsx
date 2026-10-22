import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import { flaggedIds } from "@/model/checks";
import { ordered } from "@/model/normalize";
import type { FlowNode, Model } from "@/model/types";
import { useSkillStore } from "@/features/skill-flow/store";
import { useViewport } from "@/features/skill-flow/viewport";

const COLW = 240;
const ROW = 50;

interface MM {
  key: string;
  label: string;
  kind: string;
  id?: string;
  num?: string;
  implied?: boolean;
  children: MM[];
  side?: number;
  ax: number;
  ay: number;
  x: number;
  y: number;
  leaves: number;
  parent?: MM | null;
  w?: number;
  h?: number;
}

function buildLayout(
  model: Model,
  opts: { out: boolean; use: boolean; flow: boolean },
  mmPos: Record<string, { x: number; y: number }>,
): { list: MM[]; byKey: Map<string, MM>; ox: number; oy: number; width: number; height: number } {
  const root: MM = { key: "root", label: model.title, kind: "root", children: [], ax: 0, ay: 0, x: 0, y: 0, leaves: 0 };
  const add = (parent: MM, n: FlowNode) => {
    const mm: MM = {
      key: "n:" + n.num,
      id: n.id,
      num: n.num,
      label: n.kind === "decision" ? n.question || n.title : n.title,
      kind: n.kind,
      children: [],
      ax: 0,
      ay: 0,
      x: 0,
      y: 0,
      leaves: 0,
    };
    parent.children.push(mm);
    if (n.branches)
      n.branches.forEach((b) => {
        const bn: MM = {
          key: "b:" + n.num + ":" + b.label,
          id: n.id,
          label: b.label + (b.steps.length ? "" : b.implied ? " · not described" : " · continue"),
          kind: "branch",
          implied: b.implied,
          children: [],
          ax: 0,
          ay: 0,
          x: 0,
          y: 0,
          leaves: 0,
        };
        mm.children.push(bn);
        b.steps.forEach((s) => add(bn, s));
      });
    if (n.steps) n.steps.forEach((s) => add(mm, s));
    if (opts.out)
      n.creates.forEach((c) => {
        mm.children.push({
          key: "o:" + n.num + ":" + c.name,
          id: n.id,
          label: c.name,
          kind: "out",
          children: [],
          ax: 0,
          ay: 0,
          x: 0,
          y: 0,
          leaves: 0,
        });
      });
    if (opts.use)
      n.uses.forEach((u) => {
        mm.children.push({
          key: "u:" + n.num + ":" + u,
          id: n.id,
          label: u,
          kind: "use",
          children: [],
          ax: 0,
          ay: 0,
          x: 0,
          y: 0,
          leaves: 0,
        });
      });
  };
  model.steps.forEach((n) => add(root, n));

  const leaves = (m: MM): number => (m.leaves = m.children.length ? m.children.reduce((a, c) => a + leaves(c), 0) : 1);
  leaves(root);
  const total = root.leaves;
  let acc = 0;
  root.children.forEach((c) => {
    c.side = acc < total / 2 ? 1 : -1;
    acc += c.leaves;
  });
  const place = (m: MM, depth: number, side: number, y0: number) => {
    m.side = side;
    m.ax = side * depth * COLW;
    m.ay = y0 + (m.leaves * ROW) / 2;
    let y = y0;
    m.children.forEach((c) => {
      place(c, depth + 1, side, y);
      y += c.leaves * ROW;
    });
  };
  [1, -1].forEach((side) => {
    const kids = root.children.filter((c) => c.side === side);
    const h = kids.reduce((a, c) => a + c.leaves, 0) * ROW;
    let y = -h / 2;
    kids.forEach((c) => {
      place(c, 1, side, y);
      y += c.leaves * ROW;
    });
  });
  root.ax = 0;
  root.ay = 0;
  root.side = 1;

  const list: MM[] = [];
  (function w(m: MM, parent: MM | null) {
    m.parent = parent;
    list.push(m);
    m.children.forEach((c) => w(c, m));
  })(root, null);

  list.forEach((m) => {
    const p = mmPos[m.key];
    m.x = p ? p.x : m.ax;
    m.y = p ? p.y : m.ay;
  });

  const xs = list.map((m) => m.x);
  const ys = list.map((m) => m.y);
  const minX = Math.min(...xs) - 180;
  const minY = Math.min(...ys) - 60;
  const maxX = Math.max(...xs) + 180;
  const maxY = Math.max(...ys) + 60;
  return {
    list,
    byKey: new Map(list.map((m) => [m.key, m])),
    ox: -minX,
    oy: -minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function dataFlows() {
  const res: { from: FlowNode; to: FlowNode; name: string }[] = [];
  const seen = new Set<string>();
  const nodes = ordered();
  nodes.forEach((p) =>
    p.creates.forEach((c) => {
      const nm = c.name.toLowerCase();
      const base = nm.split("/").pop() || nm;
      nodes.forEach((q) => {
        if (q === p) return;
        const hay = (q.uses.join(" ") + " " + q.source + " " + q.detail).toLowerCase();
        if (q.uses.some((u) => u.toLowerCase() === nm) || (base.length > 5 && hay.includes(base))) {
          const k = p.id + ">" + q.id;
          if (!seen.has(k)) {
            seen.add(k);
            res.push({ from: p, to: q, name: c.name });
          }
        }
      });
    }),
  );
  return res;
}

function edgePt(m: MM, ox: number, oy: number, toward: { x: number; y: number }) {
  const cx = m.x + ox;
  const cy = m.y + oy;
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  const w = m.w || 120;
  const h = m.h || 28;
  const s = Math.min((w / 2 + 4) / Math.abs(dx || 1e-6), (h / 2 + 4) / Math.abs(dy || 1e-6));
  return { x: cx + dx * s, y: cy + dy * s };
}

function curve(a: { x: number; y: number }, b: { x: number; y: number }) {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const off = Math.min(60, len * 0.2);
  const cx = mx - (dy / len) * off;
  const cy = my + (dx / len) * off;
  return {
    d: `M${a.x},${a.y} Q${cx},${cy} ${b.x},${b.y}`,
    mid: { x: (a.x + 2 * cx + b.x) / 4, y: (a.y + 2 * cy + b.y) / 4 },
  };
}

type DragState =
  | { type: "drag"; key: string; sx: number; sy: number; ox: number; oy: number; moved: boolean }
  | { type: "link"; fromKey: string; to: { x: number; y: number } | null }
  | null;

export function MindMap({ onElement }: { onElement?: (el: HTMLElement | null) => void }) {
  const model = useSkillStore((s) => s.model);
  const files = useSkillStore((s) => s.files);
  const sugg = useSkillStore((s) => s.sugg);
  const sel = useSkillStore((s) => s.sel);
  const links = useSkillStore((s) => s.links);
  const mmPos = useSkillStore((s) => s.mmPos);
  const mmOpts = useSkillStore((s) => s.mmOpts);
  const mmLink = useSkillStore((s) => s.mmLink);
  const exportMode = useSkillStore((s) => s.exportMode);
  const select = useSkillStore((s) => s.select);
  const addLink = useSkillStore((s) => s.addLink);
  const selectLink = useSkillStore((s) => s.selectLink);
  const setLinkLabel = useSkillStore((s) => s.setLinkLabel);
  const removeLink = useSkillStore((s) => s.removeLink);
  const setMmOpt = useSkillStore((s) => s.setMmOpt);
  const setMmPos = useSkillStore((s) => s.setMmPos);
  const resetMmPositions = useSkillStore((s) => s.resetMmPositions);
  const openShot = useSkillStore((s) => s.openShot);
  const setFocus = useSkillStore((s) => s.setFocus);
  const setChatScope = useSkillStore((s) => s.setChatScope);
  const sendChat = useSkillStore((s) => s.sendChat);

  const { vpRef, innerRef, zoom, controls } = useViewport({ max: 2.5, min: 0.2 });
  const [drag, setDrag] = useState<DragState>(null);
  const [metrics, setMetrics] = useState<Record<string, { w: number; h: number }>>({});
  const layerRef = useRef<HTMLDivElement | null>(null);
  const fitted = useRef(false);

  const layout = useMemo(() => buildLayout(model, mmOpts, mmPos), [model, mmOpts, mmPos]);
  const { list, byKey, ox, oy, width, height } = layout;

  const flags = useMemo(
    () => flaggedIds({ files, model, dismissed: sugg.dismissed, claude: sugg.claude }),
    [files, model, sugg],
  );
  const showFlags = exportMode ? exportMode.flags : true;

  useEffect(() => {
    onElement?.(innerRef.current);
  }, [onElement, innerRef]);

  // Measure node boxes after every layout change so edges can meet the right edges of the boxes.
  useLayoutEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    const next: Record<string, { w: number; h: number }> = {};
    let changed = false;
    layer.querySelectorAll<HTMLElement>(".mm-node").forEach((el) => {
      const key = el.dataset.key || "";
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      next[key] = { w, h };
      const prev = metrics[key];
      if (!prev || prev.w !== w || prev.h !== h) changed = true;
    });
    if (changed) setMetrics(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, mmOpts, exportMode]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      if (!fitted.current) {
        fitted.current = true;
        controls.fitMin(0.6, layerRef.current?.querySelector('[data-key="root"]') as HTMLElement | null);
      }
    }, 60);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model]);

  const mmName = useCallback(
    (key: string) => {
      const m = byKey.get(key);
      if (!m) return key;
      return (m.num ? m.num + " " : "") + m.label;
    },
    [byKey],
  );

  const pos = (m: MM) => {
    if (drag?.type === "drag" && drag.key === m.key) return { x: m.x, y: m.y };
    return { x: m.x, y: m.y };
  };

  const edges = useMemo(() => {
    const parts: ReactNode[] = [];
    list.forEach((m) => {
      if (!m.parent) return;
      const p = m.parent;
      const mt = metrics[m.key];
      const pt = metrics[p.key];
      if (!mt || !pt) return;
      const side = m.x >= p.x ? 1 : -1;
      const a = { x: p.x + ox + (side * pt.w) / 2, y: p.y + oy };
      const b = { x: m.x + ox - (side * mt.w) / 2, y: m.y + oy };
      const dx = (b.x - a.x) / 2;
      parts.push(
        <path
          key={`t-${m.key}`}
          className="t"
          d={`M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`}
        />,
      );
    });
    if (mmOpts.flow && !exportMode) {
      dataFlows().forEach((f, i) => {
        const from = byKey.get("o:" + f.from.num + ":" + f.name) || byKey.get("n:" + f.from.num);
        const to = byKey.get("n:" + f.to.num);
        if (!from || !to || !metrics[from.key] || !metrics[to.key]) return;
        const a = edgePt(from, ox, oy, { x: to.x + ox, y: to.y + oy });
        const b = edgePt(to, ox, oy, { x: from.x + ox, y: from.y + oy });
        parts.push(<path key={`df-${i}`} className="df" d={curve(a, b).d} markerEnd="url(#arDf)" />);
      });
    }
    links.forEach((l, i) => {
      const from = byKey.get(l.from);
      const to = byKey.get(l.to);
      if (!from || !to || !metrics[from.key] || !metrics[to.key]) return;
      const a = edgePt(from, ox, oy, { x: to.x + ox, y: to.y + oy });
      const b = edgePt(to, ox, oy, { x: from.x + ox, y: from.y + oy });
      const c = curve(a, b);
      parts.push(
        <path key={`ul-${i}`} className={`ul${mmLink === i ? " sel" : ""}`} d={c.d} markerEnd="url(#arUl)" />,
        <path key={`hit-${i}`} className="hit" data-link={i} d={c.d} onClick={() => selectLink(i)} />,
      );
    });
    return parts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, metrics, mmOpts.flow, exportMode, links, mmLink, ox, oy, byKey]);

  const chipPositions = useMemo(
    () =>
      links
        .map((l, i) => {
          const from = byKey.get(l.from);
          const to = byKey.get(l.to);
          if (!from || !to || !metrics[from.key] || !metrics[to.key]) return null;
          const a = edgePt(from, ox, oy, { x: to.x + ox, y: to.y + oy });
          const b = edgePt(to, ox, oy, { x: from.x + ox, y: from.y + oy });
          return { i, mid: curve(a, b).mid };
        })
        .filter(Boolean) as { i: number; mid: { x: number; y: number } }[],
    [links, byKey, metrics, ox, oy],
  );

  // --- pointer interactions on the layer ---
  const onPointerDown = (e: ReactPointerEvent) => {
    const target = e.target as HTMLElement;
    const dot = target.closest("[data-dot]") as HTMLElement | null;
    const nodeEl = target.closest(".mm-node") as HTMLElement | null;
    if (!nodeEl && !dot) return;
    e.stopPropagation();
    const key = (dot || nodeEl)!.dataset.key || "";
    const m = byKey.get(key);
    if (!m) return;
    layerRef.current?.setPointerCapture(e.pointerId);
    if (dot) {
      setDrag({ type: "link", fromKey: key, to: null });
    } else {
      setDrag({ type: "drag", key, sx: e.clientX, sy: e.clientY, ox: m.x, oy: m.y, moved: false });
    }
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    if (!drag) return;
    if (drag.type === "drag") {
      const k = controls.getTransform().k;
      const dx = (e.clientX - drag.sx) / k;
      const dy = (e.clientY - drag.sy) / k;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      const m = byKey.get(drag.key);
      if (!m) return;
      m.x = drag.ox + dx;
      m.y = drag.oy + dy;
      setDrag({ ...drag, moved: true });
      const el = layerRef.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(drag.key)}"]`);
      if (el) {
        el.style.left = m.x + ox + "px";
        el.style.top = m.y + oy + "px";
      }
    } else {
      setDrag({ ...drag, to: controls.toLayer(e.clientX, e.clientY) });
    }
  };

  const onPointerUp = (e: ReactPointerEvent) => {
    if (!drag) return;
    const d = drag;
    setDrag(null);
    if (d.type === "drag") {
      const m = byKey.get(d.key);
      if (d.moved && m) {
        setMmPos(d.key, { x: m.x, y: m.y });
      } else if (m?.id) {
        select(m.id);
      }
    } else {
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest(".mm-node") as HTMLElement | null;
      if (el && el.dataset.key && el.dataset.key !== d.fromKey) addLink(d.fromKey, el.dataset.key);
    }
  };

  const link = mmLink != null ? links[mmLink] : null;

  return (
    <>
      <div className="toolbar">
        <button className="ib" type="button" onClick={() => controls.fit("all")}>
          Fit
        </button>
        <div className="zoom">
          <button className="ib" type="button" aria-label="Zoom out" onClick={() => controls.zoomBy(1 / 1.2)}>
            −
          </button>
          <span className="zval" title="Ctrl + scroll to zoom">
            {zoom}%
          </span>
          <button className="ib" type="button" aria-label="Zoom in" onClick={() => controls.zoomBy(1.2)}>
            +
          </button>
        </div>
        <span className="sep" />
        <button className="ib" type="button" aria-pressed={mmOpts.out} onClick={() => setMmOpt("out", !mmOpts.out)}>
          Outputs
        </button>
        <button className="ib" type="button" aria-pressed={mmOpts.use} onClick={() => setMmOpt("use", !mmOpts.use)}>
          Tools &amp; files
        </button>
        <button className="ib" type="button" aria-pressed={mmOpts.flow} onClick={() => setMmOpt("flow", !mmOpts.flow)}>
          Data links
        </button>
        <button
          className="ib"
          type="button"
          title="Put every box back in its automatic position"
          onClick={() => {
            resetMmPositions();
            controls.fitMin(0.6, layerRef.current?.querySelector('[data-key="root"]') as HTMLElement | null);
          }}
        >
          Reset layout
        </button>
        <span className="grow" />
        <button
          className="ib"
          type="button"
          disabled={!links.length}
          onClick={() => {
            if (!links.length) return;
            setChatScope(null);
            useSkillStore.getState().setSide("chat");
            void sendChat(
              "I drew these connections in the mind map:\n" +
                links.map((l) => `- ${mmName(l.from)} → ${mmName(l.to)}${l.label ? ` (${l.label})` : ""}`).join("\n") +
                "\nExplain how each pair is related, whether the file states it clearly, and what is missing.",
            );
          }}
        >
          Ask AI about my links
        </button>
        <button
          className="ib shotBtn"
          type="button"
          title="Save the mind map as PNG or JPEG"
          onClick={() => openShot("mindmap")}
        >
          Screenshot
        </button>
        <button className="ib focusBtn" type="button" onClick={() => setFocus(true)}>
          Focus
        </button>
      </div>
      <div className="toolbar">
        <div className="legend">
          <span>
            <i style={{ borderColor: "var(--wire)" }} />
            Structure
          </span>
          <span>
            <i style={{ borderColor: "var(--make)", borderTopStyle: "dashed" }} />
            Data passes (auto)
          </span>
          <span>
            <i style={{ borderColor: "var(--link)", borderTopWidth: 3 }} />
            Your links
          </span>
        </div>
        <span className="grow" />
        <span className="hintline">
          Scroll to pan, Ctrl + scroll to zoom. Drag boxes to arrange. Drag from a pink dot onto another box to connect
          them.
        </span>
      </div>
      {link && (
        <div className="linkbar">
          <strong>Link</strong>
          <span>{`${mmName(link.from)} → ${mmName(link.to)}`}</span>
          <input
            type="text"
            placeholder="Label, e.g. needs output of"
            aria-label="Link label"
            value={link.label || ""}
            onChange={(e) => setLinkLabel(mmLink as number, e.target.value)}
          />
          <button
            className="btn sm"
            type="button"
            onClick={() => {
              setChatScope(null);
              useSkillStore.getState().setSide("chat");
              void sendChat(
                `In the mind map I connected "${mmName(link.from)}" to "${mmName(link.to)}"${link.label ? ` with the label "${link.label}"` : ""}. How are these related in the workflow? Is this dependency stated clearly in the file, and is anything missing?`,
              );
            }}
          >
            Ask AI
          </button>
          <button className="btn sm" type="button" onClick={() => removeLink(mmLink as number)}>
            Delete
          </button>
          <button className="btn sm ghost" type="button" onClick={() => selectLink(null)}>
            Done
          </button>
        </div>
      )}
      <div className="viewport" ref={vpRef}>
        <div className="vp-inner" ref={innerRef} style={{ width: width + 40, height: height + 40 }}>
          <div
            className="mm-layer"
            ref={layerRef}
            style={{ width, height, position: "relative" }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <svg className="mm-svg" width={width} height={height}>
              <defs>
                <marker id="arDf" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                  <path d="M0,0L10,5L0,10z" />
                </marker>
                <marker id="arUl" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                  <path d="M0,0L10,5L0,10z" />
                </marker>
              </defs>
              {edges}
              {drag?.type === "link" && drag.to && (
                <path
                  className="tmp"
                  d={`M${(byKey.get(drag.fromKey)?.x || 0) + ox},${(byKey.get(drag.fromKey)?.y || 0) + oy} L${drag.to.x},${drag.to.y}`}
                />
              )}
            </svg>
            {list.map((m) => {
              const cls = [
                "mm-node",
                m.kind,
                m.implied ? "implied" : "",
                m.id && sel === m.id && !["out", "use", "branch"].includes(m.kind) ? "sel" : "",
                drag?.type === "link" && drag.fromKey === m.key ? "linksrc" : "",
              ]
                .filter(Boolean)
                .join(" ");
              const p = pos(m);
              return (
                <div
                  key={m.key}
                  className={cls}
                  data-key={m.key}
                  style={{ left: p.x + ox, top: p.y + oy }}
                  role={m.id ? "button" : undefined}
                  tabIndex={m.id ? 0 : undefined}
                  aria-pressed={m.id ? sel === m.id : undefined}
                  aria-label={m.id ? `${m.num ? m.num + ". " : ""}${m.label}` : undefined}
                  onKeyDown={
                    m.id
                      ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            select(m.id as string);
                          }
                        }
                      : undefined
                  }
                >
                  {m.num ? <span className="num">{m.num}</span> : null}
                  {m.label}
                  {m.id && showFlags && flags.has(m.id) && m.key.startsWith("n:") ? (
                    <span style={{ color: "var(--danger)", fontWeight: 700 }}> !</span>
                  ) : null}
                  <span
                    className={`dot ${(m.side ?? 1) < 0 ? "l" : "r"}`}
                    data-dot={m.key}
                    title="Drag to another box to connect"
                  />
                </div>
              );
            })}
            {chipPositions.map(({ i, mid }) => (
              <div
                key={`chip-${i}`}
                className={`mm-lchip${mmLink === i ? " sel" : ""}`}
                data-link={i}
                style={{ left: mid.x, top: mid.y }}
                role="button"
                tabIndex={0}
                aria-pressed={mmLink === i}
                aria-label={`Edit link: ${links[i].label || `${mmName(links[i].from)} to ${mmName(links[i].to)}`}`}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    selectLink(i);
                  }
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  selectLink(i);
                }}
              >
                {links[i].label || "link"}
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
