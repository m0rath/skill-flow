// Line-based text diff: the common prefix and suffix are trimmed, then an LCS table aligns the changed middle.
// Skill files are small and edits are local, so this stays fast without a full Myers implementation.

const MAX_CELLS = 4_000_000;

export type DiffType = "eq" | "del" | "add";

export interface DiffOp {
  type: DiffType;
  text: string;
  a: number | null;
  b: number | null;
}

/**
 * Diff two texts line by line.
 * Returns ops where `a` and `b` are 1-based line numbers in the old and new text
 * (null when the line isn't in that side).
 */
export function diffLines(oldText: string, newText: string): DiffOp[] {
  const A = splitLines(oldText);
  const B = splitLines(newText);
  let start = 0;
  while (start < A.length && start < B.length && A[start] === B[start]) start++;
  let endA = A.length;
  let endB = B.length;
  while (endA > start && endB > start && A[endA - 1] === B[endB - 1]) {
    endA--;
    endB--;
  }
  const ops: DiffOp[] = [];
  const eq = (i: number, j: number) => ops.push({ type: "eq", text: A[i], a: i + 1, b: j + 1 });
  for (let i = 0; i < start; i++) eq(i, i);
  middle(A.slice(start, endA), B.slice(start, endB), start, ops);
  for (let i = endA, j = endB; i < A.length; i++, j++) eq(i, j);
  return ops;
}

function splitLines(text: string): string[] {
  const s = String(text ?? "");
  if (!s) return [];
  const lines = s.split(/\r?\n/);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function middle(A: string[], B: string[], off: number, ops: DiffOp[]) {
  const n = A.length;
  const m = B.length;
  const del = (i: number) => ops.push({ type: "del", text: A[i], a: off + i + 1, b: null });
  const add = (j: number) => ops.push({ type: "add", text: B[j], a: null, b: off + j + 1 });
  if (n * m > MAX_CELLS) {
    for (let i = 0; i < n; i++) del(i);
    for (let j = 0; j < m; j++) add(j);
    return;
  }
  const w = m + 1;
  const lcs = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i * w + j] =
        A[i] === B[j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      ops.push({ type: "eq", text: A[i], a: off + i + 1, b: off + j + 1 });
      i++;
      j++;
    } else if (lcs[(i + 1) * w + j] >= lcs[i * w + j + 1]) del(i++);
    else add(j++);
  }
  while (i < n) del(i++);
  while (j < m) add(j++);
}

/** Count added and removed lines. */
export function diffStats(ops: DiffOp[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const o of ops) {
    if (o.type === "add") added++;
    else if (o.type === "del") removed++;
  }
  return { added, removed };
}

/** Group ops into hunks: runs of changes with up to `context` unchanged lines around them. */
export function hunks(ops: DiffOp[], context = 3): DiffOp[][] {
  const ranges: [number, number][] = [];
  ops.forEach((o, k) => {
    if (o.type === "eq") return;
    const from = Math.max(0, k - context);
    const to = Math.min(ops.length, k + context + 1);
    const last = ranges[ranges.length - 1];
    if (last && from <= last[1]) last[1] = to;
    else ranges.push([from, to]);
  });
  return ranges.map(([from, to]) => ops.slice(from, to));
}

/** Render one file's changes as a unified diff (the format `git apply` and `patch` read). */
export function unifiedDiff(path: string, oldText: string, newText: string, context = 3): string {
  const ops = diffLines(oldText, newText);
  const hs = hunks(ops, context);
  if (!hs.length) return "";
  const lines = [`--- a/${path}`, `+++ b/${path}`];
  for (const h of hs) {
    const aLines = h.filter((o) => o.type !== "add");
    const bLines = h.filter((o) => o.type !== "del");
    const aStart = aLines.length ? (aLines[0].a as number) : startBefore(h, "a", ops);
    const bStart = bLines.length ? (bLines[0].b as number) : startBefore(h, "b", ops);
    lines.push(`@@ -${aStart},${aLines.length} +${bStart},${bLines.length} @@`);
    for (const o of h) lines.push((o.type === "add" ? "+" : o.type === "del" ? "-" : " ") + o.text);
  }
  return lines.join("\n") + "\n";
}

function startBefore(hunk: DiffOp[], side: "a" | "b", ops: DiffOp[]): number {
  const k = ops.indexOf(hunk[0]);
  for (let i = k - 1; i >= 0; i--) if (ops[i][side] != null) return ops[i][side] as number;
  return 0;
}
