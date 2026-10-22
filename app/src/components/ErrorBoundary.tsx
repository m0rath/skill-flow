import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Error recovery UI shared by the root class boundary and the router's
 * `errorElement`. Uses the legacy design-system classes (`.btn`, `.eyebrow-tag`)
 * so the screen matches the rest of the app, plus a scoped <style> block for
 * its layout. Rendered from either React or React Router, so it stays router-free.
 */

const ERROR_FALLBACK_CSS = `
.eb-root {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--paper);
  color: var(--ink);
}
.eb-card {
  width: min(560px, 100%);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
  padding: 28px 26px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 14px;
  box-shadow: var(--shadow);
}
.eb-title {
  margin: 0;
  font: 700 22px/1.15 var(--cond);
}
.eb-text {
  margin: 0;
  color: var(--muted);
}
.eb-detail {
  margin: 0;
  max-width: 100%;
  overflow: auto;
  padding: 10px 12px;
  background: var(--danger-bg);
  color: var(--danger);
  border-radius: 8px;
  font: 12px/1.5 var(--mono);
  white-space: pre-wrap;
  word-break: break-word;
}
.eb-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 4px;
}
`;

function errorMessage(error: unknown): string | null {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return null;
}

/** Friendly, styled recovery screen. Never throws. */
export function ErrorFallback({ error }: { error: unknown }) {
  const detail = errorMessage(error);
  return (
    <div className="eb-root" role="alert">
      <style>{ERROR_FALLBACK_CSS}</style>
      <div className="eb-card">
        <span className="eyebrow-tag">Unexpected error</span>
        <h1 className="eb-title">Something broke on this page</h1>
        <p className="eb-text">
          An unexpected error stopped this view from rendering. Your files and API settings are saved locally and are
          not affected.
        </p>
        {import.meta.env.DEV && detail && <pre className="eb-detail">{detail}</pre>}
        <div className="eb-actions">
          <button type="button" className="btn primary" onClick={() => window.location.reload()}>
            Reload
          </button>
          <a className="btn" href="/">
            Go to hub
          </a>
        </div>
      </div>
    </div>
  );
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Root error boundary. Wraps the router so a render crash shows the recovery
 * screen instead of a blank page. RouteElement-level crashes are handled by the
 * router's own `errorElement` (see `App.tsx`), which renders the same fallback.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Keep the full stack in the console for debugging / crash reporting.
    console.error("[justools] Unhandled render error:", error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return <ErrorFallback error={error} />;
  }
}
