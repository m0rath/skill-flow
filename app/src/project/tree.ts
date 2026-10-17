import type { BinFile, ProjectFile, TreeNode } from "@/project/types";

/** Build the nested folder tree used by the Structure tab. */
export function buildTree(files: ProjectFile[], bins: BinFile[]): TreeNode {
  const root: TreeNode = { name: "", path: "", dirs: new Map(), files: [] };
  const all: { path: string; f?: ProjectFile; b?: BinFile }[] = [
    ...files.map((f) => ({ path: f.path, f })),
    ...bins.map((b) => ({ path: b.path, b })),
  ];
  all.forEach((x) => {
    const parts = x.path.split("/");
    let node = root;
    parts.slice(0, -1).forEach((p, i) => {
      if (!node.dirs.has(p))
        node.dirs.set(p, { name: p, path: parts.slice(0, i + 1).join("/"), dirs: new Map(), files: [] });
      node = node.dirs.get(p) as TreeNode;
    });
    node.files.push(x);
  });
  const count = (n: TreeNode) => {
    n.count = n.files.length;
    n.lines = n.files.reduce((a, x) => a + (x.f?.lines || 0), 0);
    n.dirs.forEach((d) => {
      count(d);
      n.count = (n.count || 0) + (d.count || 0);
      n.lines = (n.lines || 0) + (d.lines || 0);
    });
  };
  count(root);
  return root;
}

/** Every directory path in the tree, for "Expand all". */
export function buildTreeDirs(files: ProjectFile[], bins: BinFile[]): string[] {
  const s = new Set<string>();
  [...files, ...bins].forEach((f) => {
    const parts = f.path.split("/");
    for (let i = 1; i < parts.length; i++) s.add(parts.slice(0, i).join("/"));
  });
  return [...s];
}
