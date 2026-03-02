import { useEffect, useMemo, useState } from "react";
import { Button, Card, Col, Form, Row, Spinner } from "react-bootstrap";
import { setDatasetTarget, getDatasetTarget, type DatasetRangePreset, type DatasetTarget } from "../api/datasetTargetApi";
import { listUniverses } from "../../universe/api";
import type { UniverseMeta } from "../../universe/types";

type DraftState = {
  universeId: string | null;
  rangeKind: "preset" | "manual";
  preset: DatasetRangePreset;
  manualStart: string;
  manualEnd: string;
};

const STORAGE_KEY = "datasetTargetDraft";
const PRESETS: DatasetRangePreset[] = ["24h", "48h", "1w", "2w", "4w", "1mo"];

function toDatetimeLocal(ms: number): string {
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms);
  const offsetMs = d.getTimezoneOffset() * 60000;
  const local = new Date(d.getTime() - offsetMs);
  return local.toISOString().slice(0, 16);
}

function fromDatetimeLocal(input: string): number | null {
  if (!input) return null;
  const ms = new Date(input).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function defaultDraft(): DraftState {
  const now = Date.now();
  return {
    universeId: null,
    rangeKind: "preset",
    preset: "24h",
    manualStart: toDatetimeLocal(now - 24 * 60 * 60 * 1000),
    manualEnd: toDatetimeLocal(now),
  };
}

function draftFromTarget(target: DatasetTarget): DraftState {
  const base = defaultDraft();
  if (target.range.kind === "preset") {
    return {
      ...base,
      universeId: target.universeId,
      rangeKind: "preset",
      preset: target.range.preset,
    };
  }
  return {
    ...base,
    universeId: target.universeId,
    rangeKind: "manual",
    manualStart: toDatetimeLocal(target.range.startMs),
    manualEnd: toDatetimeLocal(target.range.endMs),
  };
}

function parseStoredDraft(raw: string | null): DraftState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<DraftState>;
    const defaults = defaultDraft();
    const preset = typeof parsed.preset === "string" && PRESETS.includes(parsed.preset as DatasetRangePreset)
      ? (parsed.preset as DatasetRangePreset)
      : "24h";
    const rangeKind = parsed.rangeKind === "manual" ? "manual" : "preset";
    const universeId = typeof parsed.universeId === "string" && parsed.universeId.trim() ? parsed.universeId : null;
    const manualStart = typeof parsed.manualStart === "string" ? parsed.manualStart : defaults.manualStart;
    const manualEnd = typeof parsed.manualEnd === "string" ? parsed.manualEnd : defaults.manualEnd;
    return { universeId, rangeKind, preset, manualStart, manualEnd };
  } catch {
    return null;
  }
}

export default function DatasetTargetCard() {
  const [universes, setUniverses] = useState<UniverseMeta[]>([]);
  const [draft, setDraft] = useState<DraftState>(() => defaultDraft());
  const [loadingInit, setLoadingInit] = useState(true);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const res = await listUniverses();
        if (!active) return;
        setUniverses(Array.isArray(res.universes) ? res.universes : []);
      } catch {
        if (!active) return;
        setUniverses([]);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      const local = parseStoredDraft(window.localStorage.getItem(STORAGE_KEY));
      if (local) {
        if (active) setDraft(local);
        if (active) setLoadingInit(false);
        return;
      }
      try {
        const res = await getDatasetTarget();
        if (!active) return;
        const next = draftFromTarget(res.datasetTarget);
        setDraft(next);
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        if (!active) return;
        const fallback = defaultDraft();
        setDraft(fallback);
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback));
      } finally {
        if (active) setLoadingInit(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (loadingInit) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
  }, [draft, loadingInit]);

  const applyDisabled = useMemo(() => {
    if (applying || loadingInit) return true;
    if (draft.rangeKind !== "manual") return false;
    const startMs = fromDatetimeLocal(draft.manualStart);
    const endMs = fromDatetimeLocal(draft.manualEnd);
    return startMs == null || endMs == null || endMs <= startMs;
  }, [applying, draft, loadingInit]);

  async function onApply() {
    if (applyDisabled) return;
    setError("");
    setApplying(true);
    try {
      const payload = draft.rangeKind === "preset"
        ? { universeId: draft.universeId, range: { kind: "preset", preset: draft.preset } }
        : {
          universeId: draft.universeId,
          range: {
            kind: "manual",
            startMs: Number(fromDatetimeLocal(draft.manualStart)),
            endMs: Number(fromDatetimeLocal(draft.manualEnd)),
          },
        };
      const res = await setDatasetTarget(payload);
      const next = draftFromTarget(res.datasetTarget);
      setDraft(next);
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setApplying(false);
    }
  }

  return (
    <Card className="mb-2">
      <Card.Header>
        <b>Dataset Target</b>
      </Card.Header>
      <Card.Body>
        <Row className="g-2 align-items-end">
          <Col md={3} sm={6} xs={12}>
            <Form.Group>
              <Form.Label style={{ fontSize: 12 }}>Universe</Form.Label>
              <Form.Select
                value={draft.universeId ?? ""}
                onChange={(e) => setDraft((prev) => ({ ...prev, universeId: e.currentTarget.value || null }))}
              >
                <option value="">Not selected</option>
                {universes.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </Form.Select>
            </Form.Group>
          </Col>

          <Col md={3} sm={6} xs={12}>
            <Form.Group>
              <Form.Label style={{ fontSize: 12 }}>Range mode</Form.Label>
              <Form.Select
                value={draft.rangeKind}
                onChange={(e) => setDraft((prev) => ({ ...prev, rangeKind: e.currentTarget.value === "manual" ? "manual" : "preset" }))}
              >
                <option value="preset">Preset</option>
                <option value="manual">Manual</option>
              </Form.Select>
            </Form.Group>
          </Col>

          {draft.rangeKind === "preset" ? (
            <Col md={3} sm={6} xs={12}>
              <Form.Group>
                <Form.Label style={{ fontSize: 12 }}>Preset</Form.Label>
                <Form.Select
                  value={draft.preset}
                  onChange={(e) => setDraft((prev) => ({ ...prev, preset: e.currentTarget.value as DatasetRangePreset }))}
                >
                  {PRESETS.map((p) => <option key={p} value={p}>{p}</option>)}
                </Form.Select>
              </Form.Group>
            </Col>
          ) : (
            <>
              <Col md={3} sm={6} xs={12}>
                <Form.Group>
                  <Form.Label style={{ fontSize: 12 }}>Start</Form.Label>
                  <Form.Control
                    type="datetime-local"
                    value={draft.manualStart}
                    onChange={(e) => setDraft((prev) => ({ ...prev, manualStart: e.currentTarget.value }))}
                  />
                </Form.Group>
              </Col>
              <Col md={3} sm={6} xs={12}>
                <Form.Group>
                  <Form.Label style={{ fontSize: 12 }}>End</Form.Label>
                  <Form.Control
                    type="datetime-local"
                    value={draft.manualEnd}
                    onChange={(e) => setDraft((prev) => ({ ...prev, manualEnd: e.currentTarget.value }))}
                  />
                </Form.Group>
              </Col>
            </>
          )}

          <Col md="auto" sm={6} xs={12}>
            <Button onClick={() => void onApply()} disabled={applyDisabled}>
              {applying ? <Spinner size="sm" animation="border" className="me-2" /> : null}
              Set/Apply
            </Button>
          </Col>
        </Row>
        {error ? <div style={{ color: "#b02a37", marginTop: 8, fontSize: 12 }}>{error}</div> : null}
      </Card.Body>
    </Card>
  );
}
