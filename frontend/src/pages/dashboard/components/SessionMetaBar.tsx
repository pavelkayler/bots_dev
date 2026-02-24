import { Badge, Button, Form } from "react-bootstrap";
import { CopyButton } from "../../../shared/components/CopyButton";

type Props = {
  sessionId: string | null;
  eventsFile: string | null;
  activeOnly: boolean;
  onToggleActiveOnly: (v: boolean) => void;
  rowsCount: number;
  apiError: string | null;

  onRefreshRows: () => void;
};

export function SessionMetaBar(props: Props) {
  const { sessionId, eventsFile, activeOnly, onToggleActiveOnly, rowsCount, apiError, onRefreshRows } = props;

  return (
    <div className="d-flex align-items-center gap-2 flex-wrap mb-2" style={{ fontSize: 12 }}>
      <div>
        <b>sessionId:</b> {sessionId ?? "-"}
        {sessionId ? <CopyButton className="ms-2 py-0" value={sessionId} /> : null}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 260, flex: "1 1 520px", maxWidth: "100%" }}>
        <b style={{ flex: "0 0 auto" }}>eventsFile:</b>
        <div title={eventsFile ?? ""} style={{ flex: "1 1 auto", minWidth: 0, maxWidth: "100%", overflowX: "auto", whiteSpace: "nowrap" }}>
          <span style={{ display: "inline-block", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", verticalAlign: "bottom" }}>{eventsFile ?? "-"}</span>
        </div>
        {eventsFile ? <CopyButton className="py-0" value={eventsFile} /> : null}
      </div>

      <div className="ms-auto d-flex align-items-center gap-2">
        <Button size="sm" variant="outline-secondary" onClick={onRefreshRows}>
          Refresh rows
        </Button>

        <Form.Check type="switch" id="active-only" label="Active only" checked={activeOnly} onChange={(e) => onToggleActiveOnly(e.currentTarget.checked)} />
        <Badge bg="secondary">rows: {rowsCount}</Badge>
      </div>

      {apiError ? <Badge bg="danger">API: {apiError}</Badge> : null}
    </div>
  );
}
