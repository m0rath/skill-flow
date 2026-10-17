import { useEffect, useMemo } from "react";

import { useSkillStore } from "@/features/skill-flow/store";
import { useViewport } from "@/features/skill-flow/viewport";
import { archGraph, layoutArch } from "@/project/arch";
import { KIND_COLOR, kindPill } from "@/project/analyze";

export function ArchView({ onElement }: { onElement: (el: HTMLElement | null) => void }) {
  const project = useSkillStore((s) => s.project);
  const model = useSkillStore((s) => s.model);
  const code = useSkillStore((s) => s.code);
  const files = useSkillStore((s) => s.files);
  const bins = useSkillStore((s) => s.bins);
  const archLevel = useSkillStore((s) => s.archLevel);
  const setArchLevel = useSkillStore((s) => s.setArchLevel);
  const sel = useSkillStore((s) => s.sel);
  const select = useSkillStore((s) => s.select);
  const setSide = useSkillStore((s) => s.setSide);
  const openPath = useSkillStore((s) => s.openPath);
  const openShot = useSkillStore((s) => s.openShot);
  const focus = useSkillStore((s) => s.focus);
  const setFocus = useSkillStore((s) => s.setFocus);
  const { vpRef, innerRef, zoom, controls } = useViewport({ min: 0.15 });

  const layout = useMemo(() => {
    if (!project) return null;
    const g = archGraph(archLevel, model.components || [], project, code, files, bins);
    return layoutArch(g, archLevel);
  }, [project, model, code, files, bins, archLevel]);

  useEffect(() => {
    const t = window.setTimeout(() => controls.fitMin(0.35), 40);
    return () => window.clearTimeout(t);
  }, [layout, controls]);

  if (!project || !layout) return null;

  return (
    <div id="view-arch">
      <div className="toolbar">
        <button className="ib" type="button" onClick={() => controls.fitMin(0.35)}>
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
        <span className="segtabs">
          <button type="button" aria-pressed={archLevel === "files"} onClick={() => setArchLevel("files")}>
            Files
          </button>
          <button type="button" aria-pressed={archLevel === "components"} onClick={() => setArchLevel("components")}>
            Components
          </button>
        </span>
        <span className="grow" />
        <span className="hintline">{layout.note}</span>
        <span className="hintline">Click for details · double-click to open</span>
        <button className="ib" type="button" title="Save the architecture as an image" onClick={() => openShot("arch")}>
          Screenshot
        </button>
        <button className={`ib focusBtn${focus ? " on" : ""}`} type="button" onClick={() => setFocus(!focus)}>
          Focus
        </button>
      </div>
      <div className="viewport" ref={vpRef}>
        <div className="vp-inner" ref={innerRef}>
          <div
            className="mm-layer"
            ref={(el) => {
              onElement(el);
            }}
            style={{ width: layout.width, height: layout.height }}
          >
            <svg className="mm-svg" width={layout.width} height={layout.height}>
              <defs>
                <marker
                  id="arArch"
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto"
                >
                  <path d="M0,0L10,5L0,10z" style={{ fill: "var(--wire)" }} />
                </marker>
              </defs>
              {layout.edges.map((e, i) => {
                const on = sel === e.from || sel === e.to;
                return (
                  <g key={i}>
                    <path
                      className={`t arch-e${on ? " on" : ""}${e.back ? " back" : ""}`}
                      d={e.d}
                      markerEnd="url(#arArch)"
                    />
                  </g>
                );
              })}
              {layout.edges.map((e, i) =>
                e.n ? (
                  <text key={`n${i}`} x={e.lx} y={e.ly} className="arch-n">
                    {e.n}
                  </text>
                ) : null,
              )}
            </svg>

            {layout.cards.map((c) => (
              <div
                className={`acard${sel === c.node.id ? " sel" : ""}`}
                key={c.node.id}
                role="button"
                tabIndex={0}
                style={
                  {
                    left: c.x,
                    top: c.y,
                    width: c.w,
                    height: c.h,
                    "--kc": KIND_COLOR[c.node.kind] || "var(--wire)",
                  } as React.CSSProperties
                }
                onClick={() => {
                  select(c.node.id);
                  setSide("details");
                }}
                onDoubleClick={() => {
                  if (c.node.id.startsWith("f:")) openPath(c.node.id.slice(2));
                }}
              >
                <div className="ac-top">
                  {archLevel === "components" ? (
                    <span dangerouslySetInnerHTML={{ __html: kindPill(c.node.kind) }} />
                  ) : (
                    <span className={`kpill k-${c.node.kind}`}>{c.node.pill}</span>
                  )}
                  <span className="ac-m">{c.node.meta}</span>
                </div>
                <b>{c.node.title}</b>
                <span className="ac-p">{c.node.purpose}</span>
                <span className="ac-path mono">{c.node.path}</span>
              </div>
            ))}
          </div>
        </div>
        {layout.cards.length === 0 && (
          <p className="empty" style={{ position: "absolute", left: 0, right: 0, top: "45%", textAlign: "center" }}>
            {layout.emptyText}
          </p>
        )}
      </div>
    </div>
  );
}
