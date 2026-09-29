import { $ } from "../lib/dom.js";
import { esc } from "../lib/util.js";
import { S } from "../state.js";

export function outlineList(nodes) {
  return `<ol>${nodes
    .map((n) => {
      if (n.kind === "decision" || n.kind === "parallel")
        return `<li><span class="o-q" data-id="${n.id}">${esc(n.num)} ${n.kind === "parallel" ? "In parallel" : "Decide"}: ${esc(n.question || n.title)}</span><ul>${n.branches.map((b) => `<li><span class="o-b${b.implied ? " implied" : ""}">${esc(b.label)}</span> → ${b.steps.length ? outlineList(b.steps) : `<span class="o-meta">${b.implied ? "not described in the file" : "continue"}</span>`}</li>`).join("")}</ul></li>`;
      if (n.kind === "loop")
        return `<li><span class="o-loop" data-id="${n.id}">${esc(n.num)} Repeat: ${esc(n.title)}</span>${n.over ? ` <span class="o-meta">(${esc(n.over)})</span>` : ""}${outlineList(n.steps)}</li>`;
      const mk = n.creates.length
        ? ` <span class="o-meta">→ creates ${n.creates.map((c) => `<span class="mono">${esc(c.name)}</span>`).join(", ")}</span>`
        : "";
      return `<li><span class="o-title" data-id="${n.id}">${esc(n.num)} ${esc(n.title)}</span>${mk}${n.detail && n.detail !== n.title ? `<div class="o-meta">${esc(n.detail)}</div>` : ""}</li>`;
    })
    .join("")}</ol>`;
}
export function renderOutline() {
  $("view-outline").innerHTML =
    `<p class="o-meta" style="margin-top:0">Start: ${esc(S.model.trigger || "skill is invoked")}</p>` +
    outlineList(S.model.steps);
}
