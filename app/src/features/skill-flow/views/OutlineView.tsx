import type { FlowNode } from "@/model/types";
import { useSkillStore } from "@/features/skill-flow/store";

function OutlineList({ nodes }: { nodes: FlowNode[] }) {
  const goTo = useSkillStore((s) => s.goTo);
  return (
    <ol>
      {nodes.map((n) => {
        if (n.kind === "decision" || n.kind === "parallel")
          return (
            <li key={n.id}>
              <span
                className="o-q"
                role="button"
                tabIndex={0}
                onClick={() => goTo(n.id, "diagram")}
                onKeyDown={(e) => e.key === "Enter" && goTo(n.id, "diagram")}
              >
                {n.num} {n.kind === "parallel" ? "In parallel" : "Decide"}: {n.question || n.title}
              </span>
              <ul>
                {(n.branches || []).map((b) => (
                  <li key={b.label}>
                    <span className={`o-b${b.implied ? " implied" : ""}`}>{b.label}</span> →{" "}
                    {b.steps.length ? (
                      <OutlineList nodes={b.steps} />
                    ) : (
                      <span className="o-meta">{b.implied ? "not described in the file" : "continue"}</span>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          );
        if (n.kind === "loop")
          return (
            <li key={n.id}>
              <span
                className="o-loop"
                role="button"
                tabIndex={0}
                onClick={() => goTo(n.id, "diagram")}
                onKeyDown={(e) => e.key === "Enter" && goTo(n.id, "diagram")}
              >
                {n.num} Repeat: {n.title}
              </span>
              {n.over ? <span className="o-meta"> ({n.over})</span> : null}
              <OutlineList nodes={n.steps || []} />
            </li>
          );
        return (
          <li key={n.id}>
            <span
              className="o-title"
              role="button"
              tabIndex={0}
              onClick={() => goTo(n.id, "diagram")}
              onKeyDown={(e) => e.key === "Enter" && goTo(n.id, "diagram")}
            >
              {n.num} {n.title}
            </span>
            {n.creates.length ? (
              <span className="o-meta">
                {" "}
                → creates{" "}
                {n.creates.map((c, i) => (
                  <span key={c.name}>
                    {i > 0 ? ", " : ""}
                    <span className="mono">{c.name}</span>
                  </span>
                ))}
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

export function OutlineView() {
  const model = useSkillStore((s) => s.model);
  return (
    <div className="scroll outline">
      <h2>{model.title}</h2>
      {model.trigger ? <p className="desc">{model.trigger}</p> : null}
      <OutlineList nodes={model.steps} />
      {model.notes.length > 0 && (
        <>
          <h3>Conventions</h3>
          <ul>
            {model.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
