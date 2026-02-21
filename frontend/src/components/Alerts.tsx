import { Alert, Container } from 'react-bootstrap';
import { appStore, useAppStore } from '../state/store';

export function Alerts() {
  const alerts = useAppStore((state) => state.operatorAlerts);

  if (alerts.length === 0) {
    return null;
  }

  return (
    <Container fluid className="mb-3">
      {alerts.map((alert) => (
        <Alert
          key={alert.id}
          variant={alert.kind}
          dismissible
          onClose={() => appStore.dismissOperatorAlert(alert.id)}
          className="py-2 mb-2"
        >
          <strong>{new Date(alert.ts).toLocaleTimeString()}</strong> — {alert.message}
        </Alert>
      ))}
    </Container>
  );
}
