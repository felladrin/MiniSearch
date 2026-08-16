import { createPubSub } from "create-pubsub";

type LogEntry = {
  timestamp: string;
  message: string;
  id: string;
};

export const logEntriesPubSub = createPubSub<LogEntry[]>([]);

const [updateLogEntries, , getLogEntries] = logEntriesPubSub;

/** Appends a timestamped entry to the in-app log. */
export function addLogEntry(message: string) {
  updateLogEntries([
    ...getLogEntries(),
    {
      timestamp: new Date().toISOString(),
      message,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
    },
  ]);
}
