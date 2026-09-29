import { test } from "node:test";
import assert from "node:assert/strict";
import { frontmatter, quickParse, shortTitle, splitCondition } from "../public/assets/js/model/quick-parse.js";
import { EXAMPLE_MD } from "./fixtures/incident-postmortem.js";

test("frontmatter reads name and description and strips the block", () => {
  const { meta, body } = frontmatter('---\nname: demo\ndescription: "Does a thing"\n---\n# Title\n');
  assert.deepEqual(meta, { name: "demo", description: "Does a thing" });
  assert.equal(body, "# Title\n");
});

test("frontmatter is optional", () => {
  assert.deepEqual(frontmatter("# Just a heading"), { meta: {}, body: "# Just a heading" });
});

test("shortTitle drops step prefixes, markup and trailing punctuation", () => {
  assert.equal(shortTitle("**Step 2:** Classify severity."), "Classify severity");
  assert.equal(shortTitle("3. Build the timeline"), "Build the timeline");
});

test("splitCondition separates the condition from the action", () => {
  assert.deepEqual(splitCondition("- If the file exists, overwrite it"), {
    cond: "the file exists",
    then: "overwrite it",
  });
  assert.deepEqual(splitCondition("Otherwise, stop"), { cond: "Otherwise", then: "stop" });
});

test("quickParse maps the example skill", () => {
  const m = quickParse([{ path: "SKILL.md", text: EXAMPLE_MD }]);
  assert.equal(m.title, "incident-postmortem");
  assert.equal(m.inputs.length, 3);
  assert.deepEqual(m.notes, ["Times always in UTC.", "Keep the tone blameless."]);
  assert.ok(m.steps.length >= 7, "one node per numbered step at least");
  assert.equal(m.steps[0].title, "Collect the incident record");
  assert.ok(m.steps[0].creates.some((c) => c.name === "work/ticket.json"));
  assert.ok(m.steps[0].uses.includes("scripts/fetch_ticket.py"));
  assert.ok(
    m.steps.some((s) => s.kind === "loop"),
    "the 'For each source' step becomes a loop",
  );
  assert.ok(
    m.steps.some((s) => s.kind === "decision"),
    "if/when lines become decisions",
  );
});

test("quickParse prefers SKILL.md over other files", () => {
  const m = quickParse([
    { path: "notes.md", text: "# Notes\n" },
    { path: "skill/SKILL.md", text: "---\nname: picked\n---\n" },
  ]);
  assert.equal(m.title, "picked");
});

test("quickParse falls back to a placeholder when there are no steps", () => {
  const m = quickParse([{ path: "a.md", text: "Just prose." }]);
  assert.equal(m.steps.length, 1);
  assert.equal(m.steps[0].title, "No clear steps found");
});
