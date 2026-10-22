/*
  Pure path / file-classification helpers ported from the legacy analyser.
  All functions here are side-effect free: no DOM, no globals.
*/
import type { Edge, Lang, ProjectFile } from "@/project/types";

/** Directories that are never worth reading. */
export const IGNORE_DIR_RE =
  /(^|\/)(node_modules|\.git|\.hg|\.svn|dist|build|out|\.next|\.nuxt|\.svelte-kit|target|vendor|venv|\.venv|env|__pycache__|\.pytest_cache|\.mypy_cache|\.ruff_cache|\.tox|coverage|\.nyc_output|\.idea|\.gradle|\.terraform|obj|Pods|DerivedData|\.cache|\.turbo|\.parcel-cache|\.yarn|bower_components|site-packages|\.DS_Store|__MACOSX)(\/|$)/;
/** Extensions treated as text. */
export const TEXT_EXT_RE =
  /\.(md|mdx|markdown|txt|rst|adoc|json|jsonc|yaml|yml|toml|ini|cfg|conf|properties|env\.example|example|sample|js|jsx|ts|tsx|mjs|cjs|vue|svelte|astro|py|pyi|rb|go|rs|java|kt|kts|scala|groovy|swift|m|mm|c|h|cc|cpp|cxx|hpp|cs|fs|vb|php|pl|pm|sh|bash|zsh|fish|ps1|psm1|bat|cmd|sql|graphql|gql|proto|html|htm|css|scss|sass|less|xml|xsd|gradle|cmake|tf|tfvars|hcl|lua|r|dart|ex|exs|erl|hrl|hs|clj|cljs|elm|nim|zig|sol|tex|csv|tsv|http|rest|prisma|j2|jinja|tmpl|tpl|hbs|ejs|pug|liquid|mk|nix|bzl|bazel|dockerignore|gitignore|editorconfig|prettierrc|eslintrc|babelrc|npmrc|nvmrc|tool-versions)$/i;
/** Bare filenames treated as text regardless of extension. */
export const TEXT_NAME_RE =
  /(^|\/)(Dockerfile[\w.-]*|Makefile|GNUmakefile|Procfile|LICENSE[\w.-]*|LICENCE[\w.-]*|COPYING|README|CHANGELOG|CONTRIBUTING|CODEOWNERS|NOTICE|AUTHORS|Jenkinsfile|Gemfile|Rakefile|Vagrantfile|Brewfile|Pipfile|Justfile|Taskfile|\.env\.example|\.env\.sample|\.gitignore|\.dockerignore|\.gitattributes|\.editorconfig)$/i;
/** Lock files are always treated as binary/skipped. */
export const LOCK_RE =
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|Cargo\.lock|go\.sum|composer\.lock|Gemfile\.lock|Pipfile\.lock|uv\.lock|bun\.lockb|npm-shrinkwrap\.json)$/i;
/** Reader budget limits shared with the file-ingest code. */
export const LIMITS = { maxText: 1500, maxFileBytes: 250000, maxTotalBytes: 14e6, maxEntries: 8000 };

/** Language detector patterns, name and colour. */
export const LANGS: [RegExp, string, string][] = [
  [/\.(ts|tsx)$/i, "TypeScript", "#3178C6"],
  [/\.(js|jsx|mjs|cjs)$/i, "JavaScript", "#D4A72C"],
  [/\.py[i]?$/i, "Python", "#3572A5"],
  [/\.go$/i, "Go", "#00ADD8"],
  [/\.rs$/i, "Rust", "#B7410E"],
  [/\.(java)$/i, "Java", "#B07219"],
  [/\.(kt|kts)$/i, "Kotlin", "#A97BFF"],
  [/\.rb$/i, "Ruby", "#CC342D"],
  [/\.php$/i, "PHP", "#4F5D95"],
  [/\.(cs)$/i, "C#", "#178600"],
  [/\.(c|h)$/i, "C", "#6E6E6E"],
  [/\.(cc|cpp|cxx|hpp)$/i, "C++", "#F34B7D"],
  [/\.swift$/i, "Swift", "#F05138"],
  [/\.scala$/i, "Scala", "#C22D40"],
  [/\.(vue)$/i, "Vue", "#41B883"],
  [/\.(svelte)$/i, "Svelte", "#FF3E00"],
  [/\.(html|htm)$/i, "HTML", "#E34C26"],
  [/\.(css|scss|sass|less)$/i, "CSS", "#663399"],
  [/\.(sh|bash|zsh|fish|ps1|bat|cmd)$/i, "Shell", "#89A05A"],
  [/\.sql$/i, "SQL", "#E38C00"],
  [/\.(md|mdx|markdown|rst|adoc|txt)$/i, "Docs", "#7A8794"],
  [/\.(json|jsonc|ya?ml|toml|ini|cfg|conf|properties|env\.example|xml)$/i, "Config", "#9AA7B4"],
  [/(^|\/)Dockerfile|\.(tf|hcl)$/i, "Infra", "#2496ED"],
  [/\.(dart)$/i, "Dart", "#00B4AB"],
  [/\.(ex|exs)$/i, "Elixir", "#6E4A7E"],
  [/\.(lua)$/i, "Lua", "#000080"],
  [/\.(r)$/i, "R", "#198CE7"],
];

