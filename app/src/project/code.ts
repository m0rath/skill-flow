/*
  Code index builder for the Project Flow Mapper.

  Per-language parsers (JS/TS, Python, Go) plus a generic fallback turn each source
  file into a `Parsed` record; `buildCodeIndex` then assembles the symbol table,
  resolves calls between files, and discovers routes.

  Ported faithfully from the legacy analyser in app/_ref/legacy-app.js (the
  "CODE INDEX + FLOWS" section). The legacy version read the globals `S.files` /
  `S.bins` and wrote `S.code`; this port takes the files as its only argument and
  returns the index, touching no global state.
*/

import type {
  Api,
  Bind,
  CallTarget,
  CodeIndex,
  ExtRef,
  Mount,
  Parsed,
  ParsedRoute,
  ProjectFile,
  Reexport,
  Route,
  Sym,
} from "@/project/types";

/* ---------- shared small helpers (ported from the legacy analyser) ---------- */

const arr = (x: unknown): unknown[] => (Array.isArray(x) ? (x as unknown[]) : x == null || x === "" ? [] : [x]);

const isCode = (p: string): boolean =>
  /\.(js|jsx|ts|tsx|mjs|cjs|vue|svelte|astro|py|rb|go|rs|java|kt|kts|scala|swift|c|h|cc|cpp|cxx|hpp|cs|php|sh|bash|ps1|sql|dart|ex|exs|lua|r|hs|clj|zig|sol)$/i.test(
    p,
  );

const dirOf = (p: string): string => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

function joinPath(dir: string, rel: string): string {
  const parts = dir ? dir.split("/") : [];
  rel.split("/").forEach((x) => {
    if (x === "..") parts.pop();
    else if (x && x !== ".") parts.push(x);
  });
  return parts.join("/");
}

function joinRoute(...parts: (string | undefined | null)[]): string {
  const s = parts
    .filter(Boolean)
    .map((x) => String(x).replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
  return "/" + s;
}

/** Run `fn` over every parsed file; a malformed file must not abort the whole build. */
function eachFile(P: Record<string, Parsed>, fn: (path: string, p: Parsed) => void): void {
  Object.entries(P).forEach(([k, v]) => {
    try {
      fn(k, v);
    } catch {
      /* ignore a single file's failure, matching the legacy per-file try/catch */
    }
  });
}

function pushTo<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const list = m.get(k);
  if (list) list.push(v);
  else m.set(k, [v]);
}

/** Build a symbol with the `calls` array every `Sym` requires. */
const mkSym = (s: Omit<Sym, "calls">): Sym => ({ ...s, calls: [] });

/* ---------- block ranges ---------- */

function indentOf(l: string): number {
  return (l.match(/^\s*/) || [""])[0].replace(/\t/g, "    ").length;
}

function braceEnd(lines: string[], start: number): number {
  let depth = 0;
  let seen = false;
  let inStr: string | null = null;
  let inBlock = false;
  for (let i = start; i < lines.length && i < start + 3000; i++) {
    const l = lines[i];
    for (let k = 0; k < l.length; k++) {
      const c = l[k];
      const n = l[k + 1];
      if (inBlock) {
        if (c === "*" && n === "/") {
          inBlock = false;
          k++;
        }
        continue;
      }
      if (inStr) {
        if (c === "\\") {
          k++;
          continue;
        }
        if (c === inStr) inStr = null;
        continue;
      }
      if (c === "/" && n === "/") break;
      if (c === "/" && n === "*") {
        inBlock = true;
        k++;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") {
        inStr = c;
        continue;
      }
      if (c === "{") {
        depth++;
        seen = true;
      } else if (c === "}") {
        depth--;
        if (seen && depth <= 0) return i;
      }
    }
    if (inStr === '"' || inStr === "'") inStr = null;
    if (!seen && i > start + 2 && !/[({,=>]\s*$/.test(lines[i])) return i;
  }
  return Math.min(lines.length - 1, start + 1);
}

function pyEnd(lines: string[], start: number): number {
  const base = indentOf(lines[start]);
  let last = start;
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim() || /^\s*#/.test(l)) continue;
    if (indentOf(l) <= base) break;
    last = i;
  }
  return last;
}

function condFor(lines: string[], line: number, fnStart: number): string | null {
  const ind = indentOf(lines[line]);
  for (let i = line - 1; i > fnStart; i--) {
    const l = lines[i];
    if (!l.trim()) continue;
    const li = indentOf(l);
    if (li < ind) {
      const m = l
        .trim()
        .match(
          /^(?:}\s*)?(if|else\s+if|elif|else|for|while|switch|case|catch|except|try|with|when|unless|select)\b(.*)$/,
        );
      if (m) {
        const full = (m[1] + m[2]).replace(/\s*[{:]\s*$/, "").replace(/\s+/g, " ");
        const f = full.match(/^for\s*\(?\s*(?:const|let|var|await)?\s*\(?\s*([\w$]+)[^)]*?\s+(?:of|in)\s+(.+?)\)?$/);
        if (f) {
          let e = f[2].replace(/\)\s*$/, "");
          const bal = (e.match(/\(/g) || []).length - (e.match(/\)/g) || []).length;
          if (bal > 0) e += ")".repeat(bal);
          return ("for each " + f[1] + " in " + e).slice(0, 60);
        }
        return full.slice(0, 70);
      }
      return null;
    }
  }
  return null;
}

/* ---------- language tables ---------- */

const JS_FILE = /\.(js|jsx|ts|tsx|mjs|cjs|vue|svelte)$/i;
const PY_FILE = /\.pyi?$/i;
const GO_FILE = /\.go$/i;

