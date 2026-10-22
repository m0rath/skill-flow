import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import { useDialog } from "@/components/a11y";
import {
  captureImage,
  nextFrames,
  shotFilename,
  type ShotFormat,
  type ShotOptions,
} from "@/features/skill-flow/export";
import { offerDownload } from "@/features/skill-flow/files";
import { useSkillStore } from "@/features/skill-flow/store";
import { usePrefersReducedMotion } from "@/hooks/useMediaQuery";

export function PasteModal() {
  const open = useSkillStore((s) => s.pasteOpen);
  const setOpen = useSkillStore((s) => s.setPasteOpen);
  const loadText = useSkillStore((s) => s.loadText);
  const [text, setText] = useState("");
  const reduce = usePrefersReducedMotion();
  const dialogRef = useDialog(open, () => setOpen(false));

  useEffect(() => {
    if (open) setText("");
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="modal"
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={reduce ? { duration: 0 } : { duration: 0.15 }}
          onClick={(e) => e.target === e.currentTarget && setOpen(false)}
        >
          <motion.div
            ref={dialogRef}
            className="box"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pasteTitle"
            tabIndex={-1}
            initial={reduce ? false : { opacity: 0, y: 10, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.99 }}
            transition={reduce ? { duration: 0 } : { duration: 0.18, ease: "easeOut" }}
          >
            <strong id="pasteTitle">Paste Markdown</strong>
            <textarea
              data-autofocus
              aria-label="Markdown to map"
              placeholder="Paste the contents of a SKILL.md or any Markdown workflow here"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <div className="row">
              <button className="btn" type="button" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button
                className="btn primary"
                type="button"
                disabled={!text.trim()}
                onClick={() => {
                  setOpen(false);
                  loadText(text);
                }}
              >
                Map workflow
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function ShotModal({ getElement }: { getElement: () => HTMLElement | null }) {
  const shot = useSkillStore((s) => s.shot);
  const closeShot = useSkillStore((s) => s.closeShot);
  const model = useSkillStore((s) => s.model);
  const setExportMode = useSkillStore((s) => s.setExportMode);
  const [opts, setOpts] = useState<ShotOptions>({ format: "png", scale: 2, background: "light", header: true });
  const [expand, setExpand] = useState(true);
  const [flags, setFlags] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const reduce = usePrefersReducedMotion();
  // Do not let Escape or a backdrop click dismiss the dialog mid-render.
  const dialogRef = useDialog(shot.open, closeShot, { closeOnEscape: !busy });

  useEffect(() => {
    if (shot.open) setMsg("");
  }, [shot.open]);

  const view = shot.view;

  const run = async (copy: boolean) => {
    const el = getElement();
    if (!el) {
      setMsg("Nothing to capture yet.");
      return;
    }
    setBusy(true);
    setMsg(copy ? "Copying…" : "Rendering…");
    setExportMode({ expand, flags });
    await nextFrames();
    try {
      const target = getElement() || el;
      const format: ShotFormat = copy ? "png" : opts.format;
      const blob = await captureImage(
        target,
        { ...opts, format },
        {
          title: model.title,
          summary: model.summary,
          legend:
            view === "mindmap"
              ? ["Structure", "Data passes (auto)", "Your links"]
              : view === "flows"
                ? ["Part", "Data store", "External service", "Result sent back"]
                : view === "arch"
                  ? ["Component", "Depends on", "Back edge"]
                  : ["Step", "Decision", "Repeat", "Output"],
        },
      );
      if (copy) {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        setMsg("Copied to the clipboard.");
      } else {
        offerDownload(shotFilename(model.title, view, opts.format), blob);
        setMsg("Downloaded.");
      }
    } catch {
      setMsg(
        copy
          ? "Couldn't copy the image. Use Download instead."
          : "Couldn't render the image. Try a lower quality setting.",
      );
    } finally {
      setExportMode(null);
      setBusy(false);
    }
  };

  return (
    <AnimatePresence>
      {shot.open && (
        <motion.div
          className="modal"
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={reduce ? { duration: 0 } : { duration: 0.15 }}
          onClick={(e) => e.target === e.currentTarget && !busy && closeShot()}
        >
          <motion.div
            ref={dialogRef}
            className="box"
            role="dialog"
            aria-modal="true"
            aria-labelledby="shotTitle"
            aria-busy={busy}
            tabIndex={-1}
            style={{ width: "min(520px, 100%)" }}
            initial={reduce ? false : { opacity: 0, y: 10, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.99 }}
            transition={reduce ? { duration: 0 } : { duration: 0.18, ease: "easeOut" }}
          >
            <strong id="shotTitle">Save as image</strong>
            <p className="empty" style={{ margin: 0 }}>
              The whole{" "}
              {view === "mindmap"
                ? "mind map"
                : view === "flows"
                  ? "flow"
                  : view === "arch"
                    ? "architecture"
                    : "diagram"}{" "}
              is saved, not just the visible part.
            </p>
            <div className="shot-opts">
              <span>Format</span>
              <span className="seg">
                <label>
                  <input
                    type="radio"
                    name="shotFmt"
                    checked={opts.format === "png"}
                    onChange={() => setOpts((o) => ({ ...o, format: "png" }))}
                  />
                  PNG
                </label>
                <label>
                  <input
                    type="radio"
                    name="shotFmt"
                    checked={opts.format === "jpeg"}
                    onChange={() => setOpts((o) => ({ ...o, format: "jpeg" }))}
                  />
                  JPEG
                </label>
                <label>
                  <input
                    type="radio"
                    name="shotFmt"
                    checked={opts.format === "svg"}
                    onChange={() => setOpts((o) => ({ ...o, format: "svg" }))}
                  />
                  SVG
                </label>
              </span>
              <span>Quality</span>
              <span className="seg">
                <label>
                  <input
                    type="radio"
                    name="shotScale"
                    checked={opts.scale === 1}
                    onChange={() => setOpts((o) => ({ ...o, scale: 1 }))}
                  />
                  Standard
                </label>
                <label>
                  <input
                    type="radio"
                    name="shotScale"
                    checked={opts.scale === 2}
                    onChange={() => setOpts((o) => ({ ...o, scale: 2 }))}
                  />
                  Sharp (2×)
                </label>
                <label>
                  <input
                    type="radio"
                    name="shotScale"
                    checked={opts.scale === 3}
                    onChange={() => setOpts((o) => ({ ...o, scale: 3 }))}
                  />
                  Print (3×)
                </label>
              </span>
              <span>Colors</span>
              <span className="seg">
                <label>
                  <input
                    type="radio"
                    name="shotBg"
                    checked={opts.background === "light"}
                    onChange={() => setOpts((o) => ({ ...o, background: "light" }))}
                  />
                  Light, for documents
                </label>
                <label>
                  <input
                    type="radio"
                    name="shotBg"
                    checked={opts.background === "current"}
                    onChange={() => setOpts((o) => ({ ...o, background: "current" }))}
                  />
                  Current theme
                </label>
              </span>
              <span />
              <label className="toggle" style={{ color: "var(--ink)" }}>
                <input
                  type="checkbox"
                  checked={opts.header}
                  onChange={(e) => setOpts((o) => ({ ...o, header: e.target.checked }))}
                />{" "}
                Add title, summary, date and legend
              </label>
              {view === "diagram" && (
                <>
                  <span />
                  <label className="toggle" style={{ color: "var(--ink)" }}>
                    <input type="checkbox" checked={expand} onChange={(e) => setExpand(e.target.checked)} /> Expand
                    collapsed branches
                  </label>
                </>
              )}
              <span />
              <label className="toggle" style={{ color: "var(--ink)" }}>
                <input type="checkbox" checked={flags} onChange={(e) => setFlags(e.target.checked)} /> Show gap markers
                (!)
              </label>
            </div>
            <div className="msgline" role="status" aria-live="polite" style={{ fontSize: 13, minHeight: "1.2em" }}>
              {msg}
            </div>
            <div className="row">
              <button className="btn" type="button" onClick={closeShot} disabled={busy}>
                Cancel
              </button>
              <button className="btn" type="button" onClick={() => void run(true)} disabled={busy}>
                Copy to clipboard
              </button>
              <button className="btn primary" type="button" onClick={() => void run(false)} disabled={busy}>
                Download
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
