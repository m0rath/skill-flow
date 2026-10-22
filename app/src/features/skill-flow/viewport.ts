import { useCallback, useEffect, useRef, useState } from "react";

export interface Transform {
  x: number;
  y: number;
  k: number;
}

export interface ViewportControls {
  /** Zoom by a factor around the viewport centre. */
  zoomBy: (factor: number) => void;
  /** Fit the inner element: "width" keeps the top visible, "all" centres it. */
  fit: (mode: "width" | "all") => void;
  /** Fit but never below minK, centring on `el` when it does not fit fully. */
  fitMin: (minK: number, el?: HTMLElement | null) => void;
  /** Bring an element into the middle of the viewport. */
  centerOn: (el?: HTMLElement | null) => void;
  /** Map client (screen) coordinates to the inner layer's coordinate space. */
  toLayer: (clientX: number, clientY: number) => { x: number; y: number };
  getTransform: () => Transform;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Pan (drag / scroll), zoom (Ctrl + scroll, pinch, buttons) and fit for a transformed inner element.
 * Owns no React state for the transform (it would cause a re-render per frame); it mutates styles directly
 * and mirrors only the zoom percentage into React state for the label.
 */
export function useViewport(opts: { max?: number; min?: number } = {}) {
  const { max = 2.5, min = 0.2 } = opts;
  const vpRef = useRef<HTMLDivElement | null>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const [zoom, setZoom] = useState(100);
  const st = useRef<Transform>({ x: 0, y: 0, k: 1 });
  const animT = useRef<number | null>(null);

  const apply = useCallback(() => {
    const inner = innerRef.current;
    if (inner) inner.style.transform = `translate(${st.current.x}px,${st.current.y}px) scale(${st.current.k})`;
    setZoom(Math.round(st.current.k * 100));
  }, []);

  const animate = useCallback(() => {
    const inner = innerRef.current;
    if (!inner) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    inner.classList.add("anim");
    if (animT.current) window.clearTimeout(animT.current);
    animT.current = window.setTimeout(() => {
      inner.classList.remove("anim");
      animT.current = null;
    }, 300);
  }, []);

  // Clear a pending transition class timer if the view unmounts mid-animation.
  useEffect(
    () => () => {
      if (animT.current) window.clearTimeout(animT.current);
      animT.current = null;
    },
    [],
  );

  const zoomTo = useCallback(
    (k: number, cx: number, cy: number) => {
      k = clamp(k, min, max);
      const c = st.current;
      c.x = cx - (cx - c.x) * (k / c.k);
      c.y = cy - (cy - c.y) * (k / c.k);
      c.k = k;
      apply();
    },
    [apply, max, min],
  );

  const zoomBy = useCallback(
    (f: number) => {
      const vp = vpRef.current;
      if (!vp) return;
      const r = vp.getBoundingClientRect();
      zoomTo(st.current.k * f, r.width / 2, r.height / 2);
    },
    [zoomTo],
  );

  const fit = useCallback(
    (mode: "width" | "all") => {
      const vp = vpRef.current;
      const inner = innerRef.current;
      if (!vp || !inner) return false;
      const r = vp.getBoundingClientRect();
      const w = inner.offsetWidth;
      const h = inner.offsetHeight;
      if (!w || !r.width) return false;
      const kw = (r.width - 24) / w;
      const kh = (r.height - 24) / h;
      const c = st.current;
      c.k = clamp(mode === "all" ? Math.min(kw, kh) : kw, min, 1);
      c.x = (r.width - w * c.k) / 2;
      c.y = mode === "all" ? Math.max(12, (r.height - h * c.k) / 2) : 12;
      animate();
      apply();
      return true;
    },
    [animate, apply, min],
  );

  const centerOn = useCallback(
    (el?: HTMLElement | null) => {
      const vp = vpRef.current;
      if (!el || !vp) return;
      const r = vp.getBoundingClientRect();
      const b = el.getBoundingClientRect();
      if (!r.width) return;
      const c = st.current;
      c.x += r.left + r.width / 2 - (b.left + b.width / 2);
      c.y += r.top + r.height / 2 - (b.top + b.height / 2);
      animate();
      apply();
    },
    [animate, apply],
  );

  const fitMin = useCallback(
    (minK: number, el?: HTMLElement | null) => {
      const vp = vpRef.current;
      const inner = innerRef.current;
      if (!vp || !inner) return false;
      const r = vp.getBoundingClientRect();
      const w = inner.offsetWidth;
      const h = inner.offsetHeight;
      if (!w || !r.width) return false;
      const c = st.current;
      const all = Math.min((r.width - 24) / w, (r.height - 24) / h);
      c.k = Math.max(minK, Math.min(1, (r.width - 24) / w, (r.height - 24) / h));
      c.x = (r.width - w * c.k) / 2;
      c.y = (r.height - h * c.k) / 2;
      apply();
      if (el && c.k > all) centerOn(el);
      else animate();
      return true;
    },
    [animate, apply, centerOn],
  );

  const toLayer = useCallback((clientX: number, clientY: number) => {
    const vp = vpRef.current;
    if (!vp) return { x: 0, y: 0 };
    const r = vp.getBoundingClientRect();
    const c = st.current;
    return { x: (clientX - r.left - c.x) / c.k, y: (clientY - r.top - c.y) / c.k };
  }, []);

  useEffect(() => {
    const vp = vpRef.current;
    if (!vp) return;
    const pointers = new Map<number, { x: number; y: number }>();
    let drag: { x: number; y: number; sx: number; sy: number } | null = null;
    let pinch: { d: number; k: number } | null = null;

    const blocked = (t: EventTarget | null) =>
      (t as HTMLElement | null)?.closest?.(
        "button,input,textarea,select,.node,.loophead,.parhead,.mm-node,.mm-lchip,.hit,.folded",
      );

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || blocked(e.target)) return;
      vp.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        drag = { x: e.clientX, y: e.clientY, sx: st.current.x, sy: st.current.y };
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, k: st.current.k };
        drag = null;
      }
      vp.classList.add("grabbing");
    };

    const onMove = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const r = vp.getBoundingClientRect();
        zoomTo(
          (pinch.k * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.d,
          (a.x + b.x) / 2 - r.left,
          (a.y + b.y) / 2 - r.top,
        );
      } else if (drag) {
        const c = st.current;
        c.x = drag.sx + e.clientX - drag.x;
        c.y = drag.sy + e.clientY - drag.y;
        apply();
      }
    };

    const end = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (!pointers.size) {
        drag = null;
        vp.classList.remove("grabbing");
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = vp.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        zoomTo(st.current.k * Math.exp(-e.deltaY * 0.0022), e.clientX - r.left, e.clientY - r.top);
      } else {
        const c = st.current;
        c.x -= e.shiftKey ? e.deltaY : e.deltaX;
        c.y -= e.shiftKey ? 0 : e.deltaY;
        apply();
      }
    };

    vp.addEventListener("pointerdown", onDown);
    vp.addEventListener("pointermove", onMove);
    vp.addEventListener("pointerup", end);
    vp.addEventListener("pointercancel", end);
    vp.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      vp.removeEventListener("pointerdown", onDown);
      vp.removeEventListener("pointermove", onMove);
      vp.removeEventListener("pointerup", end);
      vp.removeEventListener("pointercancel", end);
      vp.removeEventListener("wheel", onWheel);
      // Unmounting mid-drag must not leave pointer capture or the grabbing cursor behind.
      pointers.forEach((_, id) => {
        try {
          if (vp.hasPointerCapture(id)) vp.releasePointerCapture(id);
        } catch {
          /* the pointer is already gone */
        }
      });
      pointers.clear();
      drag = null;
      pinch = null;
      vp.classList.remove("grabbing");
    };
  }, [apply, zoomTo]);

  const controls: ViewportControls = {
    zoomBy,
    fit,
    fitMin,
    centerOn,
    toLayer,
    getTransform: () => ({ ...st.current }),
  };

  return { vpRef, innerRef, zoom, controls };
}
