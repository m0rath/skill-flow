import { INPUT_DIR } from "./quick-parse";
import { ordered } from "./normalize";
import type { FileItem, Model, Suggestion } from "./types";

export interface ChecksInput {
  files: FileItem[];
  model: Model;
  /** Ids the user dismissed. */
  dismissed: string[];
  /** AI-provided suggestions, if a review has run. */
  claude?: Suggestion[] | null;
}

export function allText(files: FileItem[]): string {
  return files.map((f) => f.text).join("\n");
}

/** Deterministic gaps that need no API key. */
export function localChecks({ files, model, dismissed }: ChecksInput): Suggestion[] {
  const out: Suggestion[] = [];
  ordered().forEach((n) => {
    if (n.branches && n.kind === "decision") {
      const implied = n.branches.filter((b) => b.implied);
      if (implied.length) {
        const other = n.branches.find((b) => !b.implied);
        out.push({
          id: "l-br-" + n.num,
          sev: "medium",
          cat: "Missing branch",
          nodeId: n.id,
          title: `Step ${n.num} only says what to do in one case`,
          whatIf: `What happens if "${other ? other.label : n.question}" is not the case?`,
          suggestion: `Add an explicit "otherwise" instruction for step ${n.num}: continue, stop, or ask the user.`,
        });
      }
    }
    if (n.kind === "loop" && !n.over)
      out.push({
        id: "l-loop-" + n.num,
        sev: "low",
        cat: "Loop exit",
        nodeId: n.id,
        title: `Step ${n.num} repeats without a stated end`,
        whatIf: "When does this loop stop?",
        suggestion: "State what it repeats over, or the condition that ends it.",
      });
  });
  (model.inputs || []).forEach((inp, i) => {
    if (/optional/i.test(inp)) {
      const kw = (inp.match(/[A-Za-z]{4,}/g) || []).filter((w) => !/optional|export|from|with|file/i.test(w))[0] || "";
      const handled =
        kw &&
        ordered().some(
          (n) =>
            n.kind === "decision" &&
            (n.question + " " + (n.branches || []).map((b) => b.label).join(" ") + " " + n.source)
              .toLowerCase()
              .includes(kw.toLowerCase()),
        );
      if (!handled)
        out.push({
          id: "l-in-" + i,
          sev: "medium",
          cat: "Missing input path",
          nodeId: null,
          title: `Optional input may not be handled: ${inp.replace(/\s*\(optional\)/i, "")}`,
          whatIf: `What happens if "${inp.replace(/\s*\(optional\)/i, "")}" is not provided?`,
          suggestion: "Add a step or condition that says what to do without it.",
        });
    }
  });
  if (
    !/\b(error|fail(?:s|ed|ing|ure)?|invalid|exception|retry|timeout|cannot|can't|unable|not found)\b/i.test(
      allText(files),
    )
  )
    out.push({
      id: "l-err",
      sev: "high",
      cat: "Error handling",
      nodeId: null,
      title: "No failure handling anywhere in the file",
      whatIf: "What happens if a script, tool call or fetch fails, or an input is invalid?",
      suggestion: "Add what to do on failure: retry, report to the user, or stop with a clear message.",
    });
  const real = files.filter((f) => !f.virtual);
  if (real.length > 1) {
    const have = files.map((f) => f.path).join("\n");
    const listed = (files.find((f) => f.virtual) || { text: "" }).text;
    const refs = new Set<string>();
    ordered().forEach((n) =>
      n.uses.forEach((u) => {
        if (INPUT_DIR.test(u)) refs.add(u);
      }),
    );
    refs.forEach((r) => {
      if (!have.includes(r) && !listed.includes(r))
        out.push({
          id: "l-ref-" + r,
          sev: "low",
          cat: "Missing file",
          nodeId: null,
          title: `Referenced file not in the upload: ${r}`,
          whatIf: `What if ${r} does not exist when the skill runs?`,
          suggestion: "Add the file to the skill folder or fix the path.",
        });
    });
  }
  return out.filter((s) => !dismissed.includes(s.id));
}

/** Node ids that should show the "!" marker. */
export function flaggedIds(input: ChecksInput): Set<string> {
  const ids = new Set<string>();
  localChecks(input).forEach((s) => s.nodeId && ids.add(s.nodeId));
  (input.claude || []).forEach((s) => {
    if (s.nodeId && !input.dismissed.includes(s.id)) ids.add(s.nodeId);
  });
  return ids;
}

export function suggCount(input: ChecksInput): number {
  return localChecks(input).length + (input.claude || []).filter((s) => !input.dismissed.includes(s.id)).length;
}

export function allSugg(input: ChecksInput): Suggestion[] {
  return [...localChecks(input), ...(input.claude || []).filter((s) => !input.dismissed.includes(s.id))];
}
