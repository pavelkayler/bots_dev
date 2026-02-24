import { createBrowserRouter, Navigate } from "react-router-dom";
import { DashboardPage } from "../../pages/dashboard/DashboardPage";
import { UniversePage } from "../../pages/universe/UniversePage";

export const router = createBrowserRouter(
  [
    { path: "/", element: <DashboardPage /> },
    { path: "/universe", element: <UniversePage /> },
    { path: "*", element: <Navigate to="/" replace /> }
  ],
  {
    future: {
      v7_startTransition: true,
      v7_relativeSplatPath: true
    }
  }
);
