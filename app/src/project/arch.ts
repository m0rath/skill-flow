import { compDeps, compOfPath } from "@/project/analyze";
import { isTestPath } from "@/project/paths";
import type { ArchLevel } from "@/features/skill-flow/store";
import type { BinFile, CodeIndex, PComponent, Project, ProjectFile } from "@/project/types";
export interface ArchGraphNode {
  id: string;
  title: string;
  kind: string;
  pill: string;
  purpose: string;
  path: string;
  meta: string;
}

export interface ArchGraphEdge {
  from: string;
  to: string;
  n: number;
}

export interface ArchGraph {
  nodes: ArchGraphNode[];
  edges: ArchGraphEdge[];
  trimmed?: boolean;
}

/**
 * The nodes and edges to draw. At the "files" level it uses the call graph (plus folder imports);
 * at the "components" level it uses the AI/local component map.
 */
export function archGraph(
  level: ArchLevel,
  components: PComponent[],
  project: Project,
  code: CodeIndex | null,
  files: ProjectFile[],
  bins: BinFile[],
): ArchGraph {
  if (level === "files" && code) {
    const deg = new Map<string, number>();
    const edges: ArchGraphEdge[] = [];
    code.fileCalls.forEach((n, k) => {
      const [a, b] = k.split(">");
      edges.push({ from: "f:" + a, to: "f:" + b, n });
      deg.set(a, (deg.get(a) || 0) + n);
      deg.set(b, (deg.get(b) || 0) + n);
    });
    (project.edges || []).forEach((e) => {
      if (!code.fileCalls.has(e.from + ">" + e.to) && code.P[e.from] && code.P[e.to]) {
        edges.push({ from: "f:" + e.from, to: "f:" + e.to, n: 0 });
        deg.set(e.from, (deg.get(e.from) || 0) + 1);
        deg.set(e.to, (deg.get(e.to) || 0) + 1);
      }
    });
    const entrySet = new Set(project.entries);
    let paths = Object.keys(code.P).filter((p) => !isTestPath(p) && (deg.get(p) || entrySet.has(p)));
    let cut = false;
    if (paths.length > 90) {
      cut = true;
      paths = paths.sort((a, b) => (deg.get(b) || 0) - (deg.get(a) || 0)).slice(0, 90);
    }
    const keep = new Set(paths.map((p) => "f:" + p));
    const baseCount = new Map<string, number>();
    paths.forEach((p) => {
      const bn = p.split("/").pop() || p;
      baseCount.set(bn, (baseCount.get(bn) || 0) + 1);
    });
    const fileByPath = new Map(files.map((x) => [x.path, x]));
    return {
      nodes: paths.map((p) => {
        const c = compOfPath(components, p);
        const fnN = code.P[p].syms.filter((s) => s.kind !== "class").length;
        const f = fileByPath.get(p);
        const base = p.split("/").pop() || p;
        return {
          id: "f:" + p,
          title: (baseCount.get(base) || 0) > 1 ? p.split("/").slice(-2).join("/") : base,
          kind: c ? c.kind : "other",
          pill: c ? c.name : "file",
          purpose: `${fnN} function${fnN === 1 ? "" : "s"} · ${(
            f?.lines || (f?.text ? f.text.split("\n").length : 0)
          ).toLocaleString()} lines${entrySet.has(p) ? " · entry point" : ""}`,
          path: p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "project root",
          meta: "",
        };
      }),
      edges: edges.filter((e) => keep.has(e.from) && keep.has(e.to)),
      trimmed: cut,
    };
  }
  const comps = components;
  const names = new Set(comps.map((c) => c.name));
  const deps = compDeps(comps, project).filter((d) => names.has(d.from) && names.has(d.to));
  // Count files per component in one pass instead of rescanning every file for every component.
  const fileCount = new Map<string, number>();
  [...files, ...bins].forEach((f) => {
    const c = compOfPath(comps, f.path);
    if (c) fileCount.set(c.name, (fileCount.get(c.name) || 0) + 1);
  });
  return {
    nodes: comps.map((c) => {
      const n = fileCount.get(c.name) || 0;
      return {
        id: "c:" + c.name,
        title: c.name,
        kind: c.kind,
        pill: c.kind,
        purpose: c.purpose,
        path: c.path || "root",
        meta: `${n} file${n === 1 ? "" : "s"}`,
      };
    }),
    edges: deps.map((d) => ({ from: "c:" + d.from, to: "c:" + d.to, n: d.n })),
  };
}

