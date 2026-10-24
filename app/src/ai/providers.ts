import { parseJsonLoose } from "../lib/json";

export type ProviderId = "demo" | "anthropic" | "openai" | "gemini" | "mistral";
/** Providers that use a user-supplied API key. The demo is handled separately by the server proxy. */
export type ByoProviderId = Exclude<ProviderId, "demo">;
export type DemoUpstream = "mistral" | "gemini";

export interface ProviderInfo {
  label: string;
  short: string;
  keyHint: string;
  keyUrl: string;
  keySite: string;
  host: string;
  /** True for the no-key demo backed by the Netlify Function. */
  demo?: boolean;
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  demo: {
    label: "Try the demo (no key)",
    short: "Demo",
    keyHint: "",
    keyUrl: "",
    keySite: "",
    host: "this site",
    demo: true,
  },
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
  mistral: {
    label: "Mistral AI",
    short: "Mistral",
    keyHint: "your Mistral API key",
    keyUrl: "https://console.mistral.ai/api-keys/",
    keySite: "console.mistral.ai",
    host: "api.mistral.ai",
  },
};

/** Models offered by the shared demo. Keep this list small: the server allowlists every ID. */
export const DEMO_MODELS: ModelInfo[] = [
  { id: "mistral-small-2603", name: "Mistral Small 4" },
  { id: "gemini-3.5-flash-lite", name: "Gemini 3.5 Flash-Lite" },
];
export const DEFAULT_DEMO_MODEL = DEMO_MODELS[0].id;
/** The proxy accepts 40–48K-character prompts; leave room for the JSON instruction suffix. */
export const DEMO_MAX_INPUT_CHARS = 60_000;
/** Streaming functions are killed after 60s, so keep the demo output bounded. */
export const DEMO_MAX_OUTPUT_TOKENS = 8_000;

export function demoModelName(model: string): string {
  return DEMO_MODELS.find((m) => m.id === model)?.name || model;
}

export function demoProviderName(model: string): string {
  return demoUpstream(model) === "gemini" ? "Google Gemini" : "Mistral";
}

export function demoUpstream(model: string): DemoUpstream {
  return model.startsWith("gemini-") ? "gemini" : "mistral";
}

export type ErrorCode =
  | "quota"
  | "invalid_key"
  | "rate_limited"
  | "prompt_too_large"
  | "model_not_found"
  | "overloaded"
  | "bad_request"
  | "upstream_error"
  | "cancelled"
  | "network"
  | "no_key"
  | "invalid_json"
  | "empty_completion"
  | "truncated_empty"
  | "refused"
  | "session_expired"
  | "demo_unavailable"
  | "demo_limit";

export interface AIError {
  code: ErrorCode;
  message?: string;
  text?: string;
  retryAfter?: number;
}

export interface Turn {
  role: "user" | "assistant";
  content: string;
}

export interface CallOpts {
  signal?: AbortSignal;
  onText?: (p: { text: string; delta: string }) => void;
}

export interface Client {
  (input: string | Turn[], opts?: CallOpts): Promise<{ text: string; truncated: boolean }>;
  json(input: string | Turn[], opts?: CallOpts): Promise<unknown>;
}

export function mapErr(status: number, msg: string, extra: string): ErrorCode {
  msg = String(msg || "").toLowerCase();
  extra = String(extra || "").toLowerCase();
  // The demo proxy sends these codes so the UI can point people at their own key.
  if (extra.includes("demo_unavailable")) return "demo_unavailable";
  if (extra.includes("demo_limit")) return "demo_limit";
  if (extra.includes("model_not_found")) return "model_not_found";
  if (extra.includes("network")) return "network";
  if (extra.includes("cancelled")) return "cancelled";
  if (
    extra.includes("insufficient_quota") ||
    msg.includes("exceeded your current quota") ||
    msg.includes("credit balance")
  )
    return "quota";
  if (status === 402) return "quota";
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

export function toMessages(input: string | Turn[]): Turn[] {
  const turns: Turn[] = typeof input === "string" ? [{ role: "user", content: input }] : input;
  const out: Turn[] = [];
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

interface StreamState {
  stop: "len" | null;
}

type ParsedEvent = Record<string, unknown>;

async function readSSE(res: Response, onData: (d: ParsedEvent) => void): Promise<void> {
  const body = res.body;
  if (!body) return;
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const flush = (ev: string) => {
    const data = ev
      .split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim())
      .join("");
    if (!data || data === "[DONE]") return;
    let d: ParsedEvent;
    try {
      d = JSON.parse(data) as ParsedEvent;
    } catch {
      return;
    }
    onData(d);
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        if (buf.trim()) flush(buf);
        break;
      }
      buf += dec.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let i: number;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const ev = buf.slice(0, i);
        buf = buf.slice(i + 2);
        flush(ev);
      }
    }
  } finally {
    // Release the stream lock on abort/error too, so the connection can be torn down.
    reader.releaseLock();
  }
}

