import type { FileItem } from "@/model/types";

export interface GitHubTarget {
  owner: string;
  repo: string;
  branch: string;
  subpath: string;
  fullName: string;
}

export interface TreeItem {
  path: string;
  type: "blob" | "tree" | string;
  size?: number;
}

/** A source file fetched from GitHub, ready for the project mapper. */
export type GitHubFile = FileItem & { lines: number };

export function parseGitHubUrl(raw: string): GitHubTarget | null {
  const clean = raw
    .trim()
    .replace(/^https?:\/\/(?:www\.)?github\.com\//i, "")
    .replace(/[?#].*$/, "")
    .replace(/^\/+|\/+$/g, "");
  // Decode each segment separately: decoding before the split would turn a branch name
  // containing an escaped slash (`feature%2Fapi`) into an extra path segment.
  const parts = clean
    .split("/")
    .filter(Boolean)
    .map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    });
  if (parts.length < 2) return null;
  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/i, "");
  if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) return null;
  // Empty when the link does not name a branch: we then ask GitHub for the repo's default.
  let branch = "";
  let subpath = "";
  if (parts.length >= 4 && (parts[2] === "tree" || parts[2] === "blob")) {
    branch = parts[3];
    subpath = parts.slice(4).join("/");
  }
  return { owner, repo, branch, subpath, fullName: `${owner}/${repo}` };
}

/** The GitHub API headers used for every request. */
const GH_HEADERS = { Accept: "application/vnd.github.v3+json" };

