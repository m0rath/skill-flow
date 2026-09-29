import { FENCE } from "./edits.js";
import { outlineText } from "../model/serialize.js";

/** All files as one text block with FILE headers, cut off at `budget` characters. */
export function filesBlock(files, budget) {
  let doc = "";
  for (const f of files) {
    const chunk = `\n\n===== FILE: ${f.path} =====\n${f.text}`;
    if (doc.length + chunk.length > budget) {
      doc += chunk.slice(0, Math.max(0, budget - doc.length)) + "\n[truncated]";
      break;
    }
    doc += chunk;
  }
  return doc;
}
/** Asks for the whole workflow as the JSON model that normalize() accepts. */
export function mapPrompt(files) {
  return `You are mapping the workflow described in a Claude skill (SKILL.md plus any referenced files) or another Markdown instruction document, so a reader can understand the complete flow in one diagram.

Reply with ONLY one JSON object, no prose, in this shape:
{"title":"skill or workflow name","summary":"one sentence: what this workflow accomplishes","trigger":"when/why it runs","inputs":["things that must exist or be provided before starting"],"notes":["global rules that apply to every step (max 8)"],"steps":[NODE,...]}
NODE is one of:
 {"kind":"step","title":"...","detail":"...","creates":[{"name":"...","kind":"file|data|message|artifact|other","note":"..."}],"uses":["..."],"source":"..."}
 {"kind":"decision","title":"short label","question":"the question being decided?","detail":"...","source":"...","branches":[{"label":"outcome","implied":false,"steps":[NODE,...]}]}
 {"kind":"loop","title":"...","over":"what it repeats for / until when","detail":"...","source":"...","steps":[NODE,...]}
 {"kind":"parallel","title":"...","branches":[{"label":"track","steps":[NODE,...]}]}
 {"kind":"stop","title":"why the workflow ends early","source":"..."}

Rules:
- Cover every step in execution order, including setup, validation and final delivery.
- Use a decision node for ANY branching: if/when/otherwise/unless/depending on/for type X do Y. One branch per outcome. If the text only describes one outcome, still add the other outcome as a branch with "implied": true and empty steps, so the reader sees it is not described.
- Steps that only happen for one outcome go INSIDE that branch; steps for all outcomes come after the decision.
- loop for repetition; parallel only when the text says steps run independently.
- "creates" = concrete things the step produces, with exact file names from the text. "uses" = scripts, tools, commands, reference files, templates, and earlier outputs the step reads (use the same names as in "creates" so the data flow is visible).
- title: imperative, max 7 words. detail: 1-2 plain sentences. source: a short VERBATIM quote (max 140 chars) from the text.
- If a referenced file defines a sub-procedure the main flow calls, nest it where it is called.
- Max nesting depth 5, under 60 nodes.

Document:
${filesBlock(files, 48000)}`;
}
/** System-style first turn for the chat: how to answer and how to format edits. */
export function chatInstructions({ steps, files, scope }) {
  return `You are a workflow editor built into "Skill Flow Mapper". The user sees a diagram of the workflow described in the files below (a Claude skill or Markdown playbook) and is chatting with you about it.

How to answer:
- Be concise and concrete. Refer to steps by the numbers in the outline (for example "step 2a.1"). Short paragraphs or bullets.
- When a message starts with [Scope], focus on that step but keep the whole flow in mind.
- When the user asks you to change, fix, add, remove, rename, reword or rewrite anything in the file, or agrees to a change you proposed, make the change: write 1-3 sentences on what you changed, then append exactly one fenced block like this:
${FENCE}edits
[{"file":"<path exactly as in the FILE header>","find":"<exact text copied from the current file>","replace":"<new text>"}]
${FENCE}
- "find" must be copied character for character from the CURRENT file below, must be unique in that file, and should cover whole lines. To insert, use a nearby line as "find" and put that line plus the new lines in "replace". To delete, use an empty "replace". Several small edits are better than one huge edit.
- Keep the file's existing style, headings and numbering; renumber later steps if you insert one.
- Do not include an edits block when the user only asks a question. Put nothing after the edits block.

Workflow outline (numbers match the diagram):
${outlineText(steps)}
${scope ? `\nSelected step ${scope.num}: ${scope.kind} "${scope.kind === "decision" ? scope.question || scope.title : scope.title}". Detail: ${scope.detail || "-"}. Source text: "${scope.source || "-"}"\n` : ""}
Current files:${filesBlock(files, 38000)}`;
}
/** Asks for a JSON list of gaps in the workflow. */
export function reviewPrompt({ steps, files }) {
  return `Review this workflow document (a Claude skill or Markdown playbook) for gaps that would make it fail or behave unpredictably when followed.
Focus on: conditions with no "otherwise" path (it says what to do if X is present but not if it is absent), missing input validation, missing failure/error handling for scripts, tools and fetches, loops with no exit, ambiguous instructions, outputs that are created but never used or delivered, steps referenced but never defined, and missing final delivery to the user.

Reply with ONLY a JSON array (max 12 items, most important first):
[{"title":"short statement of the gap","severity":"high|medium|low","category":"Missing branch|Error handling|Validation|Ambiguity|Missing step|Output|Other","step":"step number from the outline below, or empty string","whatIf":"What happens if ...? (the unhandled scenario, one question)","suggestion":"the concrete change to make in the file, 1-2 sentences"}]

Workflow outline (numbers match the diagram):
${outlineText(steps)}
${filesBlock(files, 40000)}`;
}
