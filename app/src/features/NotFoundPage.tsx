import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <div className="wrap">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <main id="main-content" className="hub" tabIndex={-1}>
        <section className="landing-section" style={{ paddingTop: 96 }}>
          <div className="section-header">
            <span className="eyebrow-tag">404</span>
            <h1 className="section-title">This page does not exist.</h1>
            <p className="section-desc">The tool you are looking for may have moved.</p>
          </div>
          <div className="hero-cta-group">
            <Link className="btn-pink" to="/">
              Back to the hub
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
