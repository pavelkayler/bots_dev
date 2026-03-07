import { useState } from "react";
import { Button, ButtonGroup, Card, Container } from "react-bootstrap";
import { HeaderBar } from "../dashboard/components/HeaderBar";
import { useWsFeedLite } from "../../features/ws/hooks/useWsFeed";
import { useSessionRuntime } from "../../features/session/hooks/useSessionRuntime";
import { ConfigPanel } from "../../features/config/components/ConfigPanel";
import { BotExecutionSelectors } from "../../features/bots/components/BotExecutionSelectors";
import { ProviderCapabilitiesCard } from "../../features/providers/components/ProviderCapabilitiesCard";
import { OptimizerPage } from "../optimizer/OptimizerPage";
import { useProcessStatus } from "../../features/session/hooks/useProcessStatus";
import { ProcessIndicatorsBar } from "../../features/session/components/ProcessIndicatorsBar";

const OI_MOMENTUM_BOT_ID = "oi-momentum-v1";
type OiMomentumTab = "settings" | "optimizer" | "status";

export function BotsPage() {
  const { conn, lastServerTime, wsUrl, streams } = useWsFeedLite();
  const { status, busy, start, stop, pause, resume, canStart, canStop, canPause, canResume } = useSessionRuntime();
  const { status: processStatus } = useProcessStatus();
  const [tab, setTab] = useState<OiMomentumTab>("settings");

  return (
    <>
      <HeaderBar
        conn={conn}
        sessionState={status.sessionState}
        wsUrl={wsUrl}
        lastServerTime={lastServerTime}
        streams={streams}
        canStart={canStart}
        canStop={canStop}
        busy={busy}
        onStart={() => void start()}
        onStop={() => void stop()}
        onPause={() => void pause()}
        onResume={() => void resume()}
        canPause={canPause}
        canResume={canResume}
      />

      <Container fluid className="py-2 px-2">
        <ProviderCapabilitiesCard botId={OI_MOMENTUM_BOT_ID} title="OI Momentum endpoints availability" />
        <Card>
          <Card.Header className="d-flex align-items-center justify-content-between">
            <b>OI Momentum</b>
            <ButtonGroup size="sm">
              <Button variant={tab === "settings" ? "primary" : "outline-primary"} onClick={() => setTab("settings")}>Settings</Button>
              <Button variant={tab === "optimizer" ? "primary" : "outline-primary"} onClick={() => setTab("optimizer")}>OI Optimizer</Button>
              <Button variant={tab === "status" ? "primary" : "outline-primary"} onClick={() => setTab("status")}>Status</Button>
            </ButtonGroup>
          </Card.Header>
          <Card.Body>
            {tab === "settings" ? (
              <>
                <BotExecutionSelectors allowedBotIds={[OI_MOMENTUM_BOT_ID]} hideBotSelect />
                <ConfigPanel sessionState={status.sessionState} />
              </>
            ) : tab === "optimizer" ? (
              <OptimizerPage embedded forcedBotId={OI_MOMENTUM_BOT_ID} hideBotSelectors title="OI Optimizer" />
            ) : (
              <ProcessIndicatorsBar status={processStatus} />
            )}
          </Card.Body>
        </Card>
      </Container>
    </>
  );
}
