import { $, prefersReducedMotion } from "../lib/dom.js";

/**
 * Pan (drag, scroll), zoom (Ctrl/Cmd + scroll, pinch, buttons) and fit for a transformed inner element.
 * fit("width" | "all") scales to the viewport; fitMin(minK, el) fits but never below minK, centering on el.
 */
export function makeViewport(vp, inner, zLabel) {
  const st = { x: 0, y: 0, k: 1 };
  const apply = () => {
    inner.style.transform = `translate(${st.x}px,${st.y}px) scale(${st.k})`;
    if (zLabel) zLabel.textContent = Math.round(st.k * 100) + "%";
  };
  const pointers = new Map();
  let drag = null,
    pinch = null;
  const blocked = (t) =>
    t.closest("button,input,textarea,select,.node,.loophead,.parhead,.mm-node,.mm-lchip,.hit,.folded");
  vp.addEventListener("pointerdown", (e) => {
    if (blocked(e.target)) return;
    vp.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) drag = { x: e.clientX, y: e.clientY, sx: st.x, sy: st.y };
    else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, k: st.k };
      drag = null;
    }
    vp.classList.add("grabbing");
  });
  vp.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const r = vp.getBoundingClientRect();
      zoomTo((pinch.k * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.d, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
    } else if (drag) {
      st.x = drag.sx + e.clientX - drag.x;
      st.y = drag.sy + e.clientY - drag.y;
      apply();
    }
  });
  const end = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (!pointers.size) {
      drag = null;
      vp.classList.remove("grabbing");
    }
  };
  vp.addEventListener("pointerup", end);
  vp.addEventListener("pointercancel", end);
  vp.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const r = vp.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) zoomTo(st.k * Math.exp(-e.deltaY * 0.0022), e.clientX - r.left, e.clientY - r.top);
      else {
        st.x -= e.shiftKey ? e.deltaY : e.deltaX;
        st.y -= e.shiftKey ? 0 : e.deltaY;
        apply();
      }
    },
    { passive: false },
  );
  function zoomTo(k, cx, cy) {
    k = Math.max(0.2, Math.min(2.5, k));
    st.x = cx - (cx - st.x) * (k / st.k);
    st.y = cy - (cy - st.y) * (k / st.k);
    st.k = k;
    apply();
  }
  function zoomBy(f) {
    const r = vp.getBoundingClientRect();
    zoomTo(st.k * f, r.width / 2, r.height / 2);
  }
  function fit(mode) {
    const r = vp.getBoundingClientRect(),
      w = inner.offsetWidth,
      h = inner.offsetHeight;
    if (!w || !r.width) return false;
    const kw = (r.width - 24) / w,
      kh = (r.height - 24) / h;
    st.k = Math.max(0.2, Math.min(1, mode === "all" ? Math.min(kw, kh) : kw));
    st.x = (r.width - w * st.k) / 2;
    st.y = mode === "all" ? Math.max(12, (r.height - h * st.k) / 2) : 12;
    animate();
    apply();
    return true;
  }
  function fitMin(minK, el) {
    const r = vp.getBoundingClientRect(),
      w = inner.offsetWidth,
      h = inner.offsetHeight;
    if (!w || !r.width) return false;
    st.k = Math.max(minK, Math.min(1, (r.width - 24) / w, (r.height - 24) / h));
    st.x = (r.width - w * st.k) / 2;
    st.y = (r.height - h * st.k) / 2;
    apply();
    if (el && st.k > Math.min((r.width - 24) / w, (r.height - 24) / h)) centerOn(el);
    else animate();
    return true;
  }
  function animate() {
    if (prefersReducedMotion()) return;
    inner.classList.add("anim");
    clearTimeout(animate._t);
    animate._t = setTimeout(() => inner.classList.remove("anim"), 300);
  }
  function centerOn(el) {
    if (!el) return;
    const r = vp.getBoundingClientRect(),
      b = el.getBoundingClientRect();
    if (!r.width) return;
    st.x += r.left + r.width / 2 - (b.left + b.width / 2);
    st.y += r.top + r.height / 2 - (b.top + b.height / 2);
    animate();
    apply();
  }
  const toLayer = (cx, cy) => {
    const r = vp.getBoundingClientRect();
    return { x: (cx - r.left - st.x) / st.k, y: (cy - r.top - st.y) / st.k };
  };
  apply();
  return { st, apply, zoomBy, fit, fitMin, centerOn, toLayer };
}
export let dView = null,
  mView = null;
export function initViewports() {
  dView = makeViewport($("dVp"), $("dInner"), $("dZ"));
  mView = makeViewport($("mVp"), $("mInner"), $("mZ"));
}
