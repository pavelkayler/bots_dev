import { Badge } from "react-bootstrap";

type Props = {
  sessionId: string | null;
  eventsFile: string | null;
  apiError: string | null;
};

export function SessionMetaBar(props: Props) {
  const { sessionId, eventsFile, apiError } = props;

  return (
    <div className="d-flex align-items-center gap-2 flex-wrap mb-2" style={{ fontSize: 12 }}>
      <div>
        <b>sessionId:</b> {sessionId ?? "-"}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 260, flex: "1 1 520px", maxWidth: "100%" }}>
        <b style={{ flex: "0 0 auto" }}>eventsFile:</b>
        <div title={eventsFile ?? ""} style={{ flex: "1 1 auto", minWidth: 0, maxWidth: "100%", overflowX: "auto", whiteSpace: "nowrap" }}>
          <span style={{ display: "inline-block", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", verticalAlign: "bottom" }}>{eventsFile ?? "-"}</span>
        </div>
      </div>

      {apiError ? <Badge bg="danger">API: {apiError}</Badge> : null}
    </div>
  );
}
