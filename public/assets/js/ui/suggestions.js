import { sendChat, setScope } from "../ai/chat.js";
import { errCopy } from "../ai/errors.js";
import { reviewPrompt } from "../ai/prompts.js";
import { openSettingsIfNeeded } from "../ai/settings.js";
import { $ } from "../lib/dom.js";
import { arr, esc } from "../lib/util.js";
import { allSugg, localChecks } from "../model/checks.js";
import { index, numIndex } from "../model/normalize.js";
import { S, ai, save } from "../state.js";
import { renderDiagram } from "./diagram.js";
import { goTo, openChat } from "./navigation.js";
import { renderSummary } from "./side.js";

let suggCtl = null;
export function sugCard(s) {
  const node = s.nodeId && index.get(s.nodeId);
  return `<div class="card ${esc(s.sev)}"><div class="meta"><span class="sev ${esc(s.sev)}">${esc(s.sev)}</span><span class="cat">${esc(s.cat)}</span>${node ? `<button type="button" class="stepref" data-goto="${node.id}">step ${esc(node.num)}</button>` : ""}</div>
  <h4>${esc(s.title)}</h4>${s.whatIf ? `<p class="whatif">${esc(s.whatIf)}</p>` : ""}${s.suggestion ? `<p class="fix">${esc(s.suggestion)}</p>` : ""}
  <div class="acts">${ai.client ? `<button class="btn sm primary" type="button" data-sfix="${esc(s.id)}">Fix in file</button><button class="btn sm" type="button" data-sask="${esc(s.id)}">Discuss</button>` : ""}<button class="btn sm ghost" type="button" data-sdis="${esc(s.id)}">Dismiss</button></div></div>`;
}
export function renderSuggest() {
  const local = localChecks(),
    cl = (S.sugg.claude || []).filter((s) => !S.sugg.dismissed.includes(s.id));
  const rank = { high: 0, medium: 1, low: 2 };
  const sortS = (a) => a.slice().sort((x, y) => (rank[x.sev] ?? 3) - (rank[y.sev] ?? 3));
  let h = `<div class="sugg-head"><p>Gaps in the workflow: conditions with only one path ("if it's there… but what if it isn't?"), missing failure handling, unclear loops and missing files. Fixes go through the chat, so you can see each change before keeping it.</p>`;
  h += ai.client
    ? `<button class="btn primary" type="button" id="suggRun">${S.sugg.claude ? "Review again with AI" : "Find gaps with AI"}</button><button class="btn" type="button" id="suggStop" hidden>Stop</button>`
    : `<button class="btn primary" type="button" data-open-settings>Add an API key to use AI's review</button>`;
  h += `</div><div class="err" id="suggErr" hidden></div>`;
  if (S.sugg.stale && S.sugg.claude)
    h += `<p class="empty" style="margin:0">The file changed since AI's review. Run it again for fresh results.</p>`;
  h +=
    `<h3>Quick checks <span class="badge n">${local.length}</span></h3>` +
    (local.length
      ? `<div class="cards">${sortS(local).map(sugCard).join("")}</div>`
      : `<p class="empty">No structural gaps found by the quick checks.</p>`);
  h +=
    `<h3>AI review <span class="badge n">${cl.length}</span></h3>` +
    (S.sugg.claude
      ? cl.length
        ? `<div class="cards">${sortS(cl).map(sugCard).join("")}</div>`
        : `<p class="empty">No open items.</p>`
      : `<p class="empty" id="suggIdle">${ai.client ? "AI reads the whole file and lists what could go wrong: unhandled cases, missing validation, ambiguous steps and outputs nobody uses." : "Add an API key (Anthropic, OpenAI or Gemini) in AI settings to use this."}</p>`);
  $("sugg").innerHTML = h;
  const run = $("suggRun");
  if (run) run.onclick = runSuggestions;
  const stop = $("suggStop");
  if (stop) stop.onclick = () => suggCtl?.abort();
}
export async function runSuggestions() {
  if (!ai.client) return;
  suggCtl?.abort();
  suggCtl = new AbortController();
  const my = suggCtl;
  $("suggRun").disabled = true;
  $("suggStop").hidden = false;
  const idle = $("suggIdle");
  if (idle) idle.textContent = "AI is reviewing the workflow…";
  const prompt = reviewPrompt({ steps: S.model.steps, files: S.files });
  try {
    const data = await ai.client.json(prompt, { signal: my.signal });
    if (my !== suggCtl) return;
    const list = arr(Array.isArray(data) ? data : data?.items || data?.suggestions);
    S.sugg.claude = list
      .filter((x) => x && x.title)
      .slice(0, 15)
      .map((x, i) => ({
        id: "c-" + Date.now() + "-" + i,
        sev: ["high", "medium", "low"].includes(String(x.severity).toLowerCase())
          ? String(x.severity).toLowerCase()
          : "medium",
        cat: String(x.category || "Other"),
        title: String(x.title),
        whatIf: String(x.whatIf || ""),
        suggestion: String(x.suggestion || ""),
        nodeId: numIndex.get(String(x.step || "").trim()) || null,
      }));
    S.sugg.stale = false;
    save();
    renderSuggest();
    renderSummary();
    renderDiagram();
  } catch (e) {
    if (my !== suggCtl) return;
    renderSuggest();
    if (e?.code !== "cancelled") {
      const el = $("suggErr");
      el.hidden = false;
      el.textContent = errCopy(e?.code, "AI's review failed. Try again.");
    }
    openSettingsIfNeeded(e?.code);
  } finally {
    if (my === suggCtl) {
      const r = $("suggRun");
      if (r) r.disabled = false;
      const s = $("suggStop");
      if (s) s.hidden = true;
    }
  }
}
export function initSuggestions() {
  $("sugg").addEventListener("click", (e) => {
    const g = e.target.closest("[data-goto]");
    if (g) {
      goTo(g.dataset.goto, "diagram");
      return;
    }
    const find = (id) => allSugg().find((s) => s.id === id);
    const d = e.target.closest("[data-sdis]");
    if (d) {
      S.sugg.dismissed.push(d.dataset.sdis);
      save();
      renderSuggest();
      renderSummary();
      renderDiagram();
      return;
    }
    const f = e.target.closest("[data-sfix]");
    if (f) {
      const s = find(f.dataset.sfix);
      if (!s) return;
      setScope(s.nodeId || null);
      openChat();
      sendChat(`Fix this gap in the file: ${s.title}. ${s.whatIf || ""} Suggested change: ${s.suggestion}`);
      return;
    }
    const a = e.target.closest("[data-sask]");
    if (a) {
      const s = find(a.dataset.sask);
      if (!s) return;
      setScope(s.nodeId || null);
      openChat();
      $("chatIn").value = `About this gap: ${s.title}. ${s.whatIf || ""} `;
      $("chatIn").focus();
    }
  });
}
