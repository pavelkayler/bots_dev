import { createBrowserRouter, Navigate } from "react-router-dom";
import { DashboardPage } from "../../pages/dashboard/DashboardPage";
import { UniversePage } from "../../pages/universe/UniversePage";
import { OptimizerPage } from "../../pages/optimizer/OptimizerPage";
import { BotsPage } from "../../pages/bots/BotsPage";
import { SignalBotPage } from "../../pages/signalBot/SignalBotPage";
import { ROUTER_FUTURE_FLAGS } from "./futureFlags";

const OI_MOMENTUM_BOT_ID = "oi-momentum-v1";

export const router = createBrowserRouter(
  [
    { path: "/", element: <DashboardPage /> },
    { path: "/universe", element: <UniversePage /> },
    { path: "/oimomentum", element: <BotsPage /> },
    { path: "/bots", element: <Navigate to="/oimomentum" replace /> },
    { path: "/signal-bot", element: <SignalBotPage /> },
    { path: "/optimizer", element: <OptimizerPage forcedBotId={OI_MOMENTUM_BOT_ID} hideBotSelectors title="OI Momentum Optimizer" /> },
    { path: "*", element: <Navigate to="/" replace /> }
  ],
  {
    future: ROUTER_FUTURE_FLAGS
  }
);
