import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient, mapErr, preferModel, toMessages } from "../public/assets/js/ai/providers.js";
import { parseJsonLoose } from "../public/assets/js/lib/json.js";
import { md } from "../public/assets/js/lib/markdown.js";

test("mapErr turns provider errors into app error codes", () => {
  assert.equal(mapErr(401, "invalid x-api-key"), "invalid_key");
  assert.equal(mapErr(429, ""), "rate_limited");
  assert.equal(mapErr(400, "prompt is too long"), "prompt_too_large");
  assert.equal(mapErr(429, "You exceeded your current quota", "insufficient_quota"), "quota");
  assert.equal(mapErr(404, ""), "model_not_found");
  assert.equal(mapErr(529, ""), "overloaded");
  assert.equal(mapErr(400, "bad"), "bad_request");
  assert.equal(mapErr(500, ""), "upstream_error");
});

test("toMessages merges consecutive roles and starts with the user", () => {
  assert.deepEqual(toMessages("hi"), [{ role: "user", content: "hi" }]);
  assert.deepEqual(
    toMessages([
      { role: "assistant", content: "drop me" },
      { role: "user", content: "a" },
      { role: "user", content: "b" },
      { role: "assistant", content: "" },
      { role: "assistant", content: "c" },
    ]),
    [
      { role: "user", content: "a\n\nb" },
      { role: "assistant", content: "c" },
    ],
  );
});

test("preferModel picks a sensible default per provider", () => {
  const ids = (list) => list.map((id) => ({ id }));
  assert.equal(preferModel("anthropic", ids(["claude-haiku", "claude-sonnet-5"])).id, "claude-sonnet-5");
  assert.equal(preferModel("openai", ids(["gpt-5-mini", "gpt-5"])).id, "gpt-5");
  assert.equal(
    preferModel("gemini", ids(["gemini-2.5-pro", "gemini-2.5-flash-lite", "gemini-2.5-flash"])).id,
    "gemini-2.5-flash",
  );
});

test("parseJsonLoose finds JSON in fenced or chatty replies", () => {
  assert.deepEqual(parseJsonLoose('{"a":1}'), { a: 1 });
  assert.deepEqual(parseJsonLoose("Sure:\n```json\n[1,2]\n```"), [1, 2]);
  assert.deepEqual(parseJsonLoose('Here you go {"a":[1]} hope it helps'), { a: [1] });
  assert.equal(parseJsonLoose("no json here"), undefined);
});

test("md renders a safe subset of Markdown", () => {
  assert.equal(md("**bold** and `code`"), "<p><strong>bold</strong> and <code>code</code></p>");
  assert.equal(md("- a\n- b"), "<ul><li>a</li><li>b</li></ul>");
  assert.equal(md('<img src=x onerror="alert(1)">'), "<p>&lt;img src=x onerror=&quot;alert(1)&quot;&gt;</p>");
});

const sse = (...events) =>
  new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""), {
    headers: { "content-type": "text/event-stream" },
  });
const textDelta = (text) => ({ type: "content_block_delta", delta: { type: "text_delta", text } });

test("createClient retries when the provider is overloaded", async (t) => {
  const replies = [
    () => new Response(JSON.stringify({ error: { type: "overloaded_error", message: "Overloaded" } }), { status: 529 }),
    () => sse(textDelta("Hello")),
  ];
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => replies[calls++]());
  const client = createClient({ provider: "anthropic", key: "k", model: "m" });
  const r = await client("hi");
  assert.equal(r.text, "Hello");
  assert.equal(calls, 2);
});

test("createClient does not retry errors that won't go away", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return new Response(JSON.stringify({ error: { message: "invalid x-api-key" } }), { status: 401 });
  });
  const client = createClient({ provider: "anthropic", key: "bad", model: "m" });
  await assert.rejects(client("hi"), { code: "invalid_key" });
  assert.equal(calls, 1);
});

test("Stop cancels a pending retry", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("{}", { status: 503 }));
  const ctl = new AbortController();
  const client = createClient({ provider: "gemini", key: "k", model: "m" });
  const p = client("hi", { signal: ctl.signal });
  setTimeout(() => ctl.abort(), 50);
  await assert.rejects(p, { code: "cancelled" });
});
