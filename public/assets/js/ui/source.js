import { afterFileChange } from "../app/files.js";
import { snapshot } from "../app/history.js";
import { $ } from "../lib/dom.js";
import { esc } from "../lib/util.js";
import { S } from "../state.js";

export function renderSource() {
  $("fileTabs").innerHTML =
    S.files.length > 1
      ? S.files
          .map(
            (f, i) =>
              `<button type="button" data-file="${i}" aria-pressed="${i === S.activeFile}">${esc(f.path)}${f.edited ? ' <span class="edited">•</span>' : ""}</button>`,
          )
          .join("")
      : `<span class="mono" style="font-size:12px;color:var(--muted)">${esc(S.files[0].path)}${S.files[0].edited ? ' <span class="edited">• edited</span>' : ""}</span>`;
  const f = S.files[S.activeFile] || S.files[0];
  $("editBtn").hidden = S.editing || f.virtual;
  $("saveEdit").hidden = !S.editing;
  $("cancelEdit").hidden = !S.editing;
  $("srcPre").hidden = S.editing;
  $("srcEdit").hidden = !S.editing;
  if (S.editing) return;
  const text = f.text || "";
  let html = esc(text);
  if (S.highlight) {
    const q = S.highlight.trim().slice(0, 80);
    let at = q.length > 4 ? text.indexOf(q) : -1;
    if (at < 0 && q.length > 4) at = text.toLowerCase().indexOf(q.replace(/`/g, "").toLowerCase());
    if (at >= 0) {
      const len = Math.min(S.highlight.trim().length, text.length - at);
      html =
        esc(text.slice(0, at)) +
        '<mark id="hl">' +
        esc(text.slice(at, at + len)) +
        "</mark>" +
        esc(text.slice(at + len));
    }
  }
  $("srcPre").innerHTML = html;
  const hl = document.getElementById("hl");
  if (hl) hl.scrollIntoView({ block: "center" });
}
export function initSource() {
  $("editBtn").onclick = () => {
    S.editing = true;
    $("srcEdit").value = S.files[S.activeFile].text;
    renderSource();
    $("srcEdit").focus();
  };
  $("cancelEdit").onclick = () => {
    S.editing = false;
    renderSource();
  };
  $("saveEdit").onclick = () => {
    const v = $("srcEdit").value,
      f = S.files[S.activeFile];
    S.editing = false;
    if (v !== f.text) {
      snapshot();
      f.text = v;
      f.edited = true;
      S.dirty = true;
      afterFileChange("Edited by hand");
    } else renderSource();
  };
}