export async function errFrom(res: Response): Promise<AIError> {
  let msg = "";
  let extra = "";
  try {
    const j = (await res.json()) as unknown;
    type ErrObj = { message?: string; code?: string; status?: string; type?: string; details?: unknown };
    const e: ErrObj | undefined = Array.isArray(j)
      ? ((j[0] as { error?: ErrObj } | undefined)?.error ?? undefined)
      : ((j as { error?: ErrObj }).error ?? undefined);
    msg = e?.message || "";
    extra = e?.code || e?.status || e?.type || "";
    if (e?.details) extra += " " + JSON.stringify(e.details);
  } catch {
    /* body was not JSON */
  }
  return { code: mapErr(res.status, msg, extra), message: msg };
}

interface ReqSpec {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  parse: (d: ParsedEvent, st: StreamState) => string;
}

function parseAnthropic(d: ParsedEvent, st: StreamState): string {
  const dd = d as {
    type?: string;
    delta?: { type?: string; text?: string; stop_reason?: string };
    error?: { message?: string; type?: string };
  };
  if (dd.type === "content_block_delta" && dd.delta?.type === "text_delta") return dd.delta.text || "";
  if (dd.type === "message_delta") st.stop = dd.delta?.stop_reason === "max_tokens" ? "len" : st.stop;
  if (dd.type === "error")
    throw { code: mapErr(0, dd.error?.message || "", dd.error?.type || ""), message: dd.error?.message };
  return "";
}

function parseOpenAI(d: ParsedEvent, st: StreamState): string {
  const dd = d as {
    error?: { message?: string; code?: string };
    choices?: { finish_reason?: string; delta?: { content?: string } }[];
  };
  if (dd.error) throw { code: mapErr(0, dd.error.message || "", dd.error.code || ""), message: dd.error.message };
  const c = dd.choices?.[0];
  if (c?.finish_reason === "length") st.stop = "len";
  return c?.delta?.content || "";
}

function parseGemini(d: ParsedEvent, st: StreamState): string {
  const dd = d as {
    error?: { code?: number; message?: string; status?: string };
    candidates?: { finishReason?: string; content?: { parts?: { thought?: boolean; text?: string }[] } }[];
    promptFeedback?: { blockReason?: string };
  };
  if (dd.error)
    throw {
      code: mapErr(dd.error.code || 0, dd.error.message || "", dd.error.status || ""),
      message: dd.error.message,
    };
  const c = dd.candidates?.[0];
  if (c?.finishReason === "MAX_TOKENS") st.stop = "len";
  if (dd.promptFeedback?.blockReason) throw { code: "refused" };
  return (c?.content?.parts || [])
    .filter((p) => !p.thought && p.text)
    .map((p) => p.text)
    .join("");
}

/** Mistral's chat endpoint is OpenAI-compatible, including its SSE chunks. */
const parseMistral = parseOpenAI;

const REQ: Record<
  ByoProviderId,
  (key: string, model: string, messages: Turn[], maxTokens: number, alt?: boolean) => ReqSpec
> = {
  anthropic: (key, model, messages, maxTokens) => ({
    url: "https://api.anthropic.com/v1/messages",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: { model, max_tokens: maxTokens, messages, stream: true },
    parse: parseAnthropic,
  }),
  openai: (key, model, messages, maxTokens, alt) => ({
    url: "https://api.openai.com/v1/chat/completions",
    headers: { "content-type": "application/json", authorization: "Bearer " + key },
    body: Object.assign(
      { model, messages, stream: true },
      alt ? { max_tokens: maxTokens } : { max_completion_tokens: maxTokens },
    ),
    parse: parseOpenAI,
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
    parse: parseGemini,
  }),
  mistral: (key, model, messages, maxTokens) => ({
    url: "https://api.mistral.ai/v1/chat/completions",
    headers: { "content-type": "application/json", authorization: "Bearer " + key },
    body: { model, messages, stream: true, max_tokens: maxTokens },
    parse: parseMistral,
  }),
};

