/**
 * Shared AI demo proxy.
 *
 * The browser never sees a provider key. This function validates the request, applies
 * per-IP/minute/daily and global daily limits, then streams the selected provider's SSE
 * response back unchanged. Netlify also applies an IP rate limit at the edge as a backstop.
 *
 * Required environment variables (set in Netlify, never in git):
 *   DEMO_MISTRAL_API_KEY
 *   DEMO_GEMINI_API_KEY
 *
 * Optional:
 *   DEMO_IP_SALT  a stable string used to hash IPs before they are stored in Blobs
 */
import { getStore } from "@netlify/blobs";

const MAX_INPUT_CHARS = 60_000;
const MAX_MESSAGES = 24;
const MAX_OUTPUT_TOKENS = 8_000;
const IP_DAILY_LIMIT = 12;
const IP_MINUTE_LIMIT = 6;
const GLOBAL_DAILY_LIMIT = 500;
const BLOB_STORE = "justools-demo-limits";
const BLOB_CONSISTENCY = "strong";

const MODELS = new Map([
  ["mistral-small-2603", { provider: "mistral", model: "mistral-small-2603" }],
  ["mistral-small-latest", { provider: "mistral", model: "mistral-small-latest" }],
  ["gemini-3.5-flash-lite", { provider: "gemini", model: "gemini-3.5-flash-lite" }],
]);

export const config = {
  method: ["GET", "POST"],
  // Platform-level backstop. The function also enforces the lower shared limits below.
  rateLimit: {
    action: "rate_limit",
    aggregateBy: ["ip"],
    windowSize: 86_400,
    windowLimit: 20,
  },
};

class HttpError extends Error {
  constructor(status, code, message, retryAfter) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...headers,
    },
  });
}

function errorJson(status, code, message, retryAfter) {
  const headers = {};
  if (retryAfter) headers["retry-after"] = String(Math.max(1, Math.ceil(retryAfter)));
  return json({ error: { code, message } }, status, headers);
}

function upstreamKey(provider) {
  return provider === "gemini" ? process.env.DEMO_GEMINI_API_KEY || "" : process.env.DEMO_MISTRAL_API_KEY || "";
}

