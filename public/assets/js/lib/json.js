export function parseJsonLoose(t) {
  const tries = [t.trim()];
  const f = t.match(/```(?:json)?\s*\n([\s\S]*?)```/);
  if (f) tries.push(f[1].trim());
  const a = Math.min(...["{", "["].map((c) => t.indexOf(c)).filter((i) => i >= 0)),
    b = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
  if (isFinite(a) && b > a) tries.push(t.slice(a, b + 1));
  for (const s of tries) {
    try {
      return JSON.parse(s);
    } catch (e) {}
  }
  return undefined;
}
