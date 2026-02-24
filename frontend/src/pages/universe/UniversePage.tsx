import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, Container, Form, Modal, Spinner, Table } from "react-bootstrap";
import { Link } from "react-router-dom";
import { createUniverse, deleteUniverse, listUniverses, readUniverse } from "../../features/universe/api";
import type { UniverseFile, UniverseMeta } from "../../features/universe/types";
import { fmtNum, fmtTime } from "../../shared/utils/format";

function joinSymbols(symbols: string[]) {
  return symbols.join("\n");
}

export function UniversePage() {
  const [minTurnoverUsd, setMinTurnoverUsd] = useState<string>("10000000");
  const [minVolPct, setMinVolPct] = useState<string>("10");

  const [items, setItems] = useState<UniverseMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastCreated, setLastCreated] = useState<UniverseMeta | null>(null);
  const [stats, setStats] = useState<any | null>(null);

  const [showModal, setShowModal] = useState(false);
  const [modalUniverse, setModalUniverse] = useState<UniverseFile | null>(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listUniverses();
      setItems(res.universes ?? []);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const canCreate = useMemo(() => !creating, [creating]);

  async function onCreate() {
    setCreating(true);
    setError(null);
    setLastCreated(null);
    setStats(null);
    try {
      const parsedTurnover = Number(minTurnoverUsd);
      const parsedVol = Number(minVolPct);
      if (minTurnoverUsd.trim() === "" || minVolPct.trim() === "" || !Number.isFinite(parsedTurnover) || !Number.isFinite(parsedVol)) {
        setError("Both numeric fields are required.");
        return;
      }
      const res = await createUniverse(parsedTurnover, parsedVol);
      setLastCreated(res.universe.meta);
      setStats(res.stats);
      await refresh();
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setCreating(false);
    }
  }

  async function onViewSymbols(id: string) {
    setModalError(null);
    setModalLoading(true);
    setModalUniverse(null);
    setShowModal(true);

    try {
      const uni = await readUniverse(id);
      setModalUniverse(uni);
    } catch (e: any) {
      setModalError(String(e?.message ?? e));
    } finally {
      setModalLoading(false);
    }
  }

  async function onDelete(id: string) {
    setError(null);
    try {
      await deleteUniverse(id);
      await refresh();
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  }

  return (
    <Container fluid className="py-2 px-2">
      <Card className="mb-3">
        <Card.Header className="d-flex align-items-center gap-2 flex-wrap">
          <b>Universe builder</b>
          <span style={{ opacity: 0.75, fontSize: 12 }}>
            Builds one-off universe from Bybit tickers and saves it.
          </span>

          <div className="ms-auto d-flex align-items-center gap-2">
            <Button as={Link} to="/" size="sm" variant="outline-secondary">
              Back to dashboard
            </Button>

            <Button size="sm" variant="outline-secondary" onClick={() => void refresh()} disabled={loading || creating}>
              Refresh list
            </Button>
          </div>
        </Card.Header>

        <Card.Body>
          {error ? <div style={{ color: "#b00020", marginBottom: 8 }}>{error}</div> : null}

          <Form className="mb-3">
            <div className="d-flex gap-3 flex-wrap">
              <Form.Group style={{ width: 240 }}>
                <Form.Label>Min turnover 24h (USD)</Form.Label>
                <Form.Control
                  type="number"
                  value={minTurnoverUsd}
                  onChange={(e) => setMinTurnoverUsd(e.currentTarget.value)}
                  min={0}
                />
              </Form.Group>

              <Form.Group style={{ width: 240 }}>
                <Form.Label>Min volatility 24h (%)</Form.Label>
                <Form.Control
                  type="number"
                  value={minVolPct}
                  onChange={(e) => setMinVolPct(e.currentTarget.value)}
                  min={0}
                />
              </Form.Group>

              <div className="d-flex align-items-end">
                <Button variant="primary" onClick={() => void onCreate()} disabled={!canCreate || creating}>
                  {creating ? <Spinner animation="border" size="sm" /> : "Create"}
                </Button>
              </div>
            </div>
          </Form>

          {lastCreated ? (
            <div className="d-flex align-items-center gap-2 flex-wrap mb-2" style={{ fontSize: 12 }}>
              <Badge bg="success">Saved</Badge>
              <span><b>{lastCreated.name}</b></span>
              <span>count: {lastCreated.count}</span>
              {stats ? (
                <span style={{ opacity: 0.75 }}>
                  seeded: {stats.seededSymbols} · subscribed: {stats.subscribedSymbols} · received: {stats.receivedSymbols} · collectMs: {stats.collectMs}
                </span>
              ) : null}
            </div>
          ) : null}

          <h6 className="mb-2">Saved universes</h6>
          {loading ? (
            <div className="d-flex align-items-center gap-2" style={{ opacity: 0.8 }}>
              <Spinner animation="border" size="sm" /> loading…
            </div>
          ) : !items.length ? (
            <div style={{ opacity: 0.75 }}>No universes yet. Click Create.</div>
          ) : (
            <Table striped bordered hover size="sm" style={{ tableLayout: "fixed", width: "100%" }}>
              <thead>
                <tr>
                  <th style={{ width: "26%", fontSize: 12 }}>Name</th>
                  <th style={{ width: "10%", fontSize: 12 }}>Count</th>
                  <th style={{ width: "16%", fontSize: 12 }}>Min turnover</th>
                  <th style={{ width: "14%", fontSize: 12 }}>Min vol</th>
                  <th style={{ width: "18%", fontSize: 12 }}>Updated</th>
                  <th style={{ width: "16%", fontSize: 12 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((u) => (
                  <tr key={u.id}>
                    <td style={{ fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{u.name}</td>
                    <td style={{ fontSize: 12 }}>{u.count}</td>
                    <td style={{ fontSize: 12 }}>{fmtNum(u.minTurnoverUsd)}</td>
                    <td style={{ fontSize: 12 }}>{fmtNum(u.minVolatilityPct)}%</td>
                    <td style={{ fontSize: 12, whiteSpace: "nowrap" }}>{fmtTime(u.updatedAt)}</td>
                    <td style={{ fontSize: 12 }}>
                      <div className="d-flex align-items-center gap-2">
                        <Button size="sm" variant="outline-secondary" onClick={() => void onViewSymbols(u.id)}>
                          View symbols
                        </Button>
                        <Button size="sm" variant="outline-danger" onClick={() => void onDelete(u.id)}>
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card.Body>
      </Card>

      <Modal show={showModal} onHide={() => setShowModal(false)} size="lg">
        <Modal.Header closeButton>
          <Modal.Title>Universe symbols</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {modalLoading ? (
            <div className="d-flex align-items-center gap-2" style={{ opacity: 0.8 }}>
              <Spinner animation="border" size="sm" /> loading…
            </div>
          ) : modalError ? (
            <div style={{ color: "#b00020" }}>{modalError}</div>
          ) : !modalUniverse ? (
            <div style={{ opacity: 0.75 }}>No data.</div>
          ) : (
            <>
              <div className="d-flex align-items-center gap-2 flex-wrap mb-2" style={{ fontSize: 12 }}>
                <Badge bg="secondary">{modalUniverse.meta.name}</Badge>
                <span>count: {modalUniverse.symbols.length}</span>
                <span style={{ opacity: 0.75 }}>updated: {fmtTime(modalUniverse.meta.updatedAt)}</span>
              </div>

              <Form.Control as="textarea" rows={18} readOnly value={joinSymbols(modalUniverse.symbols)} />
            </>
          )}
        </Modal.Body>
      </Modal>
    </Container>
  );
}
