import { test } from "node:test";
import assert from "node:assert/strict";
import { allCreates, counts, descCount, index, normalize, numIndex } from "../public/assets/js/model/normalize.js";
import { EXAMPLE_MODEL } from "./fixtures/incident-postmortem.js";

test("normalize numbers nested steps and fills the lookups", () => {
  const m = normalize(EXAMPLE_MODEL);
  assert.equal(m.steps[0].num, "1");
  const decision = m.steps[1];
  assert.equal(decision.kind, "decision");
  assert.equal(decision.branches[0].steps[0].num, "2a.1");
  assert.equal(decision.branches[1].steps[0].num, "2b.1");
  assert.equal(index.get(numIndex.get("2a.1")), decision.branches[0].steps[0]);
  assert.equal(decision.branches[0].steps[0].parent, decision.id);
});

test("normalize repairs loose input", () => {
  const m = normalize({
    name: "x",
    steps: [
      { type: "condition", question: "Ready?", branches: [{ label: "Yes", steps: [{ title: "Go" }] }] },
      { kind: "end", title: "Done" },
      null,
      { kind: "step", creates: ["out.md", ""], tools: "script.sh" },
    ],
  });
  assert.equal(m.title, "x");
  assert.equal(m.steps.length, 3);
  assert.equal(m.steps[0].kind, "decision");
  assert.equal(m.steps[0].branches.length, 2, "a missing 'otherwise' branch is added");
  assert.equal(m.steps[0].branches[1].implied, true);
  assert.equal(m.steps[1].kind, "stop");
  assert.deepEqual(m.steps[2].creates, [{ name: "out.md", kind: "other", note: "" }]);
  assert.deepEqual(m.steps[2].uses, ["script.sh"]);
});

test("normalize handles empty and invalid input", () => {
  assert.deepEqual(normalize(null).steps, []);
  assert.equal(normalize("nope").title, "Untitled workflow");
});

test("counts, descCount and allCreates summarise the model", () => {
  const m = normalize(EXAMPLE_MODEL);
  const c = counts();
  assert.ok(c.step > 0 && c.decision > 0 && c.loop > 0);
  assert.ok(descCount(m.steps[1]) > 5);
  const outs = allCreates().map((o) => o.name);
  assert.ok(outs.includes("work/timeline.csv"));
  assert.equal(new Set(outs).size, outs.length, "outputs are de-duplicated");
});
