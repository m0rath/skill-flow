import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import { usePrefersReducedMotion } from "@/hooks/useMediaQuery";

type MockMode = "skill" | "project";

interface MockStep {
  num: string;
  text: string;
  gap?: boolean;
}

const DATA: Record<MockMode, { steps: MockStep[]; sug: string; added: string; note: string; done: string }> = {
  skill: {
    steps: [
      { num: "01", text: "Read PR diff & commit messages" },
      { num: "02", text: "Run test suite and linter checks" },
      { num: "03", text: "CI failure has no retry or notification rule", gap: true },
      { num: "04", text: "Post review summary & approve PR" },
    ],
    sug: "add retry rule and Slack alert if CI check fails",
    added: "Retry CI pipeline & alert on failure",
    note: "Step added to playbook. Review edits in Changes tab.",
    done: "✓ Step added to playbook. Review edits in Changes tab.",
  },
  project: {
    steps: [
      { num: "01", text: "POST /api/orders (Express Route)" },
      { num: "02", text: "authMiddleware & validateOrderPayload" },
      { num: "03", text: "Unhandled Stripe 504 Gateway Timeout", gap: true },
      { num: "04", text: "db.orders.insert() & sendReceiptEmail()" },
    ],
    sug: "wrap stripeClient.charge() with retry + idempotency key",
    added: "Catch Stripe timeout with idempotent retry",
    note: "Error handler inserted in route. Review edits in Changes tab.",
    done: "✓ Error handler inserted in route. Review edits in Changes tab.",
  },
};

/** The interactive product mockup on the landing hero. */
export function HeroMockup() {
  const [mode, setMode] = useState<MockMode>("skill");
  const [resolved, setResolved] = useState<null | "accepted" | "kept">(null);
  const [added, setAdded] = useState(false);
  const reduce = usePrefersReducedMotion();
  const d = DATA[mode];

  const pick = (m: MockMode) => {
    setMode(m);
    setResolved(null);
    setAdded(false);
  };

  return (
    <div className="mockup-window">
      <div className="mockup-header">
        <div className="mockup-tabs" role="tablist" aria-label="Example tool">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "skill"}
            className={"m-tab" + (mode === "skill" ? " active" : "")}
            onClick={() => pick("skill")}
          >
            SKILL FLOW
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "project"}
            className={"m-tab" + (mode === "project" ? " active" : "")}
            onClick={() => pick("project")}
          >
            PROJECT FLOW
          </button>
        </div>
      </div>

      <div className="mockup-steps">
        {d.steps.map((s, i) => {
          const isGapStep = s.gap && !added;
          return (
            <motion.div
              key={mode + s.num}
              className={"m-step" + (isGapStep ? " gap-step" : "")}
              initial={reduce ? false : { opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, delay: reduce ? 0 : i * 0.05 }}
            >
              <span className="m-num">{s.num}</span>
              <span className="m-text">{s.gap && added ? d.added : s.text}</span>
              {s.gap && (
                <span className="badge-gap" style={added ? { background: "var(--make, #3A7419)" } : undefined}>
                  {added ? "ADDED" : "GAP"}
                </span>
              )}
            </motion.div>
          );
        })}
      </div>

      <div className="mockup-ai-box">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={resolved ?? "ask"}
            initial={reduce ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? undefined : { opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
          >
            {resolved === "accepted" ? (
              <p className="m-ai-msg" style={{ color: "var(--make, #3A7419)", fontWeight: 600, margin: 0 }}>
                {d.done}
              </p>
            ) : resolved === "kept" ? (
              <p className="m-ai-msg" style={{ color: "var(--muted)", margin: 0 }}>
                Suggestion kept as note. You keep final say over every change.
              </p>
            ) : (
              <>
                <p className="m-ai-msg">
                  <span className="pink-highlight">AI suggests:</span> {d.sug}
                </p>
                <div className="m-ai-actions">
                  <button
                    type="button"
                    className="btn-m-accept"
                    onClick={() => {
                      setAdded(true);
                      setResolved("accepted");
                    }}
                  >
                    Accept
                  </button>
                  <button type="button" className="btn-m-keep" onClick={() => setResolved("kept")}>
                    Keep mine
                  </button>
                </div>
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
