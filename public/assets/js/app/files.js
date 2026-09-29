import { analyze } from "../ai/mapping.js";
import { $, toast } from "../lib/dom.js";
import { normalize } from "../model/normalize.js";
import { quickParse } from "../model/quick-parse.js";
import { S, ai, baselineOf, save } from "../state.js";
import { setTab } from "../ui/navigation.js";
import { renderAll } from "../ui/render.js";
import { renderChanges } from "../ui/changes.js";
import { renderSource } from "../ui/source.js";
import { setStatus, showErr } from "../ui/status.js";

export function realFiles() {
  return S.files.filter((f) => !f.virtual);
}
export function fileName(f) {
  let b = f.path.split("/").pop();
  if (!/\.(md|txt)$/i.test(b)) b = b.replace(/\.(mdx|markdown)$/i, "") + ".md";
  return b;
}
export function updateDl() {
  const rf = realFiles();
  const f = rf[0];
  $("dlLabel").textContent = "Download " + (f ? fileName(f) : ".md");
  $("dlZipBtn").hidden = rf.length < 2 || !window.JSZip;
  $("dirtyDot").hidden = !S.dirty;
}
export function offer(filename, data) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  toast("Downloaded " + filename);
}
// Skills are a few KB of text. The limits stop a huge file or a zip bomb from freezing the tab.
const MAX_FILE_BYTES = 2_000_000;
const MAX_TOTAL_BYTES = 10_000_000;
const tooBig = (name) => `${name} is too large. Files must be under ${MAX_FILE_BYTES / 1_000_000} MB.`;

/** Unzip one entry as text, stopping as soon as it grows past the limit (zip headers can lie about size). */
function readZipEntry(z, max) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const stream = z.internalStream("string");
    stream
      .on("data", (chunk) => {
        size += chunk.length;
        if (size > max) {
          stream.pause();
          reject(new RangeError(tooBig(z.name)));
        } else chunks.push(chunk);
      })
      .on("error", reject)
      .on("end", () => resolve(chunks.join("")))
      .resume();
  });
}

/** Read uploaded files (and zips) into `{ path, text }` entries. `error` explains why a file was skipped. */
export async function readFiles(fileList) {
  const out = [];
  let error = "",
    total = 0;
  const budget = () => Math.min(MAX_FILE_BYTES, MAX_TOTAL_BYTES - total);
  for (const f of fileList) {
    if (/\.(zip|skill)$/i.test(f.name)) {
      if (!window.JSZip) {
        error = "Zip support did not load. Upload the SKILL.md file directly.";
        continue;
      }
      if (f.size > MAX_TOTAL_BYTES) {
        error = `${f.name} is too large. Zips must be under ${MAX_TOTAL_BYTES / 1_000_000} MB.`;
        continue;
      }
      let zip;
      try {
        zip = await JSZip.loadAsync(f);
      } catch (e) {
        error = `${f.name} could not be read as a zip file.`;
        continue;
      }
      const all = Object.values(zip.files).filter((z) => !z.dir && !/(^|\/)(__MACOSX|\.DS_Store)/.test(z.name));
      const texts = all.filter((z) => /\.(md|mdx|markdown|txt)$/i.test(z.name));
      texts.sort((a, b) => /skill\.md$/i.test(b.name) - /skill\.md$/i.test(a.name) || a.name.localeCompare(b.name));
      for (const z of texts.slice(0, 25)) {
        try {
          const text = await readZipEntry(z, budget());
          total += text.length;
          out.push({ path: z.name, text });
        } catch (e) {
          error = e instanceof RangeError ? e.message : `${z.name} could not be read from ${f.name}.`;
        }
      }
      const others = all.filter((z) => !texts.includes(z)).map((z) => z.name);
      if (others.length) out.push({ path: "(other files in zip)", text: others.join("\n"), virtual: true });
    } else if (f.size > budget()) error = tooBig(f.name);
    else {
      const text = await f.text();
      total += text.length;
      out.push({ path: f.name, text });
    }
  }
  return { files: out, error };
}
export function resetForNewFile() {
  S.sel = null;
  S.chatScope = null;
  S.highlight = null;
  S.collapsed.clear();
  S.history = [];
  S.dirty = false;
  S.chat = [];
  S.links = [];
  S.mmPos = {};
  S.mmLink = null;
  S.sugg = { claude: null, stale: false, dismissed: [] };
  S.editing = false;
  S.fitted = { diagram: false, mindmap: false };
  $("undoBtn").disabled = true;
}
async function loadUploads(fileList) {
  const { files, error } = await readFiles(fileList);
  return load(files, error);
}
export async function load(files, error = "") {
  showErr(error);
  files = files.filter((f) => f.text && f.text.trim());
  if (!files.filter((f) => !f.virtual).length) {
    showErr(error || "That file is empty or not text. Upload a .md, .txt, or a zipped skill folder.");
    return;
  }
  files.sort(
    (a, b) => !!a.virtual - !!b.virtual || /(^|\/)skill\.md$/i.test(b.path) - /(^|\/)skill\.md$/i.test(a.path),
  );
  resetForNewFile();
  S.files = files;
  S.original = baselineOf(files);
  S.activeFile = 0;
  S.rawModel = null;
  S.model = normalize(quickParse(files));
  S.mode = "quick";
  setStatus("quick", "Quick map (approximate)");
  renderAll();
  setTab("diagram");
  save();
  if (ai.client && $("aiToggle").checked) analyze();
}
export function afterFileChange(why) {
  S.sugg.stale = true;
  if (ai.client && $("aiToggle").checked) {
    renderSource();
    renderChanges();
    updateDl();
    save();
    analyze(true);
  } else {
    S.rawModel = null;
    S.model = normalize(quickParse(S.files));
    S.mode = "quick";
    setStatus("quick", why + " · quick map");
    renderAll();
    save();
  }
}
export function initFiles() {
  $("dlBtn").onclick = () => {
    const f = realFiles()[0];
    if (f) offer(fileName(f), f.text);
  };
  $("dlZipBtn").onclick = async () => {
    const zip = new JSZip();
    realFiles().forEach((f) => zip.file(f.path, f.text));
    const blob = await zip.generateAsync({ type: "blob" });
    offer((S.model.title || "skill").replace(/[^\w.-]+/g, "-") + ".zip", blob);
  };
  $("uploadBtn").onclick = () => $("fileInput").click();
  $("fileInput").onchange = async (e) => {
    const fl = [...e.target.files];
    e.target.value = "";
    if (fl.length) loadUploads(fl);
  };
  ["dragenter", "dragover"].forEach((ev) =>
    document.addEventListener(ev, (e) => {
      if (e.dataTransfer?.types?.includes("Files")) {
        e.preventDefault();
        $("drop").classList.add("over");
      }
    }),
  );
  ["dragleave", "drop"].forEach((ev) =>
    document.addEventListener(ev, (e) => {
      if (ev === "drop" || !e.relatedTarget) $("drop").classList.remove("over");
    }),
  );
  document.addEventListener("drop", async (e) => {
    const fl = [...(e.dataTransfer?.files || [])];
    if (fl.length) {
      e.preventDefault();
      loadUploads(fl);
    }
  });
  $("pasteBtn").onclick = () => {
    $("modal").hidden = false;
    $("pasteArea").focus();
  };
  $("pasteCancel").onclick = () => ($("modal").hidden = true);
  $("pasteGo").onclick = () => {
    const t = $("pasteArea").value;
    if (!t.trim()) return;
    $("modal").hidden = true;
    $("pasteArea").value = "";
    load([{ path: "pasted.md", text: t }]);
  };
}
