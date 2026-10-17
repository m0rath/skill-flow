/*
  Shared types for the Project Flow Mapper (the code-aware half of the app).
  These mirror the shapes produced by the legacy analyser in public/index.html so the ported
  logic and the React views can talk to each other without guessing.
*/

/** A text file read from a folder/zip (or a virtual file created by the mapper). */
export interface ProjectFile {
  path: string;
  text: string;
  size?: number;
  lines?: number;
  virtual?: boolean;
  edited?: boolean;
  created?: boolean;
}

/** A file that was not read as text (binary, too large, or a lock file). */
export interface BinFile {
  path: string;
  size: number;
  bin: true;
  skipped?: boolean;
}

export interface Lang {
  name: string;
  color: string;
}

export interface LangStat extends Lang {
  lines: number;
  files: number;
}

export interface Edge {
  from: string;
  to: string;
  kind: string;
}

export interface CompEdge {
  from: string;
  to: string;
  n: number;
  ai?: boolean;
}

export interface Comp {
  key: string;
  files: number;
  lines: number;
  langs: string[];
  paths: string[];
}

export interface Command {
  cmd: string;
  purpose: string;
  from?: string;
}

export interface Todo {
  path: string;
  n: number;
}

/** Everything the analyser learns about a project's shape. */
export interface Project {
  name: string;
  files: number;
  bins: number;
  total: number;
  lines: number;
  langs: LangStat[];
  edges: Edge[];
  comps: Comp[];
  compEdges: CompEdge[];
  readmes: string[];
  docs: string[];
  manifests: string[];
  ci: string[];
  docker: string[];
  tests: string[];
  entries: string[];
  license: string | null;
  envExample: string | null;
  envVars: string[];
  todos: Todo[];
  commands: Command[];
  stack: string[];
  big: { path: string; lines: number }[];
}

/** A component as described in the AI-visible model (`model.components`). */
export interface PComponent {
  name: string;
  path: string;
  kind: string;
  purpose: string;
  depends: string[];
  keyFiles: string[];
}

/* ---------- code index ---------- */

/** Where an import binding comes from. */
export interface Bind {
  spec?: string;
  file?: string;
  name?: string;
  pkg?: string;
  dir?: string;
}

export interface Reexport {
  file?: string;
  name?: string;
  orig?: string;
  all?: boolean;
}

export interface ExtRef {
  ext: true;
  cat: string;
  pkg: string;
  label: string;
}

export interface FileCall {
  fileCall: true;
  file: string;
  label: string;
}

export interface RegRef {
  reg: true;
  label: string;
}

export type CallTarget = string | ExtRef | FileCall | RegRef;

export interface Call {
  to: CallTarget;
  line: number;
  cond: string | null;
  text: string;
  render?: boolean;
  load?: boolean;
}

export type SymKind = "function" | "method" | "class" | "module" | "route" | "main" | "const" | "component" | "other";

export interface Sym {
  name: string;
  fn?: string;
  cls?: string;
  proto?: string;
  short?: string;
  kind: SymKind | string;
  line: number;
  end: number;
  id?: string;
  file?: string;
  calls: Call[];
  exportDefault?: boolean;
  job?: string;
  route?: ParsedRoute;
}

export interface ParsedRoute {
  method: string;
  path: string;
  obj?: string;
  line: number;
  symLine?: number;
  classRef?: string;
  fnRef?: string;
  handlerRef?: string;
  route?: ParsedRoute;
}
export interface Mount {
  ref: string;
  prefix: string;
  line: number;
}

export interface Api {
  name: string;
  sym?: string | null;
  symRef?: Sym;
}

/** The result of parsing one code file. */
export interface Parsed {
  lines: string[];
  syms: Sym[];
  bind: Map<string, Bind>;
  routes: ParsedRoute[];
  mounts: Mount[];
  lang: string;
  top?: Sym;
  api?: Api[];
  dirFiles?: string[];
  reexports?: Reexport[];
}

export interface Route {
  name: string;
  method: string;
  path: string;
  file: string;
  line: number;
  sym: string;
}

export interface CodeIndex {
  P: Record<string, Parsed>;
  SY: Map<string, Sym>;
  routes: Route[];
  fileCalls: Map<string, number>;
  calledBy: Map<string, { from: string; line: number }[]>;
}

/* ---------- flows & traces ---------- */

export interface Flow {
  id: string;
  group: string;
  name: string;
  actor: string;
  root: string;
  file?: string;
  route?: Route;
  all?: boolean;
  custom?: boolean;
}

/** One line of a traced story. `phase` rows mark the start of a sub-flow. */
export interface FlowStep {
  depth: number;
  from: string;
  fromSym: string;
  fromName: string;
  line: number;
  cond: string | null;
  text: string;
  to: string;
  toSym: string | null;
  toName: string;
  load?: boolean;
  render?: boolean;
  ext?: boolean;
  cat?: string | null;
  recursive?: boolean;
  reg?: boolean;
  entry?: boolean;
  phase?: boolean;
  title?: string;
  sub?: string;
}

/** High-level overview model (used by the Overview flow mode and the animated player). */
export interface OvNode {
  key: string;
  kind: "actor" | "code" | "store" | "ext";
  cat?: string;
  label: string;
  tag: string;
  color: string;
  icon: string;
  files: Set<string>;
  fns: string[];
  items: [number, string][];
  first: number;
  writes: number;
  reads: number;
  queries: number;
  calls: number;
  rank: number;
}

export interface OvEdge {
  id: number;
  from: string;
  to: string;
  n: number;
  first: number;
  names: string[];
  conds: string[];
  resp: boolean;
  c?: number[];
}

export type OvHop =
  { type: "phase" } | { type: "work"; node: string } | { type: "edge"; e: number; from: string; to: string };

export interface OvModel {
  nodes: Map<string, OvNode>;
  edges: OvEdge[];
  hops: OvHop[];
  level: string;
}

/* ---------- file tree ---------- */

export interface TreeNode {
  name: string;
  path: string;
  dirs: Map<string, TreeNode>;
  files: { path: string; f?: ProjectFile; b?: BinFile }[];
  count?: number;
  lines?: number;
}
