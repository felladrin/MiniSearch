import { createRoot } from "react-dom/client";
import { App } from "./components/App";

createRoot(document.body.appendChild(document.createElement("div"))).render(
  <App />,
);
