import { afterFileChange, offer } from "../app/files.js";
import { snapshot } from "../app/history.js";
import { diffLines, diffStats, hunks, unifiedDiff } from "../lib/diff.js";
import { $, toast } from "../lib/dom.js";
import { esc } from "../lib/util.js";
import { S } from "../state.js";
import { setTab } from "./navigation.js";

/** Every file that differs from the uploaded version, with its diff ops and line counts. */
export function fileChanges() {
  const now = S.files.filter((f) => !f.virtual);
  const paths = [...new Set([...S.original.map((f) => f.path), ...now.map((f) => f.path)])];
  return paths
    .map((path) => {
      const before = S.original.find((f) => f.path === path)?.text ?? "",
        after = now.find((f) => f.path === path)?.text ?? "";
      if (before === after) return null;
      const ops = diffLines(before, after);
      return { path, before, after, ops, ...diffStats(ops) };
    })
    .filter(Boolean);
}

/** The combined patch for all changed files. */
export function patchText(changes = fileChanges()) {
  return changes.map((c) => unifiedDiff(c.path, c.before, c.after)).join("");
}

function renderBadge(changes) {
  const added = changes.reduce((n, c) => n + c.added, 0),
    removed = changes.reduce((n, c) => n + c.removed, 0);
  const badge = $("chgBadge");
  badge.hidden = !changes.length;
  badge.innerHTML = `<span class="add">+${added}</span> <span class="del">−${removed}</span>`;
  badge.title = `${added} lines added, ${removed} removed since upload`;
}

const row = (o) => {
  const k = o.type === "add" ? "add" : o.type === "del" ? "del" : "eq";
  const sign = k === "add" ? "+" : k === "del" ? "−" : "";
  return `<tr class="${k}"><td class="ln">${o.a ?? ""}</td><td class="ln">${o.b ?? ""}</td><td class="sign" aria-hidden="true">${sign}</td><td class="code">${esc(o.text) || " "}</td></tr>`;
};

/** Update the tab badge, and the diff itself when the Changes tab is open. */
export function renderChanges() {
  const changes = fileChanges();
  renderBadge(changes);
  if (S.tab !== "changes") return;
  let h = `<div class="chg-head"><p>Everything that changed since the file was loaded: your edits in Source and the AI fixes you applied from the chat. Undo steps back one change at a time.</p>`;
  if (changes.length)
    h += `<div class="acts"><button class="btn sm" type="button" id="chgCopy">Copy diff</button><button class="btn sm" type="button" id="chgPatch">Download .patch</button></div>`;
  h += `</div>`;
  if (!changes.length)
    h += `<p class="empty">No changes yet. Edit the file in the Source tab, or ask the AI chat to fix something, and the difference shows up here.</p>`;
  for (const c of changes) {
    const canRestore = S.original.some((f) => f.path === c.path);
    h += `<section class="chg-file"><div class="chg-title"><span class="mono">${esc(c.path)}</span><span class="add">+${c.added}</span><span class="del">−${c.removed}</span><span style="flex:1"></span>${canRestore ? `<button class="btn sm ghost" type="button" data-restore="${esc(c.path)}">Restore original</button>` : ""}</div>`;
    h += `<table class="chg-diff"><tbody>`;
    hunks(c.ops).forEach((ops, i) => {
      if (i) h += `<tr class="gap"><td colspan="4">⋯</td></tr>`;
      h += ops.map(row).join("");
    });
    h += `</tbody></table></section>`;
  }
  $("changes").innerHTML = h;
}

export function initChanges() {
  // "All changes" buttons elsewhere (such as on applied AI edits in the chat) open this tab.
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-show-changes]")) setTab("changes");
  });
  $("changes").addEventListener("click", async (e) => {
    if (e.target.closest("#chgCopy")) {
      try {
        await navigator.clipboard.writeText(patchText());
        toast("Diff copied");
      } catch (_) {
        toast("Could not copy. Use Download .patch instead.");
      }
      return;
    }
    if (e.target.closest("#chgPatch")) {
      const name = (S.model?.title || "skill").replace(/[^\w.-]+/g, "-") + ".patch";
      offer(name, new Blob([patchText()], { type: "text/x-diff;charset=utf-8" }));
      return;
    }
    const r = e.target.closest("[data-restore]");
    if (r) {
      const f = S.files.find((x) => x.path === r.dataset.restore),
        orig = S.original.find((x) => x.path === r.dataset.restore);
      if (!f || !orig) return;
      snapshot();
      f.text = orig.text;
      f.edited = false;
      S.dirty = S.files.some((x) => x.edited);
      toast("Restored the original " + f.path);
      afterFileChange("Original restored");
    }
  });
}
