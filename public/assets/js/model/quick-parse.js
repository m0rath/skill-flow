const FILE_RE =
  /`?((?:[\w.\-<>{}~]+\/)*[\w.\-<>{}]+\.(?:md|mdx|json|html?|pdf|docx|xlsx|pptx|csv|tsv|txt|py|js|ts|sh|ya?ml|png|jpe?g|svg|zip|xml|sql))`?/gi;
const MAKE_VERB = /\b(creat|writ|sav|generat|output|produc|export|build|emit|render|append|store|draft)\w*/i;
export const INPUT_DIR = /^(templates?|references?|scripts?|examples?|assets?|docs?)\//i;
export function frontmatter(text) {
  const m = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  m[1].split("\n").forEach((l) => {
    const k = l.match(/^([\w-]+):\s*(.*)$/);
    if (k) meta[k[1]] = k[2].replace(/^["']|["']$/g, "");
  });
  return { meta, body: text.slice(m[0].length) };
}
const clean = (s) =>
  s
    .replace(/\*\*|__|`/g, "")
    .replace(/^\s*(step|phase|stage)\s*\d+\s*[:.\-–)]\s*/i, "")
    .replace(/^\s*\d+[.)]\s*/, "")
    .trim();
export function shortTitle(s) {
  s = clean(s);
  const cut = s.split(/(?<=[.;:])\s|,\s(?=(?:then|and|if|when)\b)/)[0];
  return (cut.length > 64 ? cut.slice(0, 61).replace(/\s\S*$/, "") + "…" : cut).replace(/[.:]$/, "");
}
export function extract(body) {
  const creates = [],
    uses = [],
    seen = new Set();
  body.split(/(?<=[.!?])\s+|\n/).forEach((sent) => {
    const verb = MAKE_VERB.test(sent);
    for (const m of sent.matchAll(FILE_RE)) {
      const f = m[1];
      if (seen.has(f)) continue;
      seen.add(f);
      if (verb && !INPUT_DIR.test(f)) creates.push({ name: f, kind: "file" });
      else uses.push(f);
    }
  });
  for (const m of body.matchAll(/`([^`\n]{2,60})`/g)) {
    const t = m[1].trim();
    FILE_RE.lastIndex = 0;
    if (!seen.has(t) && !FILE_RE.test(t) && /^[\w.\-/ <>]+$/.test(t) && t.split(" ").length <= 4) {
      seen.add(t);
      uses.push(t);
    }
    FILE_RE.lastIndex = 0;
  }
  return { creates, uses: uses.slice(0, 6) };
}
export function splitCondition(line) {
  const s = clean(line.replace(/^\s*[-*+]\s*/, ""));
  const m = s.match(/^(if|when|unless|in case|for)\s+(.+?)(?:,\s*|\s+then\s+|:\s*)(.+)$/i);
  if (m) return { cond: (m[1].toLowerCase() === "unless" ? "Unless " : "") + m[2], then: m[3] };
  const o = s.match(/^otherwise,?\s*(.+)$/i);
  if (o) return { cond: "Otherwise", then: o[1] };
  return { cond: s.slice(0, 50), then: s };
}
export function sectionToNodes(title, lines) {
  const body = lines.join("\n");
  const { creates, uses } = extract(title + "\n" + body);
  const prose = lines
    .filter((l) => l.trim() && !/^\s*([-*+]|\d+[.)])\s/.test(l) && !/^\s*(if|when|unless|otherwise)\b/i.test(l))
    .join(" ")
    .trim();
  const condLines = lines.filter((l) => /^\s*([-*+]\s*)?(if|when|unless|otherwise|in case)\b/i.test(l));
  const subItems = lines.filter((l) => /^\s*\d+[.)]\s+/.test(l)).map((l) => l.replace(/^\s*\d+[.)]\s+/, ""));
  const loopM = (title + " " + body).match(
    /\b(for each|for every|repeat(?:ing)?|iterate over|loop over|until)\b([^.\n:]{0,70})/i,
  );
  const node = {
    kind: "step",
    title: shortTitle(title),
    detail: (clean(prose) || clean(title)).slice(0, 320),
    creates,
    uses,
    source: (lines.find((l) => l.trim()) || title).trim().slice(0, 140),
  };
  if (loopM && subItems.length) {
    node.kind = "loop";
    node.over = (loopM[1] + loopM[2]).trim();
    node.steps = subItems.map((s) => ({
      kind: "step",
      title: shortTitle(s),
      detail: clean(s),
      source: s.slice(0, 140),
      ...extract(s),
    }));
  } else if (loopM) {
    node.kind = "loop";
    node.over = (loopM[1] + loopM[2]).trim();
    node.steps = [{ kind: "step", title: node.title, detail: node.detail }];
  }
  const res = [node];
  if (condLines.length) {
    const parts = condLines.map(splitCondition);
    const q = parts.length === 1 ? parts[0].cond.replace(/[.?]$/, "") + "?" : "Which case applies?";
    const mk = (p) => ({
      kind: "step",
      title: shortTitle(p.then),
      detail: clean(p.then),
      source: p.then.slice(0, 140),
      ...extract(p.then),
    });
    res.push({
      kind: "decision",
      title: q,
      question: q,
      source: condLines[0].trim().slice(0, 140),
      branches:
        parts.length === 1
          ? [
              { label: "Yes", steps: [mk(parts[0])] },
              { label: "No", steps: [], implied: true },
            ]
          : parts.map((p) => ({ label: p.cond.slice(0, 48), steps: [mk(p)] })),
    });
  }
  return res;
}
export function quickParse(files) {
  const primary = files.find((f) => /(^|\/)skill\.md$/i.test(f.path)) || files[0];
  const { meta, body } = frontmatter(primary.text);
  const sections = [];
  let cur = { level: 0, title: "", lines: [] },
    inCode = false;
  body.split("\n").forEach((l) => {
    if (/^\s*```/.test(l)) inCode = !inCode;
    const h = !inCode && l.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      sections.push(cur);
      cur = { level: h[1].length, title: h[2].trim(), lines: [] };
    } else cur.lines.push(l);
  });
  sections.push(cur);
  const h1 = sections.find((s) => s.level === 1);
  const SKIP =
    /^(inputs?|prerequisites?|requirements?|rules|notes?|guidelines?|references?|examples?|overview|about|introduction|faq|tips|gotchas|troubleshooting|resources|output format|when to use)\b/i;
  const inputsSec = sections.find((s) => /^(inputs?|prerequisites?|requirements?|what you need)/i.test(clean(s.title)));
  const notesSec = sections.find((s) =>
    /^(rules|guidelines|notes?|constraints|gotchas|important)/i.test(clean(s.title)),
  );
  const listItems = (sec) =>
    sec
      ? sec.lines
          .filter((l) => /^\s*([-*+]|\d+[.)])\s/.test(l))
          .map((l) => clean(l.replace(/^\s*([-*+]|\d+[.)])\s+/, "")))
      : [];
  let steps = [];
  const stepHeads = sections.filter(
    (s) => s.level >= 2 && /^(\**\s*)?(step|phase|stage)\s*\d+|^\d+[.)]\s/i.test(s.title),
  );
  if (stepHeads.length >= 2) steps = stepHeads.flatMap((s) => sectionToNodes(s.title, s.lines));
  else {
    const items = [];
    let it = null;
    sections
      .filter((s) => !SKIP.test(clean(s.title)))
      .forEach((s) =>
        s.lines.forEach((l) => {
          const m = l.match(/^(\d+)[.)]\s+(.*)$/);
          if (m) {
            it = { title: m[2], lines: [m[2]] };
            items.push(it);
          } else if (it && /^\s{2,}\S/.test(l)) it.lines.push(l.trim());
          else if (l.trim()) it = null;
        }),
      );
    if (items.length >= 2) steps = items.flatMap((i) => sectionToNodes(i.title, i.lines));
    else
      steps = sections
        .filter((s) => s.level === 2 && !SKIP.test(clean(s.title)))
        .flatMap((s) => sectionToNodes(s.title, s.lines));
  }
  if (!steps.length)
    steps = [
      {
        kind: "step",
        title: "No clear steps found",
        detail: "This file has no numbered steps or step headings. Try mapping with AI for a better read.",
      },
    ];
  return {
    title: meta.name || (h1 && clean(h1.title)) || primary.path,
    summary: meta.description || "",
    trigger: (meta.description || "").match(/\buse (?:this )?(?:skill )?when\b(.*)/i)?.[0] || "",
    inputs: listItems(inputsSec),
    notes: listItems(notesSec).slice(0, 8),
    steps,
  };
}
