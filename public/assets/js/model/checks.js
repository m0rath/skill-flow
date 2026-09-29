import { INPUT_DIR } from "./quick-parse.js";
import { ordered } from "./normalize.js";
import { S } from "../state.js";

export function allText() {
  return S.files.map((f) => f.text).join("\n");
}
export function localChecks() {
  const out = [];
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
  (S.model.inputs || []).forEach((inp, i) => {
    if (/optional/i.test(inp)) {
      const kw = (inp.match(/[A-Za-z]{4,}/g) || []).filter((w) => !/optional|export|from|with|file/i.test(w))[0] || "";
      const handled =
        kw &&
        ordered().some(
          (n) =>
            n.kind === "decision" &&
            (n.question + " " + n.branches.map((b) => b.label).join(" ") + " " + n.source)
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
    !/\b(error|fail(?:s|ed|ing|ure)?|invalid|exception|retry|timeout|cannot|can't|unable|not found)\b/i.test(allText())
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
  const real = S.files.filter((f) => !f.virtual);
  if (real.length > 1) {
    const have = S.files.map((f) => f.path).join("\n");
    const listed = (S.files.find((f) => f.virtual) || { text: "" }).text;
    const refs = new Set();
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
  return out.filter((s) => !S.sugg.dismissed.includes(s.id));
}
export function flaggedIds() {
  const ids = new Set();
  localChecks().forEach((s) => s.nodeId && ids.add(s.nodeId));
  (S.sugg.claude || []).forEach((s) => {
    if (s.nodeId && !S.sugg.dismissed.includes(s.id)) ids.add(s.nodeId);
  });
  return ids;
}
export function suggCount() {
  return localChecks().length + (S.sugg.claude || []).filter((s) => !S.sugg.dismissed.includes(s.id)).length;
}
export function allSugg() {
  return [...localChecks(), ...(S.sugg.claude || []).filter((s) => !S.sugg.dismissed.includes(s.id))];
}
