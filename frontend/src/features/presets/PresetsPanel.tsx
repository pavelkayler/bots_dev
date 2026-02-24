import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, Spinner, Table } from "react-bootstrap";
import type { SessionState } from "../../shared/types/domain";
import { fmtTime } from "../../shared/utils/format";
import { listPresets, readPreset, savePreset } from "./api";
import type { PresetMeta } from "./types";
import { updateRuntimeConfig, fetchRuntimeConfig } from "../config/api/configApi";

type Props = {
  sessionState: SessionState;
};

export function PresetsPanel({ sessionState }: Props) {
  const [items, setItems] = useState<PresetMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);

  const canMutateUniverse = sessionState === "STOPPED";

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listPresets();
      setItems(res.presets ?? []);
      setLastUpdatedAt(Date.now());
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const hint = useMemo(() => {
    if (canMutateUniverse) return null;
    return "Universe apply is blocked while session is RUNNING. Stop session to apply presets that change symbols or klineTfMin.";
  }, [canMutateUniverse]);

  async function onSaveCurrent() {
    const name = window.prompt("Preset name", `Preset ${new Date().toLocaleString()}`);
    if (!name) return;

    setLoading(true);
    setError(null);
    try {
      const cfg = await fetchRuntimeConfig();
      await savePreset(name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "preset", name, cfg);
      await refresh();
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  async function onApply(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const preset = await readPreset(id);
      await updateRuntimeConfig(preset.config);

      await refresh();
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card className="mb-3">
      <Card.Header className="d-flex align-items-center gap-2 flex-wrap">
        <b>Presets</b>
        {lastUpdatedAt ? <span style={{ opacity: 0.75, fontSize: 12 }}>updated: {fmtTime(lastUpdatedAt)}</span> : null}

        <div className="ms-auto d-flex align-items-center gap-2">
          <Button size="sm" variant="outline-secondary" onClick={() => void refresh()} disabled={loading}>
            Refresh
          </Button>
          <Button size="sm" variant="outline-secondary" onClick={() => void onSaveCurrent()} disabled={loading}>
            Save current
          </Button>
        </div>
      </Card.Header>

      <Card.Body>
        {hint ? <div style={{ opacity: 0.75, fontSize: 12, marginBottom: 8 }}>{hint}</div> : null}

        {loading ? (
          <div className="d-flex align-items-center gap-2" style={{ opacity: 0.8 }}>
            <Spinner animation="border" size="sm" /> loading…
          </div>
        ) : error ? (
          <div style={{ color: "#b00020" }}>{error}</div>
        ) : !items.length ? (
          <div style={{ opacity: 0.75 }}>No presets yet. Click "Save current".</div>
        ) : (
          <Table striped bordered hover size="sm" style={{ tableLayout: "fixed", width: "100%" }}>
            <thead>
              <tr>
                <th style={{ width: "30%", fontSize: 12 }}>Name</th>
                <th style={{ width: "20%", fontSize: 12 }}>Updated</th>
                <th style={{ width: "20%", fontSize: 12 }}>Id</th>
                <th style={{ width: "15%", fontSize: 12 }}>Action</th>
                <th style={{ width: "15%", fontSize: 12 }}>State</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id}>
                  <td style={{ fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</td>
                  <td style={{ fontSize: 12, whiteSpace: "nowrap" }}>{fmtTime(p.updatedAt)}</td>
                  <td style={{ fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.id}</td>
                  <td style={{ fontSize: 12 }}>
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => void onApply(p.id)}
                      disabled={Boolean(busyId) || loading}
                    >
                      Apply
                    </Button>
                  </td>
                  <td style={{ fontSize: 12 }}>
                    {busyId === p.id ? <Badge bg="warning">applying</Badge> : <Badge bg="secondary">ready</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card.Body>
    </Card>
  );
}
