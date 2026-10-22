const HTML_ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escape HTML-significant characters. Used by the small Markdown renderer. */
export function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => HTML_ENTITIES[c] ?? c);
}

/** Wrap a value in an array unless it already is one; drop null/undefined/empty string. */
export function arr<T>(x: T | T[] | null | undefined): T[] {
  if (Array.isArray(x)) return x;
  if (x == null) return [];
  if (typeof x === "string" && !x) return [];
  return [x];
}

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
