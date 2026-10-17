/*
  High-level overview model and geometry.
  Ported from the vanilla-JS legacy analyser (see app/_ref/legacy-app.js): the
  overview groups a detailed trace into a handful of big nodes/edges and lays
  them out in rank columns. This file returns data only — no DOM, no SVG strings.
*/

import { compOfPath, KIND_COLOR } from "@/project/analyze";
import { dirOf } from "@/project/paths";
import type { Flow, FlowStep, OvEdge, OvHop, OvModel, OvNode, PComponent } from "@/project/types";

export const OV_HIDE = new Set(["Library", "Web framework", "Test framework", "UI framework"]);
export const OV_STORE = new Set(["Database", "File system / OS", "Queue / messaging", "Cloud / SaaS"]);

export const CAT_COLOR: Record<string, string> = {
  Database: "var(--decide)",
  "HTTP / external API": "var(--link)",
  "File system / OS": "var(--muted)",
  Configuration: "var(--faint)",
  "Response to caller": "var(--make)",
  "Queue / messaging": "var(--loop)",
  "Cloud / SaaS": "var(--link)",
  "AI API": "var(--step)",
  Library: "var(--wire)",
  "Web framework": "var(--wire)",
};

export const OV_IC: Record<string, string> = {
  actor:
    '<svg viewBox="0 0 16 16"><circle cx="8" cy="5" r="3"/><path d="M2.5 14c.8-3 3-4.5 5.5-4.5s4.7 1.5 5.5 4.5"/></svg>',
  code: '<svg viewBox="0 0 16 16"><path d="M5.5 4 2 8l3.5 4M10.5 4 14 8l-3.5 4"/></svg>',
  db: '<svg viewBox="0 0 16 16"><ellipse cx="8" cy="4" rx="5" ry="2"/><path d="M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4M3 8c0 1.1 2.2 2 5 2s5-.9 5-2"/></svg>',
  http: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/><path d="M2 8h12M8 2c2 2 2 10 0 12M8 2c-2 2-2 10 0 12"/></svg>',
  file: '<svg viewBox="0 0 16 16"><path d="M4 2h5l3 3v9H4z"/><path d="M9 2v3h3"/></svg>',
  queue: '<svg viewBox="0 0 16 16"><path d="M2 4h12M2 8h12M2 12h12"/></svg>',
  config:
    '<svg viewBox="0 0 16 16"><path d="M3 4h10M3 8h10M3 12h10"/><circle cx="6" cy="4" r="1.4"/><circle cx="10" cy="8" r="1.4"/><circle cx="5" cy="12" r="1.4"/></svg>',
  cloud: '<svg viewBox="0 0 16 16"><path d="M4.5 12h7a3 3 0 0 0 .4-6A4 4 0 0 0 4.3 7 2.5 2.5 0 0 0 4.5 12z"/></svg>',
};

export const ovCatIcon = (cat: string): string =>
  /^Database/.test(cat)
    ? OV_IC.db
    : /^File/.test(cat)
      ? OV_IC.file
      : /^Queue/.test(cat)
        ? OV_IC.queue
        : /^Config/.test(cat)
          ? OV_IC.config
          : /Cloud|AI/.test(cat)
            ? OV_IC.cloud
            : OV_IC.http;

export const ovFn = (s: FlowStep): string => s.toName + (s.ext || s.load || s.reg || s.render || s.entry ? "" : "()");

/**
 * Verb describing what a call does with an outside service.
 * The legacy version also parsed the arguments off the calling source line; with
 * no file contents here we approximate from the step's own label/text.
 */
