import { lazy, Suspense, useEffect } from "react";
import { Navigate, Outlet, RouterProvider, createBrowserRouter, useRouteError } from "react-router-dom";

import { ErrorFallback } from "@/components/ErrorBoundary";
import { NotFoundPage } from "@/features/NotFoundPage";
import { applyTheme, useAppStore } from "@/store/app";
import { useAIStore } from "@/store/ai";

// Route pages are code-split: each tool ships in its own chunk and is fetched
// on first visit. Named exports are mapped to the default shape React.lazy wants.
const HubPage = lazy(() => import("@/features/hub/HubPage").then((m) => ({ default: m.HubPage })));
const SkillFlowPage = lazy(() =>
  import("@/features/skill-flow/SkillFlowPage").then((m) => ({ default: m.SkillFlowPage })),
);
const ProjectFlowPage = lazy(() =>
  import("@/features/project-flow/ProjectFlowPage").then((m) => ({ default: m.ProjectFlowPage })),
);

const ROUTE_FALLBACK_CSS = `
.route-loading {
  min-height: 60vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  color: var(--muted);
  font-size: 13px;
}
.route-spinner {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 3px solid var(--line);
  border-top-color: var(--step);
  animation: route-spin 0.75s linear infinite;
}
@keyframes route-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .route-spinner {
    animation-duration: 2s;
  }
}
`;

function RouteFallback() {
  return (
    <div className="route-loading" role="status" aria-live="polite">
      <style>{ROUTE_FALLBACK_CSS}</style>
      <span className="route-spinner" aria-hidden="true" />
      <span>Loading…</span>
    </div>
  );
}

/**
 * Router-level error UI. React Router catches a route's render/loader error
 * before it reaches the root class boundary, so we hand it the same fallback.
 */
function RouteError() {
  const error = useRouteError();
  useEffect(() => {
    console.error("[justools] Route error:", error);
  }, [error]);
  return <ErrorFallback error={error} />;
}

const router = createBrowserRouter([
  {
    element: <Outlet />,
    errorElement: <RouteError />,
    children: [
      { path: "/", element: <HubPage /> },
      { path: "/skill-flow", element: <SkillFlowPage /> },
      { path: "/project-flow", element: <ProjectFlowPage /> },
      // Legacy URLs from the pre-React app.
      { path: "/skill-flow-mapper", element: <Navigate to="/skill-flow" replace /> },
      { path: "/project-flow-mapper", element: <Navigate to="/project-flow" replace /> },
      { path: "/hub", element: <Navigate to="/" replace /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);

function ThemeManager() {
  const theme = useAppStore((s) => s.theme);
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);
  useEffect(() => {
    useAIStore.getState().load();
  }, []);
  return null;
}

export function App() {
  return (
    <>
      <ThemeManager />
      <Suspense fallback={<RouteFallback />}>
        <RouterProvider router={router} />
      </Suspense>
    </>
  );
}
