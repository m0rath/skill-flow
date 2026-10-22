import type { Edit } from "../model/types";

export const FENCE = "`".repeat(3);

export interface ParsedReply {
  display: string;
  edits: Edit[] | null;
  open: boolean;
}

/** Keep only well-formed edits; a missing `file` is left empty (the caller falls back to matching). */
function toEdits(v: unknown): Edit[] | null {
  if (!Array.isArray(v)) return null;
  const out = v.flatMap((x): Edit[] => {
    if (!x || typeof x !== "object") return [];
    const r = x as Record<string, unknown>;
    if (typeof r.find !== "string" || typeof r.replace !== "string") return [];
    return [{ file: typeof r.file === "string" ? r.file : "", find: r.find, replace: r.replace }];
  });
  return out.length ? out : null;
}

function parseEdits(body: string): Edit[] | null {
  try {
    return toEdits(JSON.parse(body.trim()) as unknown);
  } catch {
    const a = body.indexOf("[");
    const b = body.lastIndexOf("]");
    if (a >= 0 && b > a) {
      try {
        return toEdits(JSON.parse(body.slice(a, b + 1)) as unknown);
      } catch {
        /* ignore malformed block */
      }
    }
    return null;
  }
}

/** Split a chat reply into the prose shown to the user and any `edits` fenced block. */
export function parseReply(text: string): ParsedReply {
  const i = text.indexOf(FENCE + "edits");
  if (i < 0) return { display: text.trim(), edits: null, open: false };
  const rest = text.slice(i + FENCE.length + 5);
  const j = rest.indexOf(FENCE);
  const body = j >= 0 ? rest.slice(0, j) : rest;
  return {
    display: text.slice(0, i).trim(),
    edits: parseEdits(body),
    open: j < 0,
  };
}

/** Apply one find/replace edit. Falls back to whitespace-tolerant matching. */
export function applyEdit(text: string, find: string, replace: string): string | null {
  if (find === "") return null;
  const i = text.indexOf(find);
  if (i >= 0) return text.slice(0, i) + replace + text.slice(i + find.length);
  const pat = find
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
  if (!pat) return null;
  const m = text.match(new RegExp(pat));
  if (m && m.index != null) return text.slice(0, m.index) + replace.trim() + text.slice(m.index + m[0].length);
  return null;
}
