import { memo, useEffect, useMemo, useRef, useState } from "react";

import { useSkillStore } from "@/features/skill-flow/store";
import { compOfPath } from "@/project/analyze";
import { isCI, isManifest, isReadme, isTestPath, langOf } from "@/project/paths";
import { buildTree, buildTreeDirs } from "@/project/tree";
import type { TreeNode } from "@/project/types";

function RowImpl({ x, depth }: { x: TreeNode["files"][number]; depth: number }) {
  const sel = useSkillStore((s) => s.sel);
  const select = useSkillStore((s) => s.select);
  const setSide = useSkillStore((s) => s.setSide);
  const openPath = useSkillStore((s) => s.openPath);
  const entries = useSkillStore((s) => s.project?.entries);
  const notes = useSkillStore((s) => s.notes);
  const todos = useSkillStore((s) => s.project?.todos);
  const p = x.path;
  const L = langOf(p);
  const name = p.split("/").pop() || p;
  const flags = [
    isReadme(p) ? "README" : "",
    entries?.includes(p) ? "entry" : "",
    isManifest(p) ? "manifest" : "",
    isTestPath(p) ? "test" : "",
    isCI(p) ? "CI" : "",
    x.f?.edited ? "edited" : "",
    x.f?.created ? "new" : "",
  ].filter(Boolean);
  const noteN = notes.filter((n) => n.status === "open" && n.file === p).length;
  const todoN = todos?.find((t) => t.path === p)?.n || 0;
  const open = (dbl = false) => {
    select("f:" + p);
    setSide("details");
    if (dbl) openPath(p);
  };
  return (
    <div
      className={`tr f${sel === "f:" + p ? " sel" : ""}`}
      style={{ "--d": depth } as React.CSSProperties}
      role="treeitem"
      tabIndex={0}
      aria-selected={sel === "f:" + p}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      }}
      onClick={(e) => open(e.detail >= 2)}
    >
      <span className="ldot" style={{ background: x.b ? "var(--line)" : L.color }} />
      <span className={`tn${x.b ? " bin" : ""}`}>{name}</span>
      {flags.map((fl) => (
        <span className={`tflag t-${fl}`} key={fl}>
          {fl}
        </span>
      ))}
      {noteN ? (
        <span className="tflag t-note">
          {noteN} note{noteN > 1 ? "s" : ""}
        </span>
      ) : null}
      {todoN ? <span className="tflag t-todo">{todoN} TODO</span> : null}
      <span className="tm">{x.f ? `${(x.f.lines || 0).toLocaleString()} lines` : x.b ? "binary" : ""}</span>
    </div>
  );
}

const Row = memo(RowImpl);

function DirImpl({ d, depth, q }: { d: TreeNode; depth: number; q: string }) {
  const treeOpen = useSkillStore((s) => s.treeOpen);
  const toggleTreeDir = useSkillStore((s) => s.toggleTreeDir);
  const components = useSkillStore((s) => s.model.components);
  const match = (p: string) => !q || p.toLowerCase().includes(q);
  const dirHas = (n: TreeNode): boolean =>
    !q || n.files.some((x) => match(x.path)) || [...n.dirs.values()].some(dirHas);
  if (!dirHas(d)) return null;
  const open = !!q || treeOpen.includes(d.path) || depth === 0;
  const c = compOfPath(components ?? [], d.path + "/x");
  return (
    <>
      {depth > 0 && (
        <div
          className="tr d"
          style={{ "--d": depth - 1 } as React.CSSProperties}
          role="treeitem"
          aria-expanded={open}
          data-dir-path={d.path}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              toggleTreeDir(d.path);
            }
          }}
          onClick={() => toggleTreeDir(d.path)}
        >
          <span className="caret">{open ? "▾" : "▸"}</span>
          <span className="tn">{d.name}/</span>
          {c && c.path.replace(/\/$/, "") === d.path ? <span className="tflag t-comp">{c.name}</span> : null}
          <span className="tm">
            {(d.count || 0).toLocaleString()} files · {(d.lines || 0).toLocaleString()} lines
          </span>
        </div>
      )}
      {open && (
        <>
          {[...d.dirs.values()]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((sd) => (
              <Dir d={sd} depth={depth + 1} q={q} key={sd.path} />
            ))}
          {d.files
            .filter((x) => match(x.path))
            .sort((a, b) => a.path.localeCompare(b.path))
            .map((x) => (
              <Row x={x} depth={depth} key={x.path} />
            ))}
        </>
      )}
    </>
  );
}

const Dir = memo(DirImpl);

export function StructureView() {
  const files = useSkillStore((s) => s.files);
  const bins = useSkillStore((s) => s.bins);
  const project = useSkillStore((s) => s.project);
  const treeFilter = useSkillStore((s) => s.treeFilter);
  const setTreeFilter = useSkillStore((s) => s.setTreeFilter);
  const setTreeOpen = useSkillStore((s) => s.setTreeOpen);
  const toggleTreeDir = useSkillStore((s) => s.toggleTreeDir);

  // Keystrokes stay in local state so typing is instant; the (potentially large)
  // tree re-filter is debounced into the store.
  const [filterDraft, setFilterDraft] = useState(treeFilter);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => setTreeFilter(filterDraft), 150);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [filterDraft, setTreeFilter]);

  const root = useMemo(() => buildTree(files, bins), [files, bins]);
  if (!project) return null;

  // Arrow keys move between visible rows; Left/Right collapse or expand a folder.
  const onTreeKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const nav = e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End";
    const toggle = e.key === "ArrowRight" || e.key === "ArrowLeft";
    if (!nav && !toggle) return;
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="treeitem"]'));
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const i = active ? items.indexOf(active) : -1;
    if (i < 0) return;
    if (nav) {
      e.preventDefault();
      const next =
        e.key === "Home"
          ? 0
          : e.key === "End"
            ? items.length - 1
            : e.key === "ArrowDown"
              ? Math.min(items.length - 1, i + 1)
              : Math.max(0, i - 1);
      items[next]?.focus();
      return;
    }
    const expanded = active?.getAttribute("aria-expanded");
    const path = active?.dataset.dirPath;
    if (!path || expanded === null) return;
    e.preventDefault();
    if (e.key === "ArrowRight" && expanded === "false") toggleTreeDir(path);
    else if (e.key === "ArrowLeft" && expanded === "true") toggleTreeDir(path);
  };

  return (
    <div id="view-structure" className="scroll">
      <div className="tree-head">
        <input
          type="search"
          placeholder="Filter files by name or path"
          aria-label="Filter files"
          value={filterDraft}
          onChange={(e) => setFilterDraft(e.target.value)}
        />
        <button className="btn sm" type="button" onClick={() => setTreeOpen(buildTreeDirs(files, bins))}>
          Expand all
        </button>
        <button className="btn sm" type="button" onClick={() => setTreeOpen([])}>
          Collapse all
        </button>
        <span className="sum">
          {project.total.toLocaleString()} files · {project.lines.toLocaleString()} lines · {project.readmes.length}{" "}
          README{project.readmes.length === 1 ? "" : "s"} · {project.tests.length} test files
        </span>
      </div>
      <div role="tree" aria-label="Project file tree" onKeyDown={onTreeKey}>
        {treeFilter ? <Dir d={root} depth={0} q={treeFilter.trim().toLowerCase()} /> : <Dir d={root} depth={0} q="" />}
        {root.count === 0 && <p className="empty">No files match.</p>}
      </div>
    </div>
  );
}
