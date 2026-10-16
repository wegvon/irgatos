import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import { WebApp } from "./page/App";
import { trackVisualViewport } from "./page/theme";
import { ToastHost } from "./page/ui/parts";
import "../../styles/index.css";
import "./page/web.css";

/**
 * Browser access page. The Mac serves it to phones and tablets over
 * Tailscale; everything it shows comes from the running app.
 */
trackVisualViewport();

// The Mac only sends a token back here when it did not match. Either way it
// should not stay in the address bar.
const triedToken = new URLSearchParams(location.search).has("token");
if (triedToken) history.replaceState(null, "", `/${location.hash}`);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <ToastHost>
      <WebApp triedToken={triedToken} />
    </ToastHost>
  </StrictMode>,
);
