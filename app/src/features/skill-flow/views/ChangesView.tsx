import { useMemo, useState, type ReactElement } from "react";

import { diffLines, diffStats, hunks, unifiedDiff, type DiffOp } from "@/lib/diff";
import { useSkillStore } from "@/features/skill-flow/store";
import { offerDownload } from "@/features/skill-flow/files";
import { useAppStore } from "@/store/app";

interface Change {
  path: string;
  before: string;
  after: string;
  ops: DiffOp[];
  added: number;
  removed: number;
}

export function ChangesView() {
  const files = useSkillStore((s) => s.files);
  const original = useSkillStore((s) => s.original);
  const title = useSkillStore((s) => s.model.title);
  const restoreOriginal = useSkillStore((s) => s.restoreOriginal);
  const toast = useAppStore((s) => s.toast);
  const [busy, setBusy] = useState(false);

  const changes = useMemo<Change[]>(() => {
    const now = files.filter((f) => !f.virtual);
    const paths = [...new Set([...original.map((f) => f.path), ...now.map((f) => f.path)])];
    return paths
      .map((path) => {
        const before = original.find((f) => f.path === path)?.text ?? "";
        const after = now.find((f) => f.path === path)?.text ?? "";
        if (before === after) return null;
        const ops = diffLines(before, after);
        return { path, before, after, ops, ...diffStats(ops) };
      })
      .filter(Boolean) as Change[];
  }, [files, original]);

  const patchText = () => changes.map((c) => unifiedDiff(c.path, c.before, c.after)).join("");

  const row = (o: DiffOp, k: number) => {
    const cls = o.type === "add" ? "add" : o.type === "del" ? "del" : "eq";
    const sign = cls === "add" ? "+" : cls === "del" ? "−" : "";
    return (
      <tr className={cls} key={k}>
        <td className="ln">{o.a ?? ""}</td>
        <td className="ln">{o.b ?? ""}</td>
        <td className="sign" aria-hidden="true">
          {sign}
        </td>
        <td className="code">{o.text || " "}</td>
      </tr>
    );
  };

  const copyDiff = async () => {
    setBusy(true);
    try {
      await navigator.clipboard.writeText(patchText());
      toast("Diff copied");
    } catch {
      toast("Could not copy. Use Download .patch instead.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="scroll">
      <div className="sugg">
        <div className="chg-head">
          <p>
            Everything that changed since the file was loaded: your edits in Source and the AI fixes you applied from
            the chat. Undo steps back one change at a time.
          </p>
          {changes.length > 0 && (
            <div className="acts">
              <button className="btn sm" type="button" onClick={copyDiff} disabled={busy}>
                Copy diff
              </button>
              <button
                className="btn sm"
                type="button"
                onClick={() =>
                  offerDownload(
                    (title || "skill").replace(/[^\w.-]+/g, "-") + ".patch",
                    new Blob([patchText()], { type: "text/x-diff;charset=utf-8" }),
                  )
                }
              >
                Download .patch
              </button>
            </div>
          )}
        </div>
        {!changes.length && (
          <p className="empty">
            No changes yet. Edit the file in the Source tab, or ask the AI chat to fix something, and the difference
            shows up here.
          </p>
        )}
        {changes.map((c) => {
          const canRestore = original.some((f) => f.path === c.path);
          return (
            <section className="chg-file" key={c.path}>
              <div className="chg-title">
                <span className="mono">{c.path}</span>
                <span className="add">+{c.added}</span>
                <span className="del">−{c.removed}</span>
                <span style={{ flex: 1 }} />
                {canRestore && (
                  <button className="btn sm ghost" type="button" onClick={() => restoreOriginal(c.path)}>
                    Restore original
                  </button>
                )}
              </div>
              <table className="chg-diff">
                <tbody>
                  {hunks(c.ops).map((ops, i) => (
                    <HunkRows key={i} ops={ops} first={i === 0} row={row} />
                  ))}
                </tbody>
              </table>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function HunkRows({ ops, first, row }: { ops: DiffOp[]; first: boolean; row: (o: DiffOp, k: number) => ReactElement }) {
  return (
    <>
      {!first && (
        <tr className="gap">
          <td colSpan={4}>⋯</td>
        </tr>
      )}
      {ops.map((o, k) => row(o, k))}
    </>
  );
}
