import { useEffect } from "react";
import { Navigate, RouterProvider, createBrowserRouter } from "react-router-dom";

import { HubPage } from "@/features/hub/HubPage";
import { NotFoundPage } from "@/features/NotFoundPage";
import { ProjectFlowPage } from "@/features/project-flow/ProjectFlowPage";
import { SkillFlowPage } from "@/features/skill-flow/SkillFlowPage";
import { applyTheme, useAppStore } from "@/store/app";

const router = createBrowserRouter([
  { path: "/", element: <HubPage /> },
  { path: "/skill-flow", element: <SkillFlowPage /> },
  { path: "/project-flow", element: <ProjectFlowPage /> },
  // Legacy URLs from the pre-React app.
  { path: "/skill-flow-mapper", element: <Navigate to="/skill-flow" replace /> },
  { path: "/project-flow-mapper", element: <Navigate to="/project-flow" replace /> },
  { path: "/hub", element: <Navigate to="/" replace /> },
  { path: "*", element: <NotFoundPage /> },
]);

function ThemeManager() {
  const theme = useAppStore((s) => s.theme);
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);
  return null;
}

export function App() {
  return (
    <>
      <ThemeManager />
      <RouterProvider router={router} />
    </>
  );
}
