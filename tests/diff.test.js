import { test } from "node:test";
import assert from "node:assert/strict";
import { diffLines, diffStats, hunks, unifiedDiff } from "../public/assets/js/lib/diff.js";

const kinds = (ops) => ops.map((o) => (o.type === "eq" ? " " : o.type === "add" ? "+" : "-") + o.text).join("|");

test("identical texts have no changes", () => {
  const ops = diffLines("a\nb\n", "a\nb\n");
  assert.deepEqual(diffStats(ops), { added: 0, removed: 0 });
  assert.deepEqual(hunks(ops), []);
  assert.equal(unifiedDiff("f.md", "a\nb\n", "a\nb\n"), "");
});

test("a changed line shows as removed then added, with line numbers", () => {
  const ops = diffLines("a\nb\nc", "a\nB\nc");
  assert.equal(kinds(ops), " a|-b|+B| c");
  assert.deepEqual(
    ops.map((o) => [o.a, o.b]),
    [
      [1, 1],
      [2, null],
      [null, 2],
      [3, 3],
    ],
  );
  assert.deepEqual(diffStats(ops), { added: 1, removed: 1 });
});

test("insertions and deletions in the middle keep the rest aligned", () => {
  assert.equal(kinds(diffLines("a\nb\nc\nd", "a\nc\nx\nd")), " a|-b| c|+x| d");
  assert.equal(kinds(diffLines("", "new")), "+new");
  assert.equal(kinds(diffLines("old", "")), "-old");
});

test("hunks keep nearby changes together and split distant ones", () => {
  const old = Array.from({ length: 20 }, (_, i) => "l" + i).join("\n");
  const near = old.replace("l5", "X").replace("l8", "Y");
  assert.equal(hunks(diffLines(old, near)).length, 1);
  const far = old.replace("l1\n", "X\n").replace("l18", "Y");
  const hs = hunks(diffLines(old, far));
  assert.equal(hs.length, 2);
  assert.equal(hs[0][0].text, "l0");
  assert.equal(hs[1].at(-1).text, "l19");
});

test("unifiedDiff writes a patch that git understands", () => {
  const patch = unifiedDiff("SKILL.md", "a\nb\nc\nd\ne\n", "a\nb\nC\nd\ne\nf\n", 1);
  assert.equal(patch, "--- a/SKILL.md\n+++ b/SKILL.md\n@@ -2,4 +2,5 @@\n b\n-c\n+C\n d\n e\n+f\n");
  assert.equal(unifiedDiff("x.md", "", "hi\n"), "--- a/x.md\n+++ b/x.md\n@@ -0,0 +1,1 @@\n+hi\n");
});

test("very large rewrites fall back to a block replace", () => {
  const a = Array.from({ length: 3000 }, (_, i) => "a" + i).join("\n");
  const b = Array.from({ length: 3000 }, (_, i) => "b" + i).join("\n");
  assert.deepEqual(diffStats(diffLines(a, b)), { added: 3000, removed: 3000 });
});
