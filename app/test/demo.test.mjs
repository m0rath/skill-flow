import assert from "node:assert/strict";
import test from "node:test";

process.env.DEMO_MISTRAL_API_KEY = "test-key";
process.env.DEMO_GEMINI_API_KEY = "test-key";
// Force the in-memory fallback; CI has no Netlify Blobs context.
delete process.env.NETLIFY_BLOBS_CONTEXT;

const upstreamBodies = [];
globalThis.fetch = async (_url, init) => {
  upstreamBodies.push(JSON.parse(init.body));
  const sse = [
    'data: {"choices":[{"delta":{"content":"OK"}}]}',
    "",
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
    "",
    "",
  ].join("\n");
  return new Response(sse, {
    status: 200,
    headers: { "content-type": "text/event-stream", "x-request-id": "req-test" },
  });
};

const { default: handler } = await import(new URL("../netlify/functions/demo.mjs", import.meta.url));

const BODY = { model: "mistral-small-2603", messages: [{ role: "user", content: "hi" }] };

async function post(body = BODY, ip = "10.0.0.2") {
  return handler(
    new Request("http://local/api/demo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { ip },
  );
}

test("demo proxy validates, streams, and rate-limits", async () => {
  const health = await handler(new Request("http://local/api/demo"), { ip: "10.0.0.1" });
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true, providers: { mistral: true, gemini: true } });

  const bad = await post({ ...BODY, model: "nope" });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error.code, "model_not_found");
  assert.equal(upstreamBodies.length, 0, "invalid models must not reach the provider");

  for (let i = 0; i < 6; i += 1) {
    const res = await post();
    assert.equal(res.status, 200, `request ${i + 1} should pass`);
    assert.equal(res.headers.get("x-demo-provider"), "mistral");
    assert.equal(res.headers.get("x-demo-model"), "mistral-small-2603");
    assert.match(await res.text(), /"content":"OK"/);
  }
  assert.equal(upstreamBodies.length, 6);

  const limited = await post();
  assert.equal(limited.status, 429);
  assert.equal((await limited.json()).error.code, "rate_limited");
  assert.ok(Number(limited.headers.get("retry-after")) > 0);

  // A different IP has its own minute budget, even though the global budget was touched.
  const other = await post(BODY, "10.0.0.3");
  assert.equal(other.status, 200);
  await other.text();

  const tooLarge = await post({ ...BODY, messages: [{ role: "user", content: "x".repeat(60_001) }] });
  assert.equal(tooLarge.status, 413);
  assert.equal((await tooLarge.json()).error.code, "prompt_too_large");

  assert.equal(upstreamBodies[0].max_tokens, 8_000);
  assert.equal(upstreamBodies[0].model, "mistral-small-2603");
});
