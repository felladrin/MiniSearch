import { createRoot } from "react-dom/client";
import { App } from "./components/App/App";
import { historyDatabase } from "./modules/history";
import { addLogEntry } from "./modules/logEntries";
import { getSettings, listenToSettingsChanges } from "./modules/pubSub";

const settings = getSettings();

historyDatabase.on("ready", () => {
  addLogEntry("History database initialized");
});

historyDatabase.on("close", () => {
  addLogEntry("History database connection closed");
});

if (settings.enableHistory) {
  try {
    await historyDatabase.open().catch((error: Error) => {
      addLogEntry(`Failed to open history database: ${error.message}`);
    });
  } catch (error) {
    addLogEntry(
      `History database initialization error: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

listenToSettingsChanges((newSettings) => {
  if (newSettings.enableHistory && !historyDatabase.isOpen()) {
    historyDatabase.open().catch((error: Error) => {
      addLogEntry(`Failed to open history database: ${error.message}`);
    });
  } else if (!newSettings.enableHistory && historyDatabase.isOpen()) {
    historyDatabase.close();
  }
});

createRoot(document.body.appendChild(document.createElement("div"))).render(
  <App />,
);

addLogEntry("App initialized");