export function fpVerb(s: FlowStep): string {
  if (s.entry) return "starts";
  if (s.load) return "loads";
  if (s.render) return "renders";
  if (s.reg) return "registers";
  if (!s.ext) return "calls";
  const t = (s.toName + " " + (s.text || "")).toLowerCase();
  if (s.cat === "Response to caller") return "sends the result back to";
  if (s.cat === "Configuration") return "reads settings from";
  if (/^HTTP/.test(s.cat || "")) return "sends a request to";
  if ((s.cat != null && OV_STORE.has(s.cat)) || s.cat === "AI API") {
    if (
      /\b(insert|update|delete|upsert|replace|merge)\b|\.(save|write\w*|put|create\w*|set|push|publish|send\w*|append\w*|add|mkdir|unlink|rm|remove|copy\w*|upload\w*|enqueue|emit)\b|writefile|appendfile|"w"|'w'|"a"|'a'/.test(
        t,
      )
    )
      return "writes to";
    if (
      /\bselect\b|\.(get\w*|find\w*|read\w*|load\w*|fetch\w*|list\w*|exists\w*|stat\w*|scan|query|download\w*|consume|subscribe)\b|readfile|"r"|'r'/.test(
        t,
      )
    )
      return /\bselect\b|\.(get|find|read|load|fetch|list|exists|stat|download)/.test(t) || /readfile|"r"|'r'/.test(t)
        ? "reads from"
        : "queries";
    return "uses";
  }
  return "calls";
}

