import { useMemo } from "react";

import { allCreates, counts } from "@/model/normalize";
import { suggCount } from "@/model/checks";
import { useSkillStore } from "@/features/skill-flow/store";

export function SummaryBar() {
  const model = useSkillStore((s) => s.model);
  const files = useSkillStore((s) => s.files);
  const sugg = useSkillStore((s) => s.sugg);

  // counts() / allCreates() read the module-level node index, which normalize() rebuilds for each model.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const c = useMemo(() => counts(), [model]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const outs = useMemo(() => allCreates().length, [model]);
  const gaps = useMemo(
    () => suggCount({ files, model, dismissed: sugg.dismissed, claude: sugg.claude }),
    [files, model, sugg],
  );

  return (
    <div className="summary">
      <div>
        <span className="eyebrow">Workflow</span>
        <h2>{model.title}</h2>
        {model.summary ? <p className="desc">{model.summary}</p> : null}
        {model.trigger ? (
          <div className="trigger">
            <span className="eyebrow">Runs when</span>
            <span>{model.trigger}</span>
          </div>
        ) : null}
      </div>
      <div className="stats">
        <div className="stat s">
          <b>{c.step}</b>
          <span>steps</span>
        </div>
        <div className="stat d">
          <b>{c.decision}</b>
          <span>decisions</span>
        </div>
        <div className="stat l">
          <b>{c.loop}</b>
          <span>repeats</span>
        </div>
        <div className="stat m">
          <b>{outs}</b>
          <span>outputs</span>
        </div>
        <div className="stat g">
          <b>{gaps}</b>
          <span>possible gaps</span>
        </div>
      </div>
    </div>
  );
}
