import { parseJsonLoose } from "../lib/json.js";

export const PROVIDERS = {
  anthropic: {
    label: "Anthropic (Claude)",
    short: "Claude",
    keyHint: "sk-ant-...",
    keyUrl: "https://console.anthropic.com/settings/keys",
    keySite: "console.anthropic.com",
    host: "api.anthropic.com",
  },
  openai: {
    label: "OpenAI (ChatGPT)",
    short: "OpenAI",
    keyHint: "sk-...",
    keyUrl: "https://platform.openai.com/api-keys",
    keySite: "platform.openai.com",
    host: "api.openai.com",
  },
  gemini: {
    label: "Google Gemini",
    short: "Gemini",
    keyHint: "AIza...",
    keyUrl: "https://aistudio.google.com/app/apikey",
    keySite: "aistudio.google.com",
    host: "generativelanguage.googleapis.com",
  },
};
export function mapErr(status, msg, extra) {
  msg = String(msg || "").toLowerCase();
  extra = String(extra || "").toLowerCase();
  if (
    extra.includes("insufficient_quota") ||
    msg.includes("exceeded your current quota") ||
    msg.includes("credit balance")
  )
    return "quota";
  if (
    status === 401 ||
    status === 403 ||
    msg.includes("api key not valid") ||
    msg.includes("invalid api key") ||
    msg.includes("incorrect api key") ||
    extra.includes("api_key_invalid")
  )
    return "invalid_key";
  if (status === 429 || extra === "resource_exhausted") return "rate_limited";
  if (
    status === 413 ||
    msg.includes("prompt is too long") ||
    msg.includes("too many tokens") ||
    msg.includes("context length") ||
    msg.includes("context_length")
  )
    return "prompt_too_large";
  if (
    status === 404 ||
    msg.includes("model:") ||
    msg.includes("does not exist") ||
    msg.includes("not found for api version")
  )
    return "model_not_found";
  if (status === 529 || status === 503 || msg.includes("overloaded")) return "overloaded";
  if (status === 400) return "bad_request";
  return "upstream_error";
}
export function toMessages(input) {
  const turns = typeof input === "string" ? [{ role: "user", content: input }] : input;
  const out = [];
  turns.forEach((t) => {
    const c = String(t.content || "");
    if (!c) return;
    const last = out[out.length - 1];
    if (last && last.role === t.role) last.content += "\n\n" + c;
    else out.push({ role: t.role, content: c });
  });
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}
export async function readSSE(res, onData) {
  const reader = res.body.getReader(),
    dec = new TextDecoder();
  let buf = "";
  const flush = (ev) => {
    const data = ev
      .split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim())
      .join("");
    if (!data || data === "[DONE]") return;
    let d;
    try {
      d = JSON.parse(data);
    } catch (_) {
      return;
    }
    onData(d);
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      if (buf.trim()) flush(buf);
      break;
    }
    buf += dec.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const ev = buf.slice(0, i);
      buf = buf.slice(i + 2);
      flush(ev);
    }
  }
}
export async function errFrom(res) {
  let msg = "",
    extra = "";
  try {
    const j = await res.json();
    const e = Array.isArray(j) ? j[0]?.error : j.error;
    msg = e?.message || "";
    extra = e?.code || e?.status || e?.type || "";
    if (e?.details) extra += " " + JSON.stringify(e.details);
  } catch (_) {}
  return { code: mapErr(res.status, msg, extra), message: msg, status: res.status };
}
const REQ = {
  anthropic: (key, model, messages, maxTokens) => ({
    url: "https://api.anthropic.com/v1/messages",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: { model, max_tokens: maxTokens, messages, stream: true },
    parse: (d, st) => {
      if (d.type === "content_block_delta" && d.delta?.type === "text_delta") return d.delta.text;
      if (d.type === "message_delta") st.stop = d.delta?.stop_reason === "max_tokens" ? "len" : st.stop;
      if (d.type === "error") throw { code: mapErr(0, d.error?.message, d.error?.type), message: d.error?.message };
      return "";
    },
  }),
  openai: (key, model, messages, maxTokens, alt) => ({
    url: "https://api.openai.com/v1/chat/completions",
    headers: { "content-type": "application/json", authorization: "Bearer " + key },
    body: Object.assign(
      { model, messages, stream: true },
      alt ? { max_tokens: maxTokens } : { max_completion_tokens: maxTokens },
    ),
    parse: (d, st) => {
      if (d.error) throw { code: mapErr(0, d.error.message, d.error.code), message: d.error.message };
      const c = d.choices?.[0];
      if (c?.finish_reason === "length") st.stop = "len";
      return c?.delta?.content || "";
    },
  }),
  gemini: (key, model, messages, maxTokens) => ({
    url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: {
      contents: messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      })),
      generationConfig: { maxOutputTokens: maxTokens },
    },
    parse: (d, st) => {
      if (d.error) throw { code: mapErr(d.error.code, d.error.message, d.error.status), message: d.error.message };
      const c = d.candidates?.[0];
      if (c?.finishReason === "MAX_TOKENS") st.stop = "len";
      if (d.promptFeedback?.blockReason) throw { code: "refused" };
      return (c?.content?.parts || [])
        .filter((p) => !p.thought && p.text)
        .map((p) => p.text)
        .join("");
    },
  }),
};
const RETRYABLE = new Set(["overloaded", "rate_limited"]);
const RETRY_DELAYS = [1000, 3000, 8000];
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject({ code: "cancelled" });
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject({ code: "cancelled" });
      },
      { once: true },
    );
  });
}
/**
 * Create a streaming client for one provider.
 * client(turns, opts) resolves to {text, truncated}; client.json(prompt, opts) resolves to parsed JSON.
 * opts: {signal, onText({text, delta})}. Errors are thrown as {code, message?, text?}.
 */
