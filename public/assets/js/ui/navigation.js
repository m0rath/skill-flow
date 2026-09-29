import { renderChat, renderScope, setScope } from "../ai/chat.js";
import { $ } from "../lib/dom.js";
import { index, ordered } from "../model/normalize.js";
import { S } from "../state.js";
import { renderChanges } from "./changes.js";
import { renderDiagram } from "./diagram.js";
import { renderMindmap } from "./mindmap.js";
import { renderDetail } from "./side.js";
import { renderSource } from "./source.js";
import { renderSuggest } from "./suggestions.js";
import { dView, mView } from "./viewport.js";

export function select(id, opts = {}) {
  S.sel = id;
  document.querySelectorAll("#dInner .sel, #mLayer .mm-node.sel").forEach((e) => e.classList.remove("sel"));
  document.querySelectorAll(`#dInner [data-id="${id}"]`).forEach((e) => e.classList.add("sel"));
  const n = index.get(id);
  if (n) {
    const mm = document.querySelector(`#mLayer [data-key="n:${CSS.escape(n.num)}"]`);
    if (mm) mm.classList.add("sel");
  }
  $("jump").value = id || "";
  renderDetail();
  if (S.side === "chat" || opts.scope) setScope(id);
  else {
    S.chatScope = id;
    renderScope();
  }
}
export function expandTo(id) {
  let n = index.get(id),
    changed = false;
  while (n && n.parent) {
    if (S.collapsed.delete(n.parent)) changed = true;
    n = index.get(n.parent);
  }
  return changed;
}
export function goTo(id, tab) {
  if (!id) return;
  if (tab && S.tab !== tab) setTab(tab);
  if (expandTo(id) && S.tab === "diagram") renderDiagram();
  select(id);
  requestAnimationFrame(() => {
    if (S.tab === "diagram") dView.centerOn(document.querySelector(`#dInner [data-id="${id}"]`));
    if (S.tab === "mindmap") {
      const n = index.get(id);
      mView.centerOn(n && document.querySelector(`#mLayer [data-key="n:${CSS.escape(n.num)}"]`));
    }
  });
}
export function step(dir) {
  const list = ordered();
  if (!list.length) return;
  const i = list.findIndex((n) => n.id === S.sel);
  const j = i < 0 ? (dir > 0 ? 0 : list.length - 1) : Math.max(0, Math.min(list.length - 1, i + dir));
  goTo(list[j].id, S.tab === "mindmap" ? "mindmap" : "diagram");
}
export function setTab(t) {
  S.tab = t;
  document.querySelectorAll("[data-tab]").forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === t));
  ["diagram", "mindmap", "suggest", "outline", "source", "changes"].forEach((v) => ($("view-" + v).hidden = v !== t));
  if (t === "mindmap") {
    renderMindmap();
    if (!S.fitted.mindmap)
      requestAnimationFrame(() => {
        S.fitted.mindmap = mView.fitMin(0.6, document.querySelector('#mLayer [data-key="root"]'));
      });
  }
  if (t === "diagram" && !S.fitted.diagram)
    requestAnimationFrame(() => {
      S.fitted.diagram = dView.fit("width");
    });
  if (t === "source") renderSource();
  if (t === "suggest") renderSuggest();
  if (t === "changes") renderChanges();
}
export function setSide(s) {
  S.side = s;
  document.querySelectorAll("[data-side]").forEach((b) => b.setAttribute("aria-selected", b.dataset.side === s));
  $("side-details").hidden = s !== "details";
  $("side-chat").hidden = s !== "chat";
  if (s === "chat") {
    $("chatBadge").hidden = true;
    renderChat();
  }
}
export const openChat = () => setSide("chat");
export function toggleFocus(on) {
  document.body.classList.toggle("focus", on);
  document.querySelectorAll(".focusBtn").forEach((b) => (b.textContent = on ? "Exit focus" : "Focus"));
  requestAnimationFrame(() => {
    if (S.tab === "diagram") dView.fit("width");
    if (S.tab === "mindmap") mView.fit("all");
  });
}
export function initNavigation() {
  document.addEventListener("click", (e) => {
    const f = e.target.closest("[data-fold]");
    if (f) {
      e.stopPropagation();
      const id = f.dataset.fold;
      if (S.collapsed.has(id)) S.collapsed.delete(id);
      else S.collapsed.add(id);
      renderDiagram();
      requestAnimationFrame(() => dView.centerOn(document.querySelector(`#dInner [data-id="${id}"]`)));
      return;
    }
    const t = e.target.closest("[data-id]");
    if (t && (t.closest("#dInner") || t.closest("#view-outline") || t.closest("#makes"))) {
      if (t.closest("#dInner")) select(t.dataset.id);
      else goTo(t.dataset.id, "diagram");
    }
    const fl = e.target.closest("[data-file]");
    if (fl) {
      S.activeFile = +fl.dataset.file;
      S.highlight = null;
      S.editing = false;
      renderSource();
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      $("modal").hidden = true;
      $("settings").hidden = true;
      if (document.body.classList.contains("focus")) toggleFocus(false);
      return;
    }
    if (e.target.closest("input,textarea,select") || e.metaKey || e.ctrlKey || e.altKey) return;
    if ((e.key === "Enter" || e.key === " ") && e.target.matches("#dInner [data-id][tabindex]")) {
      e.preventDefault();
      select(e.target.dataset.id);
      return;
    }
    if (S.tab !== "diagram" && S.tab !== "mindmap") return;
    if (e.key === "ArrowRight" || e.key === "j") {
      e.preventDefault();
      step(1);
    } else if (e.key === "ArrowLeft" || e.key === "k") {
      e.preventDefault();
      step(-1);
    } else if (e.key === "f") {
      (S.tab === "diagram" ? dView : mView).fit(S.tab === "diagram" ? "width" : "all");
    }
  });
  document.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => setTab(b.dataset.tab)));
  document.querySelectorAll("[data-side]").forEach((b) => (b.onclick = () => setSide(b.dataset.side)));
  document
    .querySelectorAll(".focusBtn")
    .forEach((b) => (b.onclick = () => toggleFocus(!document.body.classList.contains("focus"))));
}
