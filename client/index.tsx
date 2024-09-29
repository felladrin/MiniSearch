import { createRoot } from "react-dom/client";
import { addLogEntry } from "./modules/logEntries";
import { App } from "./components/App/App";
import "@mantine/core/styles.css";

createRoot(document.body.appendChild(document.createElement("div"))).render(
  <App />,
);

addLogEntry("App initialized");
