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

export function parseGitHubUrl(raw: string): GitHubTarget | null {
  const clean = raw
    .trim()
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/\.git$/i, "");
  const parts = clean.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const owner = parts[0];
  const repo = parts[1];
  let branch = "main";
  let subpath = "";
  if (parts.length >= 4 && (parts[2] === "tree" || parts[2] === "blob")) {
    branch = parts[3];
    subpath = parts.slice(4).join("/");
  }
  return { owner, repo, branch, subpath, fullName: `${owner}/${repo}` };
}

export async function fetchGitHubTree(
  owner: string,
  repo: string,
  branch = "main",
): Promise<{ tree: TreeItem[]; branch: string }> {
  const branchesToTry = [branch, branch === "main" ? "master" : "main"];
  let data: { tree?: TreeItem[] } | null = null;
  let usedBranch = branch;
  for (const b of branchesToTry) {
    const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${b}?recursive=1`;
    const res = await fetch(url, { headers: { Accept: "application/vnd.github.v3+json" } });
    if (res.ok) {
      data = (await res.json()) as { tree?: TreeItem[] };
      usedBranch = b;
      break;
    }
  }
  if (!data || !data.tree)
    throw new Error(`Could not access repository tree for ${owner}/${repo}. Ensure it is public.`);
  return { tree: data.tree, branch: usedBranch };
}

async function downloadRaw(target: GitHubTarget, branch: string, path: string): Promise<string | null> {
  const url = `https://raw.githubusercontent.com/${target.owner}/${target.repo}/${branch}/${path}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.text();
}

export interface ProgressFn {
  (p: { text: string; percent: number }): void;
}

/** Fetch the first matching Markdown / SKILL.md from a public GitHub repo. */
export async function importSkillFromGitHub(rawUrl: string, onProgress: ProgressFn = () => {}): Promise<FileItem[]> {
  const target = parseGitHubUrl(rawUrl);
  if (!target) throw new Error("Invalid GitHub repository URL. Use owner/repo or https://github.com/owner/repo");
  onProgress({ text: `Fetching tree for ${target.fullName}…`, percent: 10 });
  const { tree, branch } = await fetchGitHubTree(target.owner, target.repo, target.branch);
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
  const text = await downloadRaw(target, branch, file.path);
  if (text == null) throw new Error(`Failed to download ${file.path}`);
  onProgress({ text: "Done", percent: 100 });
  return [{ path: file.path, text }];
}

/** Fetch a slice of a public GitHub repo's source files for the project mapper. */
export async function importProjectFromGitHub(rawUrl: string, onProgress: ProgressFn = () => {}): Promise<FileItem[]> {
  const target = parseGitHubUrl(rawUrl);
  if (!target) throw new Error("Invalid GitHub repository URL. Use owner/repo or https://github.com/owner/repo");
  onProgress({ text: `Fetching tree for ${target.fullName}…`, percent: 6 });
  const { tree, branch } = await fetchGitHubTree(target.owner, target.repo, target.branch);
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

  const out: FileItem[] = [];
  for (let i = 0; i < codeFiles.length; i++) {
    const item = codeFiles[i];
    onProgress({
      text: `Downloading file ${i + 1} of ${codeFiles.length}: ${item.path}…`,
      percent: 10 + Math.round((i / codeFiles.length) * 85),
    });
    try {
      const text = await downloadRaw(target, branch, item.path);
      if (text != null) out.push({ path: item.path, text });
    } catch {
      /* skip unreadable */
    }
  }
  if (!out.length) throw new Error("No readable files could be downloaded from this repository.");
  onProgress({ text: `Ingesting ${out.length} files…`, percent: 98 });
  return out;
}
