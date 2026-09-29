import { $, toast } from "../lib/dom.js";
import { normalize } from "../model/normalize.js";
import { quickParse } from "../model/quick-parse.js";
import { S, save } from "../state.js";
import { renderAll } from "../ui/render.js";
import { setStatus } from "../ui/status.js";

export function snapshot() {
  S.history.push({ files: S.files.map((f) => ({ ...f })), rawModel: S.rawModel, mode: S.mode });
  if (S.history.length > 25) S.history.shift();
  $("undoBtn").disabled = false;
}
export function undo() {
  const h = S.history.pop();
  if (!h) return;
  S.files = h.files;
  S.rawModel = h.rawModel;
  S.mode = h.mode;
  S.model = normalize(S.rawModel || quickParse(S.files));
  S.dirty = S.files.some((f) => f.edited);
  $("undoBtn").disabled = !S.history.length;
  S.sugg.stale = true;
  setStatus(S.mode === "claude" ? "claude" : "quick", "Change undone");
  renderAll();
  save();
  toast("Undid the last change");
}
export function initHistory() {
  $("undoBtn").onclick = undo;
}
