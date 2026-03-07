import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, Table } from "react-bootstrap";
import { getProviderCapabilities, type ProviderCapabilitiesResponse, type ProviderCapabilityCheck } from "../api/providersApi";

type UiCapabilityStatus = ProviderCapabilityCheck["status"] | "checking";
type UiCapabilityCheck = Omit<ProviderCapabilityCheck, "status" | "message"> & {
  status: UiCapabilityStatus;
  message: string;
};

const INTERVAL_ORDER: Record<string, number> = {
  "1m": 1,
  "3m": 2,
  "5m": 3,
  "15m": 4,
  "30m": 5,
  "1h": 6,
  "4h": 7,
  "1d": 8,
};

const GROUP_ORDER: Array<{ pattern: RegExp; weight: number }> = [
  { pattern: /price candles/i, weight: 10 },
  { pattern: /open interest path/i, weight: 20 },
  { pattern: /funding history/i, weight: 30 },
  { pattern: /trade flow/i, weight: 40 },
  { pattern: /orderbook snapshot/i, weight: 50 },
  { pattern: /cvd source/i, weight: 55 },
  { pattern: /oi history/i, weight: 60 },
  { pattern: /liquidation history/i, weight: 70 },
];

function extractInterval(label: string): string | null {
  const match = label.match(/\(([^)]+)\)/);
  return match ? match[1].trim().toLowerCase() : null;
}

function groupWeight(label: string): number {
  for (const group of GROUP_ORDER) {
    if (group.pattern.test(label)) return group.weight;
  }
  return 999;
}

function sortChecks(rows: UiCapabilityCheck[]): UiCapabilityCheck[] {
  const next = [...rows];
  next.sort((a, b) => {
    if (a.provider !== b.provider) return a.provider.localeCompare(b.provider);
    const groupDiff = groupWeight(a.label) - groupWeight(b.label);
    if (groupDiff !== 0) return groupDiff;
    const ia = extractInterval(a.label);
    const ib = extractInterval(b.label);
    if (ia || ib) {
      const wa = ia ? (INTERVAL_ORDER[ia] ?? 999) : 0;
      const wb = ib ? (INTERVAL_ORDER[ib] ?? 999) : 0;
      const intervalDiff = wa - wb;
      if (intervalDiff !== 0) return intervalDiff;
    }
    return a.label.localeCompare(b.label);
  });
  return next;
}

function statusVariant(status: UiCapabilityStatus): string {
  switch (status) {
    case "checking":
      return "secondary";
    case "ok":
      return "success";
    case "missing_key":
      return "secondary";
    case "rate_limited":
      return "warning";
    case "plan_unsupported":
      return "danger";
    default:
      return "danger";
  }
}

function expectedChecksForBot(botId?: string): UiCapabilityCheck[] {
  const base: UiCapabilityCheck[] = [
    { id: "price_kline_1m", provider: "bybit", label: "Metric: price candles (1m)", required: true, status: "checking", available: false, message: "Checking...", latencyMs: null },
    { id: "bybit_oi_history_1m", provider: "bybit", label: "Metric: open interest path (1m)", required: false, status: "checking", available: false, message: "Checking...", latencyMs: null },
    { id: "bybit_oi_history_5m", provider: "bybit", label: "Metric: open interest path (5m)", required: true, status: "checking", available: false, message: "Checking...", latencyMs: null },
    { id: "funding_history", provider: "bybit", label: "Metric: funding history", required: true, status: "checking", available: false, message: "Checking...", latencyMs: null },
    { id: "coinglass_oi_1m_history", provider: "coinglass", label: "Metric: OI history (1m)", required: false, status: "checking", available: false, message: "Checking...", latencyMs: null },
  ];
  if (botId !== "signal-multi-factor-v1") return base;
  return [
    ...base.slice(0, 3),
    { id: "signal_trade_flow", provider: "bybit", label: "Metric: trade flow (recent trades)", required: true, status: "checking", available: false, message: "Checking...", latencyMs: null },
    { id: "signal_microstructure_orderbook", provider: "bybit", label: "Metric: orderbook snapshot", required: true, status: "checking", available: false, message: "Checking...", latencyMs: null },
    ...base.slice(3),
    { id: "signal_liquidation_history_5m", provider: "coinglass", label: "Metric: liquidation history (5m)", required: false, status: "checking", available: false, message: "Checking...", latencyMs: null },
    { id: "signal_liquidation_history_15m", provider: "coinglass", label: "Metric: liquidation history (15m)", required: false, status: "checking", available: false, message: "Checking...", latencyMs: null },
    { id: "signal_liquidation_history_30m", provider: "coinglass", label: "Metric: liquidation history (30m)", required: false, status: "checking", available: false, message: "Checking...", latencyMs: null },
    { id: "signal_liquidation_history_1h", provider: "coinglass", label: "Metric: liquidation history (1h)", required: false, status: "checking", available: false, message: "Checking...", latencyMs: null },
    { id: "signal_liquidation_history_4h", provider: "coinglass", label: "Metric: liquidation history (4h)", required: false, status: "checking", available: false, message: "Checking...", latencyMs: null },
    { id: "signal_cvd_source_bybit", provider: "bybit", label: "Metric: CVD source (Bybit public trades)", required: true, status: "checking", available: false, message: "Checking...", latencyMs: null },
  ];
}

