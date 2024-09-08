import { createRoot } from "react-dom/client";
import { App } from "./components/App/App";
import "./index.less";

createRoot(document.body.appendChild(document.createElement("div"))).render(
  <App />,
);
