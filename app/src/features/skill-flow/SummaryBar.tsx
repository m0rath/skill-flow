import { useMemo } from "react";

import { allCreates, counts } from "@/model/normalize";
import { suggCount } from "@/model/checks";
import { useSkillStore } from "@/features/skill-flow/store";

const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));

export function SummaryBar() {
  const model = useSkillStore((s) => s.model);
  const files = useSkillStore((s) => s.files);
  const sugg = useSkillStore((s) => s.sugg);
  const appMode = useSkillStore((s) => s.appMode);
  const project = useSkillStore((s) => s.project);
  const flows = useSkillStore((s) => s.flows);
  const notes = useSkillStore((s) => s.notes);
  const isProject = appMode === "project";

  // counts() / allCreates() read the module-level node index, which normalize() rebuilds for each model.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const c = useMemo(() => counts(), [model]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const outs = useMemo(() => allCreates().length, [model]);
  const gaps = useMemo(
    () => suggCount({ files, model, dismissed: sugg.dismissed, claude: sugg.claude }),
    [files, model, sugg],
  );

  if (isProject && project) {
    const openNotes = notes.filter((n) => n.status === "open").length;
    return (
      <div className="summary">
        <div>
          <span className="eyebrow">Project · {project.name}</span>
          <h2>{model.title}</h2>
          {model.summary ? <p className="desc">{model.summary}</p> : null}
          {model.trigger ? (
            <div className="trigger">
              <span className="eyebrow">Used by</span>
              <span>{model.trigger}</span>
            </div>
          ) : null}
        </div>
        <div className="stats">
          <div className="stat s">
            <b>{compact(project.files)}</b>
            <span>files</span>
          </div>
          <div className="stat d">
            <b>{compact(project.lines)}</b>
            <span>lines</span>
          </div>
          <div className="stat m">
            <b>{(model.components || []).length}</b>
            <span>components</span>
          </div>
          <div className="stat l">
            <b>{flows.filter((f) => !f.all).length}</b>
            <span>flows</span>
          </div>
          <div className="stat g">
            <b>{openNotes}</b>
            <span>open notes</span>
          </div>
        </div>
      </div>
    );
  }

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
