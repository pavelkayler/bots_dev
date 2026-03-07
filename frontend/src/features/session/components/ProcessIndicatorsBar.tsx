import { Badge, Card } from "react-bootstrap";
import type { ProcessStatusResponse } from "../../../shared/types/domain";

type Props = {
  status: ProcessStatusResponse;
};

export function fmtEta(etaSec: number | null): string {
  if (etaSec == null || !Number.isFinite(etaSec) || etaSec <= 0) return "-";
  const total = Math.max(0, Math.floor(etaSec));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

export function pct(value: number | null | undefined): string {
  if (value == null) return "-";
  const n = Number(value);
  if (!Number.isFinite(n)) return "0%";
  return `${Math.round(Math.max(0, Math.min(100, n)))}%`;
}

export function ProcessIndicatorsBar({ status }: Props) {
  return (
    <Card className="mb-3">
      <Card.Header><b>Process indicators</b></Card.Header>
      <Card.Body style={{ fontSize: 12 }}>
        <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
          <Badge bg={status.runtime.state === "RUNNING" ? "success" : status.runtime.state === "PAUSED" ? "warning" : "secondary"}>
            Runtime: {status.runtime.state}
          </Badge>
          <span>msg: {status.runtime.message ?? "-"}</span>
        </div>
        <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
          <Badge bg={status.optimizer.state === "running" ? "success" : status.optimizer.state === "paused" ? "warning" : "secondary"}>
            Optimizer: {status.optimizer.state}
          </Badge>
          <span>loop: {status.optimizer.runIndex}/{status.optimizer.runsCount || 0}{status.optimizer.isInfinite ? " (inf)" : ""}</span>
          <span>progress: {pct(status.optimizer.progressPct)}</span>
          <span>job: {status.optimizer.jobStatus ?? "-"}</span>
        </div>
        <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
          <Badge bg={status.receiveData.state === "running" ? "success" : status.receiveData.state === "queued" ? "warning" : "secondary"}>
            Receive Data: {status.receiveData.state}
          </Badge>
          <span>symbol: {status.receiveData.currentSymbol ?? "-"}</span>
          <span>progress: {pct(status.receiveData.progressPct)}</span>
          <span>ETA: {fmtEta(status.receiveData.etaSec)}</span>
          <span>msg: {status.receiveData.message ?? "-"}</span>
        </div>
        <div className="d-flex flex-wrap align-items-center gap-2">
          <Badge bg={status.recorder.state === "running" ? "success" : status.recorder.state === "waiting" ? "warning" : "secondary"}>
            Recorder: {status.recorder.state}
          </Badge>
          <span>mode: {status.recorder.mode}</span>
          <span>progress: {pct(status.recorder.progressPct)}</span>
          <span>writes: {status.recorder.writes ?? 0}</span>
          <span>symbols: {status.recorder.trackedSymbols ?? 0}</span>
          <span>msg: {status.recorder.message ?? "-"}</span>
        </div>
      </Card.Body>
    </Card>
  );
}
