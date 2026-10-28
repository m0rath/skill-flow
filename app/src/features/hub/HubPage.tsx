import { useNavigate } from "react-router-dom";

import { AppShell } from "@/components/AppShell";
import { Reveal } from "@/components/Reveal";
import { HeroMockup } from "@/features/hub/HeroMockup";

const TOOLS = [
  {
    id: "skill-flow",
    route: "/skill-flow",
    badge: "AVAILABLE NOW",
    title: "Skill Flow Mapper",
    desc: "Map, question and fix a Claude skill or Markdown playbook. Upload a SKILL.md, any .md file or a zipped skill folder, or paste your text.",
    tags: [
      "Diagram",
      "Mind map",
      "Suggestions",
      "Outline",
      "Source",
      "Changes",
      "Export PNG",
      "Export SVG",
      "Export Mermaid",
      "Download .md",
    ],
    demos: [{ label: "PR Review Playbook", to: "/skill-flow?demo=pr-review" }],
  },
  {
    id: "project-flow",
    route: "/project-flow",
    badge: "AVAILABLE NOW",
    title: "Project Flow Mapper",
    desc: "Open an entire software codebase or .zip archive to understand its architecture and runtime paths. Traces routes and calls with animated data flow diagrams.",
    tags: [
      "Architecture DAG",
      "Sequence Diagram",
      "Animated Runner",
      "Route Tracing",
      "Read with Me Voice",
      "File Inspector",
      "Code AST Index",
      "Export Image",
    ],
    demos: [
      { label: "Order & Checkout API", to: "/project-flow?demo=order-checkout" },
      { label: "Express (GitHub)", to: "/project-flow?demo=express" },
    ],
  },
] as const;

const FEATURES = [
  {
    icon: ">",
    title: "Map",
    text: "See the workflow of any skill, playbook or codebase as a diagram or mind map — with what it creates, what it needs and the rules that apply.",
  },
  {
    icon: "?",
    title: "Question",
    text: "Let AI find where the instructions are vague, missing a step or likely to break. Chat with it, or read its suggestions on your own.",
  },
  {
    icon: "✓",
    title: "Fix",
    text: "Turn a suggestion into an edit, review it in the Changes tab and download the cleaned-up files when you are happy.",
  },
];

const PROCESS = [
  {
    num: "01",
    heading: "You bring the file or project",
    text: "A SKILL.md, a Markdown playbook, a project folder, a .zip or a public GitHub repo.",
  },
  {
    num: "02",
    heading: "AI maps and questions it",
    text: "It draws the workflow or architecture, then flags gaps, vague rules and missing inputs.",
  },
  {
    num: "03",
    heading: "You review every change",
    text: "Suggestions arrive as proposals. Accept, edit or dismiss each one.",
  },
  {
    num: "04",
    heading: "The next run is better",
    text: "Clearer instructions give more reliable AI output, and you can export the result.",
  },
];

