import { Card, Col, Form, Row } from "react-bootstrap";
import { useBotSelections } from "../hooks/useBotSelections";

type Props = {
  compact?: boolean;
  onChange?: (state: { selectedBotId: string; selectedBotPresetId: string; selectedExecutionProfileId: string }) => void;
};

export function BotExecutionSelectors({ compact, onChange }: Props) {
  const {
    bots,
    botPresets,
    selectedBotId,
    selectedBotPresetId,
    selectedExecutionProfileId,
    setSelectedBotId,
    setSelectedBotPresetId,
    loading,
    error,
  } = useBotSelections();

  const emit = (next: Partial<{ selectedBotId: string; selectedBotPresetId: string; selectedExecutionProfileId: string }>) => {
    onChange?.({
      selectedBotId: next.selectedBotId ?? selectedBotId,
      selectedBotPresetId: next.selectedBotPresetId ?? selectedBotPresetId,
      selectedExecutionProfileId: next.selectedExecutionProfileId ?? selectedExecutionProfileId,
    });
  };

  const body = (
    <Row className="g-2">
      <Col md={6} xs={12}>
        <Form.Group>
          <Form.Label style={{ color: "#0d6efd", fontWeight: 700 }}>Bot (active)</Form.Label>
          <Form.Select
            style={{ borderColor: "#0d6efd", backgroundColor: "#f4f8ff" }}
            value={selectedBotId}
            disabled={loading}
            onChange={(e) => {
              const value = e.currentTarget.value;
              void setSelectedBotId(value).then(() => emit({ selectedBotId: value }));
            }}
          >
            {bots.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Form.Select>
        </Form.Group>
      </Col>
      <Col md={6} xs={12}>
        <Form.Group>
          <Form.Label>Bot preset</Form.Label>
          <Form.Select
            value={selectedBotPresetId}
            disabled={loading}
            onChange={(e) => {
              const value = e.currentTarget.value;
              void setSelectedBotPresetId(value).then(() => emit({ selectedBotPresetId: value }));
            }}
          >
            {botPresets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Form.Select>
        </Form.Group>
      </Col>
      {error ? <Col xs={12}><div style={{ color: "#b00020", fontSize: 12 }}>{error}</div></Col> : null}
    </Row>
  );

  if (compact) return body;
  return (
    <Card className="mb-3">
      <Card.Header><b>Bot and Preset</b></Card.Header>
      <Card.Body>{body}</Card.Body>
    </Card>
  );
}
