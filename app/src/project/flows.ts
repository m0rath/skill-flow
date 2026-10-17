/*
  Flows: entry-point discovery and function-call tracing.
  Ported from the vanilla-JS legacy analyser (see app/_ref/legacy-app.js) so the
  React views can build the same stories without touching the legacy globals.
*/

import { compDeps } from "@/project/analyze";
import { isTestPath, joinPath } from "@/project/paths";
import type {
  Api,
  CallTarget,
  CodeIndex,
  ExtRef,
  FileCall,
  Flow,
  FlowStep,
  PComponent,
  Project,
  ProjectFile,
  RegRef,
  Sym,
} from "@/project/types";

/* ---------- small helpers ---------- */

export function joinRoute(...parts: unknown[]): string {
  const s = parts
    .filter(Boolean)
    .map((x) => String(x).replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
  return "/" + s;
}

export function symAt(C: CodeIndex, path: string, name: string): Sym | null {
  const p = C.P[path];
  if (!p) return null;
  return (
    p.syms.find((s) => (s.fn || s.name) === name && s.kind !== "class") || p.syms.find((s) => s.short === name) || null
  );
}

export function defaultSym(C: CodeIndex, path: string): Sym | null {
  const p = C.P[path];
  if (!p) return null;
  return (
    p.syms.find((s) => s.exportDefault) ||
    p.syms.find((s) => /^\s*export\s+default\b/.test(p.lines[s.line] || "")) ||
    null
  );
}

export function reachCount(C: CodeIndex, id: string, cap = 60): number {
  const seen = new Set([id]);
  const st = [id];
  while (st.length && seen.size < cap) {
    const cur = st.pop();
    if (cur === undefined) continue;
    const s = C.SY.get(cur);
    if (!s) continue;
    s.calls.forEach((c) => {
      if (typeof c.to === "string" && !seen.has(c.to)) {
        seen.add(c.to);
        st.push(c.to);
      }
    });
  }
  return seen.size - 1;
}

/* ---------- entry-point discovery ---------- */

interface PkgJson {
  main?: string;
  module?: string;
  bin?: string | Record<string, string>;
  exports?: string | { "."?: string | { import?: string; require?: string; default?: string } };
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
}

export function findFlows(
  files: ProjectFile[],
  project: Project,
  code: CodeIndex,
  customFlows: { file: string; fn?: string }[],
  aiEntries: { file: string; function?: string; name?: string; trigger?: string }[],
): Flow[] {
  const C = code;
  const P = project;
  const flows: Flow[] = [];
  const used = new Set<string>();
  const add = (f: Flow) => {
    if (!f.root || used.has(f.root + "|" + f.name)) return;
    if (!C.SY.get(f.root)) return;
    used.add(f.root + "|" + f.name);
    flows.push(f);
  };

  // 1. commands from package.json / Makefile / README that run a file
  const scriptOf = new Map<string, string>();
  (P.commands || []).forEach((c) => {
    const m = String(c.purpose || "").match(
      /(?:node|ts-node|tsx|nodemon|bun|deno run|python3?|py|go run|ruby|php)\s+(?:-[\w-]+\s+)*([\w./-]+\.\w+)/,
    );
    if (m) {
      const p = joinPath("", m[1]);
      if (C.P[p] && (!scriptOf.has(p) || c.cmd === "npm start")) scriptOf.set(p, c.cmd);
    }
  });

  // package.json fields
  const pkg = files.find((f) => f.path === "package.json");
  let pj: PkgJson | null = null;
  try {
    pj = pkg ? (JSON.parse(pkg.text) as PkgJson) : null;
  } catch {
    /* ignore malformed package.json */
  }
  const pkgEntries: string[] = [];
  if (pj) {
    const exp = pj.exports;
    const expMain =
      typeof exp === "string"
        ? exp
        : exp
          ? typeof exp["."] === "string"
            ? exp["."]
            : exp["."]
              ? exp["."].import || exp["."].require || exp["."].default
              : undefined
          : undefined;
    [pj.main, pj.module, ...(typeof pj.bin === "string" ? [pj.bin] : Object.values(pj.bin || {})), expMain]
      .filter(Boolean)
      .forEach((x) => {
        const p = joinPath("", String(x));
        const cands = [
          p,
          p.replace(/^dist\//, "src/").replace(/\.js$/, ".ts"),
          p.replace(/^(dist|build|lib)\//, "src/").replace(/\.(c|m)?js$/, ".ts"),
          p.replace(/^(dist|build)\//, "src/"),
        ];
        const hit = cands.find((c) => C.P[c]);
        if (hit) pkgEntries.push(hit);
      });
  }

  const startFiles = [...new Set([...P.entries, ...pkgEntries, ...scriptOf.keys()])].filter(
    (p) => C.P[p] && !isTestPath(p),
  );

  // front-end app entries (Vite / CRA): src/main.* or src/index.* that render
  Object.keys(C.P)
    .filter(
      (p) =>
        /(^|\/)src\/(main|index)\.(jsx?|tsx?)$/.test(p) &&
        /createRoot|ReactDOM\.render|createApp\(|new Vue\(|bootstrapApplication|platformBrowserDynamic/.test(
          C.P[p].lines.join("\n"),
        ),
    )
    .forEach((p) => {
      if (!startFiles.includes(p)) startFiles.push(p);
    });

  startFiles.forEach((p) =>
    add({
      id: "start:" + p,
      group: scriptOf.has(p) && !P.entries.includes(p) ? "Scripts and commands" : "Start-up",
      name: scriptOf.get(p) ? `${scriptOf.get(p)}  →  ${p}` : `Start ${p}`,
      actor: scriptOf.get(p) ? "You run a command" : "Process start",
      root: ((C.P[p].syms || []).find((x) => x.kind === "main") || C.SY.get(p + "#(top)"))?.id || "",
      file: p,
    }),
  );

  // 2. routes found in code
  C.routes.forEach((r) =>
    add({
      id: "route:" + r.name + "@" + r.file,
      group: "Requests (routes)",
      name: r.name,
      actor: "Client request",
      root: r.sym,
      file: r.file,
      route: r,
    }),
  );

  // 3. Next.js file-based routes and pages
  const isNext =
    (P.stack || []).some((x) => /^next(\.js)?$/i.test(x)) ||
    files.some((f) => /(^|\/)next\.config\.(js|mjs|cjs|ts)$/.test(f.path)) ||
    !!(pj && (/\bnext\s+(dev|build|start)\b/.test(JSON.stringify(pj.scripts || {})) || (pj.dependencies || {}).next)) ||
    Object.keys(C.P).some(
      (p) =>
        /(^|\/)app\/(.*\/)?route\.(js|ts)$/.test(p) &&
        /export\s+(async\s+)?function\s+(GET|POST)\b/.test(C.P[p].lines.join("\n")),
    );
  if (isNext)
    Object.keys(C.P).forEach((p) => {
      let m: RegExpMatchArray | null;
      if ((m = p.match(/(?:^|\/)pages\/api\/(.+)\.(?:js|ts|jsx|tsx)$/))) {
        const sy = defaultSym(C, p);
        add({
          id: "next:" + p,
          group: "Requests (routes)",
          name: "API /api/" + m[1].replace(/\/index$|^index$/, ""),
          actor: "Client request",
          root: (sy || C.SY.get(p + "#(top)"))?.id || "",
          file: p,
        });
      } else if ((m = p.match(/(?:^|\/)app\/(?:(.*)\/)?route\.(?:js|ts)$/))) {
        const mm = m;
        ["GET", "POST", "PUT", "PATCH", "DELETE"].forEach((meth) => {
          const sy = symAt(C, p, meth);
          if (sy)
            add({
              id: "next:" + meth + p,
              group: "Requests (routes)",
              name: `${meth} /${(mm[1] || "").replace(/\([^)]*\)\/?/g, "")}`,
              actor: "Client request",
              root: sy.id || "",
              file: p,
            });
        });
      } else if (
        (m = p.match(/(?:^|\/)pages\/(?!api\/|_app|_document)(.+)\.(?:jsx|tsx|js|ts)$/)) ||
        (m = p.match(/(?:^|\/)app\/(?:(.*)\/)?page\.(?:jsx|tsx|js|ts)$/))
      ) {
        const sy = defaultSym(C, p);
        add({
          id: "page:" + p,
          group: "Pages",
          name: "Page /" + (m[1] || "").replace(/\/index$|^index$/, "").replace(/\([^)]*\)\/?/g, ""),
          actor: "User opens a page",
          root: (sy || C.SY.get(p + "#(top)"))?.id || "",
          file: p,
        });
      }
    });

  // 4. library API (from require/re-export patterns in entry files)
  const docTxt = files
    .filter((f) => /\.(md|mdx|rst|txt)$/i.test(f.path))
    .map((f) => f.text)
    .join("\n")
    .slice(0, 400000);
  const apiRank = (a: Api) => {
    const bare = a.name.split(".").pop() || a.name;
    return (
      (new RegExp("\\b" + bare.replace(/[$]/g, "\\$") + "\\s*\\(").test(docTxt) ? 1000 : 0) +
      Math.min(reachCount(C, a.symRef?.id || ""), 60) -
      (/^_/.test(bare) ? 500 : 0)
    );
  };
  startFiles.forEach((p) => {
    const api = (C.P[p]?.api || [])
      .filter((a) => a.symRef && a.symRef.id)
      .map((a) => [a, apiRank(a)] as [Api, number])
      .sort((x, y) => y[1] - x[1])
      .map((x) => x[0]);
    const seenA = new Set<string>();
    api.forEach((a) => {
      if (seenA.has(a.name) || seenA.size >= 25) return;
      seenA.add(a.name);
      add({
        id: "api:" + a.name,
        group: "Library API (" + p + ")",
        name: a.name + "()",
        actor: "Code that uses the library",
        root: a.symRef?.id || "",
        file: a.symRef?.file,
      });
    });
  });

  // 5. main functions in any language, python __main__, pyproject scripts, jobs and commands
  C.SY.forEach((s) => {
    if (isTestPath(s.file || "")) return;
    if (s.kind === "main") {
      if (!flows.some((f) => f.file === s.file))
        add({
          id: "main:" + s.id,
          group: "Start-up",
          name: `python ${s.file}`,
          actor: "You run a command",
          root: s.id || "",
          file: s.file,
        });
    } else if (
      /^main$/i.test(s.name) &&
      (s.kind === "function" || s.kind === "method") &&
      !flows.some((f) => f.file === s.file || C.SY.get(f.root)?.file === s.file)
    )
      add({
        id: "mainfn:" + s.id,
        group: "Start-up",
        name: `main() in ${s.file}`,
        actor: "Process start",
        root: s.id || "",
        file: s.file,
      });
    else if (s.job)
      add({
        id: "job:" + s.id,
        group: "Commands and jobs",
        name: `${s.job === "command" ? "command" : "job"} ${s.name}()`,
        actor: s.job === "command" ? "You run a command" : "Scheduler / worker",
        root: s.id || "",
        file: s.file,
      });
  });

  const pyproj = files.find((f) => /(^|\/)pyproject\.toml$/.test(f.path));
  if (pyproj) {
    const sec = pyproj.text
      .split(/\n\[/)
      .find((x) => /^(\[)?(project\.scripts|tool\.poetry\.scripts)\]/.test(x.trim()));
    if (sec)
      for (const m of sec.matchAll(/^\s*([\w-]+)\s*=\s*["']([\w.]+):(\w+)["']/gm)) {
        const modPath = m[2].replace(/\./g, "/");
        const file = Object.keys(C.P).find((p) => p.endsWith(modPath + ".py") || p.endsWith(modPath + "/__init__.py"));
        const sy = file && symAt(C, file, m[3]);
        if (sy)
          add({
            id: "pyscript:" + m[1],
            group: "Scripts and commands",
            name: `${m[1]}  →  ${file}`,
            actor: "You run a command",
            root: sy.id || "",
            file,
          });
      }
  }

  // 6. user-picked and AI-suggested starting points
  (customFlows || []).forEach((cf) => {
    const sy = cf.fn ? symAt(C, cf.file, cf.fn) : C.SY.get(cf.file + "#(top)");
    if (sy)
      add({
        id: "pick:" + cf.file + "#" + (cf.fn || ""),
        group: "Your starting points",
        name: cf.fn ? `${cf.fn}()  in ${cf.file}` : `Run ${cf.file}`,
        actor: "You start here",
        root: sy.id || "",
        file: cf.file,
        custom: true,
      });
  });
  (aiEntries || []).forEach((ae) => {
    const file = C.P[ae.file] ? ae.file : Object.keys(C.P).find((p) => p.endsWith(ae.file));
    if (!file) return;
    const sy = ae.function ? symAt(C, file, ae.function) : C.SY.get(file + "#(top)");
    if (sy)
      add({
        id: "ai:" + file + "#" + (ae.function || ""),
        group: "Found by AI",
        name: ae.name || (ae.function ? `${ae.function}() in ${file}` : file),
        actor: ae.trigger || "Trigger",
        root: sy.id || "",
        file,
      });
  });

  // 7. functions nothing else calls (likely starting points)
  if (flows.length < 30) {
    const called = new Set<string>();
    C.SY.forEach((s) =>
      s.calls.forEach((c) => {
        if (typeof c.to === "string") called.add(c.to);
      }),
    );
    const roots = new Set(flows.map((f) => f.root));
    [...C.SY.values()]
      .filter(
        (s) =>
          (s.kind === "function" || s.kind === "method" || s.kind === "route") &&
          !called.has(s.id || "") &&
          !roots.has(s.id || "") &&
          !isTestPath(s.file || "") &&
          s.calls.some((c) => typeof c.to === "string"),
      )
      .map((s) => ({ s, r: reachCount(C, s.id || "") }))
      .filter((x) => x.r >= 1)
      .sort((a, b) => b.r - a.r)
      .slice(0, Math.max(6, 20 - flows.length))
      .forEach(({ s }) =>
        add({
          id: "root:" + s.id,
          group: "Other starting points (not called by other code)",
          name: `${s.name}()  in ${s.file}`,
          actor: "Caller",
          root: s.id || "",
          file: s.file,
        }),
      );
  }

  const rankG = (g: string) =>
    g === "Start-up"
      ? 0
      : g.startsWith("Requests")
        ? 1
        : g === "Pages"
          ? 2
          : g.startsWith("Library")
            ? 3
            : g.startsWith("Scripts")
              ? 4
              : g.startsWith("Commands")
                ? 5
                : g === "Your starting points"
                  ? 6
                  : g === "Found by AI"
                    ? 7
                    : 8;
  flows.sort((a, b) => rankG(a.group) - rankG(b.group));
  if (flows.filter((f) => !/^Other starting/.test(f.group)).length > 1)
    flows.unshift({
      id: "all",
      group: "Whole project",
      name: "Everything, start to end",
      actor: "Outside world",
      all: true,
      root: "__all",
    });
  return flows;
}

export function traceFlowAllFilter(flows: Flow[]): Flow[] {
  return flows.filter((f) => !f.all && !/^Other starting/.test(f.group));
}

/* ---------- tracing ---------- */

const isFileCall = (t: CallTarget): t is FileCall => typeof t === "object" && t !== null && "fileCall" in t;
const isRegRef = (t: CallTarget): t is RegRef => typeof t === "object" && t !== null && "reg" in t;
const isExtRef = (t: CallTarget): t is ExtRef => typeof t === "object" && t !== null && "ext" in t;

export function traceFlow(flows: Flow[], code: CodeIndex, flow: Flow, maxSteps = 160, maxDepth = 9): FlowStep[] {
  if (flow.all) {
    const all: FlowStep[] = [];
    traceFlowAllFilter(flows).forEach((f) => {
      if (all.length >= 320) return;
      all.push({
        phase: true,
        depth: 0,
        from: "actor",
        fromSym: "",
        fromName: "",
        line: 0,
        cond: null,
        text: "",
        to: "actor",
        toSym: null,
        toName: "",
        title: f.name,
        sub: f.group + " · " + f.actor,
      });
      all.push(...traceFlow(flows, code, f, 70, 6));
    });
    return all;
  }
  const C = code;
  const steps: FlowStep[] = [];
  const seen = new Set<string>();
  const walk = (symId: string, depth: number) => {
    const s = C.SY.get(symId);
    if (!s || steps.length >= maxSteps) return;
    if (seen.has(symId)) return;
    seen.add(symId);
    const calls = s.calls.slice().sort((a, b) => a.line - b.line);
    for (const c of calls) {
      if (steps.length >= maxSteps) break;
      const toSym = typeof c.to === "string" ? C.SY.get(c.to) : null;
      if (isFileCall(c.to)) {
        steps.push({
          depth,
          from: s.file || "",
          fromSym: s.id || "",
          fromName: s.kind === "module" ? "start-up" : s.name,
          line: c.line,
          cond: c.cond,
          text: c.text,
          to: c.to.file,
          toSym: null,
          toName: c.to.label.replace(/\(\)$/, ""),
          ext: false,
        });
        continue;
      }
      if (isRegRef(c.to)) {
        steps.push({
          depth,
          from: s.file || "",
          fromSym: s.id || "",
          fromName: s.kind === "module" ? "start-up" : s.name,
          line: c.line,
          cond: c.cond,
          text: c.to.label,
          to: s.file || "",
          toSym: null,
          toName: c.to.label,
          ext: false,
          reg: true,
        });
        continue;
      }
      const step: FlowStep = {
        depth,
        from: s.file || "",
        fromSym: s.id || "",
        fromName: s.kind === "module" ? "start-up" : s.name,
        line: c.line,
        cond: c.cond,
        text: c.text,
        to: toSym ? toSym.file || "" : "ext:" + (isExtRef(c.to) ? c.to.cat : ""),
        toSym: toSym ? toSym.id || null : null,
        toName: toSym
          ? toSym.kind === "module"
            ? "loads " + (toSym.file || "").split("/").pop()
            : c.render
              ? "renders <" + toSym.name + ">"
              : toSym.name
          : isExtRef(c.to)
            ? c.to.label
            : typeof c.to === "string"
              ? c.to
              : "",
        load: !!c.load,
        render: !!c.render,
        ext: !toSym,
        cat: toSym ? null : isExtRef(c.to) ? c.to.cat : null,
        recursive: toSym ? seen.has(toSym.id || "") : false,
      };
      if (
        step.ext &&
        steps.some(
          (x) =>
            x.ext &&
            x.fromSym === step.fromSym &&
            x.toName === step.toName &&
            (x.line === step.line || x.cond === step.cond),
        )
      )
        continue;
      steps.push(step);
      if (toSym && depth < maxDepth && !seen.has(toSym.id || "")) walk(toSym.id || "", depth + 1);
    }
  };
  const rs = C.SY.get(flow.root);
  steps.push({
    depth: 0,
    from: "actor",
    fromSym: "",
    fromName: "",
    to: rs?.file || "",
    toSym: flow.root,
    toName: flow.route
      ? `${flow.route.method} ${flow.route.path} handler`
      : rs?.kind === "module"
        ? "start-up"
        : rs?.name || "",
    text: flow.route
      ? `${flow.route.method} ${flow.route.path}`
      : flow.actor === "You run a command"
        ? flow.name.split("  →  ")[0]
        : /^(Client request|User opens a page)$/.test(flow.actor)
          ? flow.name
          : rs?.kind === "module"
            ? "load"
            : (rs?.name || "") + "()",
    line: rs?.line ?? 0,
    cond: null,
    ext: false,
    entry: true,
  });
  walk(flow.root, 1);
  return steps;
}

export function traceText(_code: CodeIndex, flow: Flow, steps: FlowStep[]): string {
  return (
    `${flow.name} (${flow.actor})\n` +
    steps
      .map((s, i) =>
        s.phase
          ? `\n== ${s.title} (${s.sub}) ==`
          : `${"  ".repeat(s.depth)}${i + 1}. ${s.entry ? "start →" : ""} ${s.from === "actor" ? flow.actor : s.from + (s.fromName ? " " + s.fromName + "()" : "")} → ${s.ext ? "[" + s.cat + "] " + s.toName : s.to + " " + s.toName + "()"}${s.cond ? `  [when: ${s.cond}]` : ""}${s.line != null && s.from !== "actor" ? `  (line ${s.line + 1})` : ""}`,
      )
      .join("\n")
  );
}

export function allTracesText(code: CodeIndex, flows: Flow[], limit = 9000): string {
  let out = "";
  for (const f of (flows || []).filter((x) => !x.all)) {
    const t = traceText(code, f, traceFlow(flows, code, f, 40, 5)) + "\n\n";
    if (out.length + t.length > limit) break;
    out += t;
  }
  return out;
}

/* ---------- data flow (model steps → component deps) ---------- */

interface DataFlowNode {
  num: string;
  creates: { name: string }[];
  uses: string[];
  source?: string;
  detail?: string;
  steps?: DataFlowNode[];
  branches?: { steps: DataFlowNode[] }[];
}

export interface DataFlowLink {
  from: { num: string };
  to: { num: string };
  name: string;
}

/** Flatten nested flow nodes in the same pre-order as the legacy node index. */
function flattenFlowNodes(nodes: DataFlowNode[]): DataFlowNode[] {
  const out: DataFlowNode[] = [];
  const walk = (list: DataFlowNode[]) => {
    list.forEach((n) => {
      out.push(n);
      n.branches?.forEach((b) => walk(b.steps));
      if (n.steps) walk(n.steps);
    });
  };
  walk(nodes);
  return out;
}

export function dataFlowsFlow(model: { steps: DataFlowNode[] }): DataFlowLink[] {
  const res: DataFlowLink[] = [];
  const seen = new Set<string>();
  const nodes = flattenFlowNodes(model.steps || []);
  nodes.forEach((p) =>
    p.creates.forEach((c) => {
      const nm = c.name.toLowerCase();
      const base = nm.split("/").pop() || "";
      nodes.forEach((q) => {
        if (q === p) return;
        const hay = (q.uses.join(" ") + " " + (q.source || "") + " " + (q.detail || "")).toLowerCase();
        if (q.uses.some((u) => u.toLowerCase() === nm) || (base.length > 5 && hay.includes(base))) {
          const k = p.num + ">" + q.num;
          if (!seen.has(k)) {
            seen.add(k);
            res.push({ from: { num: p.num }, to: { num: q.num }, name: c.name });
          }
        }
      });
    }),
  );
  return res;
}

export function dataFlowsProject(
  model: { steps: DataFlowNode[] },
  components: PComponent[],
  project: Project,
): DataFlowLink[] {
  const res = dataFlowsFlow(model);
  compDeps(components, project).forEach((d) =>
    res.push({ from: { num: "C-" + d.from }, to: { num: "C-" + d.to }, name: "uses" }),
  );
  return res;
}
