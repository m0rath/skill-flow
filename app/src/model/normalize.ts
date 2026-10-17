import { arr } from "../lib/util";
import type { Branch, Create, FlowNode, Model, NodeKind } from "./types";

/** Flat lookup of every node by id, in document order (rebuilt on each normalize). */
export const index = new Map<string, FlowNode>();
/** Lookup of every node by its step number (for example "2a.1"). */
export const numIndex = new Map<string, string>();

export function normCreates(list: unknown): Create[] {
  return arr(list as unknown)
    .map((c) =>
      typeof c === "string"
        ? { name: c, kind: "other", note: "" }
        : {
            name: String((c as Create).name ?? (c as { title?: string }).title ?? "output"),
            kind: String((c as Create).kind ?? "other"),
            note: (c as Create).note ? String((c as Create).note) : "",
          },
    )
    .filter((c) => c.name.trim());
}

const KINDS: NodeKind[] = ["step", "decision", "loop", "parallel", "stop"];
const isKind = (k: string): k is NodeKind => (KINDS as string[]).includes(k);

export function normalize(input: unknown): Model {
  const m = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const out: Model = {
    title: String(m.title || m.name || "Untitled workflow"),
    summary: String(m.summary || m.description || ""),
    trigger: String(m.trigger || ""),
    inputs: arr(m.inputs as unknown).map(String),
    notes: arr(m.notes as unknown).map(String),
    steps: [],
  };
  // Project-flow fields ride along unchanged so the project views can read them.
  const comps = arr(m.components).filter((c): c is Record<string, unknown> => !!c && typeof c === "object");
  if (comps.length)
    out.components = comps.map((c) => ({
      name: String(c.name || "Component"),
      path: String(c.path || ""),
      kind: String(c.kind || "library"),
      purpose: String(c.purpose || ""),
      depends: arr(c.depends).map(String),
      keyFiles: arr(c.keyFiles).map(String),
    }));
  if (arr(m.stack).length) out.stack = arr(m.stack).map(String);
  const cmds = arr(m.commands).filter((c): c is Record<string, unknown> => !!c && typeof c === "object");
  if (cmds.length)
    out.commands = cmds.map((c) => ({ cmd: String(c.cmd || c.command || ""), purpose: String(c.purpose || "") }));
  index.clear();
  numIndex.clear();
  let seq = 0;

  function walk(nodes: unknown, prefix: string, parent: string | null): FlowNode[] {
    let n = 0;
    return arr(nodes as unknown)
      .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
      .map((raw) => {
        const rawKind = String(raw.kind || raw.type || "step").toLowerCase();
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
          title: String(raw.title || raw.question || raw.name || "Step"),
          detail: String(raw.detail || raw.description || ""),
          creates: normCreates(raw.creates || raw.outputs),
          uses: arr(raw.uses || raw.tools).map(String),
          source: String(raw.source || raw.quote || ""),
        };
        index.set(node.id, node);
        numIndex.set(num, node.id);
        if (kind === "decision" || kind === "parallel") {
          node.question = String(raw.question || raw.title || "");
          const br = arr(raw.branches).filter((b): b is Record<string, unknown> => !!b && typeof b === "object");
          if (kind === "decision" && br.length === 1) br.push({ label: "Otherwise", steps: [], implied: true });
          node.branches = br.map((b, i): Branch => ({
            label: String(b.label || b.condition || (kind === "parallel" ? "Track " + (i + 1) : "Case " + (i + 1))),
            implied: !!b.implied,
            steps: walk(b.steps, num + String.fromCharCode(97 + i), node.id),
          }));
        }
        if (kind === "loop") {
          node.over = String(raw.over || raw.repeat || "");
          node.steps = walk(raw.steps, num, node.id);
        }
        return node;
      });
  }

  out.steps = walk(m.steps, "", null);
  return out;
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
      if (!map.has(c.name)) map.set(c.name, { name: c.name, kind: c.kind, by: [] });
      (map.get(c.name) as CreateEntry).by.push(n);
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