type Props = {
  botId?: string;
  title?: string;
};

export function ProviderCapabilitiesCard({ botId, title = "Data endpoints availability" }: Props) {
  const [rows, setRows] = useState<UiCapabilityCheck[]>(() => expectedChecksForBot(botId));
  const [data, setData] = useState<ProviderCapabilitiesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setRows(expectedChecksForBot(botId));
    setLoading(true);
    setError(null);
    try {
      const next = await getProviderCapabilities(botId);
      setData(next);
      const map = new Map(next.checks.map((row) => [row.id, row]));
      setRows((prev) => {
        const known = prev.map((row) => {
          const hit = map.get(row.id);
          return hit ? { ...hit } : row;
        });
        const knownIds = new Set(known.map((row) => row.id));
        for (const row of next.checks) {
          if (!knownIds.has(row.id)) known.push({ ...row });
        }
        return known;
      });
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, [botId]);

  useEffect(() => {
    setRows(expectedChecksForBot(botId));
    void refresh();
  }, [refresh]);

  const requiredTotal = rows.filter((row) => row.required).length;
  const requiredAvailable = rows.filter((row) => row.required && row.available).length;
  const totalAvailable = rows.filter((row) => row.available).length;
  const displayRows = sortChecks(rows);
  const allRequiredReady = rows
    .filter((row) => row.required)
    .every((row) => row.status !== "checking");
  const requiredOk = allRequiredReady && requiredAvailable === requiredTotal;

  return (
    <Card className="mb-3">
      <Card.Header className="d-flex align-items-center justify-content-between">
        <b>{title}</b>
        <Button size="sm" variant="outline-secondary" onClick={() => void refresh()} disabled={loading}>
          {loading ? "Checking..." : "Refresh"}
        </Button>
      </Card.Header>
      <Card.Body>
        {error ? <div style={{ color: "#b00020", fontSize: 12, marginBottom: 8 }}>{error}</div> : null}
        {rows.length ? (
          <>
            <div className="d-flex flex-wrap gap-2 mb-2" style={{ fontSize: 12 }}>
              <Badge bg={requiredOk ? "success" : "danger"}>
                required endpoints: {requiredAvailable}/{requiredTotal}
              </Badge>
              <Badge bg="secondary">total available: {totalAvailable}/{rows.length}</Badge>
              <span>Bybit: {data?.bybitRestUrl ?? "-"}</span>
              <span>CoinGlass: {data?.coinglassBaseUrl ?? "-"}</span>
            </div>
            <div style={{ overflowX: "auto" }}>
              <Table size="sm" bordered hover className="mb-0" style={{ tableLayout: "fixed", minWidth: 1100 }}>
                <colgroup>
                  <col style={{ width: 120 }} />
                  <col style={{ width: 460 }} />
                  <col style={{ width: 120 }} />
                  <col style={{ width: 120 }} />
                  <col style={{ width: 420 }} />
                  <col style={{ width: 100 }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>Provider</th>
                    <th>Endpoint</th>
                    <th>Required</th>
                    <th>Status</th>
                    <th>Message</th>
                    <th>Latency, ms</th>
                  </tr>
                </thead>
                <tbody>
                  {displayRows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.provider}</td>
                      <td title={row.label} style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{row.label}</td>
                      <td>{row.required ? "yes" : "optional"}</td>
                      <td><Badge bg={statusVariant(row.status)}>{row.status}</Badge></td>
                      <td title={row.message} style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{row.message}</td>
                      <td>{row.latencyMs == null ? "-" : row.latencyMs}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </>
        ) : null}
      </Card.Body>
    </Card>
  );
}
