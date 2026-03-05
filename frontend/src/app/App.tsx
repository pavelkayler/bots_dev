import { RouterProvider } from "react-router-dom";
import { router } from "./routing/routes";
import { ROUTER_PROVIDER_FUTURE_FLAGS } from "./routing/futureFlags";

export default function App() {
  return (
    <div style={{ maxWidth: "100vw", overflowX: "hidden" }}>
        <RouterProvider router={router} future={ROUTER_PROVIDER_FUTURE_FLAGS} />
    </div>
  );
}
