import { test } from "node:test";
import assert from "node:assert/strict";
import { EXAMPLE_MD, EXAMPLE_MODEL } from "../public/assets/js/data/example.js";
import { localChecks } from "../public/assets/js/model/checks.js";
import { allCreates, counts, normalize, ordered } from "../public/assets/js/model/normalize.js";
import { S, emptySuggestions } from "../public/assets/js/state.js";

test("the built-in example shows every kind of node", () => {
  S.model = normalize(EXAMPLE_MODEL);
  const c = counts();
  assert.ok(c.decision >= 2 && c.loop >= 1);
  assert.ok(ordered().some((n) => n.kind === "stop"));
  assert.deepEqual(
    allCreates().map((o) => o.name),
    ["work/changes.diff", "work/findings.md", "output/review.md"],
  );
});

test("the built-in example has exactly one deliberate gap", () => {
  S.files = [{ path: "SKILL.md", text: EXAMPLE_MD }];
  S.sugg = emptySuggestions();
  S.model = normalize(EXAMPLE_MODEL);
  const gaps = localChecks();
  assert.deepEqual(
    gaps.map((g) => g.cat),
    ["Missing branch"],
  );
  assert.equal(gaps[0].title, "Step 4 only says what to do in one case");
});

test("'fails' and 'failed' count as failure handling", () => {
  S.sugg = emptySuggestions();
  S.model = normalize({ steps: [{ title: "Run" }] });
  S.files = [{ path: "a.md", text: "If the script fails, stop." }];
  assert.ok(!localChecks().some((g) => g.id === "l-err"));
  S.files = [{ path: "a.md", text: "Run the script." }];
  assert.ok(localChecks().some((g) => g.id === "l-err"));
});
