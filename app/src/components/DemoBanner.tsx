import { useState } from "react";

import { DEFAULT_DEMO_MODEL, demoModelName, demoProviderName } from "@/ai/providers";
import { useAIStore } from "@/store/ai";

const HIDE_KEY = "skillflow:demo-banner";

function wasHidden(): boolean {
  try {
    return sessionStorage.getItem(HIDE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * A deliberately small notice while the shared demo is selected. It names the upstream
 * provider and points at the safer option: the user's own key.
 */
export function DemoBanner() {
  const provider = useAIStore((s) => s.provider);
  const models = useAIStore((s) => s.models);
  const setSettingsOpen = useAIStore((s) => s.setSettingsOpen);
  const [hidden, setHidden] = useState(wasHidden);

  if (provider !== "demo" || hidden) return null;

  const model = models.demo || DEFAULT_DEMO_MODEL;
  const dismiss = () => {
    setHidden(true);
    try {
      sessionStorage.setItem(HIDE_KEY, "1");
    } catch {
      /* storage unavailable */
    }
  };

  return (
    <div className="demo-banner" role="note" aria-label="Demo AI privacy notice">
      <span>
        <strong>Demo AI · {demoModelName(model)}</strong> — prompts go to {demoProviderName(model)} and may be used to
        improve its models. Don&apos;t paste secrets.{" "}
        <button className="linkbtn" type="button" onClick={() => setSettingsOpen(true)}>
          Use your own key
        </button>{" "}
        for private code.
      </span>
      <button className="demo-dismiss" type="button" aria-label="Hide demo notice for this session" onClick={dismiss}>
        ×
      </button>
    </div>
  );
}