const RETRYABLE = new Set<ErrorCode>(["overloaded", "rate_limited"]);
const RETRY_DELAYS = [1000, 3000, 8000];

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject({ code: "cancelled" });
    function onAbort() {
      clearTimeout(timer);
      reject({ code: "cancelled" });
    }
    const timer = setTimeout(() => {
      // Drop the listener on the normal path so repeated retries against one signal don't pile up.
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export interface ClientConfig {
  provider: ByoProviderId;
  key: string;
  model: string;
}

/** Add the json() helper shared by direct-provider and demo clients. */
function attachJson(
  call: (input: string | Turn[], opts?: CallOpts) => Promise<{ text: string; truncated: boolean }>,
): Client {
  const fn = ((input: string | Turn[], opts?: CallOpts) => call(input, opts)) as Client;
  fn.json = async (input: string | Turn[], opts: CallOpts = {}) => {
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

/**
 * Create a streaming client for one provider.
 * client(turns, opts) resolves to {text, truncated}; client.json(prompt, opts) resolves to parsed JSON.
 * Errors are thrown as {code, message?, text?}.
 */
export function createClient({ provider, key, model }: ClientConfig): Client {
  async function call(input: string | Turn[], opts: CallOpts = {}): Promise<{ text: string; truncated: boolean }> {
    for (let tries = 0; ; tries++) {
      try {
        return await attempt(input, opts);
      } catch (e) {
        const err = e as AIError;
        if (!RETRYABLE.has(err?.code) || err.text || tries >= RETRY_DELAYS.length) throw e;
        await sleep(Math.max(RETRY_DELAYS[tries], err.retryAfter || 0), opts.signal);
      }
    }
  }

  async function attempt(
    input: string | Turn[],
    opts: CallOpts = {},
    maxTokens = 16000,
    alt = false,
  ): Promise<{ text: string; truncated: boolean }> {
    if (!key) throw { code: "no_key" };
    if (!model) throw { code: "model_not_found" };
    const r = REQ[provider](key, model, toMessages(input), maxTokens, alt);
    let res: Response;
    try {
      res = await fetch(r.url, {
        method: "POST",
        signal: opts.signal,
        headers: r.headers,
        body: JSON.stringify(r.body),
      });
    } catch (e) {
      throw { code: (e as Error)?.name === "AbortError" ? "cancelled" : "network", message: String(e) };
    }
    if (!res.ok) {
      const e = await errFrom(res);
      e.retryAfter = Math.min(Number(res.headers.get("retry-after")) * 1000 || 0, 20000);
      if (
        provider === "openai" &&
        !alt &&
        /max_completion_tokens/i.test(e.message || "") &&
        /unsupported|not supported|unrecognized/i.test(e.message || "")
      )
        return attempt(input, opts, maxTokens, true);
      if (e.code === "bad_request" && maxTokens > 8192 && /token/i.test(e.message || ""))
        return attempt(input, opts, 8192, alt);
      throw e;
    }
    let text = "";
    const st: StreamState = { stop: null };
    try {
      await readSSE(res, (d) => {
        const t = r.parse(d, st);
        if (t) {
          text += t;
          if (opts.onText) opts.onText({ text, delta: t });
        }
      });
    } catch (e) {
      if ((e as Error)?.name === "AbortError") throw { code: "cancelled", text };
      throw (e as AIError)?.code ? Object.assign(e as object, { text }) : { code: "upstream_error", text };
    }
    if (!text.trim()) throw { code: st.stop === "len" ? "truncated_empty" : "empty_completion" };
    return { text, truncated: st.stop === "len" };
  }

  return attachJson(call);
}

/**
 * Streaming client for the shared demo. The hidden provider key and rate limits live in
 * `netlify/functions/demo.mjs`; the browser only talks to the same-origin `/api/demo` route.
 */
export function createDemoClient({ model }: { model: string }): Client {
  async function call(input: string | Turn[], opts: CallOpts = {}): Promise<{ text: string; truncated: boolean }> {
    if (!model) throw { code: "model_not_found" };
    const messages = toMessages(input);
    const chars = messages.reduce((n, m) => n + m.content.length, 0);
    if (chars > DEMO_MAX_INPUT_CHARS) throw { code: "prompt_too_large" };

    let res: Response;
    try {
      res = await fetch("/api/demo", {
        method: "POST",
        signal: opts.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, messages, maxTokens: DEMO_MAX_OUTPUT_TOKENS }),
      });
    } catch (e) {
      throw { code: (e as Error)?.name === "AbortError" ? "cancelled" : "network", message: String(e) };
    }
    if (!res.ok) {
      const e = await errFrom(res);
      // Netlify's platform backstop returns a plain 429. A long Retry-After means the
      // daily budget is gone, not that the provider is briefly busy.
      const wait = Number(res.headers.get("retry-after") || 0);
      if (e.code === "rate_limited" && wait > 120) e.code = "demo_limit";
      // A static-only host may serve its SPA fallback or a generic 404 at this path.
      if (res.status === 404) e.code = "demo_unavailable";
      throw e;
    }
    if (!(res.headers.get("content-type") || "").includes("text/event-stream")) {
      throw { code: "demo_unavailable" };
    }

    // The proxy sets this header so the client can use the same parser as the direct provider.
    const upstream = res.headers.get("x-demo-provider") === "gemini" ? "gemini" : "mistral";
    const parse = upstream === "gemini" ? parseGemini : parseMistral;
    let text = "";
    const st: StreamState = { stop: null };
    try {
      await readSSE(res, (d) => {
        const t = parse(d, st);
        if (t) {
          text += t;
          if (opts.onText) opts.onText({ text, delta: t });
        }
      });
    } catch (e) {
      if ((e as Error)?.name === "AbortError") throw { code: "cancelled", text };
      throw (e as AIError)?.code ? Object.assign(e as object, { text }) : { code: "upstream_error", text };
    }
    if (!text.trim()) throw { code: st.stop === "len" ? "truncated_empty" : "empty_completion" };
    return { text, truncated: st.stop === "len" };
  }

  return attachJson(call);
}

export interface ModelInfo {
  id: string;
  name: string;
}

export async function listModels(provider: ByoProviderId, key: string): Promise<ModelInfo[]> {
  let r: Response;
  const H: { url: string; headers: Record<string, string> } = {
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
    mistral: { url: "https://api.mistral.ai/v1/models", headers: { authorization: "Bearer " + key } },
  }[provider];
  try {
    r = await fetch(H.url, { headers: H.headers });
  } catch {
    throw { code: "network" };
  }
  if (!r.ok) throw await errFrom(r);
  const j = (await r.json()) as {
    data?: { id: string; display_name?: string; created?: number }[];
    models?: { name: string; displayName?: string; supportedGenerationMethods?: string[] }[];
  };
  if (provider === "anthropic") return (j.data || []).map((m) => ({ id: m.id, name: m.display_name || m.id }));
  if (provider === "openai") {
    const skip =
      /(audio|realtime|tts|transcribe|embedding|image|search|dall-e|whisper|moderation|instruct|babbage|davinci|computer-use|codex)/i;
    return (j.data || [])
      .filter((m) => /^(gpt-|o\d|chatgpt-)/i.test(m.id) && !skip.test(m.id))
      .sort((a, b) => (b.created || 0) - (a.created || 0))
      .map((m) => ({ id: m.id, name: m.id }));
  }
  if (provider === "mistral") {
    const skip = /(embed|moderation|ocr|audio|tts|vision|classifier)/i;
    return (j.data || [])
      .filter((m) => !skip.test(m.id))
      .map((m) => ({ id: m.id, name: m.display_name || m.id }))
      .sort((a, b) => a.id.localeCompare(b.id));
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

export function preferModel(provider: ProviderId, models: ModelInfo[]): ModelInfo | undefined {
  const by = (re: RegExp) => models.find((m) => re.test(m.id));
  if (provider === "demo") return by(/^mistral-small/i) || models[0] || DEMO_MODELS[0];
  if (provider === "anthropic") return by(/sonnet/i) || models[0];
  if (provider === "openai") return by(/^gpt-\d(\.\d+)?$/i) || by(/^gpt-\d/i) || models[0];
  if (provider === "mistral")
    return by(/^mistral-small/i) || by(/^mistral-medium/i) || by(/^mistral-large/i) || models[0];
  return by(/^gemini-[\d.]+-flash$/i) || by(/flash(?!.*(lite|preview|exp))/i) || by(/flash/i) || models[0];
}
