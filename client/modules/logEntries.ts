import { createPubSub } from "create-pubsub";

type LogEntry = {
  timestamp: string;
  message: string;
  id: string;
};

export const logEntriesPubSub = createPubSub<LogEntry[]>([]);

const [updateLogEntries, , getLogEntries] = logEntriesPubSub;

/** The in-app log keeps only this many of the newest entries. */
export const MAX_LOG_ENTRIES = 1000;

/** Appends a timestamped entry to the in-app log, dropping the oldest past the cap. */
export function addLogEntry(message: string) {
  updateLogEntries([
    ...getLogEntries().slice(-(MAX_LOG_ENTRIES - 1)),
    {
      timestamp: new Date().toISOString(),
      message,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
    },
  ]);
}