function nextUtcMidnight(now = Date.now()) {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

function nextMinute(now = Date.now()) {
  return Math.ceil(now / 60_000) * 60_000;
}

function retrySeconds(resetAt, now = Date.now()) {
  return Math.max(1, Math.ceil((resetAt - now) / 1000));
}

async function hashIp(ip) {
  const salt = process.env.DEMO_IP_SALT || "justools-demo-v1";
  const data = new TextEncoder().encode(`${salt}:${ip || "unknown"}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest).slice(0, 16))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Fallback counters keep local development and rare Blobs failures useful. They are
 * per-instance, which is why the platform rate limit and Blobs are the primary guards.
 */
const memoryCounts = new Map();

function bumpMemory(key, limit, resetAt) {
  const now = Date.now();
  if (memoryCounts.size > 2_000) {
    for (const [k, v] of memoryCounts) if (v.resetAt <= now) memoryCounts.delete(k);
  }
  const prev = memoryCounts.get(key);
  const count = prev && prev.resetAt === resetAt ? prev.count : 0;
  if (count >= limit) return { ok: false, retryAfter: retrySeconds(resetAt, now) };
  memoryCounts.set(key, { count: count + 1, resetAt });
  return { ok: true };
}

let blobStore;
function limitsStore() {
  if (blobStore !== undefined) return blobStore;
  // Netlify's runtime may expose the Blobs context as a global rather than an env var.
  const context = globalThis.netlifyBlobsContext || process.env.NETLIFY_BLOBS_CONTEXT;
  if (!context) {
    blobStore = null;
    return blobStore;
  }
  try {
    blobStore = getStore({ name: BLOB_STORE, consistency: BLOB_CONSISTENCY });
  } catch {
    blobStore = null;
  }
  return blobStore;
}

/** Atomic-ish fixed-window increment. Contention retries instead of leaking extra requests. */
async function bumpBlob(store, key, limit, resetAt) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const entry = await store.getWithMetadata(key, { type: "json", consistency: BLOB_CONSISTENCY });
    const prev = entry?.data && entry.data.resetAt === resetAt ? entry.data : null;
    const count = prev ? Number(prev.count) || 0 : 0;
    if (count >= limit) return { ok: false, retryAfter: retrySeconds(resetAt) };
    const next = { count: count + 1, resetAt };
    const result = entry
      ? await store.setJSON(key, next, { onlyIfMatch: entry.etag })
      : await store.setJSON(key, next, { onlyIfNew: true });
    if (result.modified) return { ok: true };
  }
  // Extreme contention should not lock a real user out. The platform backstop still applies.
  return { ok: true };
}

async function bump(key, limit, resetAt) {
  const store = limitsStore();
  if (store) {
    try {
      return await bumpBlob(store, key, limit, resetAt);
    } catch (e) {
      console.warn("demo: blobs rate limit failed, using memory fallback", e?.message || String(e));
    }
  }
  return bumpMemory(key, limit, resetAt);
}

async function checkLimits(ip) {
  const now = Date.now();
  const minuteReset = nextMinute(now);
  const dayReset = nextUtcMidnight(now);
  const ipHash = await hashIp(ip);

  // Keep one stable key per counter and reset it in place. A key per minute or per day
  // would accumulate in Blobs forever.
  const minute = await bump(`minute/${ipHash}`, IP_MINUTE_LIMIT, minuteReset);
  if (!minute.ok) return { ...minute, code: "rate_limited" };

  const daily = await bump(`ip/${ipHash}/day`, IP_DAILY_LIMIT, dayReset);
  if (!daily.ok) return { ...daily, code: "demo_limit" };

  const global = await bump("global", GLOBAL_DAILY_LIMIT, dayReset);
  return global.ok ? global : { ...global, code: "demo_limit" };
}

async function readBody(req) {
  const length = Number(req.headers.get("content-length") || 0);
  if (length > 120_000) throw new HttpError(413, "prompt_too_large", "The request is too large for the demo.");
  let raw;
  try {
    raw = await req.text();
  } catch {
    throw new HttpError(400, "bad_request", "The demo request could not be read.");
  }
  if (raw.length > 120_000) throw new HttpError(413, "prompt_too_large", "The request is too large for the demo.");

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new HttpError(400, "bad_request", "The demo request was not valid JSON.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new HttpError(400, "bad_request", "The demo request was invalid.");

  const selected = typeof body.model === "string" ? MODELS.get(body.model) : undefined;
  if (!selected) throw new HttpError(400, "model_not_found", "That model is not available in the demo.");

  if (!Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > MAX_MESSAGES)
    throw new HttpError(400, "bad_request", "The demo request needs a short conversation.");

  const messages = [];
  let chars = 0;
  for (const turn of body.messages) {
    if (!turn || (turn.role !== "user" && turn.role !== "assistant")) continue;
    const content = typeof turn.content === "string" ? turn.content : "";
    if (!content) continue;
    chars += content.length;
    if (chars > MAX_INPUT_CHARS)
      throw new HttpError(
        413,
        "prompt_too_large",
        "The file is too large for the demo. Use your own key for full-size files.",
      );
    messages.push({ role: turn.role, content });
  }
  while (messages.length && messages[0].role !== "user") messages.shift();
  if (!messages.length) throw new HttpError(400, "bad_request", "The demo request needs a user message.");

  const requested = Number(body.maxTokens);
  const maxTokens = Number.isFinite(requested)
    ? Math.max(256, Math.min(MAX_OUTPUT_TOKENS, Math.floor(requested)))
    : MAX_OUTPUT_TOKENS;

  return { selected, messages, maxTokens, chars };
}

function abortSignal(req) {
  if (typeof AbortSignal.timeout !== "function") return req.signal;
  const timeout = AbortSignal.timeout(55_000);
  return typeof AbortSignal.any === "function" ? AbortSignal.any([req.signal, timeout]) : timeout;
}

async function callMistral(key, model, messages, maxTokens, signal) {
  return fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    signal,
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages, stream: true, max_tokens: maxTokens }),
  });
}

async function callGemini(key, model, messages, maxTokens, signal) {
  return fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
    {
      method: "POST",
      signal,
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: messages.map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        })),
        generationConfig: { maxOutputTokens: maxTokens },
      }),
    },
  );
}

function upstreamFailure(status, text) {
  const lower = String(text || "").toLowerCase();
  if (status === 429) {
    return new HttpError(429, "rate_limited", "The demo provider is busy right now. Try again in a minute.");
  }
  if (
    status === 413 ||
    (status === 400 && /(token|context|too long|too large|maximum)/i.test(lower)) ||
    (status === 422 && /(token|context|too long|too large|maximum)/i.test(lower))
  ) {
    return new HttpError(
      413,
      "prompt_too_large",
      "The file is too large for the demo. Use your own key for full-size files.",
    );
  }
  if (status === 401 || status === 403 || status === 404) {
    return new HttpError(503, "demo_unavailable", "The demo is not configured correctly. Use your own key for now.");
  }
  if (status >= 500) {
    return new HttpError(502, "upstream_error", "The demo provider is temporarily unavailable. Try again.");
  }
  return new HttpError(400, "bad_request", "The demo provider rejected the request. Try again or use your own key.");
}

function log(level, message, extra = {}) {
  const line = JSON.stringify({ level, message, ...extra });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export default async function handler(req, context) {
  if (req.method === "GET") {
    return json({
      ok: true,
      providers: {
        mistral: Boolean(upstreamKey("mistral")),
        gemini: Boolean(upstreamKey("gemini")),
      },
    });
  }
  if (req.method !== "POST") {
    return json({ error: { code: "bad_request", message: "Use POST for the demo." } }, 405, { allow: "GET, POST" });
  }

  const started = Date.now();
  let provider = "";
  let model = "";
  try {
    const { selected, messages, maxTokens, chars } = await readBody(req);
    provider = selected.provider;
    model = selected.model;

    const key = upstreamKey(provider);
    if (!key) {
      throw new HttpError(
        503,
        "demo_unavailable",
        "That demo model is not configured. Try the other model or use your own key.",
      );
    }

    const limit = await checkLimits(context?.ip || req.headers.get("x-nf-client-connection-ip") || "unknown");
    if (!limit.ok) {
      const code = limit.code || "demo_limit";
      log("warn", "demo rate limited", {
        requestId: context?.requestId,
        code,
        retryAfter: limit.retryAfter,
      });
      throw new HttpError(
        429,
        code,
        code === "rate_limited"
          ? "The demo is getting a lot of requests. Try again in a minute."
          : "The demo has reached its daily limit. Use your own API key in AI settings for more.",
        limit.retryAfter,
      );
    }

    let upstream;
    try {
      upstream =
        provider === "gemini"
          ? await callGemini(key, model, messages, maxTokens, abortSignal(req))
          : await callMistral(key, model, messages, maxTokens, abortSignal(req));
    } catch (e) {
      if (req.signal.aborted) throw new HttpError(499, "cancelled", "The request was cancelled.");
      if (e?.name === "TimeoutError") throw new HttpError(504, "upstream_error", "The demo took too long. Try again.");
      throw new HttpError(502, "network", "The demo could not reach its AI provider. Try again.");
    }

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => "");
      // Do not log the upstream body: it can echo parts of the user's prompt.
      log("error", "demo upstream error", {
        requestId: context?.requestId,
        provider,
        model,
        status: upstream.status,
      });
      throw upstreamFailure(upstream.status, text);
    }
    if (!upstream.body) throw new HttpError(502, "upstream_error", "The demo provider returned an empty stream.");

    log("info", "demo request", {
      requestId: context?.requestId,
      provider,
      model,
      chars,
      maxTokens,
      ms: Date.now() - started,
    });

    return new Response(upstream.body, {
      status: 200,
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store, no-transform",
        "x-content-type-options": "nosniff",
        "x-accel-buffering": "no",
        "x-demo-provider": provider,
        "x-demo-model": model,
      },
    });
  } catch (e) {
    if (e instanceof HttpError) {
      if (e.status >= 500) {
        log("error", "demo request failed", {
          requestId: context?.requestId,
          provider,
          model,
          code: e.code,
          status: e.status,
          ms: Date.now() - started,
        });
      }
      return errorJson(e.status, e.code, e.message, e.retryAfter);
    }
    log("error", "demo unexpected error", {
      requestId: context?.requestId,
      provider,
      model,
      detail: e?.message || String(e),
      ms: Date.now() - started,
    });
    return errorJson(502, "upstream_error", "The demo hit an unexpected error. Try again or use your own key.");
  }
}
