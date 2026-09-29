// Save the flow diagram or mind map as an image file.
// The views are HTML and CSS, so the export copies the view and the page's styles (with fonts embedded)
// into an SVG <foreignObject>. That SVG is the vector export, and drawing it on a canvas gives the PNG.

import { offer } from "../app/files.js";
import { $, toast } from "../lib/dom.js";
import { S } from "../state.js";

const PAD = 24;
// Browsers refuse canvases past roughly 16k pixels a side or 16M pixels in total.
const MAX_SIDE = 16_000,
  MAX_AREA = 16_000_000;

const VIEWS = {
  diagram: { el: () => $("dInner"), suffix: "flow" },
  mindmap: { el: () => $("mLayer"), suffix: "mind-map" },
};

// Hide editing controls and selection so the picture shows only the workflow.
const EXPORT_CSS = `
.export-root { font: 14px/1.5 var(--sans); color: var(--ink); background: var(--surface-2); padding: ${PAD}px; width: max-content; }
.export-root .fold, .export-root .mm-node .dot, .export-root .mm-svg .tmp { display: none !important; }
`;

let fontCache = null;

/** Every same-origin style rule as text, with font files inlined so the SVG needs no network access. */
async function pageCss() {
  const out = [];
  for (const sheet of document.styleSheets) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch (_) {
      continue; // a cross-origin sheet; the app doesn't load any
    }
    for (const rule of rules) {
      // Media queries are skipped: in the SVG the "screen" is the image, so narrow-screen rules would reflow it.
      // The dark theme still applies through the data-theme attribute set on the SVG root.
      if (rule instanceof CSSMediaRule) continue;
      out.push(rule instanceof CSSFontFaceRule ? await inlineFonts(rule.cssText, sheet.href) : rule.cssText);
    }
  }
  return out.join("\n");
}

async function inlineFonts(cssText, base) {
  fontCache ||= new Map();
  const urls = [...cssText.matchAll(/url\(["']?([^"')]+)["']?\)/g)].map((m) => m[1]);
  for (const u of urls) {
    if (u.startsWith("data:")) continue;
    const abs = new URL(u, base || location.href).href;
    if (!fontCache.has(abs))
      fontCache.set(
        abs,
        fetch(abs)
          .then((r) => (r.ok ? r.blob() : null))
          .then(toDataUrl),
      );
    const data = await fontCache.get(abs).catch(() => null);
    // If a font can't be loaded the export still works, it just falls back to a system font.
    if (data) cssText = cssText.split(u).join(data);
  }
  return cssText;
}

function toDataUrl(blob) {
  if (!blob) return null;
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function currentTheme() {
  const set = document.documentElement.getAttribute("data-theme");
  if (set) return set;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Build a standalone SVG of one view at 100% zoom. Returns `{ svg, width, height }`. */
export async function viewToSvg(view) {
  const src = VIEWS[view].el();
  const clone = src.cloneNode(true);
  // The live view is panned and zoomed. The export shows all of it at its natural size.
  clone.style.transform = "none";
  clone.style.position = "static";
  clone.classList.remove("anim");
  clone.querySelectorAll(".sel").forEach((el) => el.classList.remove("sel"));
  const width = Math.ceil(src.offsetWidth) + PAD * 2,
    height = Math.ceil(src.offsetHeight) + PAD * 2;
  const body = new XMLSerializer().serializeToString(clone);
  const css = (await pageCss()) + EXPORT_CSS;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" data-theme="${currentTheme()}">` +
    `<style><![CDATA[${css.replaceAll("]]>", "]]]]><![CDATA[>")}]]></style>` +
    `<foreignObject x="0" y="0" width="100%" height="100%">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" class="export-root">${body}</div>` +
    `</foreignObject></svg>`;
  return { svg, width, height };
}

/** Draw the SVG on a canvas. `scale` 2 gives a sharp image on high-density screens and in slides. */
export async function svgToPng({ svg, width, height }, scale = 2) {
  const k = Math.max(
    0.25,
    Math.min(scale, MAX_SIDE / width, MAX_SIDE / height, Math.sqrt(MAX_AREA / (width * height))),
  );
  const img = new Image();
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * k);
  canvas.height = Math.round(height * k);
  const ctx = canvas.getContext("2d");
  ctx.scale(k, k);
  ctx.drawImage(img, 0, 0, width, height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("The image is too large to save."))), "image/png"),
  );
}

function fileBase(view) {
  const title = (S.model?.title || "skill").replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "skill";
  return `${title}-${VIEWS[view].suffix}`;
}

export async function exportView(view, format) {
  try {
    const out = await viewToSvg(view);
    if (format === "svg") {
      offer(fileBase(view) + ".svg", new Blob([out.svg], { type: "image/svg+xml;charset=utf-8" }));
      return;
    }
    toast("Preparing image…");
    offer(fileBase(view) + ".png", await svgToPng(out));
  } catch (e) {
    console.error(e);
    toast(
      format === "png"
        ? "This browser couldn't make a PNG. Try the SVG export, or take a screenshot."
        : "Could not export the image.",
    );
  }
}

export function initExport() {
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-export]");
    // Close any open Export menu when something else is clicked, or after picking an option.
    const picked = e.target.closest(".menu-pop button");
    document.querySelectorAll("details.menu[open]").forEach((d) => {
      if (picked || !d.contains(e.target)) d.open = false;
    });
    if (b) exportView(b.dataset.view, b.dataset.export);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const open = document.querySelector("details.menu[open]");
    if (open) {
      open.open = false;
      open.querySelector("summary").focus();
    }
  });
}
