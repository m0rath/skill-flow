/** Parse JSON out of a model reply, tolerating code fences and surrounding prose. */
export function parseJsonLoose(t: string): unknown {
  const s = String(t ?? "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n");
  const tries = [s.trim()];
  for (const f of s.matchAll(/```(?:json)?\s*\n?([\s\S]*?)```/gi)) tries.push(f[1].trim());
  const a = Math.min(...["{", "["].map((c) => s.indexOf(c)).filter((i) => i >= 0));
  const b = Math.max(s.lastIndexOf("}"), s.lastIndexOf("]"));
  if (Number.isFinite(a) && b > a) tries.push(s.slice(a, b + 1));
  for (const candidate of tries) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      /* try the next candidate */
    }
  }
  return undefined;
}
