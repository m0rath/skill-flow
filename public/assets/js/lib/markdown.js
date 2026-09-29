import { esc } from "./util.js";

export function md(s) {
  const lines = esc(s).split("\n");
  let h = "",
    list = null,
    code = false,
    buf = [];
  const inline = (t) => t.replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  const close = () => {
    if (list) {
      h += `</${list}>`;
      list = null;
    }
  };
  lines.forEach((l) => {
    if (/^\s*```/.test(l)) {
      if (code) {
        h += `<pre>${buf.join("\n")}</pre>`;
        buf = [];
        code = false;
      } else {
        close();
        code = true;
      }
      return;
    }
    if (code) {
      buf.push(l);
      return;
    }
    let m;
    if ((m = l.match(/^\s*[-*]\s+(.*)/))) {
      if (list !== "ul") {
        close();
        h += "<ul>";
        list = "ul";
      }
      h += `<li>${inline(m[1])}</li>`;
    } else if ((m = l.match(/^\s*\d+[.)]\s+(.*)/))) {
      if (list !== "ol") {
        close();
        h += "<ol>";
        list = "ol";
      }
      h += `<li>${inline(m[1])}</li>`;
    } else if ((m = l.match(/^#{1,4}\s+(.*)/))) {
      close();
      h += `<p><strong>${inline(m[1])}</strong></p>`;
    } else if (l.trim()) {
      close();
      h += `<p>${inline(l)}</p>`;
    } else close();
  });
  close();
  if (code) h += `<pre>${buf.join("\n")}</pre>`;
  return h;
}
