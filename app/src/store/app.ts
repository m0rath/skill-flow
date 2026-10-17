import { create } from "zustand";

export type ThemeChoice = "light" | "dark" | null;

const THEME_KEY = "skillflow:theme";

function readTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === "light" || v === "dark") return v;
  } catch {
    /* storage unavailable */
  }
  return null;
}

export interface Toast {
  id: number;
  text: string;
}

interface AppState {
  theme: ThemeChoice;
  toasts: Toast[];
  setTheme: (t: ThemeChoice) => void;
  toggleTheme: () => void;
  toast: (text: string) => void;
  dismissToast: (id: number) => void;
  /** Has the request to open the GitHub import modal, if any. */
  gitModal: { open: boolean; tool: "skill-flow" | "project-flow" };
  openGitModal: (tool: "skill-flow" | "project-flow") => void;
  closeGitModal: () => void;
}

let toastId = 0;

export const useAppStore = create<AppState>((set, get) => ({
  theme: readTheme(),
  toasts: [],
  setTheme: (t) => {
    try {
      if (t) localStorage.setItem(THEME_KEY, t);
      else localStorage.removeItem(THEME_KEY);
    } catch {
      /* ignore */
    }
    set({ theme: t });
  },
  toggleTheme: () => {
    const cur = get().theme;
    const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const next = (cur ? cur === "dark" : systemDark) ? "light" : "dark";
    get().setTheme(next);
  },
  toast: (text) => {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts, { id, text }] }));
    window.setTimeout(() => get().dismissToast(id), 2800);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  gitModal: { open: false, tool: "project-flow" },
  openGitModal: (tool) => set({ gitModal: { open: true, tool } }),
  closeGitModal: () => set((s) => ({ gitModal: { ...s.gitModal, open: false } })),
}));

/** Apply the chosen theme to <html>. Called once on mount and on every change. */
export function applyTheme(theme: ThemeChoice) {
  const root = document.documentElement;
  if (theme) root.setAttribute("data-theme", theme);
  else root.removeAttribute("data-theme");
}
