import { esc } from "./util";

/**
 * Minimal Markdown to HTML for the "read" source view and chat answers.
 * Input is HTML-escaped first, so the output is safe to inject.
 */
export function md(s: string): string {
  const lines = esc(s).split("\n");
  let h = "";
  let list: "ul" | "ol" | null = null;
  let code = false;
  let buf: string[] = [];
  const inline = (t: string) =>
    t.replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
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
    let m: RegExpMatchArray | null;
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
