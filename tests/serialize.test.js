import { test } from "node:test";
import assert from "node:assert/strict";
import { normalize } from "../public/assets/js/model/normalize.js";
import { outlineText, toMermaid } from "../public/assets/js/model/serialize.js";
import { EXAMPLE_MODEL } from "./fixtures/incident-postmortem.js";

const model = normalize(EXAMPLE_MODEL);

test("outlineText lists every step with its number", () => {
  const text = outlineText(model.steps);
  assert.match(text, /^1 \[step\] Collect the incident record \(creates: work\/ticket\.json\)$/m);
  assert.match(text, /^2 \[decision\] What is the incident severity\?$/m);
  assert.match(text, /^ {2}- branch "SEV1 or SEV2":$/m);
  assert.match(text, /\[loop\] Build the timeline — repeats for each source/);
});

test("toMermaid produces a flowchart from Start to Done", () => {
  const src = toMermaid(model.steps);
  const lines = src.split("\n");
  assert.equal(lines[0], "flowchart TD");
  assert.ok(lines.includes('  S(("Start"))'));
  assert.ok(lines.includes('  E(("Done"))'));
  assert.ok(
    lines.some((l) => /-->\|"SEV3 or lower"\|/.test(l)),
    "decision branches are labelled edges",
  );
  assert.ok(!/[<>](?!\|)/.test(src.replace(/-->|-\.->|&lt;|&gt;/g, "")), "angle brackets in labels are escaped");
});
