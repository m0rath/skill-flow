export const $ = (id) => document.getElementById(id);
export const store = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch (e) {
      return null;
    }
  },
  /** Returns false when the browser refuses to store it (storage full, or disabled in private mode). */
  set(k, v) {
    try {
      localStorage.setItem(k, v);
      return true;
    } catch (e) {
      return false;
    }
  },
};
export const prefersReducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
let toastTimer = null;
export function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2800);
}
