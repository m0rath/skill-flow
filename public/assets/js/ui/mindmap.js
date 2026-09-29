import { sendChat, setScope } from "../ai/chat.js";
import { $ } from "../lib/dom.js";
import { esc } from "../lib/util.js";
import { flaggedIds } from "../model/checks.js";
import { ordered } from "../model/normalize.js";
import { S, save } from "../state.js";
import { openChat, select } from "./navigation.js";
import { mView } from "./viewport.js";

const COLW = 240,
  ROW = 50;
let MM = null;
export function mmBuild() {
  const root = { key: "root", label: S.model.title, kind: "root", children: [] };
  const add = (parent, n) => {
    const mm = {
      key: "n:" + n.num,
      id: n.id,
      num: n.num,
      label: n.kind === "decision" ? n.question || n.title : n.title,
      kind: n.kind,
      children: [],
    };
    parent.children.push(mm);
    if (n.branches)
      n.branches.forEach((b) => {
        const bn = {
          key: "b:" + n.num + ":" + b.label,
          id: n.id,
          label: b.label + (b.steps.length ? "" : b.implied ? " · not described" : " · continue"),
          kind: "branch",
          implied: b.implied,
          children: [],
        };
        mm.children.push(bn);
        b.steps.forEach((s) => add(bn, s));
      });
    if (n.steps) n.steps.forEach((s) => add(mm, s));
    if (S.mmOpts.out)
      n.creates.forEach((c) =>
        mm.children.push({ key: "o:" + n.num + ":" + c.name, id: n.id, label: c.name, kind: "out", children: [] }),
      );
    if (S.mmOpts.use)
      n.uses.forEach((u) =>
        mm.children.push({ key: "u:" + n.num + ":" + u, id: n.id, label: u, kind: "use", children: [] }),
      );
  };
  S.model.steps.forEach((n) => add(root, n));
  const leaves = (mm) => (mm.leaves = mm.children.length ? mm.children.reduce((a, c) => a + leaves(c), 0) : 1);
  leaves(root);
  const total = root.leaves;
  let acc = 0;
  root.children.forEach((c) => {
    c.side = acc < total / 2 ? 1 : -1;
    acc += c.leaves;
  });
  const place = (mm, depth, side, y0) => {
    mm.side = side;
    mm.ax = side * depth * COLW;
    mm.ay = y0 + (mm.leaves * ROW) / 2;
    let y = y0;
    mm.children.forEach((c) => {
      place(c, depth + 1, side, y);
      y += c.leaves * ROW;
    });
  };
  [1, -1].forEach((side) => {
    const kids = root.children.filter((c) => c.side === side);
    const h = kids.reduce((a, c) => a + c.leaves, 0) * ROW;
    let y = -h / 2;
    kids.forEach((c) => {
      place(c, 1, side, y);
      y += c.leaves * ROW;
    });
  });
  root.ax = 0;
  root.ay = 0;
  root.side = 1;
  const list = [];
  (function w(mm, parent) {
    mm.parent = parent;
    list.push(mm);
    mm.children.forEach((c) => w(c, mm));
  })(root, null);
  list.forEach((mm) => {
    const p = S.mmPos[mm.key];
    mm.x = p ? p.x : mm.ax;
    mm.y = p ? p.y : mm.ay;
  });
  return { root, list, byKey: new Map(list.map((m) => [m.key, m])) };
}
export function renderMindmap() {
  MM = mmBuild();
  const xs = MM.list.map((m) => m.x),
    ys = MM.list.map((m) => m.y);
  const minX = Math.min(...xs) - 180,
    minY = Math.min(...ys) - 60,
    maxX = Math.max(...xs) + 180,
    maxY = Math.max(...ys) + 60;
  MM.ox = -minX;
  MM.oy = -minY;
  const layer = $("mLayer");
  layer.style.width = maxX - minX + "px";
  layer.style.height = maxY - minY + "px";
  const flags = flaggedIds();
  layer.innerHTML =
    `<svg class="mm-svg" id="mSvg" width="${maxX - minX}" height="${maxY - minY}"></svg>` +
    MM.list
      .map((m) => {
        const cls = [
          "mm-node",
          m.kind,
          m.implied ? "implied" : "",
          m.id && S.sel === m.id && m.kind !== "out" && m.kind !== "use" && m.kind !== "branch" ? "sel" : "",
        ].join(" ");
        const num = m.num ? `<span class="num">${esc(m.num)}</span>` : "";
        const flag =
          m.id && flags.has(m.id) && m.key.startsWith("n:")
            ? ' <span style="color:var(--danger);font-weight:700">!</span>'
            : "";
        return `<div class="${cls}" data-key="${esc(m.key)}" style="left:${m.x + MM.ox}px;top:${m.y + MM.oy}px">${num}${esc(m.label)}${flag}<span class="dot ${m.side < 0 ? "l" : "r"}" data-dot="${esc(m.key)}" title="Drag to another box to connect"></span></div>`;
      })
      .join("") +
    S.links
      .map(
        (l, i) =>
          `<div class="mm-lchip${S.mmLink === i ? " sel" : ""}" data-link="${i}">${esc(l.label || "link")}</div>`,
      )
      .join("");
  layer.querySelectorAll(".mm-node").forEach((el) => {
    const m = MM.byKey.get(el.dataset.key);
    if (m) {
      m.el = el;
      m.w = el.offsetWidth;
      m.h = el.offsetHeight;
    }
  });
  mmDrawEdges();
  $("mAsk").disabled = !S.links.length;
  renderLinkBar();
}
export function edgePt(m, toward) {
  const cx = m.x + MM.ox,
    cy = m.y + MM.oy,
    dx = toward.x - cx,
    dy = toward.y - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  const s = Math.min((m.w / 2 + 4) / Math.abs(dx || 1e-6), (m.h / 2 + 4) / Math.abs(dy || 1e-6));
  return { x: cx + dx * s, y: cy + dy * s };
}
export function curve(a, b) {
  const mx = (a.x + b.x) / 2,
    my = (a.y + b.y) / 2,
    dx = b.x - a.x,
    dy = b.y - a.y,
    len = Math.hypot(dx, dy) || 1;
  const off = Math.min(60, len * 0.2);
  const cx = mx - (dy / len) * off,
    cy = my + (dx / len) * off;
  return {
    d: `M${a.x},${a.y} Q${cx},${cy} ${b.x},${b.y}`,
    mid: { x: (a.x + 2 * cx + b.x) / 4, y: (a.y + 2 * cy + b.y) / 4 },
  };
}
export function dataFlows() {
  const res = [],
    seen = new Set();
  const nodes = ordered();
  nodes.forEach((p) =>
    p.creates.forEach((c) => {
      const nm = c.name.toLowerCase(),
        base = nm.split("/").pop();
      nodes.forEach((q) => {
        if (q === p) return;
        const hay = (q.uses.join(" ") + " " + q.source + " " + q.detail).toLowerCase();
        if (q.uses.some((u) => u.toLowerCase() === nm) || (base.length > 5 && hay.includes(base))) {
          const k = p.id + ">" + q.id;
          if (!seen.has(k)) {
            seen.add(k);
            res.push({ from: p, to: q, name: c.name });
          }
        }
      });
    }),
  );
  return res;
}
export function mmDrawEdges() {
  if (!MM) return;
  const svg = $("mSvg");
  let h = `<defs><marker id="arDf" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0L10,5L0,10z"/></marker><marker id="arUl" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0L10,5L0,10z"/></marker></defs>`;
  MM.list.forEach((m) => {
    if (!m.parent) return;
    const p = m.parent,
      side = m.x >= p.x ? 1 : -1;
    const a = { x: p.x + MM.ox + (side * p.w) / 2, y: p.y + MM.oy },
      b = { x: m.x + MM.ox - (side * m.w) / 2, y: m.y + MM.oy };
    const dx = (b.x - a.x) / 2;
    h += `<path class="t" d="M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}"/>`;
  });
  if (S.mmOpts.flow)
    dataFlows().forEach((f) => {
      const from = MM.byKey.get("o:" + f.from.num + ":" + f.name) || MM.byKey.get("n:" + f.from.num),
        to = MM.byKey.get("n:" + f.to.num);
      if (!from || !to || !from.w || !to.w) return;
      const a = edgePt(from, { x: to.x + MM.ox, y: to.y + MM.oy }),
        b = edgePt(to, { x: from.x + MM.ox, y: from.y + MM.oy });
      h += `<path class="df" d="${curve(a, b).d}" marker-end="url(#arDf)"/>`;
    });
  S.links.forEach((l, i) => {
    const from = MM.byKey.get(l.from),
      to = MM.byKey.get(l.to),
      chip = document.querySelector(`[data-link="${i}"]`);
    if (!from || !to || !from.w || !to.w) {
      if (chip) chip.hidden = true;
      return;
    }
    const a = edgePt(from, { x: to.x + MM.ox, y: to.y + MM.oy }),
      b = edgePt(to, { x: from.x + MM.ox, y: from.y + MM.oy }),
      c = curve(a, b);
    h += `<path class="ul${S.mmLink === i ? " sel" : ""}" d="${c.d}" marker-end="url(#arUl)"/><path class="hit" data-link="${i}" d="${c.d}"/>`;
    if (chip) {
      chip.hidden = false;
      chip.style.left = c.mid.x + "px";
      chip.style.top = c.mid.y + "px";
    }
  });
  svg.innerHTML = h + `<path class="tmp" id="mTmp" d=""/>`;
}
export function mmName(key) {
  const m = MM && MM.byKey.get(key);
  if (!m) return key;
  return (m.num ? m.num + " " : "") + m.label;
}
export function renderLinkBar() {
  const l = S.links[S.mmLink];
  $("linkBar").hidden = !l;
  if (!l) return;
  $("linkDesc").textContent = `${mmName(l.from)} → ${mmName(l.to)}`;
  if (document.activeElement !== $("linkLabel")) $("linkLabel").value = l.label || "";
}
export function initMindmap() {
  const layer = $("mLayer");
  let op = null;
  layer.addEventListener("pointerdown", (e) => {
    const dot = e.target.closest("[data-dot]");
    const node = e.target.closest(".mm-node");
    if (!node && !dot) return;
    e.stopPropagation();
    layer.setPointerCapture(e.pointerId);
    const m = MM.byKey.get((dot || node).dataset.dot || node.dataset.key);
    if (dot) {
      op = { type: "link", m };
      m.el.classList.add("linksrc");
    } else op = { type: "drag", m, sx: e.clientX, sy: e.clientY, ox: m.x, oy: m.y, moved: false };
  });
  layer.addEventListener("pointermove", (e) => {
    if (!op) return;
    if (op.type === "drag") {
      const dx = (e.clientX - op.sx) / mView.st.k,
        dy = (e.clientY - op.sy) / mView.st.k;
      if (!op.moved && Math.hypot(dx, dy) < 4) return;
      op.moved = true;
      op.m.x = op.ox + dx;
      op.m.y = op.oy + dy;
      op.m.el.style.left = op.m.x + MM.ox + "px";
      op.m.el.style.top = op.m.y + MM.oy + "px";
      mmDrawEdges();
    } else {
      const p = mView.toLayer(e.clientX, e.clientY),
        a = { x: op.m.x + MM.ox, y: op.m.y + MM.oy };
      $("mTmp").setAttribute("d", `M${a.x},${a.y} L${p.x},${p.y}`);
    }
  });
  const end = (e) => {
    if (!op) return;
    const o = op;
    op = null;
    if (o.type === "drag") {
      if (o.moved) {
        S.mmPos[o.m.key] = { x: o.m.x, y: o.m.y };
        save();
      } else if (o.m.id) {
        select(o.m.id);
      }
    } else {
      o.m.el.classList.remove("linksrc");
      $("mTmp").setAttribute("d", "");
      const t = document.elementFromPoint(e.clientX, e.clientY)?.closest(".mm-node");
      if (t && t.dataset.key !== o.m.key) {
        S.links.push({ from: o.m.key, to: t.dataset.key, label: "" });
        S.mmLink = S.links.length - 1;
        save();
        renderMindmap();
        setTimeout(() => $("linkLabel").focus(), 0);
      }
    }
  };
  layer.addEventListener("pointerup", end);
  layer.addEventListener("pointercancel", end);
  layer.addEventListener("click", (e) => {
    const l = e.target.closest("[data-link]");
    if (l) {
      S.mmLink = +l.dataset.link;
      renderMindmap();
    }
  });
  $("mVp").addEventListener("click", (e) => {
    const l = e.target.closest(".hit");
    if (l) {
      S.mmLink = +l.dataset.link;
      renderMindmap();
    }
  });
  $("linkLabel").addEventListener("input", (e) => {
    const l = S.links[S.mmLink];
    if (!l) return;
    l.label = e.target.value;
    const chip = document.querySelector(`[data-link="${S.mmLink}"]`);
    if (chip) chip.textContent = l.label || "link";
    save();
  });
  $("linkDel").onclick = () => {
    S.links.splice(S.mmLink, 1);
    S.mmLink = null;
    save();
    renderMindmap();
  };
  $("linkClose").onclick = () => {
    S.mmLink = null;
    renderMindmap();
  };
  $("linkAsk").onclick = () => {
    const l = S.links[S.mmLink];
    if (!l) return;
    setScope(null);
    openChat();
    sendChat(
      `In the mind map I connected "${mmName(l.from)}" to "${mmName(l.to)}"${l.label ? ` with the label "${l.label}"` : ""}. How are these related in the workflow? Is this dependency stated clearly in the file, and is anything missing?`,
    );
  };
  $("mAsk").onclick = () => {
    if (!S.links.length) return;
    setScope(null);
    openChat();
    sendChat(
      "I drew these connections in the mind map:\n" +
        S.links.map((l) => `- ${mmName(l.from)} → ${mmName(l.to)}${l.label ? ` (${l.label})` : ""}`).join("\n") +
        "\nExplain how each pair is related, whether the file states it clearly, and what is missing.",
    );
  };
  $("mOuts").onclick = (e) => {
    S.mmOpts.out = !S.mmOpts.out;
    e.currentTarget.setAttribute("aria-pressed", S.mmOpts.out);
    renderMindmap();
  };
  $("mUses").onclick = (e) => {
    S.mmOpts.use = !S.mmOpts.use;
    e.currentTarget.setAttribute("aria-pressed", S.mmOpts.use);
    renderMindmap();
  };
  $("mFlow").onclick = (e) => {
    S.mmOpts.flow = !S.mmOpts.flow;
    e.currentTarget.setAttribute("aria-pressed", S.mmOpts.flow);
    mmDrawEdges();
  };
  $("mReset").onclick = () => {
    S.mmPos = {};
    save();
    renderMindmap();
    mView.fitMin(0.6, document.querySelector('#mLayer [data-key="root"]'));
  };
  $("mFit").onclick = () => mView.fit("all");
  $("mZ").title = "Ctrl + scroll to zoom";
  $("mIn").onclick = () => mView.zoomBy(1.2);
  $("mOut").onclick = () => mView.zoomBy(1 / 1.2);
}
