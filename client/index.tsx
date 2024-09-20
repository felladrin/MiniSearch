import { createRoot } from "react-dom/client";
import { addLogEntry } from "./modules/logEntries";
import { Root } from "./components/Root/Root";
import "./index.css";

createRoot(document.body.appendChild(document.createElement("div"))).render(
  <Root />,
);

addLogEntry("App initialized");
