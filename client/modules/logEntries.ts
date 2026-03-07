import { createPubSub } from "create-pubsub";

/**
 * Represents a single log entry with timestamp and message
 */
type LogEntry = {
  /** ISO timestamp of when the log entry was created */
  timestamp: string;
  /** The log message content */
  message: string;
  /** Unique identifier for the log entry */
  id: string;
};

/**
 * PubSub instance for managing log entries across the application
 */
export const logEntriesPubSub = createPubSub<LogEntry[]>([]);

const [updateLogEntries, , getLogEntries] = logEntriesPubSub;

/**
 * Adds a new log entry with the current timestamp
 * @param message - The log message to add
 */
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