export function langOf(p: string): Lang {
  for (const [re, name, color] of LANGS) if (re.test(p)) return { name, color };
  return { name: "Other", color: "#B9C2CC" };
}

export const isCode = (p: string) =>
  /\.(js|jsx|ts|tsx|mjs|cjs|vue|svelte|astro|py|rb|go|rs|java|kt|kts|scala|swift|c|h|cc|cpp|cxx|hpp|cs|php|sh|bash|ps1|sql|dart|ex|exs|lua|r|hs|clj|zig|sol)$/i.test(
    p,
  );

export const isTestPath = (p: string) =>
  /(^|\/)(tests?|__tests__|spec|specs|e2e|cypress)\//i.test(p) ||
  /\.(test|spec)\.[a-z]+$/i.test(p) ||
  /_test\.(go|py|rb)$/i.test(p) ||
  /(^|\/)test_[^/]+\.py$/i.test(p);

export const isReadme = (p: string) => /(^|\/)readme(\.[a-z]+)?$/i.test(p);

export const isManifest = (p: string) =>
  /(^|\/)(package\.json|pyproject\.toml|requirements[\w.-]*\.txt|setup\.py|setup\.cfg|Pipfile|go\.mod|Cargo\.toml|pom\.xml|build\.gradle(\.kts)?|settings\.gradle(\.kts)?|composer\.json|Gemfile|[\w.-]+\.csproj|[\w.-]+\.sln|mix\.exs|pubspec\.yaml|deno\.jsonc?|bun\.toml)$/i.test(
    p,
  );

export const isCI = (p: string) =>
  /(^|\/)(\.github\/workflows\/[^/]+\.ya?ml|\.gitlab-ci\.yml|Jenkinsfile|azure-pipelines\.yml|\.circleci\/config\.yml|bitbucket-pipelines\.yml|\.travis\.yml|buildkite\.ya?ml)$/i.test(
    p,
  );

export const isDocker = (p: string) =>
  /(^|\/)(Dockerfile[\w.-]*|docker-compose[\w.-]*\.ya?ml|compose\.ya?ml|\.dockerignore)$/i.test(p) ||
  /(^|\/)(k8s|kubernetes|helm|charts|deploy|infra|terraform)\//i.test(p);

export const isDoc = (p: string) => /\.(md|mdx|rst|adoc)$/i.test(p) && !isReadme(p);

export const ENTRY_RE =
  /(^|\/)(main|index|app|server|cli|manage|wsgi|asgi|__main__|program|Program|Main|application|bootstrap)\.(js|jsx|ts|tsx|mjs|cjs|py|go|rs|java|kt|rb|php|cs)$/;

export const CONTAINER_RE =
  /^(src|lib|app|apps|packages|services|internal|pkg|cmd|modules|libs|components|projects|server|client|backend|frontend|source|api)$/i;

export function compKey(path: string): string {
  const p = path.split("/");
  if (p.length === 1) return "(root)";
  if (CONTAINER_RE.test(p[0]) && p.length > 2) return p[0] + "/" + p[1];
  return p[0];
}

export const dirOf = (p: string): string => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

export function joinPath(dir: string, rel: string): string {
  const parts = dir ? dir.split("/") : [];
  rel.split("/").forEach((x) => {
    if (x === "..") parts.pop();
    else if (x && x !== ".") parts.push(x);
  });
  return parts.join("/");
}

