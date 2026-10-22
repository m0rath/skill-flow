/*
  Project-level analysis ported from the legacy analyser. Everything here is pure:
  it takes files/bins as arguments and returns data, never touching app globals.
*/
import {
  compKey,
  ENTRY_RE,
  isCI,
  isCode,
  isDocker,
  isDoc,
  isManifest,
  isReadme,
  isTestPath,
  joinPath,
  langOf,
  resolveImports,
} from "@/project/paths";
import type { BinFile, Command, CompEdge, LangStat, PComponent, Project, ProjectFile } from "@/project/types";

/** Recognised component kinds. */
export const COMP_KINDS = [
  "ui",
  "api",
  "service",
  "library",
  "cli",
  "data",
  "infra",
  "config",
  "tests",
  "docs",
  "other",
];

/** Parse a JSON string into an object, returning null on failure or non-objects/arrays. */
function parseJson(text: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(text);
    return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Coerce a dynamic value into a plain object map (empty when it is not one). */
function asObj(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Line count of a file's text (0 when the text is empty). */
export function lineCount(text: string): number {
  return text ? text.split("\n").length : 0;
}

/**
 * Return copies of `files` with `lines` filled in. Keeps `analyzeProject` from mutating its
 * input while still giving the views the cached line counts they render.
 */
export function withLineCounts(files: ProjectFile[]): ProjectFile[] {
  return files.map((f) => {
    const n = lineCount(f.text);
    return f.lines === n ? f : { ...f, lines: n };
  });
}

export function projectCommands(files: ProjectFile[]): Command[] {
  const out: Command[] = [];
  const seen = new Set<string>();
  const push = (cmd: string, purpose: string, from: string) => {
    if (!seen.has(cmd)) {
      seen.add(cmd);
      out.push({ cmd, purpose, from });
    }
  };
  const pkg = files.find((f) => f.path === "package.json") || files.find((f) => /(^|\/)package\.json$/.test(f.path));
  if (pkg) {
    const j = parseJson(pkg.text);
    if (j)
      Object.entries(asObj(j.scripts))
        .slice(0, 12)
        .forEach(([k, v]) => push(k === "start" || k === "test" ? `npm ${k}` : `npm run ${k}`, String(v), pkg.path));
  }
  const mk = files.find((f) => /^(Makefile|GNUmakefile)$/i.test(f.path));
  if (mk)
    [...mk.text.matchAll(/^([A-Za-z][\w.-]*):(?![=])/gm)]
      .slice(0, 10)
      .forEach((m) => push("make " + m[1], "Makefile target", mk.path));
  const readme = files.find((f) => isReadme(f.path) && !f.path.includes("/"));
  if (readme) {
    for (const m of readme.text.matchAll(
      /^\s*(?:\$\s+)?((?:npm|npx|yarn|pnpm|bun|pip|pip3|python3?|uv|poetry|go|cargo|docker(?:-compose| compose)?|make|mvn|gradle|\.\/gradlew|dotnet|bundle|rails|php|composer|deno|just|terraform|kubectl|helm)\s[^\n`]{1,90})$/gm,
    ))
      if (out.length < 16) push(m[1].trim(), "From the README", readme.path);
  }
  return out;
}

export function projectStack(files: ProjectFile[]): string[] {
  const s = new Set<string>();
  const pkg = files.find((f) => /(^|\/)package\.json$/.test(f.path));
  if (pkg) {
    const j = parseJson(pkg.text);
    if (j)
      Object.keys(asObj(j.dependencies))
        .slice(0, 10)
        .forEach((d) => s.add(d));
  }
  const req = files.find((f) => /(^|\/)requirements[\w.-]*\.txt$/.test(f.path));
  if (req)
    req.text
      .split("\n")
      .map((l) => l.split(/[=<>~![; ]/)[0].trim())
      .filter((x) => x && !x.startsWith("#") && !x.startsWith("-"))
      .slice(0, 10)
      .forEach((d) => s.add(d));
  const py = files.find((f) => /(^|\/)pyproject\.toml$/.test(f.path));
  if (py) {
    const m = py.text.match(/dependencies\s*=\s*\[([\s\S]*?)\]/);
    if (m) [...m[1].matchAll(/"([\w.-]+)/g)].slice(0, 10).forEach((x) => s.add(x[1]));
  }
  const gm = files.find((f) => /(^|\/)go\.mod$/.test(f.path));
  if (gm)
    [...gm.text.matchAll(/^\s*([\w.-]+\/[\w./-]+)\s+v/gm)]
      .slice(0, 8)
      .forEach((x) => s.add(x[1].split("/").slice(-1)[0]));
  const cg = files.find((f) => /(^|\/)Cargo\.toml$/.test(f.path));
  if (cg) {
    const m = cg.text.split(/\[dependencies\]/)[1];
    if (m) [...m.split(/\n\[/)[0].matchAll(/^([\w-]+)\s*=/gm)].slice(0, 8).forEach((x) => s.add(x[1]));
  }
  if (files.some((f) => isDocker(f.path) && /Dockerfile/i.test(f.path))) s.add("Docker");
  return [...s];
}

interface CompAcc {
  key: string;
  files: number;
  lines: number;
  langs: Map<string, number>;
  paths: string[];
}

export function analyzeProject(files: ProjectFile[], bins: BinFile[], name: string): Project {
  const byLang = new Map<string, LangStat>();
  let lines = 0;
  // Local counts, never written back onto the caller's file objects.
  const lineOf = new Map<string, number>();
  files.forEach((f) => {
    const n = lineCount(f.text);
    lineOf.set(f.path, n);
    lines += n;
    const L = langOf(f.path);
    const cur = byLang.get(L.name) || { name: L.name, color: L.color, lines: 0, files: 0 };
    cur.lines += n;
    cur.files++;
    byLang.set(L.name, cur);
  });
  const edges = resolveImports(files);
  const comps = new Map<string, CompAcc>();
  [...files, ...bins].forEach((f) => {
    const k = compKey(f.path);
    const c = comps.get(k) || { key: k, files: 0, lines: 0, langs: new Map<string, number>(), paths: [] };
    c.files++;
    const fl = "bin" in f ? 0 : (lineOf.get(f.path) ?? 0);
    c.lines += fl;
    c.paths.push(f.path);
    if (!("bin" in f)) {
      const L = langOf(f.path).name;
      c.langs.set(L, (c.langs.get(L) || 0) + fl);
    }
    comps.set(k, c);
  });
  const compEdges = new Map<string, number>();
  edges.forEach((e) => {
    const a = compKey(e.from);
    const b = compKey(e.to);
    if (a === b) return;
    const k = a + ">" + b;
    compEdges.set(k, (compEdges.get(k) || 0) + 1);
  });
  const todos: { path: string; n: number }[] = [];
  files.forEach((f) => {
    if (!isCode(f.path)) return;
    const m = f.text.match(/\b(TODO|FIXME|HACK|XXX)\b/g);
    if (m) todos.push({ path: f.path, n: m.length });
  });
  const envVars = new Set<string>();
  files.forEach((f) => {
    if (!isCode(f.path)) return;
    for (const m of f.text.matchAll(
      /process\.env\.([A-Z_][A-Z0-9_]*)|process\.env\[['"]([A-Z_][A-Z0-9_]*)['"]\]|os\.environ(?:\.get)?\(?\[?['"]([A-Z_][A-Z0-9_]*)['"]|os\.getenv\(\s*['"]([A-Z_][A-Z0-9_]*)['"]|os\.Getenv\("([A-Z_][A-Z0-9_]*)"\)|ENV\[['"]([A-Z_][A-Z0-9_]*)['"]\]|env::var\("([A-Z_][A-Z0-9_]*)"\)|System\.getenv\("([A-Z_][A-Z0-9_]*)"\)/g,
    )) {
      const v = m.slice(1).find(Boolean);
      if (v) envVars.add(v);
    }
  });
  const allPaths = [...files.map((f) => f.path), ...bins.map((b) => b.path)];
  const pkg = files.find((f) => f.path === "package.json");
  const entries = new Set<string>();
  if (pkg) {
    const j = parseJson(pkg.text);
    if (j) {
      const binVals = typeof j.bin === "string" ? [j.bin] : Object.values(asObj(j.bin));
      [j.main, ...binVals].filter(Boolean).forEach((x) => {
        const c = joinPath("", String(x));
        if (allPaths.includes(c)) entries.add(c);
      });
      Object.values(asObj(j.scripts)).forEach((v) => {
        const m = String(v).match(/(?:node|ts-node|tsx|nodemon|bun)\s+([\w./-]+\.\w+)/);
        if (m && allPaths.includes(joinPath("", m[1]))) entries.add(joinPath("", m[1]));
      });
    }
  }
  files
    .filter((f) => {
      if (!ENTRY_RE.test(f.path) || isTestPath(f.path)) return false;
      const d = f.path.split("/").length;
      const base = f.path.split("/").pop() || "";
      if (/^(index|app|application|bootstrap)\./.test(base))
        return d === 1 || (d === 2 && /^(src|app|lib|server|backend|api|cmd)$/i.test(f.path.split("/")[0]));
      return d <= 3;
    })
    .sort((a, b) => a.path.split("/").length - b.path.split("/").length)
    .slice(0, 6)
    .forEach((f) => entries.add(f.path));
  files
    .filter((f) => /(^|\/)cmd\/[^/]+\/main\.go$|(^|\/)src\/main\.rs$|(^|\/)manage\.py$/.test(f.path))
    .forEach((f) => entries.add(f.path));
  const P: Project = {
    name: name || "Project",
    files: files.length,
    bins: bins.length,
    total: files.length + bins.length,
    lines,
    langs: [...byLang.values()].filter((x) => x.lines).sort((a, b) => b.lines - a.lines),
    edges,
    comps: [...comps.values()]
      .map((c) => ({
        ...c,
        langs: [...c.langs.entries()]
          .sort((a, b) => b[1] - a[1])
          .map((x) => x[0])
          .slice(0, 3),
      }))
      .sort((a, b) => b.files - a.files),
    compEdges: [...compEdges.entries()].map(([k, n]) => {
      const [a, b] = k.split(">");
      return { from: a, to: b, n };
    }),
    readmes: files
      .filter((f) => isReadme(f.path))
      .map((f) => f.path)
      .sort((a, b) => a.split("/").length - b.split("/").length),
    docs: files.filter((f) => isDoc(f.path)).map((f) => f.path),
    manifests: files.filter((f) => isManifest(f.path)).map((f) => f.path),
    ci: allPaths.filter(isCI),
    docker: allPaths.filter((p) => isDocker(p)).slice(0, 12),
    tests: allPaths.filter(isTestPath),
    entries: [...entries],
    license: allPaths.find((p) => /^(LICENSE|LICENCE|COPYING)/i.test(p)) || null,
    envExample: allPaths.find((p) => /(^|\/)\.env\.(example|sample|template)$|(^|\/)env\.example$/i.test(p)) || null,
    envVars: [...envVars].slice(0, 40),
    todos: todos.sort((a, b) => b.n - a.n),
    commands: projectCommands(files),
    stack: projectStack(files),
    big: files
      .filter((f) => isCode(f.path) && (lineOf.get(f.path) ?? 0) > 800)
      .sort((a, b) => (lineOf.get(b.path) ?? 0) - (lineOf.get(a.path) ?? 0))
      .map((f) => ({ path: f.path, lines: lineOf.get(f.path) ?? 0 })),
  };
  return P;
}

export function componentsFromLocal(P: Project): PComponent[] {
  return P.comps
    .filter((c) => c.files)
    .slice(0, 24)
    .map((c) => ({
      name: c.key,
      path: c.key === "(root)" ? "" : c.key,
      kind: /test|spec|e2e/i.test(c.key)
        ? "tests"
        : /docs?$/i.test(c.key)
          ? "docs"
          : /^\.github|deploy|infra|k8s|helm|terraform|docker/i.test(c.key)
            ? "infra"
            : /config|settings/i.test(c.key)
              ? "config"
              : /ui|web|client|frontend|components|pages|views|public|static/i.test(c.key)
                ? "ui"
                : /api|routes|server|controllers|handlers/i.test(c.key)
                  ? "api"
                  : /db|data|models|migrations|schema|repositor/i.test(c.key)
                    ? "data"
                    : /cli|cmd|bin|scripts/i.test(c.key)
                      ? "cli"
                      : "library",
      purpose: `${c.files} file${c.files === 1 ? "" : "s"}${c.langs.length ? " · " + c.langs.join(", ") : ""}`,
      depends: P.compEdges.filter((e) => e.from === c.key).map((e) => e.to),
      keyFiles: c.paths
        .filter((p) => isReadme(p) || ENTRY_RE.test(p) || isManifest(p))
        .slice(0, 4)
        .concat(c.paths.filter((p) => isCode(p)).slice(0, 3))
        .slice(0, 6),
    }));
}

export function compOfPath(components: PComponent[], path: string): PComponent | null {
  let best: PComponent | null = null;
  let bl = -1;
  components.forEach((c) => {
    const cp = (c.path || "").replace(/\/$/, "");
    if (cp === "" && bl < 0) {
      best = c;
      bl = 0;
    } else if (cp && (path === cp || path.startsWith(cp + "/")) && cp.length > bl) {
      best = c;
      bl = cp.length;
    } else if ((c.keyFiles || []).includes(path) && bl < 1) {
      best = c;
      bl = 1;
    }
  });
  return best;
}

export function compDeps(components: PComponent[], project: Project): CompEdge[] {
  const map = new Map<string, CompEdge>();
  components.forEach((c) =>
    (c.depends || []).forEach((d) => map.set(c.name + ">" + d, { from: c.name, to: d, n: 0, ai: true })),
  );
  project.edges.forEach((e) => {
    const a = compOfPath(components, e.from);
    const b = compOfPath(components, e.to);
    if (!a || !b || a === b) return;
    const k = a.name + ">" + b.name;
    const cur = map.get(k) || { from: a.name, to: b.name, n: 0 };
    cur.n++;
    map.set(k, cur);
  });
  return [...map.values()];
}

export function compStats(
  components: PComponent[],
  files: ProjectFile[],
  bins: BinFile[],
  comp: PComponent,
): { files: number; lines: number; langs: string[]; paths: string[]; readme?: string; tests: number } {
  const ps = [...files, ...bins].filter((f) => compOfPath(components, f.path) === comp);
  const lines = ps.reduce((a, f) => a + ("bin" in f ? 0 : f.lines || lineCount(f.text)), 0);
  const langs = new Map<string, number>();
  ps.forEach((f) => {
    if (!("bin" in f)) {
      const L = langOf(f.path).name;
      langs.set(L, (langs.get(L) || 0) + (f.lines || lineCount(f.text)));
    }
  });
  return {
    files: ps.length,
    lines,
    langs: [...langs.entries()]
      .sort((a, b) => b[1] - a[1])
      .map((x) => x[0])
      .slice(0, 3),
    paths: ps.map((f) => f.path),
    readme: ps.find((f) => isReadme(f.path))?.path,
    tests: ps.filter((f) => isTestPath(f.path)).length,
  };
}

export const KIND_COLOR: Record<string, string> = {
  ui: "var(--step)",
  api: "var(--loop)",
  service: "var(--loop)",
  library: "var(--make)",
  cli: "var(--step)",
  data: "var(--decide)",
  infra: "var(--muted)",
  config: "var(--muted)",
  tests: "var(--link)",
  docs: "var(--faint)",
  other: "var(--wire)",
};