export interface ArchCard {
  node: ArchGraphNode;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ArchEdgePath {
  from: string;
  to: string;
  d: string;
  n: number;
  back: boolean;
  lx: number;
  ly: number;
}

export interface ArchLayout {
  width: number;
  height: number;
  cards: ArchCard[];
  edges: ArchEdgePath[];
  note: string;
  emptyText: string;
}

/** Lay a graph out as a layered DAG (sources on top) and route the edges. */
export function layoutArch(graph: ArchGraph, level: ArchLevel): ArchLayout {
  const ids = graph.nodes.map((n) => n.id);
  const out = new Map<string, string[]>(ids.map((id) => [id, []]));
  graph.edges.forEach((e) => out.get(e.from)?.push(e.to));

  const rank = new Map<string, number>();
  const state = new Map<string, number>();
  const visit = (n: string): number => {
    if (state.get(n) === 2) return rank.get(n) || 0;
    if (state.get(n) === 1) return -1;
    state.set(n, 1);
    let r = 0;
    (out.get(n) || []).forEach((m) => {
      const x = visit(m);
      if (x >= 0) r = Math.max(r, x + 1);
    });
    state.set(n, 2);
    rank.set(n, r);
    return r;
  };
  ids.forEach(visit);

  const maxR = Math.max(0, ...rank.values());
  const rows: ArchGraphNode[][] = [];
  graph.nodes.forEach((n) => {
    const r = maxR - (rank.get(n.id) || 0);
    (rows[r] = rows[r] || []).push(n);
  });

  const W = level === "files" ? 200 : 230;
  const H = level === "files" ? 98 : 112;
  const GX = 40;
  const GY = 92;
  const maxPerRow = level === "files" ? 7 : 6;
  const pos = new Map<string, { x: number; y: number; sub: number }>();

  // Group incoming edges once; the row sort below would otherwise rescan every edge per node.
  const incoming = new Map<string, ArchGraphEdge[]>();
  graph.edges.forEach((e) => {
    const list = incoming.get(e.to);
    if (list) list.push(e);
    else incoming.set(e.to, [e]);
  });

  const rowsF = rows.filter(Boolean);
  rowsF.forEach((row, ri) => {
    if (ri > 0)
      row.sort((a, b) => {
        const bc = (n: ArchGraphNode) => {
          const ps = (incoming.get(n.id) || []).filter((d) => pos.has(d.from)).map((d) => pos.get(d.from)?.x || 0);
          return ps.length ? ps.reduce((x, y) => x + y, 0) / ps.length : 0;
        };
        return bc(a) - bc(b);
      });
    row.forEach((c, i) => {
      const sub = Math.floor(i / maxPerRow);
      const k = i % maxPerRow;
      const n = Math.min(maxPerRow, row.length - sub * maxPerRow);
      pos.set(c.id, { x: (k - (n - 1) / 2) * (W + GX), y: 0, sub });
    });
  });

  let y = 0;
  rowsF.forEach((row) => {
    const subs = Math.max(...row.map((c) => pos.get(c.id)?.sub || 0)) + 1;
    row.forEach((c) => {
      const p = pos.get(c.id);
      if (p) p.y = y + p.sub * (H + 30);
    });
    y += subs * (H + 30) + GY - 30;
  });

  const xs = [...pos.values()].map((p) => p.x);
  const minX = Math.min(...xs, 0) - W / 2 - 40;
  const maxX = Math.max(...xs, 0) + W / 2 + 40;
  const maxY = y + 20;
  const ox = -minX;
  const oy = 30;

  const edges: ArchEdgePath[] = [];
  graph.edges.forEach((d) => {
    const a = pos.get(d.from);
    const b = pos.get(d.to);
    if (!a || !b) return;
    const ax = a.x + ox;
    const ay = a.y + oy + H;
    const bx = b.x + ox;
    const by = b.y + oy;
    let path: string;
    if (by > ay) path = `M${ax},${ay} C${ax},${(ay + by) / 2} ${bx},${(ay + by) / 2} ${bx},${by - 2}`;
    else {
      const side = bx >= ax ? 1 : -1;
      const sx = ax + (side * W) / 2;
      const sy = a.y + oy + H / 2;
      const ex = bx - (side * W) / 2;
      const ey = b.y + oy + H / 2;
      path = `M${sx},${sy} C${sx + side * 90},${sy} ${ex - side * 90},${ey} ${ex},${ey}`;
    }
    edges.push({ from: d.from, to: d.to, d: path, n: d.n, back: by <= ay, lx: (ax + bx) / 2 + 6, ly: (ay + by) / 2 });
  });

  const cards: ArchCard[] = graph.nodes.map((node) => {
    const p = pos.get(node.id) || { x: 0, y: 0 };
    return { node, x: p.x + ox - W / 2, y: p.y + oy, w: W, h: H };
  });

  return {
    width: maxX - minX,
    height: maxY + 40,
    cards,
    edges,
    note:
      level === "files"
        ? `Files that call each other; numbers count calls.${graph.trimmed ? " Showing the 90 most connected files." : ""}`
        : "Components; numbers count imports between them.",
    emptyText: level === "files" ? "No calls between files were found." : "No components found yet.",
  };
}
