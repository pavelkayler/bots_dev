import { useEffect, useMemo, useState } from "react";
import { Badge, Button, ButtonGroup, Card, Col, Container, Row, Table } from "react-bootstrap";
import { HeaderBar } from "../dashboard/components/HeaderBar";
import { useWsFeed } from "../../features/ws/hooks/useWsFeed";
import { useSessionRuntime } from "../../features/session/hooks/useSessionRuntime";
import { useProcessStatus } from "../../features/session/hooks/useProcessStatus";
import { ProcessIndicatorsBar } from "../../features/session/components/ProcessIndicatorsBar";
import { OptimizerPage } from "../optimizer/OptimizerPage";
import { useBotSelections } from "../../features/bots/hooks/useBotSelections";
import { ProviderCapabilitiesCard } from "../../features/providers/components/ProviderCapabilitiesCard";
import { listDatasetHistories, type DatasetHistoryRecord } from "../../features/datasetHistory/api/datasetHistoryApi";
import { SignalFollowTailDatasetCard } from "./SignalFollowTailDatasetCard";
import { setRecorderMode } from "../../features/recorder/api/recorderApi";
import { SignalBotSettingsPanel } from "./SignalBotSettingsPanel";

const SIGNAL_BOT_ID = "signal-multi-factor-v1";
type SignalTab = "live" | "settings" | "optimizer" | "report";