const EXT_CATS: [RegExp, string][] = [
  [
    /^(pg|postgres|mysql2?|mariadb|mongoose|mongodb|sequelize|knex|prisma|@prisma\/client|typeorm|drizzle-orm|redis|ioredis|sqlite3?|better-sqlite3|psycopg2?|asyncpg|sqlalchemy|pymongo|peewee|tortoise|django\.db|database\/sql|gorm|pgx|mgo|jdbc|dynamodb)/i,
    "Database",
  ],
  [
    /^(axios|node-fetch|got|superagent|undici|ky|requests|httpx|urllib3?|aiohttp|net\/http|resty|okhttp|grpc|@grpc)/i,
    "HTTP / external API",
  ],
  [
    /^(fs|fs\/promises|node:fs|path|node:path|os|shutil|pathlib|io\/ioutil|os\/exec|child_process|subprocess|glob)$/i,
    "File system / OS",
  ],
  [
    /^(express|fastify|koa|hapi|@hapi|restify|flask|fastapi|starlette|django|gin|github\.com\/gin-gonic|echo|fiber|chi|mux|@nestjs|next|nuxt|sinatra|rails)/i,
    "Web framework",
  ],
  [/^(kafkajs|amqplib|bullmq|bull|celery|pika|nats|@aws-sdk\/client-sqs|rabbitmq|kafka)/i, "Queue / messaging"],
  [
    /^(aws-sdk|@aws-sdk|boto3|@google-cloud|google-cloud|@azure|azure|firebase|@supabase|stripe|twilio|@slack|slack_sdk|@sendgrid|nodemailer)/i,
    "Cloud / SaaS",
  ],
  [/^(openai|@anthropic-ai|anthropic|@google\/generative-ai|google\.generativeai|langchain|@langchain)/i, "AI API"],
  [/^(react|react-dom|vue|svelte|@angular|preact|solid-js)$/i, "UI framework"],
  [/^(jest|vitest|mocha|chai|pytest|unittest|testing)$/i, "Test framework"],
];

const extCat = (pkg: string): string => {
  for (const [re, cat] of EXT_CATS) if (re.test(pkg)) return cat;
  return "Library";
};
const pkgName = (spec: string): string =>
  spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];

/* ---------- generic symbol scanner (used by the generic parser) ---------- */