export function HubPage() {
  const navigate = useNavigate();

  return (
    <AppShell mode="hub">
      <section className="hub">
        {/* 1. Hero */}
        <div className="landing-hero">
          <div className="hero-left">
            <Reveal as="span" className="eyebrow-tag" y={8}>
              VISUAL TOOLS FOR AI SKILLS &amp; SOFTWARE PROJECTS
            </Reveal>
            <Reveal delay={0.05}>
              <h1 className="hero-title">
                AI drafts.
                <br />
                Humans
                <br />
                <span className="pink-text">decide.</span>
              </h1>
            </Reveal>
            <Reveal delay={0.1}>
              <p className="hero-desc">
                justools turns invisible instructions into visible workflows. Map an AI skill or an entire codebase, let
                AI question what's missing, review every suggestion, and download the result.
              </p>
            </Reveal>
            <Reveal delay={0.15}>
              <div className="hero-cta-group">
                <button type="button" className="btn-pink" onClick={() => navigate("/skill-flow")}>
                  Open Skill Flow →
                </button>
                <button type="button" className="btn-hero-secondary" onClick={() => navigate("/project-flow")}>
                  Open Project Flow →
                </button>
              </div>
            </Reveal>
          </div>
          <Reveal className="hero-right" delay={0.1}>
            <HeroMockup />
          </Reveal>
        </div>

        {/* 2. The tools */}
        <section className="landing-section" id="tools">
          <Reveal className="section-header">
            <span className="eyebrow-tag">THE TOOLS</span>
            <h2 className="section-title">Pick one. More on the way.</h2>
          </Reveal>

          {TOOLS.map((tool, i) => (
            <Reveal key={tool.id} delay={i * 0.05}>
              <div
                className="tool-banner-card"
                style={i ? { marginTop: 24 } : undefined}
                onClick={(e) => {
                  // Pointer convenience: the accessible path is the real Open button below.
                  if ((e.target as HTMLElement).closest(".demo-link, .tool-link-btn")) return;
                  navigate(tool.route);
                }}
              >
                <div className="tool-banner-main">
                  <span className="badge-avail">{tool.badge}</span>
                  <h3 className="tool-banner-title">{tool.title}</h3>
                  <p className="tool-banner-desc">{tool.desc}</p>
                  <button
                    type="button"
                    className="tool-link-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(tool.route);
                    }}
                  >
                    Open {tool.title.split(" ")[0]} →
                  </button>
                  <div className="tool-banner-footer">
                    Or try demo:{" "}
                    {tool.demos.map((demo, di) => (
                      <span key={demo.to}>
                        {di > 0 && " · "}
                        <button
                          type="button"
                          className="demo-link"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(demo.to);
                          }}
                        >
                          {demo.label}
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
                <div className="tool-banner-tags">
                  {tool.tags.map((t) => (
                    <span key={t} className="pill-tag">
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            </Reveal>
          ))}
        </section>

        {/* 3. What justools is */}
        <section className="landing-section" id="what-it-is">
          <Reveal className="section-header">
            <span className="eyebrow-tag">WHAT JUSTOOLS IS</span>
            <h2 className="section-title">AI instructions are hard to see. We make them visible.</h2>
            <p className="section-desc">
              A skill file, a Markdown playbook or even a whole codebase is just text, until something goes wrong. Our
              tools turn that text into something you can look at, challenge and improve.
            </p>
          </Reveal>

          <div className="cards-grid-3">
            {FEATURES.map((f, i) => (
              <Reveal key={f.title} className="feature-card" delay={i * 0.06}>
                <div className="feature-icon-box">
                  <span className="feature-icon">{f.icon}</span>
                </div>
                <h3 className="feature-title">{f.title}</h3>
                <p className="feature-text">{f.text}</p>
              </Reveal>
            ))}
          </div>
        </section>

        {/* 4. How humans make AI better */}
        <section className="landing-section" id="humans-ai">
          <Reveal className="section-header">
            <span className="eyebrow-tag">HOW HUMANS MAKE AI BETTER</span>
            <h2 className="section-title">A loop, not a handoff.</h2>
            <p className="section-desc">
              AI is fast at reading and flagging. People know what the work is actually for. Each round of review makes
              the instructions clearer, and clearer instructions give more reliable AI results.
            </p>
          </Reveal>

          <div className="process-steps-grid">
            {PROCESS.map((p, i) => (
              <Reveal key={p.num} className="process-col" delay={i * 0.06}>
                <div className="process-line" />
                <span className="process-num">{p.num}</span>
                <h4 className="process-heading">{p.heading}</h4>
                <p className="process-text">{p.text}</p>
              </Reveal>
            ))}
          </div>

          <div className="comparison-grid">
            <Reveal className="comparison-card">
              <span className="comp-label">THE AI</span>
              <h3 className="comp-title">Does the heavy reading</h3>
              <ul className="comp-list">
                <li>Draws the workflow as a diagram or mind map</li>
                <li>Spots gaps, vague rules and missing inputs</li>
                <li>Proposes edits and explains why</li>
              </ul>
            </Reveal>
            <Reveal className="comparison-card" delay={0.08}>
              <span className="comp-label">YOU</span>
              <h3 className="comp-title">Keep the final say</h3>
              <ul className="comp-list">
                <li>Pick the AI: use the demo, or bring your own key for Claude, ChatGPT, Gemini or Mistral</li>
                <li>Accept, edit or dismiss every suggestion, or allow automatic fixes</li>
                <li>Own the final file and export it as .md, PNG, SVG or Mermaid</li>
              </ul>
            </Reveal>
          </div>
        </section>

        {/* 5. Bottom CTA */}
        <section className="landing-cta-section">
          <Reveal>
            <h2 className="bottom-cta-title">Bring a file you already have. See what it really says.</h2>
            <div className="hero-cta-group" style={{ justifyContent: "center" }}>
              <button type="button" className="btn-pink" onClick={() => navigate("/skill-flow")}>
                Open Skill Flow →
              </button>
              <button type="button" className="btn-hero-secondary" onClick={() => navigate("/project-flow")}>
                Open Project Flow →
              </button>
            </div>
          </Reveal>
        </section>

        {/* 6. Footer */}
        <footer className="landing-footer">
          <button type="button" className="footer-brand" onClick={() => window.scrollTo({ top: 0 })}>
            justools.in
          </button>
          <span className="footer-tagline">AI drafts. Humans decide.</span>
        </footer>
      </section>
    </AppShell>
  );
}
