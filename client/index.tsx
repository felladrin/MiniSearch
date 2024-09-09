import { createRoot } from "react-dom/client";
import { App } from "./components/App/App";
import "./index.less";
import { StrictMode } from "react";
import { addLogEntry } from "./modules/logEntries";

createRoot(document.body.appendChild(document.createElement("div"))).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

addLogEntry("App initialized");
