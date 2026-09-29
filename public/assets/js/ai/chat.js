import { FENCE, applyEdit, parseReply } from "./edits.js";
import { errCopy } from "./errors.js";
import { chatInstructions } from "./prompts.js";
import { openSettingsIfNeeded } from "./settings.js";
import { afterFileChange, realFiles } from "../app/files.js";
import { snapshot, undo } from "../app/history.js";
import { $, toast } from "../lib/dom.js";
import { md } from "../lib/markdown.js";
import { esc } from "../lib/util.js";
import { index } from "../model/normalize.js";
import { S, ai, save } from "../state.js";

let chatCtl = null;
export function setScope(id) {
  S.chatScope = id || null;
  renderScope();
}
export function renderScope() {
  const n = S.chatScope && index.get(S.chatScope);
  const pill = $("scopePill");
  pill.className = "scope-pill" + (n ? "" : " all");
  pill.textContent = n
    ? `Step ${n.num} · ${n.kind === "decision" ? n.question || n.title : n.title}`
    : "Whole workflow";
  $("scopeAll").hidden = !n;
  renderQuick();
}
export function renderQuick() {
  const n = S.chatScope && index.get(S.chatScope);
  const items = n
    ? ["Explain this step", "What if this fails?", "What's missing here?", "Make this step clearer"]
    : ["Summarize the flow", "Where can this go wrong?", "Add error handling", "Tighten the wording"];
  $("quick").innerHTML = ai.client
    ? items.map((t) => `<button type="button" data-q="${esc(t)}">${esc(t)}</button>`).join("")
    : "";
}
export function diffHtml(ed) {
  const cut = (s) => {
    const ls = s.split("\n");
    return ls.length > 14 ? [...ls.slice(0, 14), `… ${ls.length - 14} more lines`] : ls;
  };
  return ed
    .map(
      (x) =>
        `<div class="f">${esc(x.file)}${x.ok ? "" : " · could not find this text"}</div>` +
        (x.find
          ? cut(x.find)
              .map((l) => `<div class="del">- ${esc(l)}</div>`)
              .join("")
          : "") +
        (x.replace
          ? cut(x.replace)
              .map((l) => `<div class="add">+ ${esc(l)}</div>`)
              .join("")
          : ""),
    )
    .join("");
}
export function renderMsg(m, i) {
  if (m.role === "user")
    return `<div class="msg user" data-msg="${i}">${m.scope ? `<span class="sc">about step ${esc(m.scope.num)} · ${esc(m.scope.title)}</span>` : ""}${esc(m.text)}</div>`;
  let body =
    m.pending && !m.text
      ? `<span class="typing"><i></i><i></i><i></i> ${m.phase === "edits" ? "Preparing changes" : "Thinking"}</span>`
      : md(m.text);
  if (m.pending && m.text && m.phase === "edits")
    body += `<p class="typing"><i></i><i></i><i></i> Preparing changes</p>`;
  if (m.edits && m.edits.length) {
    const okN = (m.results || []).filter((r) => r.ok).length,
      bad = (m.results || []).length - okN;
    const state =
      m.status === "applied"
        ? `<span class="ok">Applied ${okN} change${okN === 1 ? "" : "s"}</span>${bad ? ` <span class="bad">· ${bad} not found</span>` : ""}`
        : m.status === "undone"
          ? "Undone"
          : m.status === "discarded"
            ? "Discarded"
            : m.status === "failed"
              ? `<span class="bad">Couldn't apply: the text to replace wasn't found</span>`
              : `Proposed ${m.edits.length} change${m.edits.length === 1 ? "" : "s"}`;
    const btns =
      m.status === "proposed"
        ? `<button class="btn sm primary" type="button" data-apply="${i}">Apply</button><button class="btn sm" type="button" data-discard="${i}">Discard</button>`
        : m.status === "applied"
          ? `<button class="btn sm ghost" type="button" data-show-changes>All changes</button>` +
            (m.snap === S.history.length ? `<button class="btn sm" type="button" data-undo="${i}">Undo</button>` : "")
          : "";
    body += `<div class="change"><div class="change-h">${state}<span class="sp"></span>${btns}</div><div class="diff">${diffHtml(m.results || m.edits.map((x) => ({ ...x, ok: true })))}</div></div>`;
  }
  return `<div class="msg assistant${m.error ? " error" : ""}" data-msg="${i}">${body}</div>`;
}
export function renderChat() {
  const tip = ai.client
    ? `<div class="msg tip">Select a step in the diagram to talk about it, or keep "Whole workflow". Ask questions, or say what to change, such as "if the ticket isn't found, ask the user again". Changes are written into the file and the map redraws. Undo and Download are at the top.</div>`
    : `<div class="msg tip">Chat needs an API key from Anthropic, OpenAI or Google Gemini. <button class="btn sm primary" type="button" data-open-settings>Add API key</button></div>`;
  $("msgs").innerHTML = tip + S.chat.map(renderMsg).join("");
  $("msgs").scrollTop = $("msgs").scrollHeight;
  $("chatSend").disabled = !ai.client;
  $("chatIn").disabled = !ai.client;
  renderScope();
}
export function updateMsg(i) {
  const el = document.querySelector(`[data-msg="${i}"]`);
  if (el) {
    el.outerHTML = renderMsg(S.chat[i], i);
    $("msgs").scrollTop = $("msgs").scrollHeight;
  } else renderChat();
}
export async function sendChat(text) {
  text = String(text || "").trim();
  if (!text || !ai.client) return;
  $("chatErr").hidden = true;
  const scope = S.chatScope && index.get(S.chatScope);
  const history = S.chat.filter((m) => !m.pending && !m.error).slice(-10);
  S.chat.push({
    role: "user",
    text,
    scope: scope
      ? { num: scope.num, title: scope.kind === "decision" ? scope.question || scope.title : scope.title }
      : null,
  });
  const reply = { role: "assistant", text: "", pending: true };
  S.chat.push(reply);
  const idx = S.chat.length - 1;
  renderChat();
  if (S.side !== "chat") (($("chatBadge").hidden = false), ($("chatBadge").textContent = "new"));
  chatCtl?.abort();
  chatCtl = new AbortController();
  const my = chatCtl;
  $("chatStop").hidden = false;
  $("chatSend").disabled = true;
  const turns = [{ role: "user", content: chatInstructions({ steps: S.model.steps, files: S.files, scope }) }];
  let budget = 12000;
  const hist = [];
  for (let k = history.length - 1; k >= 0; k--) {
    const m = history[k];
    const c =
      m.role === "user"
        ? (m.scope ? `[Scope: step ${m.scope.num} "${m.scope.title}"] ` : "") + m.text
        : (m.text || "(no text)") +
          (m.status === "applied"
            ? "\n[These edits were applied to the file.]"
            : m.edits
              ? "\n[Edits proposed but not applied.]"
              : "");
    budget -= c.length;
    if (budget < 0) break;
    hist.unshift({ role: m.role, content: c });
  }
  while (hist.length && hist[0].role === "assistant") hist.shift();
  if (hist.length)
    turns.push({ role: "assistant", content: "Understood. I have the outline and the current files." }, ...hist);
  turns.push({
    role: "user",
    content:
      (scope
        ? `[Scope: step ${scope.num} "${scope.kind === "decision" ? scope.question || scope.title : scope.title}"] `
        : "[Scope: whole workflow] ") + text,
  });
  try {
    const res = await ai.client(turns, {
      signal: my.signal,
      onText: ({ text: t }) => {
        const p = parseReply(t);
        reply.text = p.display;
        reply.phase = t.includes(FENCE + "edits") ? "edits" : "";
        updateMsg(idx);
      },
    });
    const p = parseReply(res.text);
    reply.text = p.display || (p.edits ? "Here are the changes." : res.text);
    reply.pending = false;
    if (p.edits && p.edits.length) {
      reply.edits = p.edits;
      reply.status = "proposed";
      if ($("autoApply").checked) applyMsg(idx, false);
    }
    if (res.truncated) reply.text += "\n\n(The answer was cut short. Ask for a smaller change.)";
    updateMsg(idx);
    save();
  } catch (e) {
    reply.pending = false;
    if (e?.code === "cancelled") {
      reply.text = (e.text ? parseReply(e.text).display + "\n\n" : "") + "(Stopped)";
    } else {
      reply.error = true;
      reply.text =
        (e?.text ? parseReply(e.text).display + "\n\n" : "") + errCopy(e?.code, "AI couldn't answer. Try again.");
      openSettingsIfNeeded(e?.code);
    }
    updateMsg(idx);
    save();
  } finally {
    if (my === chatCtl) {
      $("chatStop").hidden = true;
      $("chatSend").disabled = !ai.client;
    }
  }
}
export function applyMsg(i, rerender = true) {
  const m = S.chat[i];
  if (!m || !m.edits) return;
  const before = S.files.map((f) => ({ ...f }));
  const results = m.edits.map((ed) => {
    let f =
      S.files.find((x) => x.path === ed.file) ||
      S.files.find((x) => ed.file && x.path.endsWith(ed.file.replace(/^\.?\//, ""))) ||
      S.files.find((x) => !x.virtual && x.text.includes(ed.find)) ||
      realFiles()[0];
    if (!f || f.virtual) return { ...ed, ok: false };
    const out = applyEdit(f.text, ed.find, ed.replace);
    if (out == null) return { ...ed, file: f.path, ok: false };
    f.text = out;
    f.edited = true;
    return { ...ed, file: f.path, ok: true };
  });
  m.results = results;
  if (!results.some((r) => r.ok)) {
    S.files = before;
    m.status = "failed";
    if (rerender) updateMsg(i);
    save();
    return;
  }
  const cur = S.files;
  S.files = before;
  snapshot();
  S.files = cur;
  m.status = "applied";
  m.snap = S.history.length;
  S.dirty = true;
  if (rerender) updateMsg(i);
  toast("File updated · redrawing the map");
  afterFileChange("File updated");
}
export function initChat() {
  $("scopeAll").onclick = () => setScope(null);
  $("quick").addEventListener("click", (e) => {
    const b = e.target.closest("[data-q]");
    if (b) sendChat(b.dataset.q);
  });
  $("msgs").addEventListener("click", (e) => {
    const a = e.target.closest("[data-apply]");
    if (a) {
      applyMsg(+a.dataset.apply);
      return;
    }
    const d = e.target.closest("[data-discard]");
    if (d) {
      S.chat[+d.dataset.discard].status = "discarded";
      updateMsg(+d.dataset.discard);
      save();
      return;
    }
    const u = e.target.closest("[data-undo]");
    if (u) {
      const m = S.chat[+u.dataset.undo];
      if (m.snap === S.history.length) {
        undo();
        m.status = "undone";
        renderChat();
        save();
      }
    }
  });
  $("chatSend").onclick = () => {
    const v = $("chatIn").value;
    $("chatIn").value = "";
    sendChat(v);
  };
  $("chatIn").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      $("chatSend").click();
    }
  });
  $("chatStop").onclick = () => chatCtl?.abort();
}
