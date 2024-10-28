import { createRoot } from "react-dom/client";
import { App } from "./components/App/App";
import { addLogEntry } from "./modules/logEntries";

createRoot(document.body.appendChild(document.createElement("div"))).render(
  <App />,
);

addLogEntry("App initialized");