export async function fetchGitHubTree(
  owner: string,
  repo: string,
  branch = "",
  signal?: AbortSignal,
): Promise<{ tree: TreeItem[]; branch: string }> {
  const readTree = async (b: string): Promise<TreeItem[] | null> => {
    if (!b) return null;
    try {
      const res = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(b)}?recursive=1`,
        { headers: GH_HEADERS, signal },
      );
      if (!res.ok) return null;
      const data = (await res.json()) as { tree?: TreeItem[] };
      return data.tree || null;
    } catch {
      return null;
    }
  };

  // No branch in the link: ask GitHub which one is the default so we never fail on a guessed name.
  let wanted = branch;
  if (!wanted) {
    try {
      const r = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers: GH_HEADERS, signal });
      if (r.ok) wanted = ((await r.json()) as { default_branch?: string }).default_branch || "";
    } catch {
      /* fall through to the guesses below */
    }
  }

  const tried = new Set<string>();
  for (const b of [wanted, branch, "main", "master", "develop"].filter(Boolean)) {
    if (signal?.aborted) throw new DOMException("The download was cancelled.", "AbortError");
    if (tried.has(b)) continue;
    tried.add(b);
    const tree = await readTree(b);
    if (tree) return { tree, branch: b };
  }
  if (signal?.aborted) throw new DOMException("The download was cancelled.", "AbortError");
  throw new Error(`Could not access repository tree for ${owner}/${repo}. Ensure it is public.`);
}

async function downloadRaw(
  target: GitHubTarget,
  branch: string,
  path: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const url = `https://raw.githubusercontent.com/${target.owner}/${target.repo}/${branch}/${path}`;
  const res = await fetch(url, { signal });
  if (!res.ok) return null;
  return res.text();
}

export interface ProgressFn {
  (p: { text: string; percent: number }): void;
}

/** Fetch the first matching Markdown / SKILL.md from a public GitHub repo. */
export async function importSkillFromGitHub(
  rawUrl: string,
  onProgress: ProgressFn = () => {},
  signal?: AbortSignal,
): Promise<FileItem[]> {
  const target = parseGitHubUrl(rawUrl);
  if (!target) throw new Error("Invalid GitHub repository URL. Use owner/repo or https://github.com/owner/repo");
  onProgress({ text: `Fetching tree for ${target.fullName}…`, percent: 10 });
  const { tree, branch } = await fetchGitHubTree(target.owner, target.repo, target.branch, signal);
  let candidates = tree.filter((i) => i.type === "blob");
  if (target.subpath)
    candidates = candidates.filter((i) => i.path === target.subpath || i.path.startsWith(target.subpath + "/"));
  const skill = candidates.filter((i) => /\.(md|markdown|skill)$/i.test(i.path));
  if (!skill.length) throw new Error(`No Markdown or .skill files found in ${target.fullName}`);
  const file =
    skill.find((i) => /(^|\/)SKILL\.md$/i.test(i.path)) ||
    skill.find((i) => /(^|\/)README\.md$/i.test(i.path)) ||
    skill[0];
  onProgress({ text: `Downloading ${file.path}…`, percent: 60 });
  const text = await downloadRaw(target, branch, file.path, signal);
  if (text == null) throw new Error(`Failed to download ${file.path}`);
  onProgress({ text: "Done", percent: 100 });
  return [{ path: file.path, text }];
}

/** Fetch a slice of a public GitHub repo's source files for the project mapper. */
export async function importProjectFromGitHub(
  rawUrl: string,
  onProgress: ProgressFn = () => {},
  signal?: AbortSignal,
): Promise<GitHubFile[]> {
  const target = parseGitHubUrl(rawUrl);
  if (!target) throw new Error("Invalid GitHub repository URL. Use owner/repo or https://github.com/owner/repo");
  onProgress({ text: `Fetching tree for ${target.fullName}…`, percent: 6 });
  const { tree, branch } = await fetchGitHubTree(target.owner, target.repo, target.branch, signal);
  let candidates = tree.filter((i) => i.type === "blob");
  if (target.subpath)
    candidates = candidates.filter((i) => i.path === target.subpath || i.path.startsWith(target.subpath + "/"));

  const code = /\.(js|jsx|ts|tsx|mjs|cjs|py|go|java|rs|rb|php|json|ya?ml|toml|sql|html|css|md|txt|sh)$/i;
  let codeFiles = candidates.filter((i) => code.test(i.path));
  const rankPath = (p: string) => {
    if (/(^|\/)(package\.json|go\.mod|Cargo\.toml|pyproject\.toml|requirements\.txt|pom\.xml)$/i.test(p)) return 0;
    if (/(^|\/)README\.md$/i.test(p)) return 1;
    if (/(^|\/)(src|lib|app|pages|components|routes|server|api|cmd|internal|controllers|services|models)\//i.test(p))
      return 2;
    if (/\.(ts|tsx|js|jsx|py|go|rs|java|rb|php|cs)$/i.test(p)) return 3;
    if (p.startsWith(".")) return 6;
    return 4;
  };
  codeFiles.sort((a, b) => rankPath(a.path) - rankPath(b.path));
  if (!codeFiles.length) codeFiles = candidates.slice(0, 50);
  else if (codeFiles.length > 80) codeFiles = codeFiles.slice(0, 80);

  // Download a few files at a time: much faster than one-by-one, still gentle on GitHub.
  const out: GitHubFile[] = new Array(codeFiles.length);
  let done = 0;
  let next = 0;
  const worker = async () => {
    for (;;) {
      if (signal?.aborted) return;
      const i = next++;
      if (i >= codeFiles.length) return;
      const item = codeFiles[i];
      try {
        const text = await downloadRaw(target, branch, item.path, signal);
        if (text != null) out[i] = { path: item.path, text, lines: text.split("\n").length };
      } catch {
        /* skip unreadable */
      }
      done++;
      onProgress({
        text: `Downloading files… ${done} of ${codeFiles.length}`,
        percent: 10 + Math.round((done / codeFiles.length) * 85),
      });
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, codeFiles.length) }, worker));
  if (signal?.aborted) throw new DOMException("The download was cancelled.", "AbortError");

  const files = out.filter((f): f is GitHubFile => !!f);
  if (!files.length) throw new Error("No readable files could be downloaded from this repository.");
  onProgress({ text: `Ingesting ${files.length} files…`, percent: 98 });
  return files;
}
