/** Plain-text outline with step numbers, sent to the AI so it can refer to steps. */
export function outlineText(nodes, ind = "") {
  return nodes
    .map((n) => {
      if (n.branches)
        return (
          `${ind}${n.num} [${n.kind}] ${n.question || n.title}\n` +
          n.branches
            .map(
              (b) =>
                `${ind}  - branch "${b.label}"${b.implied ? " (not described in file)" : ""}:\n` +
                (b.steps.length ? outlineText(b.steps, ind + "    ") : `${ind}    (continue)\n`),
            )
            .join("")
        );
      if (n.kind === "loop")
        return (
          `${ind}${n.num} [loop] ${n.title}${n.over ? " — repeats for " + n.over : ""}\n` +
          outlineText(n.steps, ind + "  ")
        );
      return `${ind}${n.num} [${n.kind}] ${n.title}${n.creates.length ? " (creates: " + n.creates.map((c) => c.name).join(", ") + ")" : ""}\n`;
    })
    .join("");
}
/** Mermaid flowchart source for the workflow. */
export function toMermaid(steps) {
  const lines = ["flowchart TD"];
  let k = 0;
  const lab = (s) =>
    '"' + String(s).replace(/"/g, "#quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;").slice(0, 110) + '"';
  const link = (prev, id) =>
    prev.forEach((p) => lines.push(`  ${p.id} -->${p.label ? "|" + lab(p.label) + "|" : ""} ${id}`));
  function emit(nodes, prev) {
    nodes.forEach((n) => {
      const id = "N" + ++k;
      if (n.branches) {
        lines.push(`  ${id}{${lab(n.num + " " + (n.question || n.title))}}`);
        link(prev, id);
        let ends = [];
        n.branches.forEach((b) => {
          ends = ends.concat(b.steps.length ? emit(b.steps, [{ id, label: b.label }]) : [{ id, label: b.label }]);
        });
        prev = ends;
      } else if (n.kind === "loop") {
        lines.push(`  ${id}[/${lab(n.num + " Repeat: " + n.title + (n.over ? " (" + n.over + ")" : ""))}/]`);
        link(prev, id);
        emit(n.steps, [{ id }]).forEach((e) => lines.push(`  ${e.id} -.->|"next"| ${id}`));
        prev = [{ id, label: "done" }];
      } else {
        lines.push(
          `  ${id}[${lab(n.num + " " + n.title + (n.creates.length ? " | creates: " + n.creates.map((c) => c.name).join(", ") : ""))}]`,
        );
        link(prev, id);
        prev = [{ id }];
      }
    });
    return prev;
  }
  lines.push(`  S((${lab("Start")}))`);
  const ends = emit(steps, [{ id: "S" }]);
  lines.push(`  E((${lab("Done")}))`);
  link(ends, "E");
  return lines.join("\n");
}