export function SignalBotPage() {
  const { conn, rows, lastServerTime, wsUrl, streams, requestRowsRefresh } = useWsFeed();
  const { status, busy, start, stop, pause, resume, canStart, canStop, canPause, canResume } = useSessionRuntime();
  const { status: processStatus } = useProcessStatus();
  const { selectedBotId, setSelectedBotId } = useBotSelections();
  const [tab, setTab] = useState<SignalTab>("live");
  const [trackingEnabled, setTrackingEnabled] = useState(true);
  const [lastRefreshAt, setLastRefreshAt] = useState<number | null>(null);
  const [datasetHistories, setDatasetHistories] = useState<DatasetHistoryRecord[]>([]);
  const [trackingError, setTrackingError] = useState<string>("");

  useEffect(() => {
    if (!selectedBotId || selectedBotId === SIGNAL_BOT_ID) return;
    void setSelectedBotId(SIGNAL_BOT_ID);
  }, [selectedBotId, setSelectedBotId]);

  useEffect(() => {
    let active = true;
    const fetchHistories = () => {
      void (async () => {
        try {
          const res = await listDatasetHistories();
          if (!active) return;
          setDatasetHistories(Array.isArray(res.histories) ? res.histories : []);
        } catch {
          if (!active) return;
          setDatasetHistories([]);
        }
      })();
    };
    fetchHistories();
    const timer = window.setInterval(fetchHistories, 2000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const signalRows = useMemo(() => (
    rows
      .filter((row) => row.signal === "LONG" || row.signal === "SHORT")
      .sort((a, b) => Number(b.updatedAt ?? 0) - Number(a.updatedAt ?? 0))
  ), [rows]);

  const liveSummary = useMemo(() => {
    let longCount = 0;
    let shortCount = 0;
    for (const row of signalRows) {
      if (row.signal === "LONG") longCount += 1;
      if (row.signal === "SHORT") shortCount += 1;
    }
    return { total: signalRows.length, longCount, shortCount };
  }, [signalRows]);

  const topOiMoveRows = useMemo(() => (
    [...signalRows]
      .sort((a, b) => Math.abs(Number(b.oivMovePct ?? 0)) - Math.abs(Number(a.oivMovePct ?? 0)))
      .slice(0, 10)
  ), [signalRows]);

  const latestHistory = useMemo(() => {
    if (!datasetHistories.length) return null;
    return [...datasetHistories].sort((a, b) => Number(b.receivedAtMs) - Number(a.receivedAtMs))[0] ?? null;
  }, [datasetHistories]);

  const datasetChecks = useMemo(() => {
    if (!latestHistory) return [];
    const missing1mCandlesTotal = Number(latestHistory.manifest?.missing1mCandlesTotal ?? 0);
    const missingFundingPointsTotal = Number(latestHistory.manifest?.missingFundingPointsTotal ?? 0);
    const missingOiPointsTotal = Number(latestHistory.manifest?.missingOi5mPointsTotal ?? 0);
    return [
      {
        id: "candles_1m",
        label: "1m price candles",
        ok: missing1mCandlesTotal === 0,
        detail: missing1mCandlesTotal === 0 ? "ok" : `missing: ${missing1mCandlesTotal}`,
      },
      {
        id: "open_interest",
        label: "Open interest path",
        ok: Boolean(latestHistory.hasOi) && missingOiPointsTotal === 0,
        detail: Boolean(latestHistory.hasOi) && missingOiPointsTotal === 0 ? "ok" : `missing points: ${missingOiPointsTotal}`,
      },
      {
        id: "funding",
        label: "Funding history",
        ok: Boolean(latestHistory.hasFunding) && missingFundingPointsTotal === 0,
        detail: Boolean(latestHistory.hasFunding) && missingFundingPointsTotal === 0 ? "ok" : `missing points: ${missingFundingPointsTotal}`,
      },
    ];
  }, [latestHistory]);

  const missingMetricLabels = useMemo(() => datasetChecks.filter((it) => !it.ok).map((it) => it.label), [datasetChecks]);
  const datasetBaselineReady = useMemo(() => latestHistory != null && missingMetricLabels.length === 0, [latestHistory, missingMetricLabels]);

  useEffect(() => {
    if (!trackingEnabled || !datasetBaselineReady) return;
    const id = window.setInterval(() => {
      requestRowsRefresh("tick");
      setLastRefreshAt(Date.now());
    }, 5_000);
    return () => window.clearInterval(id);
  }, [trackingEnabled, datasetBaselineReady, requestRowsRefresh]);

  useEffect(() => {
    if (!datasetBaselineReady) return;
    void (async () => {
      try {
        await setRecorderMode(trackingEnabled ? "record_only" : "off");
        setTrackingError("");
      } catch (e: any) {
        setTrackingError(String(e?.message ?? e));
      }
    })();
  }, [trackingEnabled, datasetBaselineReady]);

  useEffect(() => {
    if (datasetBaselineReady || !trackingEnabled) return;
    setTrackingEnabled(false);
    void setRecorderMode("off").catch(() => undefined);
  }, [datasetBaselineReady, trackingEnabled]);

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
        canPause={canPause}
        canResume={canResume}
        busy={busy}
        onStart={() => void start()}
        onStop={() => void stop()}
        onPause={() => void pause()}
        onResume={() => void resume()}
      />
      <Container fluid className="py-2 px-2">
        <ProcessIndicatorsBar status={processStatus} />
        <Card className="mb-3">
          <Card.Header className="d-flex align-items-center justify-content-between">
            <b>Signal Bot</b>
            <ButtonGroup size="sm">
              <Button variant={tab === "live" ? "primary" : "outline-primary"} onClick={() => setTab("live")}>Live Signals</Button>
              <Button variant={tab === "settings" ? "primary" : "outline-primary"} onClick={() => setTab("settings")}>Settings</Button>
              <Button variant={tab === "optimizer" ? "primary" : "outline-primary"} onClick={() => setTab("optimizer")}>Signal Bot Optimizer</Button>
              <Button variant={tab === "report" ? "primary" : "outline-primary"} onClick={() => setTab("report")}>Report</Button>
            </ButtonGroup>
          </Card.Header>
          <Card.Body>
            {tab === "live" ? (
              <>
                <ProviderCapabilitiesCard botId={SIGNAL_BOT_ID} title="Signal Bot endpoints availability" />
                <SignalFollowTailDatasetCard />
                <div className="d-flex align-items-center gap-2 mb-2">
                  <Button
                    size="sm"
                    variant={trackingEnabled ? "outline-danger" : "success"}
                    disabled={!datasetBaselineReady}
                    onClick={() => setTrackingEnabled((prev) => !prev)}
                  >
                    {trackingEnabled ? "Stop tracking" : "Start tracking"}
                  </Button>
                  <Badge bg="secondary">update: 5 sec</Badge>
                  <Badge bg="primary">signals: {liveSummary.total}</Badge>
                  <Badge bg="success">long: {liveSummary.longCount}</Badge>
                  <Badge bg="danger">short: {liveSummary.shortCount}</Badge>
                  <span style={{ fontSize: 12, opacity: 0.8 }}>
                    last refresh: {lastRefreshAt ? new Date(lastRefreshAt).toLocaleTimeString() : "-"}
                  </span>
                </div>
                {!datasetBaselineReady ? (
                  <div style={{ fontSize: 12, color: "#b45309", marginBottom: 8 }}>
                    Tracking is locked until baseline dataset is complete. Optimizer uses 1m dataset history; WS updates are used for live/paper monitoring.
                  </div>
                ) : null}
                {trackingError ? (
                  <div style={{ fontSize: 12, color: "#b00020", marginBottom: 8 }}>
                    Recorder mode update failed: {trackingError}
                  </div>
                ) : null}
                <div style={{ overflowX: "auto" }}>
                  <Table size="sm" bordered hover className="mb-0">
                    <thead>
                      <tr>
                        <th>Symbol</th>
                        <th>Signal</th>
                        <th>Price</th>
                        <th>Price move, %</th>
                        <th>OI value</th>
                        <th>OI move, %</th>
                        <th>Funding</th>
                        <th>Reason</th>
                        <th>Updated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {signalRows.length ? signalRows.map((row) => (
                        <tr key={row.symbol}>
                          <td>{row.symbol}</td>
                          <td>
                            <span style={{ color: row.signal === "LONG" ? "#198754" : "#dc3545", fontWeight: 600 }}>
                              {row.signal}
                            </span>
                          </td>
                          <td>{Number(row.markPrice ?? 0).toFixed(6)}</td>
                          <td>{Number(row.priceMovePct ?? 0).toFixed(3)}</td>
                          <td>{Number(row.openInterestValue ?? 0).toFixed(2)}</td>
                          <td style={{ color: Number(row.oivMovePct ?? 0) >= 0 ? "#198754" : "#dc3545" }}>
                            {Number(row.oivMovePct ?? 0).toFixed(3)}
                          </td>
                          <td>{Number(row.fundingRate ?? 0).toFixed(6)}</td>
                          <td>{row.signalReason || "-"}</td>
                          <td>{row.updatedAt ? new Date(row.updatedAt).toLocaleTimeString() : "-"}</td>
                        </tr>
                      )) : (
                        <tr><td colSpan={9} style={{ fontSize: 12, opacity: 0.75 }}>No live signals yet.</td></tr>
                      )}
                    </tbody>
                  </Table>
                </div>
              </>
            ) : null}

            {tab === "settings" ? (
              <SignalBotSettingsPanel sessionState={status.sessionState} />
            ) : null}

            {tab === "optimizer" ? (
              <Card className="mt-1">
                <Card.Header className="py-2"><b>Signal Bot Optimizer</b></Card.Header>
                <Card.Body>
                  <OptimizerPage embedded forcedBotId={SIGNAL_BOT_ID} hideBotSelectors title="Signal Bot Optimizer" />
                </Card.Body>
              </Card>
            ) : null}

            {tab === "report" ? (
              <Row className="g-3">
                <Col md={4} xs={12}>
                  <Card>
                    <Card.Body>
                      <div style={{ fontSize: 12, opacity: 0.8 }}>Total active signals</div>
                      <div style={{ fontSize: 28, fontWeight: 700 }}>{liveSummary.total}</div>
                    </Card.Body>
                  </Card>
                </Col>
                <Col md={4} xs={12}>
                  <Card>
                    <Card.Body>
                      <div style={{ fontSize: 12, opacity: 0.8 }}>Long / Short</div>
                      <div style={{ fontSize: 28, fontWeight: 700 }}>{liveSummary.longCount} / {liveSummary.shortCount}</div>
                    </Card.Body>
                  </Card>
                </Col>
                <Col md={4} xs={12}>
                  <Card>
                    <Card.Body>
                      <div style={{ fontSize: 12, opacity: 0.8 }}>Tracking</div>
                      <div style={{ fontSize: 28, fontWeight: 700 }}>{trackingEnabled ? "ON" : "OFF"}</div>
                    </Card.Body>
                  </Card>
                </Col>
                <Col xs={12}>
                  <Card>
                    <Card.Header className="py-2"><b>Top OI change symbols</b></Card.Header>
                    <Card.Body>
                      <div style={{ overflowX: "auto" }}>
                        <Table size="sm" bordered hover className="mb-0">
                          <thead>
                            <tr>
                              <th>#</th>
                              <th>Symbol</th>
                              <th>Signal</th>
                              <th>OI move, %</th>
                              <th>Price move, %</th>
                              <th>Funding</th>
                            </tr>
                          </thead>
                          <tbody>
                            {topOiMoveRows.length ? topOiMoveRows.map((row, index) => (
                              <tr key={row.symbol}>
                                <td>{index + 1}</td>
                                <td>{row.symbol}</td>
                                <td>{row.signal ?? "-"}</td>
                                <td style={{ color: Number(row.oivMovePct ?? 0) >= 0 ? "#198754" : "#dc3545" }}>
                                  {Number(row.oivMovePct ?? 0).toFixed(3)}
                                </td>
                                <td>{Number(row.priceMovePct ?? 0).toFixed(3)}</td>
                                <td>{Number(row.fundingRate ?? 0).toFixed(6)}</td>
                              </tr>
                            )) : (
                              <tr><td colSpan={6} style={{ fontSize: 12, opacity: 0.75 }}>No report data yet.</td></tr>
                            )}
                          </tbody>
                        </Table>
                      </div>
                    </Card.Body>
                  </Card>
                </Col>
              </Row>
            ) : null}
          </Card.Body>
        </Card>
      </Container>
    </>
  );
}