/* ---------- model: group the detailed trace into a few big parts ---------- */
export function buildOverview(model: { components?: PComponent[] }, flow: Flow, steps: FlowStep[]): OvModel {
  const real = steps.filter((s) => !s.phase);
  const files: string[] = [];
  real.forEach((s) =>
    [s.from, s.to].forEach((p) => {
      if (p !== "actor" && !String(p).startsWith("ext:") && !files.includes(p)) files.push(p);
    }),
  );
  const keyAt = (f: string, lv: string): string => {
    if (lv === "file") return "f:" + f;
    if (lv === "dir") return "d:" + (dirOf(f) || "(root)");
    const c = compOfPath(model.components || [], f);
    return c ? "c:" + c.name : "d:" + (dirOf(f) || "(root)");
  };
  const levels = ["comp", "dir", "file"];
  const counts = levels.map((lv) => new Set(files.map((f) => keyAt(f, lv))).size);
  let li = levels.findIndex((_lv, k) => counts[k] >= 3 && counts[k] <= 10);
  if (li < 0) li = levels.findIndex((_lv, k) => counts[k] >= 2 && counts[k] <= 10);
  if (li < 0) li = counts[0] >= 2 ? 0 : counts[1] >= 2 ? 1 : 2;
  const level = levels[li];
  const fileKey = new Map<string, string>();
  const order: string[] = [];
  files.forEach((f) => {
    const k = keyAt(f, level);
    if (!order.includes(k)) order.push(k);
  });
  const keep = new Set(order.slice(0, 9));
  files.forEach((f) => {
    const k = keyAt(f, level);
    fileKey.set(f, keep.has(k) || order.length <= 10 ? k : "o:other");
  });
  const nodeOf = (p: string): string | null => {
    if (p === "actor") return "actor";
    if (String(p).startsWith("ext:")) {
      const cat = p.slice(4);
      if (cat === "Response to caller") return "actor";
      return OV_HIDE.has(cat) ? null : p;
    }
    return fileKey.get(p) || keyAt(p, level);
  };
  const nodes = new Map<string, OvNode>();
  const edges: OvEdge[] = [];
  const ekey = new Map<string, OvEdge>();
  const hops: OvHop[] = [];
  const node = (k: string): OvNode => {
    const existing = nodes.get(k);
    if (existing) return existing;
    let n: OvNode;
    if (k === "actor")
      n = {
        key: k,
        kind: "actor",
        label: flow.actor,
        tag: "Starts here",
        color: "var(--ink)",
        icon: OV_IC.actor,
        files: new Set(),
        fns: [],
        items: [],
        first: Infinity,
        writes: 0,
        reads: 0,
        queries: 0,
        calls: 0,
        rank: 0,
      };
    else if (k.startsWith("ext:")) {
      const cat = k.slice(4);
      n = {
        key: k,
        kind: OV_STORE.has(cat) ? "store" : "ext",
        cat,
        label: cat,
        tag: OV_STORE.has(cat) ? "Where data is kept" : cat === "Configuration" ? "Settings" : "Outside service",
        color: CAT_COLOR[cat] || "var(--wire)",
        icon: ovCatIcon(cat),
        files: new Set(),
        fns: [],
        items: [],
        first: Infinity,
        writes: 0,
        reads: 0,
        queries: 0,
        calls: 0,
        rank: 0,
      };
    } else {
      const nm = k.slice(2);
      const c = k.startsWith("c:") ? (model.components || []).find((x) => x.name === nm) : null;
      n = {
        key: k,
        kind: "code",
        label:
          k === "o:other"
            ? "Other code"
            : k.startsWith("f:")
              ? nm.split("/").pop() || ""
              : k.startsWith("d:")
                ? nm === "(root)"
                  ? "project root"
                  : nm.split("/").slice(-2).join("/")
                : nm,
        tag: c ? c.kind || "code" : k.startsWith("f:") ? dirOf(nm) || "project root" : "Code",
        color: c ? KIND_COLOR[c.kind] || "var(--wire)" : "var(--wire)",
        icon: OV_IC.code,
        files: new Set(),
        fns: [],
        items: [],
        first: Infinity,
        writes: 0,
        reads: 0,
        queries: 0,
        calls: 0,
        rank: 0,
      };
    }
    nodes.set(k, n);
    return n;
  };
  node("actor").first = 0;
  const hideLoads =
    flow.all ||
    real.filter((s) => !s.entry && !s.load && !s.reg && !(s.ext && s.cat != null && OV_HIDE.has(s.cat))).length >= 3;
  steps.forEach((s, i) => {
    if (s.phase) {
      hops[i] = { type: "phase" };
      return;
    }
    const a = nodeOf(s.from);
    const b = nodeOf(s.to);
    const A = node(a || "actor");
    if (s.from !== "actor" && !String(s.from).startsWith("ext:")) A.files.add(s.from);
    if (!b || (hideLoads && (s.load || s.reg) && b !== "actor")) {
      hops[i] = { type: "work", node: A.key };
      A.items.push([i, (s.load || s.reg ? "" : "uses ") + s.toName]);
      return;
    }
    const B = node(b);
    B.first = Math.min(B.first, i);
    if (!String(s.to).startsWith("ext:") && s.to !== "actor") B.files.add(s.to);
    const v = fpVerb(s);
    if (B.kind === "code") {
      if (!B.fns.includes(ovFn(s))) B.fns.push(ovFn(s));
      B.items.push([i, (s.cond ? "if " + s.cond + ": " : "") + ovFn(s)]);
    } else {
      B.items.push([i, v + " · " + s.toName]);
      if (v === "writes to") B.writes++;
      else if (v === "reads from") B.reads++;
      else if (v === "queries") B.queries++;
      else B.calls++;
    }
    if (a === b) {
      hops[i] = { type: "work", node: B.key };
      return;
    }
    const ek = (a ?? "actor") + ">" + b;
    let e = ekey.get(ek);
    if (!e) {
      e = {
        id: edges.length,
        from: a ?? "actor",
        to: b,
        n: 0,
        first: i,
        names: [],
        conds: [],
        resp: s.to === "ext:Response to caller",
      };
      ekey.set(ek, e);
      edges.push(e);
    }
    e.n++;
    const nm = ovFn(s);
    if (!e.names.includes(nm)) e.names.push(nm);
    if (s.cond && !e.conds.includes(s.cond)) e.conds.push(s.cond);
    hops[i] = { type: "edge", e: e.id, from: a ?? "actor", to: b };
  });
  // ranks: code by first reach, stores and services in the last column
  const rank = new Map<string, number>([["actor", 0]]);
  hops.forEach((h) => {
    if (h && h.type === "edge" && !rank.has(h.to) && nodes.get(h.to)?.kind === "code")
      rank.set(h.to, (rank.get(h.from) ?? 0) + 1);
  });
  nodes.forEach((n) => {
    if (n.kind === "code" && !rank.has(n.key)) rank.set(n.key, 1);
  });
  const maxCode = Math.max(0, ...[...nodes.values()].filter((n) => n.kind === "code").map((n) => rank.get(n.key) ?? 0));
  nodes.forEach((n) => {
    if (n.kind === "store" || n.kind === "ext") rank.set(n.key, maxCode + 1);
    n.rank = rank.get(n.key) ?? 0;
  });
  return { nodes, edges, hops, level };
}

/* ---------- geometry (renderFlowOverview, data only) ---------- */

export interface OvGeo {
  x: number;
  y: number;
  w: number;
  h: number;
  rank: number;
}

export interface OvJourney {
  actor: string;
  codes: OvNode[];
  outs: OvNode[];
  resp: boolean;
}

