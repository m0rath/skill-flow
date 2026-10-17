import JSZip from "jszip";

import type { FileItem } from "@/model/types";

// Skills are a few KB of text. The limits stop a huge file or a zip bomb from freezing the tab.
const MAX_FILE_BYTES = 2_000_000;
const MAX_TOTAL_BYTES = 10_000_000;
const tooBig = (name: string) => `${name} is too large. Files must be under ${MAX_FILE_BYTES / 1_000_000} MB.`;

/** Unzip one entry as text, stopping as soon as it grows past the limit (zip headers can lie about size). */
function readZipEntry(z: JSZip.JSZipObject, max: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: string[] = [];
    let size = 0;
    // internalStream is JSZip's incremental reader; it is not part of the public typings.
    const stream = (z as unknown as { internalStream: (t: string) => NodeJS.ReadableStream }).internalStream("string");
    stream
      .on("data", (chunk: string) => {
        size += chunk.length;
        if (size > max) {
          (stream as unknown as { pause: () => void }).pause();
          reject(new RangeError(tooBig(z.name)));
        } else chunks.push(chunk);
      })
      .on("error", reject)
      .on("end", () => resolve(chunks.join("")))
      .resume();
  });
}

/** Read uploaded files (and zips) into `{ path, text }` entries. `error` explains why a file was skipped. */
export async function readFiles(fileList: File[]): Promise<{ files: FileItem[]; error: string }> {
  const out: FileItem[] = [];
  let error = "";
  let total = 0;
  const budget = () => Math.min(MAX_FILE_BYTES, MAX_TOTAL_BYTES - total);
  for (const f of fileList) {
    const name = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    if (/\.(zip|skill)$/i.test(f.name)) {
      if (f.size > MAX_TOTAL_BYTES) {
        error = `${f.name} is too large. Zips must be under ${MAX_TOTAL_BYTES / 1_000_000} MB.`;
        continue;
      }
      let zip: JSZip;
      try {
        zip = await JSZip.loadAsync(f);
      } catch {
        error = `${f.name} could not be read as a zip file.`;
        continue;
      }
      const all = Object.values(zip.files).filter((z) => !z.dir && !/(^|\/)(__MACOSX|\.DS_Store)/.test(z.name));
      const texts = all.filter((z) => /\.(md|mdx|markdown|txt)$/i.test(z.name));
      texts.sort(
        (a, b) =>
          Number(/skill\.md$/i.test(b.name)) - Number(/skill\.md$/i.test(a.name)) || a.name.localeCompare(b.name),
      );
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
    } else if (f.size > budget()) {
      error = tooBig(name);
    } else {
      const text = await f.text();
      total += text.length;
      out.push({ path: name, text });
    }
  }
  return { files: out, error };
}

/** Trigger a browser download for a file or blob. */
export function offerDownload(filename: string, data: Blob | string): void {
  const blob = data instanceof Blob ? data : new Blob([data], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}
