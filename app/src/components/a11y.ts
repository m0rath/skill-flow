import { useEffect, useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

/**
 * Small, dependency-free accessibility helpers shared by the app's dialogs, tablists
 * and the header. Kept in one place so every overlay behaves the same way.
 */

const FOCUSABLE_SELECTOR =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

function focusable(scope: HTMLElement): HTMLElement[] {
  return Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.getClientRects().length > 0 || el === document.activeElement,
  );
}

/**
 * Modal/dialog accessibility: traps Tab focus, closes on Escape, locks body scroll,
 * moves focus into the dialog on open and restores it to the trigger on close.
 * Attach the returned ref to the dialog element and give it `tabIndex={-1}`.
 * Mark the preferred initial control with `data-autofocus`.
 */
export function useDialog(open: boolean, onClose: () => void, opts: { closeOnEscape?: boolean } = {}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const closeOnEscape = useRef(opts.closeOnEscape ?? true);
  closeOnEscape.current = opts.closeOnEscape ?? true;

  useEffect(() => {
    if (!open) return;
    const node = ref.current;
    const restore = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const initial = node ? (node.querySelector<HTMLElement>("[data-autofocus]") ?? focusable(node)[0] ?? node) : null;
    initial?.focus({ preventScroll: true });

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && closeOnEscape.current) {
        e.preventDefault();
        close.current();
        return;
      }
      if (e.key !== "Tab" || !node) return;
      const list = focusable(node);
      if (!list.length) {
        e.preventDefault();
        node.focus({ preventScroll: true });
        return;
      }
      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === node)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = prevOverflow;
      if (restore && document.contains(restore)) restore.focus({ preventScroll: true });
    };
  }, [open]);

  return ref;
}

/**
 * Arrow-key navigation for a `role="tablist"`. Tabs must carry `data-tab-id`.
 * Selection follows focus: `activate` receives the id of the newly focused tab.
 */
export function tablistKeyDown(e: ReactKeyboardEvent<HTMLElement>, activate: (id: string) => void): void {
  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") return;
  const tabs = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]'));
  const i = tabs.indexOf(e.target as HTMLElement);
  if (i < 0) return;
  e.preventDefault();
  const next =
    e.key === "Home"
      ? 0
      : e.key === "End"
        ? tabs.length - 1
        : e.key === "ArrowRight"
          ? (i + 1) % tabs.length
          : (i - 1 + tabs.length) % tabs.length;
  const el = tabs[next];
  el.focus();
  const id = el.dataset.tabId;
  if (id) activate(id);
}
