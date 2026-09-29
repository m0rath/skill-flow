export const FENCE = "`".repeat(3);
export function parseReply(text) {
  const i = text.indexOf(FENCE + "edits");
  if (i < 0) return { display: text.trim(), edits: null, open: false };
  const rest = text.slice(i + FENCE.length + 5);
  const j = rest.indexOf(FENCE);
  const body = j >= 0 ? rest.slice(0, j) : rest;
  let edits = null;
  if (j >= 0) {
    try {
      edits = JSON.parse(body.trim());
    } catch (e) {
      const a = body.indexOf("["),
        b = body.lastIndexOf("]");
      if (a >= 0 && b > a) {
        try {
          edits = JSON.parse(body.slice(a, b + 1));
        } catch (_) {}
      }
    }
  }
  return {
    display: text.slice(0, i).trim(),
    edits: Array.isArray(edits)
      ? edits.filter((x) => x && typeof x.find === "string" && typeof x.replace === "string")
      : null,
    open: j < 0,
  };
}
export function applyEdit(text, find, replace) {
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
  if (m) return text.slice(0, m.index) + replace.trim() + text.slice(m.index + m[0].length);
  return null;
}
