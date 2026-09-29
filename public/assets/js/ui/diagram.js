import { $, toast } from "../lib/dom.js";
import { esc } from "../lib/util.js";
import { flaggedIds } from "../model/checks.js";
import { allCreates, descCount, ordered } from "../model/normalize.js";
import { toMermaid } from "../model/serialize.js";
import { S } from "../state.js";
import { goTo, step } from "./navigation.js";
import { dView } from "./viewport.js";

export const ICON_FILE =
  '<svg width="10" height="11" viewBox="0 0 10 11" aria-hidden="true"><path d="M1 1h5l3 3v6H1z" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>';
const ICON_LOOP =
  '<svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><path d="M13 8a5 5 0 1 1-1.5-3.5M13 2v3h-3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
export function chips(n) {
  let h = "";
  if (n.creates.length)
    h += `<div class="chiprow"><span class="lbl">makes</span><div class="chips">${n.creates.map((c) => `<span class="chip make">${ICON_FILE}${esc(c.name)}</span>`).join("")}</div></div>`;
  if (n.uses.length)
    h += `<div class="chiprow"><span class="lbl">uses</span><div class="chips">${n.uses
      .slice(0, 3)
      .map((u) => `<span class="chip use">${esc(u)}</span>`)
      .join("")}${n.uses.length > 3 ? `<span class="chip use">+${n.uses.length - 3}</span>` : ""}</div></div>`;
  return h;
}
const wire = (arrow = true, grow = false) => `<div class="wire${arrow ? " arrow" : ""}${grow ? " grow" : ""}"></div>`;
let FLAGS = new Set();
export function renderNode(n) {
  const sel = S.sel === n.id ? " sel" : "",
    flag = FLAGS.has(n.id) ? " flag" : "";
  const col = S.collapsed.has(n.id);
  const fold =
    n.branches || (n.steps && n.steps.length)
      ? `<button type="button" class="fold" data-fold="${n.id}" aria-label="${col ? "Expand" : "Collapse"}">${col ? "Expand" : "Collapse"}</button>`
      : "";
  // A box that holds its own Collapse button can't also be a button, so it becomes a labelled group instead.
  const attrs = `data-id="${n.id}" tabindex="0" ${fold ? `role="group" aria-label="${esc(n.num)} ${esc(n.question || n.title)}"` : 'role="button"'}`;
  if (n.kind === "decision" || n.kind === "parallel") {
    const isPar = n.kind === "parallel";
    const head = isPar
      ? `<div class="parhead${sel}" ${attrs}>${esc(n.num)} · In parallel${n.title && n.title !== "Step" ? " · " + esc(n.title) : ""}${fold}</div>`
      : `<div class="node decision${sel}${flag}" ${attrs}><div class="top"><span class="diamond"></span><span class="num">${esc(n.num)}</span><span class="kind">Decision</span>${fold}</div><h3>${esc(n.question || n.title)}</h3>${n.detail ? `<p>${esc(n.detail)}</p>` : ""}${chips(n)}</div>`;
    if (col)
      return `<div class="flow">${head}${wire()}<button type="button" class="folded" data-fold="${n.id}">${n.branches.map((b) => esc(b.label)).join(" / ")} · ${descCount(n)} steps hidden</button></div>`;
    const branches = n.branches
      .map(
        (b) =>
          `<div class="branch">${wire(false)}<span class="blabel${isPar ? " par" : ""}${b.implied ? " implied" : ""}">${esc(b.label)}</span>${b.steps.length ? wire() + renderFlow(b.steps) : wire(false) + (b.implied ? `<span class="skip implied">Not described</span>` : `<span class="skip">${isPar ? "nothing" : "continue"}</span>`)}${wire(false, true)}</div>`,
      )
      .join("");
    return `<div class="flow">${head}${wire(false)}<div class="branches">${branches}</div>${wire(false)}<div class="merge"></div></div>`;
  }
  if (n.kind === "loop") {
    const head = `<div class="loophead${sel}" ${attrs}>${ICON_LOOP}<span class="num">${esc(n.num)}</span><span>${esc(n.title)}${n.over ? ` <span style="font-weight:500">· ${esc(n.over)}</span>` : ""}</span>${fold}</div>`;
    if (col)
      return `<div class="loop">${head}${wire()}<button type="button" class="folded" data-fold="${n.id}">${descCount(n)} steps hidden</button></div>`;
    return `<div class="loop">${head}${wire()}${renderFlow(n.steps)}<div class="loopback">${ICON_LOOP} repeat</div></div>`;
  }
  const k = n.kind === "stop" ? "stop" : "step";
  return `<div class="node ${k}${sel}${flag}" ${attrs} title="${esc(n.detail)}"><div class="top"><span class="num">${esc(n.num)}</span><span class="kind">${k === "stop" ? "Stop" : "Step"}</span></div><h3>${esc(n.title)}</h3>${n.detail && n.detail !== n.title ? `<p>${esc(n.detail)}</p>` : ""}${chips(n)}</div>`;
}
export function renderFlow(nodes) {
  return `<div class="flow">${nodes.map((n, i) => (i ? wire() : "") + renderNode(n)).join("")}</div>`;
}
export function renderDiagram() {
  FLAGS = flaggedIds();
  const m = S.model,
    outs = allCreates().length;
  $("dInner").innerHTML =
    `<div class="flow"><div class="term"><span class="eyebrow">Start</span>${esc(m.trigger || "Skill is invoked")}</div>${wire()}${renderFlow(m.steps)}${wire()}<div class="term end"><span class="eyebrow">Done</span>${outs ? outs + " output" + (outs > 1 ? "s" : "") + " produced" : "Workflow complete"}</div></div>`;
  $("jump").innerHTML =
    `<option value="">Jump to step…</option>` +
    ordered()
      .map(
        (n) =>
          `<option value="${n.id}"${S.sel === n.id ? " selected" : ""}>${esc(n.num)} · ${esc((n.kind === "decision" ? n.question || n.title : n.title).slice(0, 48))}</option>`,
      )
      .join("");
}
export function initDiagram() {
  $("dPrev").onclick = () => step(-1);
  $("dNext").onclick = () => step(1);
  $("jump").onchange = (e) => goTo(e.target.value, "diagram");
  $("dFit").onclick = () => dView.fit("width");
  $("dIn").onclick = () => dView.zoomBy(1.2);
  $("dOut").onclick = () => dView.zoomBy(1 / 1.2);
  $("dCollapse").onclick = () => {
    ordered().forEach((n) => {
      if ((n.branches || n.kind === "loop") && n.parent) S.collapsed.add(n.id);
    });
    renderDiagram();
    dView.fit("width");
  };
  $("dExpand").onclick = () => {
    S.collapsed.clear();
    renderDiagram();
  };
  $("mermaidBtn").onclick = async () => {
    try {
      await navigator.clipboard.writeText(toMermaid(S.model.steps));
      toast("Mermaid code copied");
    } catch (e) {
      toast("The clipboard is blocked in this view.");
    }
  };
}
