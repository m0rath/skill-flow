import { parseJsonLoose } from "../lib/json";

export type ProviderId = "anthropic" | "openai" | "gemini";

export interface ProviderInfo {
  label: string;
  short: string;
  keyHint: string;
  keyUrl: string;
  keySite: string;
  host: string;
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
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
  | "session_expired";

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
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
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

const REQ: Record<
  ProviderId,
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
    parse: (d, st) => {
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
      const dd = d as {
        error?: { message?: string; code?: string };
        choices?: { finish_reason?: string; delta?: { content?: string } }[];
      };
      if (dd.error) throw { code: mapErr(0, dd.error.message || "", dd.error.code || ""), message: dd.error.message };
      const c = dd.choices?.[0];
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
    },
  }),
};

const RETRYABLE = new Set<ErrorCode>(["overloaded", "rate_limited"]);
const RETRY_DELAYS = [1000, 3000, 8000];

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
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

export interface ClientConfig {
  provider: ProviderId;
  key: string;
  model: string;
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

export interface ModelInfo {
  id: string;
  name: string;
}

export async function listModels(provider: ProviderId, key: string): Promise<ModelInfo[]> {
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
  if (provider === "anthropic") return by(/sonnet/i) || models[0];
  if (provider === "openai") return by(/^gpt-\d(\.\d+)?$/i) || by(/^gpt-\d/i) || models[0];
  return by(/^gemini-[\d.]+-flash$/i) || by(/flash(?!.*(lite|preview|exp))/i) || by(/flash/i) || models[0];
}
