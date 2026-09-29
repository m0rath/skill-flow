import { sendChat, setScope } from "../ai/chat.js";
import { $ } from "../lib/dom.js";
import { esc } from "../lib/util.js";
import { suggCount } from "../model/checks.js";
import { allCreates, counts, index } from "../model/normalize.js";
import { S } from "../state.js";
import { ICON_FILE } from "./diagram.js";
import { openChat, setTab } from "./navigation.js";

export function renderSummary() {
  const m = S.model,
    c = counts(),
    gaps = suggCount();
  $("summary").innerHTML =
    `<div><span class="eyebrow">Workflow</span><h2>${esc(m.title)}</h2>${m.summary ? `<p class="desc">${esc(m.summary)}</p>` : ""}${m.trigger ? `<div class="trigger"><span class="eyebrow">Runs when</span><span>${esc(m.trigger)}</span></div>` : ""}</div>
  <div class="stats"><div class="stat s"><b>${c.step}</b><span>steps</span></div><div class="stat d"><b>${c.decision}</b><span>decisions</span></div><div class="stat l"><b>${c.loop}</b><span>repeats</span></div><div class="stat m"><b>${allCreates().length}</b><span>outputs</span></div><div class="stat g"><b>${gaps}</b><span>possible gaps</span></div></div>`;
  $("suggBadge").hidden = !gaps;
  $("suggBadge").textContent = gaps;
}
export function renderSideStatic() {
  const mk = allCreates();
  $("makeCount").textContent = mk.length;
  $("makes").innerHTML = mk.length
    ? mk
        .map(
          (c) =>
            `<li><span class="ic">${ICON_FILE}</span><span class="nm">${esc(c.name)}</span><span class="by">made in ${c.by.map((n) => `<button type="button" data-id="${n.id}">step ${esc(n.num)}</button>`).join(", ")}</span></li>`,
        )
        .join("")
    : `<li class="empty">No files or outputs detected.</li>`;
  $("inputsPanel").hidden = !S.model.inputs.length;
  $("inputs").innerHTML = `<ul class="plain">${S.model.inputs.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;
  $("notesPanel").hidden = !S.model.notes.length;
  $("notes").innerHTML = `<ul class="plain">${S.model.notes.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;
}
export function renderDetail() {
  const n = S.sel && index.get(S.sel);
  if (!n) {
    $("detail").innerHTML =
      `<h3>Step details</h3><p class="empty">Click any box in the diagram or mind map to see what it does, what it reads and what it creates. Use ← and → to walk through the steps in order.</p><div class="acts"><button class="btn sm" type="button" data-ask="overview">Ask AI to explain the whole flow</button></div>`;
    return;
  }
  const kindName = { step: "Step", decision: "Decision", loop: "Repeats", parallel: "Parallel", stop: "Stop" }[n.kind];
  const color = {
    step: "var(--step)",
    decision: "var(--decide)",
    loop: "var(--loop)",
    parallel: "var(--muted)",
    stop: "var(--ink)",
  }[n.kind];
  let h = `<div class="kindline"><span class="num">${esc(n.num)}</span><span class="kind" style="color:${color}">${kindName}</span></div><h4>${esc(n.kind === "decision" ? n.question || n.title : n.title)}</h4>`;
  if (n.detail) h += `<p>${esc(n.detail)}</p>`;
  if (n.kind === "loop" && n.over)
    h += `<div class="blk"><span class="eyebrow">Repeats for</span><span>${esc(n.over)}</span></div>`;
  if (n.branches)
    h += `<div class="blk"><span class="eyebrow">${n.kind === "parallel" ? "Tracks" : "Outcomes"}</span><ul class="plain">${n.branches.map((b) => `<li><strong${b.implied ? ' style="color:var(--danger)"' : ""}>${esc(b.label)}</strong> → ${b.steps.length ? esc(b.steps.map((s) => s.title).join(", then ")) : b.implied ? "not described in the file" : "continue with the next step"}</li>`).join("")}</ul></div>`;
  if (n.creates.length)
    h += `<div class="blk"><span class="eyebrow">Creates</span><div class="chips">${n.creates.map((c) => `<span class="chip make" title="${esc(c.note || c.kind)}">${ICON_FILE}${esc(c.name)}</span>`).join("")}</div></div>`;
  if (n.uses.length)
    h += `<div class="blk"><span class="eyebrow">Reads / uses</span><div class="chips">${n.uses.map((u) => `<span class="chip use">${esc(u)}</span>`).join("")}</div></div>`;
  if (n.source)
    h += `<div class="blk"><span class="eyebrow">From the file</span><blockquote>${esc(n.source)}</blockquote><button type="button" class="linkbtn" id="showSrc">Show in source</button></div>`;
  h += `<div class="acts"><button class="btn sm primary" type="button" data-ask="explain">Ask AI about this step</button><button class="btn sm" type="button" data-ask="missing">What's missing here?</button></div>`;
  $("detail").innerHTML = h;
  const b = $("showSrc");
  if (b)
    b.onclick = () => {
      S.highlight = n.source;
      const fi = S.files.findIndex((f) => f.text.includes(n.source.trim().slice(0, 40)));
      if (fi >= 0) S.activeFile = fi;
      setTab("source");
    };
}
export function initSide() {
  $("detail").addEventListener("click", (e) => {
    const a = e.target.closest("[data-ask]");
    if (!a) return;
    const n = S.sel && index.get(S.sel);
    if (a.dataset.ask === "overview") {
      setScope(null);
      openChat();
      sendChat(
        "Walk me through this whole workflow in plain words: the main path, each decision point and what it produces.",
      );
      return;
    }
    setScope(n ? n.id : null);
    openChat();
    if (a.dataset.ask === "explain")
      sendChat(
        "Explain this step: what it does, why it is here, what it needs from earlier steps and what later steps depend on it.",
      );
    else
      sendChat(
        "What is missing or unclear in this step? Think about cases where a condition is not met, inputs are missing, or something fails. List concrete gaps and propose the fix.",
      );
  });
}
