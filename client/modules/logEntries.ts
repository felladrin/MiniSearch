import { createPubSub } from "create-pubsub";

type LogEntry = {
  timestamp: string;
  message: string;
};

export const logEntriesPubSub = createPubSub<LogEntry[]>([]);

const [updateLogEntries, , getLogEntries] = logEntriesPubSub;

export function addLogEntry(message: string) {
  updateLogEntries([
    ...getLogEntries(),
    {
      timestamp: new Date().toISOString(),
      message,
    },
  ]);
}
