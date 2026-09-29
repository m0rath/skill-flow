import { arr } from "../lib/util.js";

export const index = new Map(),
  numIndex = new Map();
export function normCreates(list) {
  return arr(list)
    .map((c) =>
      typeof c === "string"
        ? { name: c, kind: "other", note: "" }
        : {
            name: String(c.name ?? c.title ?? "output"),
            kind: String(c.kind ?? "other"),
            note: c.note ? String(c.note) : "",
          },
    )
    .filter((c) => c.name.trim());
}
export function normalize(m) {
  m = m && typeof m === "object" ? m : {};
  const out = {
    title: String(m.title || m.name || "Untitled workflow"),
    summary: String(m.summary || m.description || ""),
    trigger: String(m.trigger || ""),
    inputs: arr(m.inputs).map(String),
    notes: arr(m.notes).map(String),
    steps: [],
  };
  index.clear();
  numIndex.clear();
  let seq = 0;
  function walk(nodes, prefix, parent) {
    let n = 0;
    return arr(nodes)
      .filter((x) => x && typeof x === "object")
      .map((raw) => {
        let kind = String(raw.kind || raw.type || "step").toLowerCase();
        if (!["step", "decision", "loop", "parallel", "stop"].includes(kind))
          kind =
            kind.startsWith("cond") || kind.startsWith("branch")
              ? "decision"
              : kind.startsWith("end")
                ? "stop"
                : "step";
        n++;
        const num = prefix ? `${prefix}.${n}` : String(n);
        const node = {
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
          let br = arr(raw.branches).filter((b) => b && typeof b === "object");
          if (kind === "decision" && br.length === 1) br.push({ label: "Otherwise", steps: [], implied: true });
          node.branches = br.map((b, i) => ({
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
export const ordered = () => [...index.values()];
export function descCount(n) {
  let c = 0;
  (function w(ns) {
    ns.forEach((x) => {
      c++;
      if (x.branches) x.branches.forEach((b) => w(b.steps));
      if (x.steps) w(x.steps);
    });
  })(n.branches ? n.branches.flatMap((b) => b.steps) : n.steps || []);
  return c;
}
export function allCreates() {
  const map = new Map();
  ordered().forEach((n) =>
    n.creates.forEach((c) => {
      if (!map.has(c.name)) map.set(c.name, { name: c.name, kind: c.kind, by: [] });
      map.get(c.name).by.push(n);
    }),
  );
  return [...map.values()];
}
export function counts() {
  const c = { step: 0, decision: 0, loop: 0 };
  ordered().forEach((n) => {
    if (n.kind === "decision") c.decision++;
    else if (n.kind === "loop") c.loop++;
    else if (n.kind !== "parallel") c.step++;
  });
  return c;
}
