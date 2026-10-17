/** Parse JSON out of a model reply, tolerating code fences and surrounding prose. */
export function parseJsonLoose(t: string): unknown {
  const tries = [t.trim()];
  const f = t.match(/```(?:json)?\s*\n([\s\S]*?)```/);
  if (f) tries.push(f[1].trim());
  const a = Math.min(...["{", "["].map((c) => t.indexOf(c)).filter((i) => i >= 0));
  const b = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
  if (isFinite(a) && b > a) tries.push(t.slice(a, b + 1));
  for (const s of tries) {
    try {
      return JSON.parse(s);
    } catch {
      /* try the next candidate */
    }
  }
  return undefined;
}
