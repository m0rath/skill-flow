import { type ReactNode } from "react";

import { type AppMode, Header } from "@/components/Header";
import { Toaster } from "@/components/Toaster";

/**
 * The shared page frame: brand header with tool navigation, the page body and the toast host.
 * Every route renders exactly one AppShell.
 */
export function AppShell({
  mode,
  actions,
  children,
}: {
  mode: AppMode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="wrap">
      <Header mode={mode} actions={actions} />
      {children}
      <Toaster />
    </div>
  );
}