export interface OvLayout {
  W: number;
  H: number;
  geo: Map<string, OvGeo>;
  edges: OvEdge[];
  orderNum: Map<number, number>;
  journey: OvJourney;
  back: number;
}

export function layoutOverview(flow: Flow, model: OvModel): OvLayout {
  const NW = 214;
  const NH = 92;
  const CG = 176;
  const RG = 30;
  const cols = new Map<number, OvNode[]>();
  [...model.nodes.values()]
    .sort((a, b) => a.first - b.first)
    .forEach((n) => {
      const list = cols.get(n.rank);
      if (list) list.push(n);
      else cols.set(n.rank, [n]);
    });
  const nCols = Math.max(...cols.keys()) + 1;
  const maxRows = Math.max(...[...cols.values()].map((c) => c.length));
  const W = Math.max(720, 60 + nCols * NW + (nCols - 1) * CG);

  // journey strip (chips rendered by the view from this data)
  const codes = [...model.nodes.values()].filter((n) => n.kind === "code").sort((a, b) => a.first - b.first);
  const outs = [...model.nodes.values()]
    .filter((n) => n.kind === "store" || n.kind === "ext")
    .sort((a, b) => a.first - b.first);
  const resp = model.edges.some((e) => e.resp);
  const actor = flow.actor + (flow.route ? " · " + flow.route.method + " " + flow.route.path : "");
  let jText = "Starts" + actor;
  if (codes.length) {
    jText +=
      "→" +
      "Runs through" +
      codes
        .slice(0, 6)
        .map((n) => n.label)
        .join("›");
    if (codes.length > 6) jText += "+" + (codes.length - 6);
  }
  if (outs.length)
    jText +=
      "→" +
      "Data goes to" +
      outs
        .map((n) => n.label + (n.writes ? " · writes" : n.reads ? " · reads" : n.queries ? " · queries" : ""))
        .join("");
  if (resp) jText += "→" + "Ends" + "Result sent back";
  const jLen = jText.length * 7.4 + 70;
  const Y0 = 34 + Math.ceil(jLen / (W - 60)) * 30 + 16;

  const colH = (n: number) => n * NH + (n - 1) * RG;
  const bodyH = colH(maxRows);
  const geo = new Map<string, OvGeo>();
  cols.forEach((list, r) => {
    const top = Y0 + (bodyH - colH(list.length)) / 2;
    list.forEach((n, k) => geo.set(n.key, { x: 30 + r * (NW + CG), y: top + k * (NH + RG), w: NW, h: NH, rank: r }));
  });
  let back = 0;
  const bottom = Y0 + bodyH;
  const curve = (e: OvEdge): number[] => {
    const A = geo.get(e.from);
    const B = geo.get(e.to);
    if (!A || !B) return [];
    if (B.rank > A.rank) {
      const x1 = A.x + A.w,
        y1 = A.y + A.h / 2,
        x2 = B.x - 3,
        y2 = B.y + B.h / 2,
        dx = Math.max(40, (x2 - x1) / 2);
      return [x1, y1, x1 + dx, y1, x2 - dx, y2, x2, y2];
    }
    if (B.rank === A.rank) {
      const down = B.y > A.y,
        x1 = A.x + A.w - 26,
        x2 = B.x + B.w - 26,
        y1 = down ? A.y + A.h : A.y,
        y2 = down ? B.y - 3 : B.y + B.h + 3;
      return [x1, y1, x1 + 60, y1 + (down ? 30 : -30), x2 + 60, y2 + (down ? -30 : 30), x2, y2];
    }
    const low = bottom + 40 + back++ * 22,
      x1 = A.x + A.w / 2 + 14,
      x2 = B.x + B.w / 2 - 14;
    return [x1, A.y + A.h, x1, low, x2, low, x2, B.y + B.h + 3];
  };
  model.edges.forEach((e) => {
    e.c = curve(e);
  });
  const H = bottom + 60 + back * 22 + 30;
  const orderNum = new Map<number, number>(
    [...model.edges].sort((a, b) => a.first - b.first).map((e, k) => [e.id, k + 1] as [number, number]),
  );
  return { W, H, geo, edges: model.edges, orderNum, journey: { actor, codes, outs, resp }, back };
}
