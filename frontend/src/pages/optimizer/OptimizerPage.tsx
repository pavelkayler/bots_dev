import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Container, Form, Spinner, Table } from "react-bootstrap";
import { HeaderBar } from "../dashboard/components/HeaderBar";
import { useWsFeed } from "../../features/ws/hooks/useWsFeed";
import { useSessionRuntime } from "../../features/session/hooks/useSessionRuntime";
import { listTapes, runOptimization, startTape, stopTape, type OptimizationResult, type OptimizerTape } from "../../features/optimizer/api/optimizerApi";
import { CopyButton } from "../../shared/components/CopyButton";

function formatSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes.toFixed(0)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function OptimizerPage() {
  const { conn, lastServerTime, wsUrl, streams } = useWsFeed();
  const { status, busy, start, stop, canStart, canStop } = useSessionRuntime();

  const [tapes, setTapes] = useState<OptimizerTape[]>([]);
  const [loadingTapes, setLoadingTapes] = useState(false);
  const [selectedTapeId, setSelectedTapeId] = useState<string>("");
  const [recordingTapeId, setRecordingTapeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [candidates, setCandidates] = useState("200");
  const [seed, setSeed] = useState("1");
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<OptimizationResult[]>([]);

  async function refreshTapes() {
    setLoadingTapes(true);
    try {
      const res = await listTapes();
      setTapes(res.tapes ?? []);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setLoadingTapes(false);
    }
  }

  useEffect(() => {
    void refreshTapes();
  }, []);

  const selectedTape = useMemo(() => tapes.find((t) => t.id === selectedTapeId) ?? null, [tapes, selectedTapeId]);

  async function onStartRecording() {
    setError(null);
    try {
      const res = await startTape();
      setRecordingTapeId(res.tapeId);
      setSelectedTapeId(res.tapeId);
      await refreshTapes();
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  }

  async function onStopRecording() {
    setError(null);
    try {
      await stopTape();
      setRecordingTapeId(null);
      await refreshTapes();
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  }

  async function onRunOptimization() {
    if (!selectedTapeId) return;
    setRunning(true);
    setError(null);
    try {
      const res = await runOptimization({
        tapeId: selectedTapeId,
        candidates: Number(candidates),
        seed: Number(seed),
      });
      setResults(res.results ?? []);
    } catch (e: any) {
      setError(String(e?.message ?? e));
      setResults([]);
    } finally {
      setRunning(false);
    }
  }

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
      />

      <Container fluid className="py-2 px-2">
        <Card>
          <Card.Header className="d-flex align-items-center justify-content-between">
            <b>Optimizer</b>
            <Button size="sm" variant="outline-secondary" onClick={() => void refreshTapes()} disabled={loadingTapes}>
              Refresh tapes
            </Button>
          </Card.Header>
          <Card.Body>
            {error ? <Alert variant="danger">{error}</Alert> : null}

            <h6>Tape recording</h6>
            <div className="d-flex align-items-center gap-2 mb-2">
              <Button size="sm" onClick={() => void onStartRecording()} disabled={Boolean(recordingTapeId)}>Start recording</Button>
              <Button size="sm" variant="outline-danger" onClick={() => void onStopRecording()} disabled={!recordingTapeId}>Stop recording</Button>
              <span style={{ fontSize: 12 }}>
                recording: <b>{recordingTapeId ? "ON" : "OFF"}</b>
                {recordingTapeId ? ` · ${recordingTapeId}` : ""}
              </span>
            </div>

            {loadingTapes ? (
              <div className="d-flex align-items-center gap-2" style={{ opacity: 0.8 }}>
                <Spinner animation="border" size="sm" /> loading...
              </div>
            ) : (
              <Table striped bordered hover size="sm" className="mb-3">
                <thead>
                  <tr>
                    <th style={{ width: 50 }}>Use</th>
                    <th>id</th>
                    <th>createdAt</th>
                    <th>symbolsCount</th>
                    <th>tf</th>
                    <th>size</th>
                  </tr>
                </thead>
                <tbody>
                  {tapes.map((t) => (
                    <tr key={t.id}>
                      <td>
                        <Form.Check
                          type="radio"
                          name="selectedTape"
                          checked={selectedTapeId === t.id}
                          onChange={() => setSelectedTapeId(t.id)}
                        />
                      </td>
                      <td style={{ fontSize: 12 }}>{t.id}</td>
                      <td style={{ fontSize: 12 }}>{new Date(t.createdAt).toLocaleString()}</td>
                      <td style={{ fontSize: 12 }}>{Array.isArray(t.meta?.symbols) ? t.meta?.symbols.length : 0}</td>
                      <td style={{ fontSize: 12 }}>{t.meta?.klineTfMin ?? "-"}</td>
                      <td style={{ fontSize: 12 }}>{formatSize(t.fileSizeBytes)}</td>
                    </tr>
                  ))}
                  {!tapes.length ? (
                    <tr>
                      <td colSpan={6} style={{ fontSize: 12, opacity: 0.75 }}>No tapes</td>
                    </tr>
                  ) : null}
                </tbody>
              </Table>
            )}

            <h6>Optimization</h6>
            <div className="d-flex gap-2 align-items-end mb-2 flex-wrap">
              <Form.Group>
                <Form.Label style={{ fontSize: 12 }}>candidates</Form.Label>
                <Form.Control value={candidates} onChange={(e) => setCandidates(e.currentTarget.value)} type="number" min={1} max={2000} />
              </Form.Group>
              <Form.Group>
                <Form.Label style={{ fontSize: 12 }}>seed</Form.Label>
                <Form.Control value={seed} onChange={(e) => setSeed(e.currentTarget.value)} type="number" />
              </Form.Group>
              <Button onClick={() => void onRunOptimization()} disabled={!selectedTapeId || running}>
                {running ? <Spinner animation="border" size="sm" /> : "Run optimization"}
              </Button>
            </div>
            {selectedTape ? <div style={{ fontSize: 12, marginBottom: 8 }}>selected tape: <b>{selectedTape.id}</b></div> : null}

            <Table striped bordered hover size="sm">
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>netPnl</th>
                  <th>trades</th>
                  <th>winRate</th>
                  <th>params</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => {
                  const paramsText = `priceTh=${r.params.priceThresholdPct.toFixed(3)} oivTh=${r.params.oivThresholdPct.toFixed(3)} tp=${r.params.tpRoiPct.toFixed(3)} sl=${r.params.slRoiPct.toFixed(3)} offset=${r.params.entryOffsetPct.toFixed(3)}`;
                  return (
                    <tr key={`${r.rank}-${r.netPnl}`}>
                      <td>{r.rank}</td>
                      <td>{r.netPnl.toFixed(4)}</td>
                      <td>{r.trades}</td>
                      <td>{r.winRatePct.toFixed(2)}%</td>
                      <td>
                        <div className="d-flex align-items-center gap-2">
                          <span style={{ fontSize: 12 }}>{paramsText}</span>
                          <CopyButton value={JSON.stringify(r.params)} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!results.length ? (
                  <tr>
                    <td colSpan={5} style={{ fontSize: 12, opacity: 0.75 }}>No results</td>
                  </tr>
                ) : null}
              </tbody>
            </Table>
          </Card.Body>
        </Card>
      </Container>
    </>
  );
}
