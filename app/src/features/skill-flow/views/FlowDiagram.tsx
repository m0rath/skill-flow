import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  type HTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import { FileIcon as IconFile, LoopIcon as IconLoop } from "@/components/Icons";
import { flaggedIds } from "@/model/checks";
import { allCreates, descCount, ordered } from "@/model/normalize";
import { toMermaid } from "@/model/serialize";
import type { FlowNode } from "@/model/types";
import { useAppStore } from "@/store/app";
import { useViewport } from "@/features/skill-flow/viewport";
import { useSkillStore } from "@/features/skill-flow/store";

function Wire({ arrow = true, grow = false }: { arrow?: boolean; grow?: boolean }) {
  return <div className={`wire${arrow ? " arrow" : ""}${grow ? " grow" : ""}`} />;
}

function Chips({ node }: { node: FlowNode }) {
  if (!node.creates.length && !node.uses.length) return null;
  return (
    <>
      {node.creates.length > 0 && (
        <div className="chiprow">
          <span className="lbl">makes</span>
          <div className="chips">
            {node.creates.map((c) => (
              <span className="chip make" key={c.name}>
                <IconFile />
                {c.name}
              </span>
            ))}
          </div>
        </div>
      )}
      {node.uses.length > 0 && (
        <div className="chiprow">
          <span className="lbl">uses</span>
          <div className="chips">
            {node.uses.slice(0, 3).map((u) => (
              <span className="chip use" key={u}>
                {u}
              </span>
            ))}
            {node.uses.length > 3 && <span className="chip use">+{node.uses.length - 3}</span>}
          </div>
        </div>
      )}
    </>
  );
}

interface NodeViewProps {
  node: FlowNode;
  sel: string | null;
  collapsed: string[];
  flags: Set<string>;
  onSelect: (id: string) => void;
  onFold: (id: string) => void;
}

function FlowFlow({ nodes, ...rest }: { nodes: FlowNode[] } & Omit<NodeViewProps, "node">) {
  return (
    <div className="flow">
      {nodes.map((n, i) => (
        <Fragment key={n.id}>
          {i > 0 && <Wire />}
          <NodeView node={n} {...rest} />
        </Fragment>
      ))}
    </div>
  );
}

function NodeView({ node, sel, collapsed, flags, onSelect, onFold }: NodeViewProps) {
  const col = collapsed.includes(node.id);
  const selected = sel === node.id;
  const flagged = flags.has(node.id);
  const hasFold = !!(node.branches || (node.steps && node.steps.length));
  const fold = hasFold ? (
    <button
      type="button"
      className="fold"
      aria-label={col ? "Expand" : "Collapse"}
      onClick={(e) => {
        e.stopPropagation();
        onFold(node.id);
      }}
    >
      {col ? "Expand" : "Collapse"}
    </button>
  ) : null;

  const common = {
    "data-id": node.id,
    tabIndex: 0,
    role: (hasFold ? "group" : "button") as "group" | "button",
    "aria-label": `${node.num} ${node.question || node.title}`,
    onClick: () => onSelect(node.id),
    onKeyDown: (e: ReactKeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onSelect(node.id);
      }
    },
  } as HTMLAttributes<HTMLDivElement> & { "data-id": string };

  if (node.kind === "decision" || node.kind === "parallel") {
    const isPar = node.kind === "parallel";
    const head = isPar ? (
      <div className={`parhead${selected ? " sel" : ""}`} {...common}>
        {node.num} · In parallel{node.title && node.title !== "Step" ? ` · ${node.title}` : ""}
        {fold}
      </div>
    ) : (
      <div className={`node decision${selected ? " sel" : ""}${flagged ? " flag" : ""}`} {...common}>
        <div className="top">
          <span className="diamond" />
          <span className="num">{node.num}</span>
          <span className="kind">Decision</span>
          {fold}
        </div>
        <h3>{node.question || node.title}</h3>
        {node.detail ? <p>{node.detail}</p> : null}
        <Chips node={node} />
      </div>
    );
    const branches = node.branches || [];
    if (col) {
      return (
        <div className="flow">
          {head}
          <Wire />
          <button
            type="button"
            className="folded"
            onClick={(e) => {
              e.stopPropagation();
              onFold(node.id);
            }}
          >
            {branches.map((b) => b.label).join(" / ")} · {descCount(node)} steps hidden
          </button>
        </div>
      );
    }
    return (
      <div className="flow">
        {head}
        <Wire arrow={false} />
        <div className="branches">
          {branches.map((b) => (
            <div className="branch" key={b.label}>
              <Wire arrow={false} />
              <span className={`blabel${isPar ? " par" : ""}${b.implied ? " implied" : ""}`}>{b.label}</span>
              {b.steps.length ? (
                <>
                  <Wire />
                  <FlowFlow
                    nodes={b.steps}
                    sel={sel}
                    collapsed={collapsed}
                    flags={flags}
                    onSelect={onSelect}
                    onFold={onFold}
                  />
                </>
              ) : (
                <>
                  <Wire arrow={false} />
                  {b.implied ? (
                    <span className="skip implied">Not described</span>
                  ) : (
                    <span className="skip">{isPar ? "nothing" : "continue"}</span>
                  )}
                </>
              )}
              <Wire arrow={false} grow />
            </div>
          ))}
        </div>
        <Wire arrow={false} />
        <div className="merge" />
      </div>
    );
  }

  if (node.kind === "loop") {
    const head = (
      <div className={`loophead${selected ? " sel" : ""}`} {...common}>
        <IconLoop />
        <span className="num">{node.num}</span>
        <span>
          {node.title}
          {node.over ? <span style={{ fontWeight: 500 }}> · {node.over}</span> : null}
        </span>
        {fold}
      </div>
    );
    if (col)
      return (
        <div className="loop">
          {head}
          <Wire />
          <button
            type="button"
            className="folded"
            onClick={(e) => {
              e.stopPropagation();
              onFold(node.id);
            }}
          >
            {descCount(node)} steps hidden
          </button>
        </div>
      );
    return (
      <div className="loop">
        {head}
        <Wire />
        {node.steps && (
          <FlowFlow
            nodes={node.steps}
            sel={sel}
            collapsed={collapsed}
            flags={flags}
            onSelect={onSelect}
            onFold={onFold}
          />
        )}
        <div className="loopback">
          <IconLoop /> repeat
        </div>
      </div>
    );
  }

  const k = node.kind === "stop" ? "stop" : "step";
  return (
    <div className={`node ${k}${selected ? " sel" : ""}${flagged ? " flag" : ""}`} title={node.detail} {...common}>
      <div className="top">
        <span className="num">{node.num}</span>
        <span className="kind">{k === "stop" ? "Stop" : "Step"}</span>
      </div>
      <h3>{node.title}</h3>
      {node.detail && node.detail !== node.title ? <p>{node.detail}</p> : null}
      <Chips node={node} />
    </div>
  );
}

