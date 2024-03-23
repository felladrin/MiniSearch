import { createRoot } from "react-dom/client";
import { App } from "./components/App";
import { prepareTextGeneration } from "./modules/textGeneration";
import "water.css/out/water.css";
import "react-tooltip/dist/react-tooltip.css";

prepareTextGeneration();

createRoot(document.body.appendChild(document.createElement("div"))).render(
  <App />,
);