export function createClient({ provider, key, model }) {
  // Busy or rate-limited providers usually recover within seconds, so retry those before giving up.
  async function call(input, opts = {}) {
    for (let tries = 0; ; tries++) {
      try {
        return await attempt(input, opts);
      } catch (e) {
        if (!RETRYABLE.has(e?.code) || e.text || tries >= RETRY_DELAYS.length) throw e;
        await sleep(Math.max(RETRY_DELAYS[tries], e.retryAfter || 0), opts.signal);
      }
    }
  }
  async function attempt(input, opts = {}, maxTokens = 16000, alt = false) {
    if (!key) throw { code: "no_key" };
    if (!model) throw { code: "model_not_found" };
    const r = REQ[provider](key, model, toMessages(input), maxTokens, alt);
    let res;
    try {
      res = await fetch(r.url, {
        method: "POST",
        signal: opts.signal,
        headers: r.headers,
        body: JSON.stringify(r.body),
      });
    } catch (e) {
      throw { code: e?.name === "AbortError" ? "cancelled" : "network", message: String(e) };
    }
    if (!res.ok) {
      const e = await errFrom(res);
      e.retryAfter = Math.min(+res.headers.get("retry-after") * 1000 || 0, 20000);
      if (
        provider === "openai" &&
        !alt &&
        /max_completion_tokens/i.test(e.message) &&
        /unsupported|not supported|unrecognized/i.test(e.message)
      )
        return attempt(input, opts, maxTokens, true);
      if (e.code === "bad_request" && maxTokens > 8192 && /token/i.test(e.message))
        return attempt(input, opts, 8192, alt);
      throw e;
    }
    let text = "";
    const st = { stop: null };
    try {
      await readSSE(res, (d) => {
        const t = r.parse(d, st);
        if (t) {
          text += t;
          opts.onText && opts.onText({ text, delta: t });
        }
      });
    } catch (e) {
      if (e?.name === "AbortError") throw { code: "cancelled", text };
      throw e?.code ? Object.assign(e, { text }) : { code: "upstream_error", text };
    }
    if (!text.trim()) throw { code: st.stop === "len" ? "truncated_empty" : "empty_completion" };
    return { text, truncated: st.stop === "len" };
  }
  const fn = (input, opts) => call(input, opts);
  fn.json = async (input, opts = {}) => {
    const withRule =
      typeof input === "string"
        ? input + "\n\nRespond with only the JSON value. No prose before or after it, no code fences."
        : input;
    const r = await call(withRule, opts);
    const v = parseJsonLoose(r.text);
    if (v === undefined) throw { code: "invalid_json", text: r.text };
    return v;
  };
  return fn;
}
export async function listModels(provider, key) {
  let r;
  const H = {
    anthropic: {
      url: "https://api.anthropic.com/v1/models?limit=100",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
    },
    openai: { url: "https://api.openai.com/v1/models", headers: { authorization: "Bearer " + key } },
    gemini: {
      url: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000",
      headers: { "x-goog-api-key": key },
    },
  }[provider];
  try {
    r = await fetch(H.url, { headers: H.headers });
  } catch (e) {
    throw { code: "network" };
  }
  if (!r.ok) throw await errFrom(r);
  const j = await r.json();
  if (provider === "anthropic") return (j.data || []).map((m) => ({ id: m.id, name: m.display_name || m.id }));
  if (provider === "openai") {
    const skip =
      /(audio|realtime|tts|transcribe|embedding|image|search|dall-e|whisper|moderation|instruct|babbage|davinci|computer-use|codex)/i;
    return (j.data || [])
      .filter((m) => /^(gpt-|o\d|chatgpt-)/i.test(m.id) && !skip.test(m.id))
      .sort((a, b) => (b.created || 0) - (a.created || 0))
      .map((m) => ({ id: m.id, name: m.id }));
  }
  const skip = /(embedding|image|tts|audio|live|aqa|vision|native-audio)/i;
  return (j.models || [])
    .filter(
      (m) =>
        (m.supportedGenerationMethods || []).includes("generateContent") &&
        /gemini/i.test(m.name) &&
        !skip.test(m.name),
    )
    .map((m) => ({ id: m.name.replace(/^models\//, ""), name: m.displayName || m.name }))
    .sort((a, b) => b.id.localeCompare(a.id, undefined, { numeric: true }));
}
export function preferModel(provider, models) {
  const by = (re) => models.find((m) => re.test(m.id));
  if (provider === "anthropic") return by(/sonnet/i) || models[0];
  if (provider === "openai") return by(/^gpt-\d(\.\d+)?$/i) || by(/^gpt-\d/i) || models[0];
  return by(/^gemini-[\d.]+-flash$/i) || by(/flash(?!.*(lite|preview|exp))/i) || by(/flash/i) || models[0];
}