function codeSymbols(text: string, path: string): { line: number; kind: string; name: string }[] {
  const syms: { line: number; kind: string; name: string }[] = [];
  const lines = text.split("\n");
  const re = /\.(py)$/i.test(path)
    ? /^(\s*)(?:async\s+)?(def|class)\s+(\w+)/
    : /\.(go)$/i.test(path)
      ? /^()(func|type)\s+(?:\([^)]*\)\s*)?(\w+)/
      : /\.(rs)$/i.test(path)
        ? /^(\s*)(?:pub(?:\([^)]*\))?\s+)?(fn|struct|enum|trait|impl|mod)\s+(\w+)/
        : /\.(java|kt|cs|scala|swift)$/i.test(path)
          ? /^(\s*)(?:(?:public|private|protected|internal|static|final|abstract|override|open|data|sealed)\s+)*(class|interface|enum|record|object|fun|void|[\w<>[\]]+)\s+(\w+)\s*[({<]/
          : /\.(rb)$/i.test(path)
            ? /^(\s*)(def|class|module)\s+([\w.?!]+)/
            : /\.(php)$/i.test(path)
              ? /^(\s*)(?:(?:public|private|protected|static|abstract|final)\s+)*(function|class|interface|trait)\s+(\w+)/
              : /^(\s*)(?:export\s+)?(?:default\s+)?(?:async\s+)?(function\*?|class|const|let|var|interface|type|enum)\s+(\w+)\s*(?:[=(<:{]|extends|implements)/;
  lines.forEach((l, i) => {
    const m = l.match(re);
    if (!m || (m[1] || "").length > 4 || /^\s*(return|if|for|while|switch)\b/.test(l)) return;
    if (/^(const|let|var)$/.test(m[2]) && (m[1] || "").length > 0) return;
    if (
      /^(const|let|var)$/.test(m[2]) &&
      !/=\s*(async\s*)?(\(|function|class|[\w$]+\s*=>)|=\s*express\.Router|=\s*z\.object/.test(l)
    )
      return;
    syms.push({ line: i + 1, kind: m[2], name: m[3] });
  });
  return syms;
}

/* ---------- per-language parsers ---------- */

type Resolver = (from: string, spec: string) => string | null;
type ModResolver = (from: string, mod: string) => string | null;

function parseJs(f: ProjectFile, resolve: Resolver): Parsed {
  const lines = f.text.split("\n");
  const syms: Sym[] = [];
  const bind = new Map<string, Bind>();
  const routes: ParsedRoute[] = [];
  const mounts: Mount[] = [];
  // bindings
  for (const m of f.text.matchAll(
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)(?:\.([A-Za-z_$][\w$]*))?/g,
  ))
    bind.set(m[1], { spec: m[2], name: m[3] || undefined });
  for (const m of f.text.matchAll(/(?:const|let|var)\s*\{([^}]+)\}\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/g))
    m[1].split(",").forEach((p) => {
      const [a, b] = p.split(":").map((x) => x.trim());
      if (a) bind.set(b || a, { spec: m[2], name: a });
    });
  for (const m of f.text.matchAll(/import\s+([^'";]+?)\s+from\s+['"]([^'"]+)['"]/g)) {
    const spec = m[2];
    const c = m[1].trim();
    const def = c.match(/^([A-Za-z_$][\w$]*)\s*(,|$)/);
    if (def) bind.set(def[1], { spec, name: "default" });
    const ns = c.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
    if (ns) bind.set(ns[1], { spec });
    const named = c.match(/\{([^}]+)\}/);
    if (named)
      named[1].split(",").forEach((p) => {
        const [a, b] = p.trim().split(/\s+as\s+/);
        if (a) bind.set((b || a).trim(), { spec, name: a.trim() });
      });
  }
  const reexports: Reexport[] = [];
  for (const m of f.text.matchAll(/export\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g))
    m[1].split(",").forEach((x) => {
      const [a, b] = x.trim().split(/\s+as\s+/);
      if (a) {
        bind.set((b || a).trim(), { spec: m[2], name: a.trim() });
        reexports.push({ name: (b || a).trim(), orig: a.trim(), file: resolve(f.path, m[2]) ?? undefined });
      }
    });
  for (const m of f.text.matchAll(/export\s*\*\s*(?:as\s+(\w+)\s*)?from\s*['"]([^'"]+)['"]/g))
    reexports.push({ all: !m[1], name: m[1] || undefined, file: resolve(f.path, m[2]) ?? undefined });
  bind.forEach((b) => {
    b.file = resolve(f.path, b.spec ?? "") ?? undefined;
    b.pkg = b.file ? undefined : pkgName(b.spec ?? "");
  });
  // instances of external libraries: const pool = new Pool(...), const app = express(), const router = express.Router()
  for (const m of f.text.matchAll(
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:new\s+)?([A-Za-z_$][\w$]*)(?:\.[A-Za-z_$][\w$]*)?\s*\(/g,
  )) {
    const src = bind.get(m[2]);
    if (src && src.pkg && !bind.has(m[1])) bind.set(m[1], { pkg: src.pkg });
  }
  // symbols
  const kw = /^(if|for|while|switch|catch|function|return|else|do|try|with|constructor)$/;
  let cls: string | null = null;
  let clsEnd = -1;
  let ctrl = "";
  let deco: { method: string; path: string } | null = null;
  lines.forEach((l, i) => {
    if (i > clsEnd) cls = null;
    let m: RegExpMatchArray | null;
    if ((m = l.match(/^\s*@Controller\(\s*(?:['"`]([^'"`]*)['"`])?/))) {
      ctrl = m[1] || "";
      return;
    }
    if ((m = l.match(/^\s*@(Get|Post|Put|Patch|Delete|All|Options|Head)\(\s*(?:['"`]([^'"`]*)['"`])?\s*\)/))) {
      deco = { method: m[1].toUpperCase(), path: m[2] || "" };
      return;
    }
    if ((m = l.match(/^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/))) {
      cls = m[1];
      clsEnd = braceEnd(lines, i);
      syms.push(mkSym({ name: m[1], kind: "class", line: i, end: clsEnd }));
      return;
    }
    if (
      (m = l.match(
        /^\s*(?:module\.exports|exports\.([A-Za-z_$][\w$]*))\s*=\s*(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)?\s*\(/,
      ))
    ) {
      syms.push(
        mkSym({
          name: m[1] || m[2] || "(default export)",
          kind: "function",
          line: i,
          end: braceEnd(lines, i),
          exportDefault: !m[1],
        }),
      );
      return;
    }
    if ((m = l.match(/^\s*export\s+default\s+(?:async\s+)?function\s*\*?\s*\(/))) {
      syms.push(
        mkSym({ name: "(default export)", kind: "function", line: i, end: braceEnd(lines, i), exportDefault: true }),
      );
      return;
    }
    if ((m = l.match(/^\s*([A-Za-z_$][\w$]*)\.prototype\.([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function\b/))) {
      syms.push(
        mkSym({
          name: m[1] + "." + m[2],
          short: m[2],
          kind: "method",
          line: i,
          end: braceEnd(lines, i),
          proto: m[1],
        }),
      );
      return;
    }
    if ((m = l.match(/^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/))) {
      syms.push(mkSym({ name: m[1], kind: "function", line: i, end: braceEnd(lines, i) }));
      return;
    }
    if (
      (m = l.match(
        /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*(?::[^=]+)?=>|[A-Za-z_$][\w$]*\s*=>)/,
      ))
    ) {
      const end = /=>\s*[^{\s]/.test(l) && !/=>\s*\{/.test(l) ? i : braceEnd(lines, i);
      syms.push(mkSym({ name: m[1], kind: "function", line: i, end }));
      return;
    }
    if (
      cls &&
      (m = l.match(
        /^\s+(?:public\s+|private\s+|protected\s+|static\s+|async\s+|get\s+|set\s+|readonly\s+)*([A-Za-z_$][\w$]*)\s*\(/,
      )) &&
      !kw.test(m[1]) &&
      /\)\s*(?::[^{;]+)?\{\s*$/.test(
        lines
          .slice(i, i + 6)
          .join(" ")
          .split("{")[0] + "{",
      )
    ) {
      syms.push(mkSym({ name: m[1], kind: "method", cls, line: i, end: braceEnd(lines, i) }));
      if (deco) {
        routes.push({
          method: deco.method,
          path: joinRoute(ctrl, deco.path),
          obj: "nest",
          line: i,
          symLine: i,
        });
        deco = null;
      }
      return;
    }
    if ((m = l.match(/^\s*([A-Za-z_$][\w$]*)\s*:\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*=>)/)) && !cls) {
      syms.push(mkSym({ name: m[1], kind: "function", line: i, end: braceEnd(lines, i) }));
      return;
    }
    // routes: app.get("/x", ...), router.post("/", handler)
    if (
      (m = l.match(
        /\b([A-Za-z_$][\w$]*)\.(get|post|put|patch|delete|all|options|head)\(\s*['"`]([^'"`]+)['"`]\s*,\s*(.*)$/i,
      ))
    ) {
      const rest = m[4];
      const ref = rest.match(/^\s*([A-Za-z_$][\w$.]*)\s*[,)]/);
      const inline = /(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>|function\s*\(/.test(rest);
      const r: ParsedRoute = {
        method: m[2].toUpperCase(),
        path: m[3],
        obj: m[1],
        line: i,
        handlerRef: !inline && ref ? ref[1] : undefined,
      };
      if (inline) {
        const end = braceEnd(lines, i);
        syms.push(mkSym({ name: `${r.method} ${r.path}`, kind: "route", line: i, end, route: r }));
      }
      routes.push(r);
      return;
    }
    if ((m = l.match(/\b([A-Za-z_$][\w$]*)\.use\(\s*['"`]([^'"`]+)['"`]\s*,\s*([A-Za-z_$][\w$]*)\s*\)/)))
      mounts.push({ prefix: m[2], ref: m[3], line: i });
  });
  lines.forEach((l, i) => {
    if (syms.some((s) => s.line === i)) return;
    for (const m of l.matchAll(
      /(?:^|[{,]\s*)([A-Za-z_$][\w$]*)\s*:\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/g,
    )) {
      if (syms.some((s) => s.name === m[1])) continue;
      const end = /=>\s*\{|function[^{]*\{/.test(l.slice(m.index)) ? braceEnd(lines, i) : i;
      syms.push(mkSym({ name: m[1], kind: "function", line: i, end }));
    }
  });
  return { lines, syms, bind, routes, mounts, reexports, lang: "js" };
}

function parsePy(f: ProjectFile, resolveMod: ModResolver): Parsed {
  const lines = f.text.split("\n");
  const syms: Sym[] = [];
  const bind = new Map<string, Bind>();
  const routes: ParsedRoute[] = [];
  const mounts: Mount[] = [];
  for (const m of f.text.matchAll(/^\s*from\s+([.\w]+)\s+import\s+\(?([^)\n]+)\)?/gm)) {
    const file = resolveMod(f.path, m[1]);
    m[2].split(",").forEach((p) => {
      const [a, b] = p.trim().split(/\s+as\s+/);
      if (!a || a === "*") return;
      const sub = resolveMod(f.path, m[1] + "." + a);
      bind.set(
        (b || a).trim(),
        sub ? { file: sub } : file ? { file, name: a.trim() } : { pkg: m[1].replace(/^\.+/, "").split(".")[0] || m[1] },
      );
    });
  }
  for (const m of f.text.matchAll(/^\s*import\s+([\w.]+)(?:\s+as\s+(\w+))?/gm)) {
    const file = resolveMod(f.path, m[1]);
    bind.set(m[2] || m[1].split(".")[0], file ? { file } : { pkg: m[1].split(".")[0] });
  }
  for (const m of f.text.matchAll(/^\s*(\w+)\s*=\s*(\w+)(?:\.\w+)?\(/gm)) {
    const src = bind.get(m[2]);
    if (src && src.pkg && !bind.has(m[1])) bind.set(m[1], { pkg: src.pkg });
  }
  let cls: string | null = null;
  let clsInd = -1;
  lines.forEach((l, i) => {
    const ind = indentOf(l);
    if (cls && l.trim() && ind <= clsInd && !/^\s*[#@]/.test(l)) cls = null;
    let m: RegExpMatchArray | null;
    if ((m = l.match(/^(\s*)class\s+(\w+)/))) {
      cls = m[2];
      clsInd = ind;
      syms.push(mkSym({ name: m[2], kind: "class", line: i, end: pyEnd(lines, i) }));
      return;
    }
    if ((m = l.match(/^(\s*)(?:async\s+)?def\s+(\w+)\s*\(/))) {
      const s = mkSym({
        name: m[2],
        kind: cls && ind > clsInd ? "method" : "function",
        cls: cls && ind > clsInd ? cls : undefined,
        line: i,
        end: pyEnd(lines, i),
      });
      for (let k = i - 1; k >= 0 && /^\s*@/.test(lines[k]); k--) {
        if (/@(?:[\w.]+\.)?(task|shared_task|periodic_task|job|scheduled_job|cron)\b/.test(lines[k])) s.job = "job";
        if (/@(?:[\w.]+\.)?(command|group)\b/.test(lines[k])) s.job = "command";
        const d = lines[k].match(
          /@(\w+)\.(route|get|post|put|patch|delete|api_route)\(\s*['"]([^'"]+)['"](?:.*methods\s*=\s*\[([^\]]+)\])?/,
        );
        if (d) {
          const method =
            d[2] === "route"
              ? d[4]
                ? d[4]
                    .replace(/['"\s]/g, "")
                    .split(",")[0]
                    .toUpperCase()
                : "GET"
              : d[2].toUpperCase();
          const route: ParsedRoute = { method, path: d[3], obj: d[1], line: k };
          s.kind = "route";
          s.route = route;
          s.name = `${method} ${d[3]}`;
          s.fn = m[2];
          routes.push(route);
        }
      }
      syms.push(s);
      return;
    }
    if (/^if\s+__name__\s*==\s*['"]__main__['"]/.test(l))
      syms.push(mkSym({ name: "__main__", kind: "main", line: i, end: pyEnd(lines, i) }));
    if (/(^|\/)urls\.py$/.test(f.path) && (m = l.match(/\b(?:re_)?path\(\s*r?['"]([^'"]*)['"]\s*,\s*([\w.]+)/)))
      routes.push({
        method: "ANY",
        path: "/" + m[1].replace(/^\^|\$$/g, ""),
        obj: "django",
        line: i,
        handlerRef: m[2].split(".").slice(0, 2).join("."),
      });
  });
  return { lines, syms, bind, routes, mounts, lang: "py" };
}

function parseGo(
  f: ProjectFile,
  goModule: string | undefined,
  goModDir: string,
  dirFiles: string[] | undefined,
): Parsed {
  const lines = f.text.split("\n");
  const syms: Sym[] = [];
  const bind = new Map<string, Bind>();
  const routes: ParsedRoute[] = [];
  const mounts: Mount[] = [];
  for (const m of f.text.matchAll(/import\s*(?:\(([\s\S]*?)\)|(\w+\s+)?"([^"]+)")/g)) {
    const specs: [string, string][] = m[1]
      ? [...m[1].matchAll(/(\w+\s+)?"([^"]+)"/g)].map((x) => [x[1], x[2]])
      : [[m[2], m[3]]];
    specs.forEach(([alias, s]) => {
      const name = (alias || "").trim() || s.split("/").pop() || "";
      if (goModule && s.startsWith(goModule + "/")) {
        const d = joinPath(goModDir, s.slice(goModule.length + 1));
        bind.set(name, { dir: d });
      } else bind.set(name, { pkg: s });
    });
  }
  lines.forEach((l, i) => {
    const m = l.match(/^func\s+(?:\(\s*\w+\s+\*?(\w+)\s*\)\s*)?(\w+)\s*\(/);
    if (m)
      syms.push(
        mkSym({
          name: m[2],
          kind: m[1] ? "method" : "function",
          cls: m[1] || undefined,
          line: i,
          end: braceEnd(lines, i),
        }),
      );
    const r = l.match(
      /\b(\w+)\.(HandleFunc|Handle|GET|POST|PUT|PATCH|DELETE|Get|Post|Put|Patch|Delete)\(\s*"([^"]+)"\s*,\s*([\w.]+)/,
    );
    if (r) {
      const method = /HandleFunc|Handle/.test(r[2]) ? "ANY" : r[2].toUpperCase();
      routes.push({ method, path: r[3], obj: r[1], line: i, handlerRef: r[4] });
    }
  });
  return { lines, syms, bind, routes, mounts, lang: "go", dirFiles };
}

function parseGeneric(f: ProjectFile): Parsed {
  const lines = f.text.split("\n");
  const syms: Sym[] = codeSymbols(f.text, f.path)
    .filter((s) => !/^(const|let|var|type|interface|enum|struct|record)$/.test(s.kind))
    .map((s) =>
      mkSym({
        name: s.name,
        kind: /class|object|module|impl|trait/.test(s.kind) ? "class" : "function",
        line: s.line - 1,
        end:
          /\{\s*$/.test(lines[s.line - 1]) || /\{/.test(lines[s.line - 1])
            ? braceEnd(lines, s.line - 1)
            : pyEnd(lines, s.line - 1),
      }),
    );
  const routes: ParsedRoute[] = [];
  let prefix = "";
  let pending: { method: string; path: string } | null = null;
  lines.forEach((l, i) => {
    let m: RegExpMatchArray | null;
    const ahead = lines.slice(i, i + 5).join(" ");
    if ((m = l.match(/@RequestMapping\(\s*(?:value\s*=\s*|path\s*=\s*)?"([^"]*)"/)) && /\bclass\s/.test(ahead)) {
      prefix = m[1];
      return;
    }
    if ((m = l.match(/\[Route\("([^"]*)"\)\]/)) && /\bclass\s/.test(ahead)) {
      prefix = m[1].replace(
        /\[controller\]/i,
        (f.path.split("/").pop() || "").replace(/Controller\.cs$/i, "").toLowerCase(),
      );
      return;
    }
    if (
      (m = l.match(/@(Get|Post|Put|Delete|Patch|Request)Mapping(?:\(\s*(?:value\s*=\s*|path\s*=\s*)?"?([^")]*)"?)?/))
    ) {
      pending = { method: m[1] === "Request" ? "ANY" : m[1].toUpperCase(), path: m[2] || "" };
      return;
    }
    if ((m = l.match(/\[Http(Get|Post|Put|Delete|Patch)(?:\("([^"]*)"\))?\]/))) {
      pending = { method: m[1].toUpperCase(), path: m[2] || "" };
      return;
    }
    if (
      (m = l.match(
        /Route::(get|post|put|patch|delete|any)\(\s*['"]([^'"]+)['"]\s*,\s*\[\s*(\w+)::class\s*,\s*['"](\w+)['"]/i,
      ))
    ) {
      routes.push({
        method: m[1].toUpperCase(),
        path: joinRoute(m[2]),
        obj: "laravel",
        line: i,
        classRef: m[3],
        fnRef: m[4],
      });
      return;
    }
    if (pending) {
      const sy = syms.find((x) => x.line >= i && x.line <= i + 3);
      if (sy) {
        routes.push({
          method: pending.method,
          path: joinRoute(prefix, pending.path),
          obj: "ctl",
          line: i,
          symLine: sy.line,
        });
        pending = null;
      }
    }
  });
  return { lines, syms, bind: new Map(), routes, mounts: [], lang: "other" };
}

/* ---------- index build ---------- */

export function buildCodeIndex(files: ProjectFile[]): CodeIndex {
  const codeFiles = files.filter((f) => isCode(f.path) && f.text.length < 400000);
  const paths = new Set(files.map((f) => f.path));
  const suffix = new Map<string, string>();
  files.forEach((f) => {
    const segs = f.path.split("/");
    for (let i = 0; i < segs.length; i++) {
      const k = segs.slice(i).join("/");
      if (!suffix.has(k)) suffix.set(k, f.path);
    }
  });
  const JSX = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte", ".d.ts"];
  const tryJs = (base: string): string | null => {
    if (paths.has(base)) return base;
    for (const e of JSX) if (paths.has(base + e)) return base + e;
    for (const e of JSX) if (paths.has(base + "/index" + e)) return base + "/index" + e;
    return null;
  };
  const aliases: { base?: boolean; prefix?: string; targets?: string[]; target?: string }[] = [];
  const wsPkgs = new Map<string, { dir: string; main: string | null }>();
  files
    .filter((f) => /(^|\/)(tsconfig|jsconfig)[\w.-]*\.json$/.test(f.path))
    .forEach((f) => {
      try {
        const j = JSON.parse(
          f.text
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .replace(/(^|[^:"'\\])\/\/.*$/gm, "$1")
            .replace(/,\s*([}\]])/g, "$1"),
        ) as { compilerOptions?: { baseUrl?: string; paths?: Record<string, unknown> } };
        const co = j.compilerOptions || {};
        const base = joinPath(dirOf(f.path), co.baseUrl || ".");
        Object.entries(co.paths || {}).forEach(([k, v]) =>
          aliases.push({
            prefix: k.replace(/\*$/, ""),
            targets: arr(v).map((t) => joinPath(base, String(t).replace(/\*$/, ""))),
          }),
        );
        if (co.baseUrl) aliases.push({ base: true, target: base });
      } catch {
        /* ignore unparseable tsconfig */
      }
    });
  files
    .filter((f) => /(^|\/)package\.json$/.test(f.path) && f.path.includes("/"))
    .forEach((f) => {
      try {
        const j = JSON.parse(f.text) as { name?: string; main?: string; module?: string; exports?: unknown };
        if (j.name)
          wsPkgs.set(j.name, {
            dir: dirOf(f.path),
            main: j.main || j.module || (typeof j.exports === "string" ? j.exports : null),
          });
      } catch {
        /* ignore unparseable package.json */
      }
    });
  const resolveJs: Resolver = (from, spec) => {
    if (spec.startsWith(".")) return tryJs(joinPath(dirOf(from), spec));
    for (const a of aliases) {
      if (a.base || !a.prefix || !spec.startsWith(a.prefix)) continue;
      for (const t of a.targets ?? []) {
        const hit =
          tryJs(joinPath("", t + "/" + spec.slice(a.prefix.length))) ||
          tryJs(joinPath("", t + spec.slice(a.prefix.length)));
        if (hit) return hit;
      }
    }
    for (const [name, w] of wsPkgs) {
      if (spec === name || spec.startsWith(name + "/")) {
        const rest = spec.slice(name.length + 1);
        const hit = rest
          ? tryJs(joinPath(w.dir, rest)) || tryJs(joinPath(w.dir, "src/" + rest))
          : (w.main &&
              tryJs(
                joinPath(
                  w.dir,
                  w.main
                    .replace(/^\.\//, "")
                    .replace(/^(dist|build|lib)\//, "src/")
                    .replace(/\.(c|m)?js$/, ""),
                ),
              )) ||
            tryJs(w.dir + "/src/index") ||
            tryJs(w.dir + "/index");
        if (hit) return hit;
      }
    }
    if (/^[@~#]\//.test(spec)) return tryJs("src/" + spec.slice(2)) || tryJs(spec.slice(2));
    for (const a of aliases)
      if (a.base && a.target) {
        const hit = tryJs(joinPath(a.target, spec));
        if (hit) return hit;
      }
    return null;
  };
  const resolveMod: ModResolver = (from, mod) => {
    let base: string;
    if (mod.startsWith(".")) {
      const dots = mod.match(/^\.+/)?.[0].length ?? 1;
      let d = dirOf(from);
      for (let i = 1; i < dots; i++) d = dirOf(d);
      base = joinPath(d, mod.slice(dots).replace(/\./g, "/"));
    } else base = mod.replace(/\./g, "/");
    for (const c of [base + ".py", base + "/__init__.py"]) {
      const hit = paths.has(c) ? c : suffix.get(c);
      if (hit) return hit;
    }
    return null;
  };
  const goMod = files.find((f) => /(^|\/)go\.mod$/.test(f.path));
  const goModule = goMod && (goMod.text.match(/^module\s+(\S+)/m) || [])[1];
  const goModDir = goMod ? dirOf(goMod.path) : "";
  const byDir = new Map<string, string[]>();
  codeFiles.forEach((f) => {
    const d = dirOf(f.path);
    let list = byDir.get(d);
    if (!list) {
      list = [];
      byDir.set(d, list);
    }
    list.push(f.path);
  });
  const P: Record<string, Parsed> = {};
  codeFiles.forEach((f) => {
    try {
      P[f.path] = JS_FILE.test(f.path)
        ? parseJs(f, resolveJs)
        : PY_FILE.test(f.path)
          ? parsePy(f, resolveMod)
          : GO_FILE.test(f.path)
            ? parseGo(f, goModule, goModDir, byDir.get(dirOf(f.path)))
            : parseGeneric(f);
    } catch {
      P[f.path] = { lines: f.text.split("\n"), syms: [], bind: new Map(), routes: [], mounts: [], lang: "other" };
    }
  });
  // symbol table
  const SY = new Map<string, Sym>();
  const byName = new Map<string, Sym[]>();
  eachFile(P, (path, p) => {
    p.syms.forEach((s) => {
      const id =
        path +
        "#" +
        (s.cls && s.kind === "method" ? s.cls + "." : "") +
        (s.fn || s.name) +
        (s.kind === "route" ? "@" + s.line : "");
      s.id = id;
      s.file = path;
      s.calls = [];
      SY.set(id, s);
      if (s.kind !== "route") pushTo(byName, s.fn || s.name, s);
    });
    const topId = path + "#(top)";
    const top: Sym = {
      id: topId,
      file: path,
      name: "(module start-up)",
      kind: "module",
      line: 0,
      end: p.lines.length - 1,
      calls: [],
    };
    SY.set(topId, top);
    p.top = top;
  });
  const symIn = (path: string, name: string): Sym | null => {
    const p = P[path];
    if (!p) return null;
    return (
      p.syms.find((s) => (s.fn || s.name) === name && s.kind !== "route" && s.kind !== "class") ||
      p.syms.find((s) => s.name === name && s.kind === "class") ||
      null
    );
  };
  const idOf = (s: Sym | null | undefined): string | null => (s && typeof s.id === "string" ? s.id : null);
  const topIdOf = (p: Parsed): string => (p.top && typeof p.top.id === "string" ? p.top.id : "");
  const enclosing = (p: Parsed, line: number): Sym | null => {
    let best: Sym | null = null;
    p.syms.forEach((s) => {
      if (s.kind === "class") return;
      if (line >= s.line && line <= s.end && (!best || s.line >= best.line)) best = s;
    });
    return best;
  };
  const extLabel = (pkg: string, member?: string | null): ExtRef => ({
    ext: true,
    cat: extCat(pkg),
    pkg,
    label: `${pkg}${member ? "." + member : ""}`,
  });
  // an imported object that is an instance of an outside library (e.g. export const db = new Pool())
  const instExt = (file: string, varName: string | undefined, method: string): ExtRef | null => {
    try {
      const q = P[file];
      if (!q) return null;
      const txt = q.lines.join("\n");
      const vn = String(varName || "").replace(/[$]/g, "\\$");
      const re =
        vn && vn !== "default"
          ? new RegExp(
              "(?:^|[\\n;])\\s*(?:export\\s+)?(?:const|let|var)?\\s*" +
                vn +
                "\\s*(?::[^=\\n]+)?=\\s*(?:await\\s+)?(?:new\\s+)?([A-Za-z_$][\\w$]*)(?:\\.[\\w$]+)*\\s*\\(",
            )
          : /(?:export\s+default|module\.exports\s*=)\s*(?:new\s+)?([A-Za-z_$][\w$]*)(?:\.[\w$]+)*\s*\(/;
      const m = txt.match(re);
      if (!m) return null;
      const bb = q.bind && q.bind.get(m[1]);
      return bb && bb.pkg ? extLabel(bb.pkg, method) : null;
    } catch {
      return null;
    }
  };
  // calls
  eachFile(P, (path, p) => {
    const lines = p.lines;
    const re = /(?<![\w$.])(?:(this|self|[A-Za-z_$][\w$]*)\s*\.\s*)?([A-Za-z_$][\w$]*)\s*\(/g;
    lines.forEach((l, i) => {
      const code = l.replace(/\/\/.*$|#.*$/, "").replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""');
      if (/^\s*(\*|\/\*)/.test(l)) return;
      const host = enclosing(p, i) || p.top;
      if (!host) return;
      if (host === p.top && p.routes.some((r) => r.line === i)) return;
      if (host.kind !== "module" && i === host.line && !/=>\s*\S|\)\s*\{\s*\S/.test(code)) return;
      for (const m of code.matchAll(re)) {
        const obj = m[1];
        const name = m[2];
        if (!obj && /^(function|if|for|while|switch|catch|return|typeof|def|class|elif|func|new|await)$/.test(name))
          continue;
        if (!obj && i === host.line && (host.fn || host.name) === name) continue;
        let to: CallTarget | null = null;
        if (!obj) {
          const params = new Set<string>();
          for (let k = host.kind === "module" ? Math.max(0, i - 3) : host.line; k <= i; k++)
            for (const pm of lines[k].matchAll(
              /function\s*[\w$]*\s*\(([^)]*)\)|\(([^)]*)\)\s*=>|([A-Za-z_$][\w$]*)\s*=>|def\s+\w+\s*\(([^)]*)\)|lambda\s+([^:]*):/g,
            ))
              (pm[1] || pm[2] || pm[3] || pm[4] || pm[5] || "").split(",").forEach((x) => {
                const nm = x
                  .trim()
                  .replace(/[=:].*$/, "")
                  .replace(/^[.*]+/, "")
                  .trim();
                if (nm) params.add(nm);
              });
          if (params.has(name)) continue;
          const local = symIn(path, name);
          if (local && local !== host) to = idOf(local);
          else {
            const b = p.bind.get(name);
            if (b) {
              if (b.file) {
                const t =
                  b.name && b.name !== "default" ? symIn(b.file, b.name) : symIn(b.file, name) || P[b.file]?.top;
                to = t ? idOf(t) : null;
              } else if (b.pkg)
                to = extLabel(
                  b.pkg,
                  b.name && b.name !== "default" ? b.name : name !== b.pkg.split("/").pop() ? name : null,
                );
            }
          }
          if (!to && p.lang === "go") {
            const same = (p.dirFiles || []).map((fp) => symIn(fp, name)).find(Boolean);
            if (same && same !== host) to = idOf(same);
          }
          if (!to && name === "fetch")
            to = { ext: true, cat: "HTTP / external API", pkg: "fetch", label: "fetch (HTTP)" };
          if (!to && name === "open" && p.lang === "py")
            to = { ext: true, cat: "File system / OS", pkg: "open", label: "open (file)" };
          if (!to && p.lang === "other") {
            const cands = (byName.get(name) || []).filter((s) => s.file !== path);
            if (cands.length === 1) to = idOf(cands[0]);
          }
        } else if (obj === "this" || obj === "self") {
          const t: Sym | null | undefined =
            (host.cls ? P[path]?.syms.find((s) => s.cls === host.cls && s.name === name) : undefined) ||
            (host.proto ? P[path]?.syms.find((s) => s.proto === host.proto && s.short === name) : undefined) ||
            symIn(path, name);
          if (t && t !== host) to = idOf(t);
        } else {
          const b = p.bind.get(obj);
          if (b && b.file) {
            const t = symIn(b.file, name);
            to = t
              ? idOf(t)
              : P[b.file]
                ? instExt(b.file, b.name && b.name !== "*" ? b.name : obj, name) || {
                    fileCall: true,
                    file: b.file,
                    label: name + "()",
                  }
                : null;
          } else if (b && b.dir) {
            const t = byDir
              .get(b.dir)
              ?.map((fp) => symIn(fp, name))
              .find(Boolean);
            if (t) to = idOf(t);
          } else if (b && b.pkg) to = extLabel(b.pkg, name);
          else if (
            /^(res|response|reply|ctx|w)$/.test(obj) &&
            /^(json|send|status|render|redirect|end|sendStatus|write|WriteHeader|sendFile|body)$/.test(name)
          )
            to = { ext: true, cat: "Response to caller", pkg: "response", label: `${obj}.${name}` };
          else if (/^(fs|path|os|shutil|subprocess|child_process)$/.test(obj)) to = extLabel(obj, name);
          else if (/^(requests|httpx|axios|http|https)$/.test(obj)) to = extLabel(obj, name);
          else if (obj === "process" && name === "exit")
            to = { ext: true, cat: "File system / OS", pkg: "process", label: "process.exit" };
        }
        if (!to) continue;
        if (
          typeof to === "object" &&
          "ext" in to &&
          to.ext &&
          (to.cat === "Web framework" || to.cat === "Test framework" || to.cat === "UI framework") &&
          !/listen|run|serve|ListenAndServe/.test(name)
        )
          continue;
        const cond = host.kind === "module" ? null : condFor(lines, i, host.line);
        host.calls.push({ to, line: i, cond, text: (obj ? obj + "." : "") + name + "()" });
      }
      if (p.lang === "js" && /<[A-Z]/.test(code))
        for (const m of code.matchAll(/<([A-Z][\w$]*)(?=[\s/>])/g)) {
          const nm = m[1];
          let t = symIn(path, nm);
          if (!t) {
            const b = p.bind.get(nm);
            if (b && b.file && P[b.file]) {
              const bf = b.file;
              const pb = P[bf];
              t =
                (b.name && b.name !== "default" ? symIn(bf, b.name) : null) ||
                pb.syms.find((x) => x.exportDefault) ||
                symIn(bf, nm) ||
                pb.syms.find((x) => /^\s*export\s+default\b/.test(pb.lines[x.line] || "")) ||
                null;
            }
          }
          if (t && t !== host) {
            const tid = idOf(t);
            if (tid && !host.calls.some((c) => c.to === tid && c.render))
              host.calls.push({
                to: tid,
                line: i,
                cond: host.kind === "module" ? null : condFor(lines, i, host.line),
                text: "<" + nm + ">",
                render: true,
              });
          }
        }
      if (
        /process\.env\.|os\.environ|os\.getenv|os\.Getenv/.test(code) &&
        !host.calls.some(
          (c) => c.line === i && typeof c.to === "object" && "cat" in c.to && c.to.cat === "Configuration",
        )
      )
        host.calls.push({
          to: { ext: true, cat: "Configuration", pkg: "env", label: "environment variables" },
          line: i,
          cond: null,
          text: (code.match(
            /process\.env\.\w+|os\.environ(?:\.get)?\(?\[?['"]?\w*|os\.getenv\(\s*['"]?\w*|os\.Getenv\("\w*/,
          ) || ["env"])[0].replace(/[([]+['"]?$/, ""),
        });
    });
  });
  // module start-up: loading project files, mounting and registering routes
  eachFile(P, (path, p) => {
    const top = p.top;
    if (!top) return;
    const lines = p.lines;
    p.bind.forEach((b) => {
      if (!b.file || !P[b.file]) return;
      const bf = b.file;
      const re = new RegExp(
        "(require\\(\\s*|from\\s+|import\\s+)['\"]" + (b.spec ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "['\"]",
      );
      const li = lines.findIndex((l) => re.test(l));
      if (li < 0) return;
      if (!top.calls.some((c) => c.to === topIdOf(P[bf])))
        top.calls.push({ to: topIdOf(P[bf]), line: li, cond: null, text: "load " + bf, load: true });
    });
    if (p.lang === "py")
      p.bind.forEach((b) => {
        const bf = b.file;
        if (!bf || !P[bf]) return;
        if (!top.calls.some((c) => c.to === topIdOf(P[bf]))) {
          const li = lines.findIndex(
            (l) => /^\s*(from|import)\s/.test(l) && l.includes(bf.replace(/\.py$/, "").split("/").pop() || ""),
          );
          top.calls.push({ to: topIdOf(P[bf]), line: Math.max(0, li), cond: null, text: "load " + bf, load: true });
        }
      });
    if (p.lang === "js") {
      const defOf = (tf: string): Sym | null => {
        const q = P[tf];
        if (!q) return null;
        const d = q.syms.find((x) => x.exportDefault);
        if (d) return d;
        const mm = q.lines.join("\n").match(/module\.exports\s*=\s*([A-Za-z_$][\w$]*)\s*;?\s*$/m);
        return mm ? symIn(tf, mm[1]) : null;
      };
      const api: Api[] = [];
      p.api = api;
      lines.forEach((l, li) => {
        if (enclosing(p, li)) return;
        for (const m of l.matchAll(/require\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
          const tf = resolveJs(path, m[1]);
          if (!tf || !P[tf]) continue;
          if (!top.calls.some((c) => c.to === topIdOf(P[tf])))
            top.calls.push({ to: topIdOf(P[tf]), line: li, cond: null, text: "load " + tf, load: true });
          const a = l.match(/^\s*([A-Za-z_$][\w$.]*)\s*=\s*require\(/);
          if (a && a[1].includes(".")) {
            if (/\.prototype$/.test(a[1]))
              P[tf].syms
                .filter((x) => x.kind === "function" || x.kind === "method")
                .forEach((x) =>
                  api.push({
                    name: a[1].replace(/\.prototype$/, "") + "." + (x.short || x.name),
                    sym: x.id ?? null,
                    symRef: x,
                  }),
                );
            else {
              const d = defOf(tf);
              api.push({ name: a[1].replace(/\.prototype/, ""), symRef: d || P[tf].top });
            }
          }
        }
      });
      p.syms.filter((x) => x.proto).forEach((x) => api.push({ name: x.name, symRef: x }));
      (p.reexports || []).forEach((r) => {
        const rf = r.file;
        if (!rf || !P[rf]) return;
        if (r.all)
          P[rf].syms
            .filter((x) => x.kind !== "class" && /^\s*export\b/.test(P[rf].lines[x.line] || ""))
            .slice(0, 15)
            .forEach((x) => api.push({ name: x.name, symRef: x }));
        else if (r.orig) {
          const t = r.orig === "default" ? P[rf].syms.find((x) => x.exportDefault) : symIn(rf, r.orig);
          if (t && r.name) api.push({ name: r.name, symRef: t });
        }
      });
      const ex = lines.join("\n").match(/module\.exports\s*=\s*\{([^}]*)\}/);
      if (ex)
        ex[1]
          .split(",")
          .map((x) => x.split(":")[0].trim())
          .filter(Boolean)
          .forEach((nm) => {
            const t = symIn(path, nm);
            if (t) api.push({ name: nm, symRef: t });
          });
      p.syms
        .filter((x) => /^\s*export\s+(async\s+)?(function|const|class)/.test(lines[x.line]) && x.kind !== "class")
        .forEach((x) => api.push({ name: x.name, symRef: x }));
    }
    if (top) {
      p.mounts.forEach((mo) => {
        const b = p.bind.get(mo.ref);
        top.calls.push({
          to: { reg: true, label: `mounts ${mo.prefix}${b && b.file ? " → " + b.file.split("/").pop() : ""}` },
          line: mo.line,
          cond: null,
          text: "mount",
        });
      });
    }
  });
  // routes with mount prefixes
  const routes: Route[] = [];
  eachFile(P, (path, p) => {
    p.routes.forEach((r) => {
      let prefix = "";
      Object.entries(P).forEach(([, mpp]) =>
        mpp.mounts.forEach((mo) => {
          const b = mpp.bind.get(mo.ref);
          if (b && b.file === path) prefix = mo.prefix.replace(/\/$/, "");
        }),
      );
      const full = prefix + (r.path === "/" && prefix ? "" : r.path) || "/";
      let sym: Sym | null =
        p.syms.find((s) => s.kind === "route" && s.route === r) ||
        (r.symLine != null ? p.syms.find((s) => s.line === r.symLine) : null) ||
        null;
      if (!sym && r.classRef) {
        const cf = Object.keys(P).find((x) => x.endsWith("/" + r.classRef + ".php"));
        if (cf) sym = symIn(cf, r.fnRef ?? "");
      }
      if (!sym && r.handlerRef) {
        let o: string | null = null;
        let n: string;
        if (r.handlerRef.includes(".")) {
          const parts = r.handlerRef.split(".");
          o = parts[0];
          n = parts[1];
        } else n = r.handlerRef;
        if (o) {
          const b = p.bind.get(o);
          if (b && b.file) sym = symIn(b.file, n);
          else if (b && b.dir)
            sym =
              byDir
                .get(b.dir)
                ?.map((fp) => symIn(fp, n))
                .find(Boolean) ?? null;
        } else {
          const bn = p.bind.get(n);
          sym =
            symIn(path, n) ||
            (bn?.file ? symIn(bn.file, bn.name || n) : null) ||
            (p.dirFiles || []).map((fp) => symIn(fp, n)).find(Boolean) ||
            null;
        }
      }
      if (sym) {
        const sid = idOf(sym);
        if (sid)
          routes.push({
            name: `${r.method} ${full}`,
            method: r.method,
            path: full,
            file: path,
            line: r.line,
            sym: sid,
          });
      }
      if (p.top && !p.syms.some((s) => s.kind === "route" && s.route === r && s.line !== r.line))
        p.top.calls.push({
          to: { reg: true, label: `registers ${r.method} ${full}` },
          line: r.line,
          cond: null,
          text: "route",
        });
    });
  });
  // file-level call counts
  const fileCalls = new Map<string, number>();
  SY.forEach((s) =>
    s.calls.forEach((c) => {
      if (typeof c.to === "string") {
        const tf = SY.get(c.to)?.file;
        if (tf && tf !== s.file) {
          const k = (s.file ?? "") + ">" + tf;
          fileCalls.set(k, (fileCalls.get(k) || 0) + 1);
        }
      }
    }),
  );
  const calledBy = new Map<string, { from: string; line: number }[]>();
  SY.forEach((s) =>
    s.calls.forEach((c) => {
      if (typeof c.to === "string") pushTo(calledBy, c.to, { from: s.id ?? "", line: c.line });
    }),
  );
  return { P, SY, routes, fileCalls, calledBy };
}
