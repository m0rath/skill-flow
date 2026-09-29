import { $ } from "../lib/dom.js";

export function setStatus(mode, text) {
  const s = $("status");
  s.className = "status " + mode;
  $("statusText").textContent = text;
}
export function showErr(msg) {
  $("err").hidden = !msg;
  $("err").textContent = msg || "";
}
