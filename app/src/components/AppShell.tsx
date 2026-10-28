import { type ReactNode } from "react";

import { DemoBanner } from "@/components/DemoBanner";
import { type AppMode, Header } from "@/components/Header";
import { Toaster } from "@/components/Toaster";
import { GitImportModal } from "@/features/GitImportModal";

/**
 * Layout styles owned by the shell: the skip link and the content landmark.
 * Injected here (rather than in a global stylesheet) so the markup and its
 * styling stay together; every value is a design-system token.
 */
const SHELL_CSS = `
.skip-link {
  position: absolute;
  left: -10000px;
  top: auto;
  width: 1px;
  height: 1px;
  overflow: hidden;
}
.skip-link:focus {
  position: fixed;
  left: 12px;
  top: 12px;
  width: auto;
  height: auto;
  overflow: visible;
  z-index: 100;
  padding: 8px 14px;
  border: 1px solid var(--step);
  border-radius: 8px;
  background: var(--surface);
  color: var(--ink);
  font-size: 13px;
  font-weight: 500;
  box-shadow: var(--shadow);
  text-decoration: none;
}
.app-main {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}
a.brand {
  color: inherit;
  text-decoration: none;
}
.brand .brand-title {
  margin: 0;
  font: 700 20px/1.1 var(--cond);
  letter-spacing: 0.01em;
  color: var(--ink);
}
`;

/**
 * The shared page frame: brand header with tool navigation, the page body and the toast host.
 * Every route renders exactly one AppShell.
 */
export function AppShell({ mode, actions, children }: { mode: AppMode; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="wrap">
      <style>{SHELL_CSS}</style>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <Header mode={mode} actions={actions} />
      {mode !== "hub" && <DemoBanner />}
      <main id="main-content" className="app-main" tabIndex={-1}>
        {children}
      </main>
      <Toaster />
      <GitImportModal />
    </div>
  );
}