export function FlowDiagram({ onElement }: { onElement?: (el: HTMLElement | null) => void }) {
  const model = useSkillStore((s) => s.model);
  const files = useSkillStore((s) => s.files);
  const sugg = useSkillStore((s) => s.sugg);
  const sel = useSkillStore((s) => s.sel);
  const collapsed = useSkillStore((s) => s.collapsed);
  const exportMode = useSkillStore((s) => s.exportMode);
  const select = useSkillStore((s) => s.select);
  const fold = useSkillStore((s) => s.fold);
  const goTo = useSkillStore((s) => s.goTo);
  const step = useSkillStore((s) => s.step);
  const collapseAll = useSkillStore((s) => s.collapseAll);
  const expandAll = useSkillStore((s) => s.expandAll);
  const openShot = useSkillStore((s) => s.openShot);
  const setFocus = useSkillStore((s) => s.setFocus);
  const toast = useAppStore((s) => s.toast);

  const { vpRef, innerRef, zoom, controls } = useViewport();
  const fitted = useRef(false);

  const flags = useMemo(
    () => flaggedIds({ files, model, dismissed: sugg.dismissed, claude: sugg.claude }),
    [files, model, sugg],
  );
  // ordered() / allCreates() read the module-level node index, rebuilt by normalize() per model.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const list = useMemo(() => ordered(), [model]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const outs = useMemo(() => allCreates().length, [model]);
  const effCollapsed = exportMode?.expand ? [] : collapsed;
  const showFlags = exportMode ? exportMode.flags : true;

  useEffect(() => {
    onElement?.(innerRef.current);
  }, [onElement, innerRef]);

  // Fit once on first render, and re-fit when the model changes shape.
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (!fitted.current) {
        fitted.current = true;
        controls.fit("width");
      }
    }, 60);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model]);

  useEffect(() => {
    if (!sel) return;
    const el = innerRef.current?.querySelector(`[data-id="${sel}"]`) as HTMLElement | null;
    if (el) controls.centerOn(el);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel]);

  const copyMermaid = async () => {
    try {
      await navigator.clipboard.writeText(toMermaid(model.steps));
      toast("Mermaid code copied");
    } catch {
      toast("The clipboard is blocked in this view.");
    }
  };

  return (
    <>
      <div className="toolbar">
        <button className="ib" type="button" onClick={() => controls.fit("width")} title="Fit to width">
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
        <button className="ib" type="button" title="Previous step (←)" onClick={() => step(-1)}>
          ←
        </button>
        <select
          className="jump"
          aria-label="Jump to step"
          value={sel || ""}
          onChange={(e) => e.target.value && goTo(e.target.value, "diagram")}
        >
          <option value="">Jump to step…</option>
          {list.map((n) => (
            <option key={n.id} value={n.id}>
              {n.num} · {(n.kind === "decision" ? n.question || n.title : n.title).slice(0, 48)}
            </option>
          ))}
        </select>
        <button className="ib" type="button" title="Next step (→)" onClick={() => step(1)}>
          →
        </button>
        <span className="sep" />
        <button className="ib" type="button" onClick={collapseAll}>
          Collapse all
        </button>
        <button className="ib" type="button" onClick={expandAll}>
          Expand all
        </button>
        <span className="grow" />
        <button className="ib" type="button" onClick={copyMermaid}>
          Copy Mermaid
        </button>
        <button
          className="ib shotBtn"
          type="button"
          title="Save the diagram as PNG or JPEG"
          onClick={() => openShot("diagram")}
        >
          Screenshot
        </button>
        <button className="ib focusBtn" type="button" onClick={() => setFocus(true)}>
          Focus
        </button>
      </div>
      <div className="viewport" ref={vpRef}>
        <div className="vp-inner diagram-inner" ref={innerRef}>
          <div className="flow">
            <div className="term">
              <span className="eyebrow">Start</span>
              {model.trigger || "Skill is invoked"}
            </div>
            <Wire />
            <FlowFlow
              nodes={model.steps}
              sel={sel}
              collapsed={effCollapsed}
              flags={showFlags ? flags : new Set()}
              onSelect={select}
              onFold={fold}
            />
            <Wire />
            <div className="term end">
              <span className="eyebrow">Done</span>
              {outs ? `${outs} output${outs > 1 ? "s" : ""} produced` : "Workflow complete"}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
