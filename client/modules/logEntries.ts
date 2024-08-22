import { createPubSub } from "create-pubsub";

export type LogEntry = {
  timestamp: string;
  message: string;
};

export const logEntriesPubSub = createPubSub<LogEntry[]>([]);

const [updateLogEntries, , getLogEntries] = logEntriesPubSub;

(window as unknown as { getLogEntries: typeof getLogEntries }).getLogEntries =
  getLogEntries;

export function addLogEntry(message: string) {
  updateLogEntries([
    ...getLogEntries(),
    {
      timestamp: new Date().toISOString(),
      message,
    },
  ]);
}
