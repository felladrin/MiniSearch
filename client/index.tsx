import { createRoot } from "react-dom/client";
import { App } from "./components/App/App";
import "./index.less";
import { StrictMode } from "react";

createRoot(document.body.appendChild(document.createElement("div"))).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
