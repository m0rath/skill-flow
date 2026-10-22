import { arr } from "../lib/util";
import type { Branch, Create, FlowNode, Model, NodeKind } from "./types";

/** Flat lookup of every node by id, in document order (rebuilt on each normalize). */
export const index = new Map<string, FlowNode>();
/** Lookup of every node by its step number (for example "2a.1"). */
export const numIndex = new Map<string, string>();

type Raw = Record<string, unknown>;

const isRaw = (v: unknown): v is Raw => !!v && typeof v === "object" && !Array.isArray(v);
const asRaw = (v: unknown): Raw => (isRaw(v) ? v : {});
const asString = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : v == null ? fallback : String(v));

export function normCreates(list: unknown): Create[] {
  return arr<unknown>(list)
    .map((c): Create => {
      if (typeof c === "string") return { name: c, kind: "other", note: "" };
      const raw = asRaw(c);
      return {
        name: asString(raw.name ?? raw.title, "output"),
        kind: asString(raw.kind, "other"),
        note: asString(raw.note),
      };
    })
    .filter((c) => c.name.trim());
}

const KINDS: NodeKind[] = ["step", "decision", "loop", "parallel", "stop"];
const isKind = (k: string): k is NodeKind => (KINDS as string[]).includes(k);

export function normalize(input: unknown): Model {
  const m = asRaw(input);
  const out: Model = {
    title: asString(m.title || m.name, "Untitled workflow"),
    summary: asString(m.summary || m.description),
    trigger: asString(m.trigger),
    inputs: arr<unknown>(m.inputs).map((x) => asString(x)),
    notes: arr<unknown>(m.notes).map((x) => asString(x)),
    steps: [],
  };
  // Project-flow fields ride along unchanged so the project views can read them.
  const comps = arr<unknown>(m.components).filter(isRaw);
  if (comps.length)
    out.components = comps.map((c) => ({
      name: asString(c.name, "Component"),
      path: asString(c.path),
      kind: asString(c.kind, "library"),
      purpose: asString(c.purpose),
      depends: arr<unknown>(c.depends).map((x) => asString(x)),
      keyFiles: arr<unknown>(c.keyFiles).map((x) => asString(x)),
    }));
  if (arr<unknown>(m.stack).length) out.stack = arr<unknown>(m.stack).map((x) => asString(x));
  const cmds = arr<unknown>(m.commands).filter(isRaw);
  if (cmds.length)
    out.commands = cmds.map((c) => ({ cmd: asString(c.cmd || c.command), purpose: asString(c.purpose) }));
  index.clear();
  numIndex.clear();
  let seq = 0;

  // A malformed/hostile reply can nest arbitrarily deep; stop before the stack does.
  const MAX_DEPTH = 12;

  function walk(nodes: unknown, prefix: string, parent: string | null, depth = 0): FlowNode[] {
    if (depth > MAX_DEPTH) return [];
    let n = 0;
    return arr<unknown>(nodes)
      .filter(isRaw)
      .map((raw) => {
        const rawKind = asString(raw.kind || raw.type, "step").toLowerCase();
        const kind: NodeKind = isKind(rawKind)
          ? rawKind
          : rawKind.startsWith("cond") || rawKind.startsWith("branch")
            ? "decision"
            : rawKind.startsWith("end")
              ? "stop"
              : "step";
        n++;
        const num = prefix ? `${prefix}.${n}` : String(n);
        const node: FlowNode = {
          id: "n" + ++seq,
          kind,
          num,
          parent,
          title: asString(raw.title || raw.question || raw.name, "Step"),
          detail: asString(raw.detail || raw.description),
          creates: normCreates(raw.creates || raw.outputs),
          uses: arr<unknown>(raw.uses || raw.tools).map((x) => asString(x)),
          source: asString(raw.source || raw.quote),
        };
        index.set(node.id, node);
        numIndex.set(num, node.id);
        if (kind === "decision" || kind === "parallel") {
          node.question = asString(raw.question || raw.title);
          const br = arr<unknown>(raw.branches).filter(isRaw);
          if (kind === "decision" && br.length === 1) br.push({ label: "Otherwise", steps: [], implied: true });
          node.branches = br.map((b, i): Branch => ({
            label: asString(b.label || b.condition, kind === "parallel" ? "Track " + (i + 1) : "Case " + (i + 1)),
            implied: !!b.implied,
            steps: walk(b.steps, num + String.fromCharCode(97 + i), node.id, depth + 1),
          }));
        }
        if (kind === "loop") {
          node.over = asString(raw.over || raw.repeat);
          node.steps = walk(raw.steps, num, node.id, depth + 1);
        }
        return node;
      });
  }

  out.steps = walk(m.steps, "", null);
  return out;
}

/** Every node in document order (pre-order: a node, its branches, then loop bodies). */
export function flattenNodes(steps: FlowNode[]): FlowNode[] {
  const out: FlowNode[] = [];
  (function walk(list: FlowNode[]) {
    list.forEach((n) => {
      out.push(n);
      if (n.branches) n.branches.forEach((b) => walk(b.steps));
      if (n.steps) walk(n.steps);
    });
  })(steps);
  return out;
}

/** Step number → node id for one model (independent of the module-level `numIndex`). */
export function numberIndex(steps: FlowNode[]): Map<string, string> {
  const map = new Map<string, string>();
  flattenNodes(steps).forEach((n) => map.set(n.num, n.id));
  return map;
}

/** Every node, flattened, in document order. */
export const ordered = (): FlowNode[] => [...index.values()];

/** Count the descendants of a node (branches and loop bodies included). */
export function descCount(n: FlowNode): number {
  let c = 0;
  (function w(ns: FlowNode[]) {
    ns.forEach((x) => {
      c++;
      if (x.branches) x.branches.forEach((b) => w(b.steps));
      if (x.steps) w(x.steps);
    });
  })(n.branches ? n.branches.flatMap((b) => b.steps) : n.steps || []);
  return c;
}

export interface CreateEntry {
  name: string;
  kind: string;
  by: FlowNode[];
}

/** Every output created anywhere in the flow, grouped by name. */
export function allCreates(): CreateEntry[] {
  const map = new Map<string, CreateEntry>();
  ordered().forEach((n) =>
    n.creates.forEach((c) => {
      let e = map.get(c.name);
      if (!e) {
        e = { name: c.name, kind: c.kind, by: [] };
        map.set(c.name, e);
      }
      e.by.push(n);
    }),
  );
  return [...map.values()];
}

export function counts(): { step: number; decision: number; loop: number } {
  const c = { step: 0, decision: 0, loop: 0 };
  ordered().forEach((n) => {
    if (n.kind === "decision") c.decision++;
    else if (n.kind === "loop") c.loop++;
    else if (n.kind !== "parallel") c.step++;
  });
  return c;
}
