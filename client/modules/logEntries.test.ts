import { beforeEach, describe, expect, it } from "vitest";
import { addLogEntry, logEntriesPubSub, MAX_LOG_ENTRIES } from "./logEntries";

const [updateLogEntries, , getLogEntries] = logEntriesPubSub;

describe("addLogEntry", () => {
  beforeEach(() => {
    updateLogEntries([]);
  });

  it("appends entries in order below the cap", () => {
    addLogEntry("first");
    addLogEntry("second");

    expect(getLogEntries().map((entry) => entry.message)).toEqual([
      "first",
      "second",
    ]);
  });

  it("keeps only the newest entries once the cap is exceeded", () => {
    for (let i = 0; i < MAX_LOG_ENTRIES + 5; i++) {
      addLogEntry(`entry ${i}`);
    }

    const entries = getLogEntries();
    expect(entries).toHaveLength(MAX_LOG_ENTRIES);
    expect(entries[0].message).toBe("entry 5");
    expect(entries.at(-1)?.message).toBe(`entry ${MAX_LOG_ENTRIES + 4}`);
  });

  it("publishes a new array on every append", () => {
    for (let i = 0; i < MAX_LOG_ENTRIES; i++) {
      addLogEntry(`entry ${i}`);
    }
    const before = getLogEntries();

    addLogEntry("one more");

    expect(getLogEntries()).not.toBe(before);
  });
});
