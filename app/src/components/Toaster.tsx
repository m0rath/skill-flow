import { AnimatePresence, motion } from "motion/react";

import { usePrefersReducedMotion } from "@/hooks/useMediaQuery";
import { useAppStore } from "@/store/app";

export function Toaster() {
  const toasts = useAppStore((s) => s.toasts);
  const dismiss = useAppStore((s) => s.dismissToast);
  const reduce = usePrefersReducedMotion();
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.button
            key={t.id}
            type="button"
            className="toast"
            title="Dismiss"
            aria-label={`${t.text}. Dismiss`}
            onClick={() => dismiss(t.id)}
            initial={reduce ? false : { opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.98 }}
            transition={reduce ? { duration: 0 } : { duration: 0.18, ease: "easeOut" }}
          >
            {t.text}
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
}
