import { test } from "node:test";
import assert from "node:assert/strict";
import { FENCE, applyEdit, parseReply } from "../public/assets/js/ai/edits.js";

test("parseReply returns plain answers unchanged", () => {
  assert.deepEqual(parseReply("  Just an answer. "), { display: "Just an answer.", edits: null, open: false });
});

test("parseReply extracts an edits block", () => {
  const text = `Changed it.\n${FENCE}edits\n[{"file":"SKILL.md","find":"a","replace":"b"},{"bad":1}]\n${FENCE}`;
  const r = parseReply(text);
  assert.equal(r.display, "Changed it.");
  assert.deepEqual(r.edits, [{ file: "SKILL.md", find: "a", replace: "b" }]);
  assert.equal(r.open, false);
});

test("parseReply tolerates junk around the JSON and flags unfinished blocks", () => {
  const junk = parseReply(`x\n${FENCE}edits\nHere: [{"find":"a","replace":""}] ok\n${FENCE}`);
  assert.deepEqual(junk.edits, [{ find: "a", replace: "" }]);
  const open = parseReply(`x\n${FENCE}edits\n[{"find":`);
  assert.equal(open.open, true);
  assert.equal(open.edits, null);
});

test("applyEdit replaces exact text", () => {
  assert.equal(applyEdit("one two three", "two", "2"), "one 2 three");
});

test("applyEdit falls back to whitespace-insensitive matching", () => {
  assert.equal(applyEdit("a  b\n  c d", "b c", "X"), "a  X d");
});

test("applyEdit returns null when nothing matches or find is empty", () => {
  assert.equal(applyEdit("abc", "zzz", "y"), null);
  assert.equal(applyEdit("abc", "", "y"), null);
});
