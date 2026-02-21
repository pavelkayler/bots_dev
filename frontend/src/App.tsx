import { useEffect } from 'react';
import { Container } from 'react-bootstrap';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppNavbar } from './components/AppNavbar';
import { ConfigPage } from './pages/ConfigPage';
import { EventsPage } from './pages/EventsPage';
import { RuntimePage } from './pages/RuntimePage';
import { SymbolsPage } from './pages/SymbolsPage';
import { appStore } from './state/store';
import { createWsClient } from './ws/client';

function App() {
  useEffect(() => {
    appStore.fetchSessionStatus().catch(() => {
      // WS snapshot will populate state when available.
    });
    const disconnect = createWsClient();
    return () => disconnect();
  }, []);

  return (
    <>
      <AppNavbar />
      <Container fluid className="pb-4">
        <Routes>
          <Route path="/config" element={<ConfigPage />} />
          <Route path="/runtime" element={<RuntimePage />} />
          <Route path="/symbols" element={<SymbolsPage />} />
          <Route path="/events" element={<EventsPage />} />
          <Route path="*" element={<Navigate to="/config" replace />} />
        </Routes>
      </Container>
    </>
  );
}

export default App;
