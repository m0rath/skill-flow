export function errCopy(code, fallback) {
  return (
    {
      rate_limited: "Too many requests right now. Wait a minute and try again.",
      prompt_too_large: "The file is too large for one request. Upload SKILL.md on its own.",
      invalid_json: "AI's answer couldn't be read. Try again.",
      session_expired: "Your session expired. Sign in again, then retry.",
      refused: "AI declined this request.",
      invalid_key: "The API key was rejected. Check it in AI settings.",
      no_key: "Add an API key in AI settings first.",
      overloaded: "AI is still overloaded after a few retries. Wait a minute, or pick another model in AI settings.",
      model_not_found: "That model isn't available for your key. Pick another in AI settings.",
      network:
        "Couldn't reach the AI provider. Check your connection, or the provider may not allow calls from this site.",
      quota: "This key has no credit or quota left. Check billing with your provider.",
      truncated_empty: "The model used its whole output budget before answering. Try a different model.",
      bad_request: "The API rejected the request. Try a different model in AI settings.",
    }[code] || fallback
  );
}
