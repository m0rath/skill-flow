export type MdBlock =
  | { kind: "h"; level: number; text: string; line: number; endLine: number }
  | { kind: "p"; text: string; line: number; endLine: number }
  | { kind: "ul"; items: string[]; line: number; endLine: number }
  | { kind: "ol"; items: string[]; line: number; endLine: number }
  | { kind: "code"; text: string; lang: string; line: number; endLine: number }
  | { kind: "front"; pairs: [string, string][]; line: number; endLine: number }
  | { kind: "quote"; text: string; line: number; endLine: number }
  | { kind: "hr"; line: number; endLine: number }
  | { kind: "table"; head: string[]; rows: string[][]; line: number; endLine: number };

const stripInline = (s: string) =>
  s
    .replace(/\*\*|__|`|\*/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .trim();

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());

/** Split Markdown into renderable blocks, each remembering the source line range (needed by read-with-me). */
export function parseMdBlocks(text: string): MdBlock[] {
  const lines = String(text || "").split("\n");
  const out: MdBlock[] = [];
  let i = 0;

  // Frontmatter
  if (lines[0]?.trim() === "---") {
    let j = 1;
    const pairs: [string, string][] = [];
    while (j < lines.length && lines[j].trim() !== "---") {
      const m = lines[j].match(/^([\w-]+):\s*(.*)$/);
      if (m) pairs.push([m[1], m[2].replace(/^["']|["']$/g, "")]);
      j++;
    }
    if (j < lines.length) {
      out.push({ kind: "front", pairs, line: 1, endLine: j + 1 });
      i = j + 1;
    }
  }

  while (i < lines.length) {
    const line = lines[i];
    const n = i + 1;
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = line.match(/^\s*```(\w*)/);
    if (fence) {
      const start = i;
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++]);
      if (i < lines.length) i++;
      out.push({ kind: "code", text: buf.join("\n"), lang: fence[1] || "", line: start + 1, endLine: i });
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      out.push({ kind: "h", level: h[1].length, text: h[2].trim(), line: n, endLine: n });
      i++;
      continue;
    }
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      out.push({ kind: "hr", line: n, endLine: n });
      i++;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const start = i;
      const buf: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ""));
      out.push({ kind: "quote", text: buf.join(" ").trim(), line: start + 1, endLine: i });
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const start = i;
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i]))
        items.push(lines[i++].replace(/^\s*\d+[.)]\s+/, "").trim());
      out.push({ kind: "ol", items, line: start + 1, endLine: i });
      continue;
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      const start = i;
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i]))
        items.push(lines[i++].replace(/^\s*[-*+]\s+/, "").trim());
      out.push({ kind: "ul", items, line: start + 1, endLine: i });
      continue;
    }
    if (line.includes("|") && /^\s*\|?[:\-\s|]+\|?\s*$/.test(lines[i + 1] || "")) {
      const start = i;
      const head = cells(lines[i++]);
      i++; // separator
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|")) rows.push(cells(lines[i++]));
      out.push({ kind: "table", head, rows, line: start + 1, endLine: i });
      continue;
    }
    // Paragraph: gather until a blank line or another block starter.
    const start = i;
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|\s*```|\s*>|\s*[-*+]\s|\s*\d+[.)]\s)/.test(lines[i]))
      buf.push(lines[i++]);
    out.push({ kind: "p", text: buf.join(" ").trim(), line: start + 1, endLine: i });
  }
  return out;
}

/** Plain spoken text for a block (used by read-with-me). Empty string means "say nothing". */
export function blockSpeech(b: MdBlock): string {
  switch (b.kind) {
    case "h":
      return stripInline(b.text).replace(/[.:]$/, "") + ".";
    case "p":
      return stripInline(b.text);
    case "ul":
    case "ol":
      return b.items.map((x) => stripInline(x).replace(/[.;:]?$/, ".")).join(" ");
    case "quote":
      return stripInline(b.text);
    case "code":
      return `There's a code example here, ${b.text.split("\n").length} lines long.`;
    case "front":
      return b.pairs.map(([k, v]) => `${k}: ${v.replace(/[.\s]+$/, "")}`).join(". ") + ".";
    case "table":
      return [b.head.join(", "), ...b.rows.map((r) => r.join(", "))].join(". ") + ".";
    case "hr":
      return "";
  }
}
