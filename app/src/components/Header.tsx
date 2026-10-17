import { type ReactNode, useCallback } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";

import { BrandMark, HomeIcon, ProjectFlowIcon, SkillFlowIcon } from "@/components/Icons";
import { useAppStore } from "@/store/app";

export type AppMode = "hub" | "skill-flow" | "project-flow";

const BRAND: Record<AppMode, { title: string; desc: string }> = {
  hub: { title: "justools", desc: "AI drafts. Humans decide." },
  "skill-flow": {
    title: "Skill Flow Mapper",
    desc: "Map, question and fix a Claude skill or Markdown playbook.",
  },
  "project-flow": {
    title: "Project Flow Mapper",
    desc: "Open a whole project folder: see its architecture, structure and how it runs, then question and fix it.",
  },
};

const HUBS = [
  { id: "what-it-is", label: "What it is" },
  { id: "humans-ai", label: "Humans + AI" },
];

export function Header({ mode, actions }: { mode: AppMode; actions?: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const toggleTheme = useAppStore((s) => s.toggleTheme);
  const brand = BRAND[mode];

  const onBrand = useCallback(() => {
    if (mode !== "hub" || location.pathname !== "/") {
      navigate("/");
      return;
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [mode, location.pathname, navigate]);

  const gotoSection = useCallback(
    (id: string) => {
      navigate("/");
      // Wait for the hub to render, then scroll to the section.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" })),
      );
    },
    [navigate],
  );

  return (
    <header className="bar">
      <div
        className="brand"
        role="button"
        tabIndex={0}
        title="Back to justools Hub"
        style={{ cursor: "pointer" }}
        onClick={onBrand}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onBrand();
          }
        }}
      >
        <BrandMark />
        <div>
          <h1>{brand.title}</h1>
          <p>{brand.desc}</p>
        </div>
      </div>

      {mode === "hub" && (
        <nav className="hub-nav" aria-label="Sections">
          {HUBS.map((h) => (
            <button key={h.id} type="button" className="hub-nav-link" onClick={() => gotoSection(h.id)}>
              {h.label}
            </button>
          ))}
        </nav>
      )}

      <nav className="mode-nav" aria-label="Tool selection">
        <NavLink to="/" end className={({ isActive }) => "mode-pill" + (isActive ? " active" : "")}>
          <HomeIcon />
          <span>Hub</span>
        </NavLink>
        <NavLink to="/skill-flow" className={({ isActive }) => "mode-pill" + (isActive ? " active" : "")}>
          <SkillFlowIcon />
          <span>Skill Flow</span>
        </NavLink>
        <NavLink to="/project-flow" className={({ isActive }) => "mode-pill" + (isActive ? " active" : "")}>
          <ProjectFlowIcon />
          <span>Project Flow</span>
        </NavLink>
      </nav>

      {actions}

      <button className="btn ghost" id="themeBtn" type="button" onClick={toggleTheme} title="Switch light / dark theme">
        Theme
      </button>
    </header>
  );
}
