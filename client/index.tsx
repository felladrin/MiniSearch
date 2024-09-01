import { createRoot } from "react-dom/client";
import { App } from "./components/App";
import "./index.less";
import { initializeBackgroundImageListener } from "./modules/backgroundImage";

createRoot(document.body.appendChild(document.createElement("div"))).render(
  <App />,
);

initializeBackgroundImageListener();
