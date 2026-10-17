import JSZip from "jszip";

import { IGNORE_DIR_RE, LIMITS, LOCK_RE, TEXT_EXT_RE, TEXT_NAME_RE, isManifest, isReadme } from "@/project/paths";
import type { BinFile, ProjectFile } from "@/project/types";

export interface IngestEntry {
  path: string;
  size: number;
  read: () => Promise<string>;
}

export interface IngestResult {
  files: ProjectFile[];
  bins: BinFile[];
  root: string | null;
  skipped: number;
}

function keepPath(p: string): boolean {
  return !IGNORE_DIR_RE.test(p);
}

function wantsText(p: string, size: number): boolean {
  return !LOCK_RE.test(p) && (TEXT_EXT_RE.test(p) || TEXT_NAME_RE.test(p)) && size <= LIMITS.maxFileBytes;
}

/** Drop the single shared top-level folder that folder pickers and zips add. */
function stripRoot(list: IngestEntry[]): string | null {
  const firsts = new Set(list.map((f) => f.path.split("/")[0]));
  if (firsts.size === 1 && list.every((f) => f.path.includes("/"))) {
    const root = [...firsts][0];
    list.forEach((f) => (f.path = f.path.slice(root.length + 1)));
    return root;
  }
  return null;
}

/** Read the text entries in batches, keeping only files that look like source. */
async function ingest(entries: IngestEntry[], onStatus?: (msg: string) => void): Promise<IngestResult> {
  entries = entries.filter((e) => keepPath(e.path)).slice(0, LIMITS.maxEntries);
  const out: ProjectFile[] = [];
  const bins: BinFile[] = [];
  let total = 0;
  let n = 0;
  let skipped = 0;
  const textEntries = entries.filter((e) => wantsText(e.path, e.size));
  const textSet = new Set(textEntries);
  entries.filter((e) => !textSet.has(e)).forEach((e) => bins.push({ path: e.path, size: e.size, bin: true }));
  textEntries.sort(
    (a, b) =>
      Number(isReadme(b.path)) - Number(isReadme(a.path)) ||
      Number(isManifest(b.path)) - Number(isManifest(a.path)) ||
      a.path.split("/").length - b.path.split("/").length,
  );
  for (let i = 0; i < textEntries.length; i += 24) {
    const batch = textEntries.slice(i, i + 24);
    const texts = await Promise.all(
      batch.map(async (e) => {
        if (n >= LIMITS.maxText || total + e.size > LIMITS.maxTotalBytes) return null;
        try {
          return await e.read();
        } catch {
          return null;
        }
      }),
    );
    batch.forEach((e, k) => {
      const t = texts[k];
      if (t == null || t.indexOf("\u0000") >= 0) {
        bins.push({ path: e.path, size: e.size, bin: true, skipped: t == null });
        if (t == null) skipped++;
        return;
      }
      const text = t.replace(/\r\n/g, "\n");
      out.push({ path: e.path, text, size: e.size, lines: text.split("\n").length });
      total += e.size;
      n++;
    });
    onStatus?.(`Reading the project… ${Math.min(i + 24, textEntries.length)} of ${textEntries.length} text files`);
  }
  return { files: out, bins, root: null, skipped };
}

/** Read a folder picker / file picker selection (and any zips in it). */
export async function readProjectFiles(fileList: File[], onStatus?: (msg: string) => void): Promise<IngestResult> {
  const list = [...fileList];
  const entries: IngestEntry[] = [];
  for (const f of list) {
    if (/\.zip$/i.test(f.name) && list.length === 1) {
      onStatus?.("Unpacking the zip…");
      let zip: JSZip;
      try {
        zip = await JSZip.loadAsync(f);
      } catch {
        throw new Error("Zip support did not load, or the file is not a valid zip.");
      }
      Object.values(zip.files)
        .filter((z) => !z.dir)
        .forEach((z) =>
          entries.push({
            path: z.name,
            size: (z as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize || 0,
            read: () => z.async("string"),
          }),
        );
    } else {
      const p = (f as File & { webkitRelativePath?: string; _relPath?: string }).webkitRelativePath || f.name;
      entries.push({ path: p, size: f.size, read: () => f.text() });
    }
  }
  const root = stripRoot(entries);
  const r = await ingest(entries, onStatus);
  r.root = root || (list.length === 1 && /\.zip$/i.test(list[0].name) ? list[0].name.replace(/\.zip$/i, "") : null);
  return r;
}

interface FsEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file: (cb: (f: File) => void, err?: () => void) => void;
  createReader: () => { readEntries: (cb: (b: FsEntry[]) => void, err?: () => void) => void };
  webkitGetAsEntry?: () => FsEntry | null;
}

/** Read folders dropped onto the page via the (non-standard) entries API. */
export async function readProjectDrop(
  items: DataTransferItemList,
  onStatus?: (msg: string) => void,
): Promise<IngestResult> {
  const entries: IngestEntry[] = [];
  const walk = (entry: FsEntry, prefix: string): Promise<void> =>
    new Promise((res) => {
      if (entry.isFile) {
        entry.file(
          (f) => {
            const p = prefix + f.name;
            entries.push({ path: p, size: f.size, read: () => f.text() });
            res();
          },
          () => res(),
        );
      } else if (entry.isDirectory) {
        const p = prefix + entry.name + "/";
        if (!keepPath(p)) return res();
        const reader = entry.createReader();
        const all: FsEntry[] = [];
        const more = () =>
          reader.readEntries(
            async (batch) => {
              if (!batch.length) {
                for (const e of all) await walk(e, p);
                res();
              } else {
                all.push(...batch);
                more();
              }
            },
            () => res(),
          );
        more();
      } else res();
    });
  const list = [...items];
  for (const it of list) {
    const e = (it as unknown as FsEntry).webkitGetAsEntry?.();
    if (e) await walk(e, "");
  }
  if (entries.length === 1 && /\.zip$/i.test(entries[0].path)) return { files: [], bins: [], root: null, skipped: 0 };
  const root = stripRoot(entries);
  const r = await ingest(entries, onStatus);
  r.root = root;
  return r;
}
