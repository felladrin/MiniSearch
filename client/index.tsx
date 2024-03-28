import { createRoot } from "react-dom/client";
import { App } from "./components/App";
import { prepareTextGeneration } from "./modules/textGeneration";
import "./index.css";

prepareTextGeneration();

createRoot(document.body.appendChild(document.createElement("div"))).render(
  <App />,
);
