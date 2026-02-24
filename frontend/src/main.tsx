import ReactDOM from "react-dom/client";
import "bootstrap/dist/css/bootstrap.min.css";
import { AppProviders } from "./app/providers/AppProviders";
import App from "./app/App";
import "./app/styles/globals.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <AppProviders>
    <App />
  </AppProviders>
);
