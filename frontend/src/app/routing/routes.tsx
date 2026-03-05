import { createBrowserRouter, Navigate } from "react-router-dom";
import { DashboardPage } from "../../pages/dashboard/DashboardPage";
import { UniversePage } from "../../pages/universe/UniversePage";
import { OptimizerPage } from "../../pages/optimizer/OptimizerPage";
import { ROUTER_FUTURE_FLAGS } from "./futureFlags";

export const router = createBrowserRouter(
  [
    { path: "/", element: <DashboardPage /> },
    { path: "/universe", element: <UniversePage /> },
    { path: "/optimizer", element: <OptimizerPage /> },
    { path: "*", element: <Navigate to="/" replace /> }
  ],
  {
    future: ROUTER_FUTURE_FLAGS
  }
);
