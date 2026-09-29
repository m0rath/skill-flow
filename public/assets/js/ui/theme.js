import { store } from "../lib/dom.js";

const THEME_KEY = "skillflow:theme";
const root = () => document.documentElement;
const systemDark = () => matchMedia("(prefers-color-scheme: dark)").matches;

/** Apply the saved theme (if any) and wire the toggle button. */
export function initTheme(button) {
  const saved = store.get(THEME_KEY);
  if (saved === "light" || saved === "dark") root().setAttribute("data-theme", saved);
  button.onclick = () => {
    const cur = root().getAttribute("data-theme");
    const next = (cur ? cur === "dark" : systemDark()) ? "light" : "dark";
    root().setAttribute("data-theme", next);
    store.set(THEME_KEY, next);
  };
}
