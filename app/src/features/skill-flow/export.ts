import { toBlob, toSvg } from "html-to-image";

import { esc } from "@/lib/util";

export type ShotFormat = "png" | "jpeg" | "svg";

export interface ShotOptions {
  format: ShotFormat;
  scale: number;
  background: "light" | "current";
  header: boolean;
}

const PAD = 24;

/** Wait for two animation frames so React can commit a temporary export state. */
export function nextFrames(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

function background(opts: ShotOptions): string {
  if (opts.background === "light") return "#ffffff";
  const bg = getComputedStyle(document.body).backgroundColor;
  return bg && bg !== "rgba(0, 0, 0, 0)" ? bg : "#ffffff";
}

function headerHtml(title: string, summary: string, legend: string[]): string {
  const date = new Date().toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  return (
    `<div class="export-head">` +
    `<h1>${esc(title || "Workflow")}</h1>` +
    (summary ? `<p>${esc(summary)}</p>` : "") +
    `<div class="export-meta">${esc(date)} · justools Skill Flow Mapper</div>` +
    (legend.length ? `<div class="export-legend">${legend.map((l) => `<span>${esc(l)}</span>`).join("")}</div>` : "") +
    `</div>`
  );
}

/** Clone the view, add padding and an optional header, and place it in a clipped off-screen host for capture. */
function buildExportNode(source: HTMLElement, opts: ShotOptions, title: string, summary: string, legend: string[]) {
  const bg = background(opts);
  // The source is absolutely positioned inside its viewport, so it contributes no intrinsic size:
  // give the wrapper explicit dimensions from the source's measured box.
  const w = Math.max(1, source.offsetWidth);
  const h = Math.max(1, source.offsetHeight);
  // A zero-size, clipped host hides the staging area without offsetting the captured node
  // (a negative left would be serialised into the clone and push the picture off the canvas).
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;overflow:hidden;z-index:-1;";
  const wrap = document.createElement("div");
  wrap.style.cssText = `position:absolute;left:0;top:0;width:${w + PAD * 2}px;padding:${PAD}px;background:${bg};color:var(--ink);font:14px/1.5 var(--sans, sans-serif);box-sizing:content-box;`;
  const clone = source.cloneNode(true) as HTMLElement;
  clone.style.transform = "none";
  clone.style.position = "relative";
  clone.style.left = "0";
  clone.style.top = "0";
  clone.style.margin = "0";
  clone.style.width = w + "px";
  clone.style.height = h + "px";
  // Strip interactive-only chrome from the picture.
  clone.querySelectorAll(".fold, .dot, .mm-svg .tmp, .mm-lchip").forEach((el) => el.remove());
  if (opts.header) wrap.innerHTML = headerHtml(title, summary, legend);
  wrap.appendChild(clone);
  host.appendChild(wrap);
  document.body.appendChild(host);
  return { wrap, cleanup: () => host.remove() };
}

/** Render the given view element to an image blob (PNG / JPEG / SVG). */
export async function captureImage(
  source: HTMLElement,
  opts: ShotOptions,
  meta: { title: string; summary: string; legend?: string[] },
): Promise<Blob> {
  const { wrap, cleanup } = buildExportNode(source, opts, meta.title, meta.summary, meta.legend || []);
  try {
    const bg = background(opts);
    if (opts.format === "svg") {
      const dataUrl = await toSvg(wrap, { backgroundColor: bg, width: wrap.offsetWidth, height: wrap.offsetHeight });
      const res = await fetch(dataUrl);
      return await res.blob();
    }
    const blob = await toBlob(wrap, {
      backgroundColor: bg,
      pixelRatio: opts.scale,
      quality: opts.format === "jpeg" ? 0.92 : undefined,
      type: opts.format === "jpeg" ? "image/jpeg" : "image/png",
      width: wrap.offsetWidth,
      height: wrap.offsetHeight,
    });
    if (!blob) throw new Error("The browser returned an empty image.");
    return blob;
  } finally {
    cleanup();
  }
}

export function shotFilename(title: string, view: string, format: ShotFormat): string {
  const base = (title || "workflow").replace(/[^\w.-]+/g, "-").toLowerCase();
  return `${base}-${view}.${format === "jpeg" ? "jpg" : format}`;
}
