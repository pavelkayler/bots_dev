import { RouterProvider } from "react-router-dom";
import { router } from "./routing/routes";

export default function App() {
  return (
    <div style={{ maxWidth: "100vw", overflowX: "hidden" }}>
        <RouterProvider
            router={router}
            future={{ v7_startTransition: true }}
        />
    </div>
  );
}
