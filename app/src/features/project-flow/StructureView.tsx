import { useMemo } from "react";

import { useSkillStore } from "@/features/skill-flow/store";
import { compOfPath } from "@/project/analyze";
import { isCI, isManifest, isReadme, isTestPath, langOf } from "@/project/paths";
import { buildTree, buildTreeDirs } from "@/project/tree";
import type { TreeNode } from "@/project/types";

function Row({ x, depth }: { x: TreeNode["files"][number]; depth: number }) {
  const sel = useSkillStore((s) => s.sel);
  const select = useSkillStore((s) => s.select);
  const setSide = useSkillStore((s) => s.setSide);
  const openPath = useSkillStore((s) => s.openPath);
  const entries = useSkillStore((s) => s.project?.entries || []);
  const notes = useSkillStore((s) => s.notes);
  const todos = useSkillStore((s) => s.project?.todos || []);
  const p = x.path;
  const L = langOf(p);
  const name = p.split("/").pop() || p;
  const flags = [
    isReadme(p) ? "README" : "",
    entries.includes(p) ? "entry" : "",
    isManifest(p) ? "manifest" : "",
    isTestPath(p) ? "test" : "",
    isCI(p) ? "CI" : "",
    x.f?.edited ? "edited" : "",
    x.f?.created ? "new" : "",
  ].filter(Boolean);
  const noteN = notes.filter((n) => n.status === "open" && n.file === p).length;
  const todoN = todos.find((t) => t.path === p)?.n || 0;
  return (
    <div
      className={`tr f${sel === "f:" + p ? " sel" : ""}`}
      style={{ "--d": depth } as React.CSSProperties}
      role="treeitem"
      tabIndex={0}
      onClick={(e) => {
        select("f:" + p);
        setSide("details");
        if (e.detail >= 2) openPath(p);
      }}
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

function Dir({ d, depth, q }: { d: TreeNode; depth: number; q: string }) {
  const treeOpen = useSkillStore((s) => s.treeOpen);
  const toggleTreeDir = useSkillStore((s) => s.toggleTreeDir);
  const components = useSkillStore((s) => s.model.components || []);
  const match = (p: string) => !q || p.toLowerCase().includes(q);
  const dirHas = (n: TreeNode): boolean =>
    !q || n.files.some((x) => match(x.path)) || [...n.dirs.values()].some(dirHas);
  if (!dirHas(d)) return null;
  const open = !!q || treeOpen.includes(d.path) || depth === 0;
  const c = compOfPath(components, d.path + "/x");
  return (
    <>
      {depth > 0 && (
        <div
          className="tr d"
          style={{ "--d": depth - 1 } as React.CSSProperties}
          role="treeitem"
          aria-expanded={open}
          tabIndex={0}
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

export function StructureView() {
  const files = useSkillStore((s) => s.files);
  const bins = useSkillStore((s) => s.bins);
  const project = useSkillStore((s) => s.project);
  const treeFilter = useSkillStore((s) => s.treeFilter);
  const setTreeFilter = useSkillStore((s) => s.setTreeFilter);
  const setTreeOpen = useSkillStore((s) => s.setTreeOpen);

  const root = useMemo(() => buildTree(files, bins), [files, bins]);
  if (!project) return null;

  return (
    <div id="view-structure" className="scroll">
      <div className="tree-head">
        <input
          type="search"
          placeholder="Filter files by name or path"
          aria-label="Filter files"
          value={treeFilter}
          onChange={(e) => setTreeFilter(e.target.value)}
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
      <div role="tree">
        {treeFilter ? <Dir d={root} depth={0} q={treeFilter.trim().toLowerCase()} /> : <Dir d={root} depth={0} q="" />}
        {root.count === 0 && <p className="empty">No files match.</p>}
      </div>
    </div>
  );
}
