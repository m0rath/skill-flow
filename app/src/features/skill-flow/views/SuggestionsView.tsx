import { useMemo } from "react";

import { localChecks } from "@/model/checks";
import { index } from "@/model/normalize";
import { useSkillStore } from "@/features/skill-flow/store";
import { useAIStore } from "@/store/ai";
import type { Suggestion } from "@/model/types";

const RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };
const sortS = (list: Suggestion[]) => list.slice().sort((a, b) => (RANK[a.sev] ?? 3) - (RANK[b.sev] ?? 3));

function SugCard({ s }: { s: Suggestion }) {
  const goTo = useSkillStore((s) => s.goTo);
  const dismissSuggestion = useSkillStore((s) => s.dismissSuggestion);
  const fixSuggestion = useSkillStore((s) => s.fixSuggestion);
  const askSuggestion = useSkillStore((s) => s.askSuggestion);
  const client = useAIStore((s) => s.client);
  const node = s.nodeId ? index.get(s.nodeId) : undefined;
  return (
    <div className={`card ${s.sev}`}>
      <div className="meta">
        <span className={`sev ${s.sev}`}>{s.sev}</span>
        <span className="cat">{s.cat}</span>
        {node ? (
          <button type="button" className="stepref" onClick={() => goTo(node.id, "diagram")}>
            step {node.num}
          </button>
        ) : null}
      </div>
      <h4>{s.title}</h4>
      {s.whatIf ? <p className="whatif">{s.whatIf}</p> : null}
      {s.suggestion ? <p className="fix">{s.suggestion}</p> : null}
      <div className="acts">
        {client ? (
          <>
            <button className="btn sm primary" type="button" onClick={() => fixSuggestion(s)}>
              Fix in file
            </button>
            <button className="btn sm" type="button" onClick={() => askSuggestion(s)}>
              Discuss
            </button>
          </>
        ) : null}
        <button className="btn sm ghost" type="button" onClick={() => dismissSuggestion(s.id)}>
          Dismiss
        </button>
      </div>
    </div>
  );
}

// Look up a node by id using the store's model tree.
export function SuggestionsView() {
  const files = useSkillStore((s) => s.files);
  const model = useSkillStore((s) => s.model);
  const sugg = useSkillStore((s) => s.sugg);
  const busy = useSkillStore((s) => s.busy);
  const error = useSkillStore((s) => s.error);
  const runSuggestions = useSkillStore((s) => s.runSuggestions);
  const stopAll = useSkillStore((s) => s.stopAll);
  const setSettingsOpen = useAIStore((s) => s.setSettingsOpen);
  const client = useAIStore((s) => s.client);

  const local = useMemo(() => localChecks({ files, model, dismissed: sugg.dismissed }), [files, model, sugg.dismissed]);
  const cl = useMemo(() => (sugg.claude || []).filter((s) => !sugg.dismissed.includes(s.id)), [sugg]);

  return (
    <div className="scroll">
      <div className="sugg">
        <div className="sugg-head">
          <p>
            Gaps in the workflow: conditions with only one path ("if it's there… but what if it isn't?"), missing
            failure handling, unclear loops and missing files. Fixes go through the chat, so you can see each change
            before keeping it.
          </p>
          {client ? (
            <>
              <button className="btn primary" type="button" onClick={() => void runSuggestions()} disabled={busy.sugg}>
                {sugg.claude ? "Review again with AI" : "Find gaps with AI"}
              </button>
              {busy.sugg && (
                <button className="btn" type="button" onClick={stopAll}>
                  Stop
                </button>
              )}
            </>
          ) : (
            <button className="btn primary" type="button" onClick={() => setSettingsOpen(true)}>
              Add an API key to use AI's review
            </button>
          )}
        </div>
        {error ? (
          <div className="err" role="alert" style={{ margin: "0 0 10px" }}>
            {error}
          </div>
        ) : null}
        {sugg.stale && sugg.claude ? (
          <p className="empty" style={{ margin: 0 }}>
            The file changed since AI's review. Run it again for fresh results.
          </p>
        ) : null}

        <h3>
          Quick checks <span className="badge n">{local.length}</span>
        </h3>
        {local.length ? (
          <div className="cards">
            {sortS(local).map((s) => (
              <SugCard key={s.id} s={s} />
            ))}
          </div>
        ) : (
          <p className="empty">No structural gaps found by the quick checks.</p>
        )}

        <h3>
          AI review <span className="badge n">{cl.length}</span>
        </h3>
        {sugg.claude ? (
          cl.length ? (
            <div className="cards">
              {sortS(cl).map((s) => (
                <SugCard key={s.id} s={s} />
              ))}
            </div>
          ) : (
            <p className="empty">No open items.</p>
          )
        ) : (
          <p className="empty">
            {client
              ? busy.sugg
                ? "AI is reviewing the workflow…"
                : "AI reads the whole file and lists what could go wrong: unhandled cases, missing validation, ambiguous steps and outputs nobody uses."
              : "Add an API key (Anthropic, OpenAI or Gemini) in AI settings to use this."}
          </p>
        )}
      </div>
    </div>
  );
}