export function resolveImports(files: ProjectFile[]): Edge[] {
  const paths = new Set(files.map((f) => f.path));
  const suffix = new Map<string, string>();
  files.forEach((f) => {
    const segs = f.path.split("/");
    for (let i = 0; i < segs.length; i++) {
      const k = segs.slice(i).join("/");
      if (!suffix.has(k)) suffix.set(k, f.path);
    }
  });
  const goMod = files.find((f) => /(^|\/)go\.mod$/.test(f.path));
  const goModule = goMod && (goMod.text.match(/^module\s+(\S+)/m) || [])[1];
  // First non-test .go file per directory, so resolving an import is a map lookup, not a scan.
  const goByDir = new Map<string, ProjectFile>();
  if (goModule)
    files.forEach((f) => {
      if (!/\.go$/.test(f.path) || /_test\.go$/.test(f.path)) return;
      const d = dirOf(f.path);
      if (!goByDir.has(d)) goByDir.set(d, f);
    });
  const JSX = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte", ".json", ".d.ts"];
  const tryJs = (base: string): string | null => {
    if (paths.has(base)) return base;
    for (const e of JSX) if (paths.has(base + e)) return base + e;
    for (const e of JSX) if (paths.has(base + "/index" + e)) return base + "/index" + e;
    return null;
  };
  const edges = new Map<string, Edge>();
  const add = (a: string, b: string | null | undefined, kind: string): void => {
    if (!b || a === b) return;
    const k = a + ">" + b;
    if (!edges.has(k)) edges.set(k, { from: a, to: b, kind });
  };
  files.forEach((f) => {
    const p = f.path;
    const dir = dirOf(p);
    const t = f.text;
    if (!isCode(p) && !/\.(html|css|scss)$/i.test(p)) return;
    if (/\.(js|jsx|ts|tsx|mjs|cjs|vue|svelte|astro)$/i.test(p)) {
      for (const m of t.matchAll(
        /(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)|^\s*import\s+['"]([^'"]+)['"]/gm,
      )) {
        const s = m[1] || m[2] || m[3] || m[4];
        if (!s) continue;
        if (s.startsWith(".")) add(p, tryJs(joinPath(dir, s)), "import");
        else if (/^[@~]\//.test(s)) add(p, tryJs("src/" + s.slice(2)) || tryJs(s.slice(2)), "import");
      }
    } else if (/\.pyi?$/i.test(p)) {
      for (const m of t.matchAll(
        /^\s*from\s+([.\w]+)\s+import\s+([\w*, ()]+)|^\s*import\s+([\w.]+(?:\s*,\s*[\w.]+)*)/gm,
      )) {
        const mods = m[1] ? [m[1]] : (m[3] || "").split(/\s*,\s*/);
        mods.forEach((mod) => {
          let base;
          if (mod.startsWith(".")) {
            const dotsM = mod.match(/^\.+/);
            const dots = dotsM ? dotsM[0].length : 0;
            let d = dir;
            for (let i = 1; i < dots; i++) d = dirOf(d);
            base = joinPath(d, mod.slice(dots).replace(/\./g, "/"));
          } else base = mod.replace(/\./g, "/");
          const cands = [base + ".py", base + "/__init__.py"];
          if (m[1] && m[2])
            m[2]
              .replace(/[()]/g, "")
              .split(",")
              .map((x) => x.trim().split(/\s+as\s+/)[0])
              .filter(Boolean)
              .forEach((n) => cands.unshift(base + "/" + n + ".py"));
          for (const c of cands) {
            const hit = paths.has(c) ? c : suffix.get(c);
            if (hit) {
              add(p, hit, "import");
              break;
            }
          }
        });
      }
    } else if (/\.go$/i.test(p) && goModule) {
      for (const m of t.matchAll(/import\s*(?:\(([\s\S]*?)\)|"([^"]+)")/g)) {
        const specs = m[1] ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : [m[2]];
        specs.forEach((s) => {
          if (!s.startsWith(goModule + "/")) return;
          const d = joinPath(dirOf(goMod.path), s.slice(goModule.length + 1));
          const hit = goByDir.get(d);
          if (hit) add(p, hit.path, "import");
        });
      }
    } else if (/\.(java|kt|scala)$/i.test(p)) {
      for (const m of t.matchAll(/^\s*import\s+(?:static\s+)?([\w.]+)\s*;?/gm)) {
        const b = m[1].replace(/\./g, "/");
        const hit = suffix.get(b + ".java") || suffix.get(b + ".kt") || suffix.get(b + ".scala");
        if (hit) add(p, hit, "import");
      }
    } else if (/\.rs$/i.test(p)) {
      for (const m of t.matchAll(/^\s*(?:pub\s+)?mod\s+(\w+)\s*;/gm)) {
        add(
          p,
          [joinPath(dir, m[1] + ".rs"), joinPath(dir, m[1] + "/mod.rs")].find((c) => paths.has(c)),
          "module",
        );
      }
    } else if (/\.(c|cc|cpp|h|hpp)$/i.test(p)) {
      for (const m of t.matchAll(/^\s*#include\s+"([^"]+)"/gm)) {
        const c = joinPath(dir, m[1]);
        add(p, paths.has(c) ? c : suffix.get(m[1]), "include");
      }
    } else if (/\.rb$/i.test(p)) {
      for (const m of t.matchAll(/require_relative\s+['"]([^'"]+)['"]/g)) {
        const c = joinPath(dir, m[1]);
        add(p, paths.has(c) ? c : paths.has(c + ".rb") ? c + ".rb" : null, "require");
      }
    } else if (/\.php$/i.test(p)) {
      for (const m of t.matchAll(/(?:require|include)(?:_once)?\s*\(?\s*(?:__DIR__\s*\.\s*)?['"]([^'"]+)['"]/g)) {
        const c = joinPath(dir, m[1].replace(/^\//, ""));
        if (paths.has(c)) add(p, c, "include");
      }
    } else if (/\.(html|css|scss)$/i.test(p)) {
      for (const m of t.matchAll(/(?:src|href)=["']([^"':#?]+)["']|@import\s+['"]([^'"]+)['"]/g)) {
        const s = m[1] || m[2];
        if (!s || /^(https?:)?\/\//.test(s)) continue;
        const c = joinPath(dir, s);
        if (paths.has(c)) add(p, c, "link");
      }
    }
  });
  return [...edges.values()];
}
