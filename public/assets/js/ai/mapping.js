import { errCopy } from "./errors.js";
import { mapPrompt } from "./prompts.js";
import { openSettingsIfNeeded } from "./settings.js";
import { $ } from "../lib/dom.js";
import { index, normalize, numIndex } from "../model/normalize.js";
import { quickParse } from "../model/quick-parse.js";
import { S, ai, save } from "../state.js";
import { renderAll } from "../ui/render.js";
import { setStatus, showErr } from "../ui/status.js";

let mapCtl = null;
export async function analyze(afterEdit) {
  if (!ai.client) return;
  mapCtl?.abort();
  mapCtl = new AbortController();
  const my = mapCtl;
  showErr("");
  setStatus("busy", afterEdit ? "File changed · AI is redrawing the map…" : "AI is reading the file…");
  $("aiBtn").disabled = true;
  $("stopBtn").hidden = false;
  try {
    const data = await ai.client.json(mapPrompt(S.files), {
      signal: my.signal,
      onText: ({ text }) => {
        if (my === mapCtl) setStatus("busy", `AI is mapping the flow… ${(text.length / 1000).toFixed(1)}k chars`);
      },
    });
    if (my !== mapCtl) return;
    if (!data || !Array.isArray(data.steps) || !data.steps.length) throw { code: "invalid_json" };
    const prevNum = S.sel && index.get(S.sel)?.num;
    S.rawModel = data;
    S.model = normalize(data);
    S.mode = "claude";
    S.sel = (prevNum && numIndex.get(prevNum)) || null;
    S.chatScope = S.chatScope && S.sel;
    S.collapsed.clear();
    setStatus("claude", afterEdit ? "Map updated by AI" : "Mapped by AI");
    renderAll();
    save();
  } catch (e) {
    if (my !== mapCtl) return;
    const code = e?.code;
    if (afterEdit) {
      S.rawModel = null;
      S.model = normalize(quickParse(S.files));
      S.mode = "quick";
      renderAll();
      save();
    }
    if (code === "cancelled") setStatus("quick", "Quick map (AI stopped)");
    else {
      setStatus("quick", "Quick map");
      showErr(errCopy(code, "AI mapping failed. The quick map is shown; you can try again."));
      openSettingsIfNeeded(code);
    }
  } finally {
    if (my === mapCtl) {
      $("aiBtn").disabled = false;
      $("stopBtn").hidden = true;
    }
  }
}
export function initMapping() {
  $("aiBtn").onclick = () => analyze();
  $("stopBtn").onclick = () => mapCtl?.abort();
}
