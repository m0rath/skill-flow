/** Escape HTML-significant characters. Used by the small Markdown renderer. */
export function esc(s: unknown): string {
  return String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

/** Wrap a value in an array unless it already is one; drop null/undefined/empty string. */
export function arr<T>(x: T | T[] | null | undefined): T[] {
  if (Array.isArray(x)) return x;
  return x == null || (x as unknown) === "" ? [] : [x as T];
}

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
