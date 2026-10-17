export type NodeKind = "step" | "decision" | "loop" | "parallel" | "stop";

export interface Create {
  name: string;
  kind: string;
  note: string;
}

export interface FlowNode {
  id: string;
  kind: NodeKind;
  num: string;
  parent: string | null;
  title: string;
  detail: string;
  creates: Create[];
  uses: string[];
  source: string;
  /** decision / parallel */
  question?: string;
  branches?: Branch[];
  /** loop */
  over?: string;
  steps?: FlowNode[];
}

export interface Branch {
  label: string;
  implied: boolean;
  steps: FlowNode[];
}

export interface Model {
  title: string;
  summary: string;
  trigger: string;
  inputs: string[];
  notes: string[];
  steps: FlowNode[];
  /** Present in the Project Flow Mapper: the components the flow runs through. */
  components?: {
    name: string;
    path: string;
    kind: string;
    purpose: string;
    depends: string[];
    keyFiles: string[];
  }[];
  stack?: string[];
  commands?: { cmd: string; purpose: string }[];
}

export interface FileItem {
  path: string;
  text: string;
  edited?: boolean;
  virtual?: boolean;
}

export type Severity = "high" | "medium" | "low";

export interface Suggestion {
  id: string;
  sev: Severity;
  cat: string;
  nodeId: string | null;
  title: string;
  whatIf: string;
  suggestion: string;
}

export interface Edit {
  file: string;
  find: string;
  replace: string;
}

export interface EditResult {
  file?: string;
  find?: string;
  ok: boolean;
  reason?: string;
}

export type ChatMessageStatus = "applied" | "applied-old" | "pending" | "error" | "done";

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  scope?: FlowNode | null;
  edits?: Edit[] | null;
  results?: EditResult[] | null;
  status?: ChatMessageStatus;
  error?: string;
  pending?: boolean;
  snap?: number;
}

export interface Note {
  id: string;
  file: string;
  line: number;
  text: string;
  type: "fix" | "change" | "question" | "note";
  quote: string;
}

export interface MindMapLink {
  from: string;
  to: string;
  label?: string;
}
