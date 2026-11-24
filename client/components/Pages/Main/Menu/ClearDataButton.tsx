import { Button, Stack, Text } from "@mantine/core";
import Dexie from "dexie";
import { useState } from "react";
import { useLocation } from "wouter";
import { addLogEntry } from "@/modules/logEntries";

interface ClearDataState {
  isClearingData: boolean;
  hasClearedData: boolean;
}

export default function ClearDataButton() {
  const [state, setState] = useState<ClearDataState>({
    isClearingData: false,
    hasClearedData: false,
  });
  const [, navigate] = useLocation();

  const handleClearDataButtonClick = async () => {
    const sureToDelete = self.confirm(
      "Are you sure you want to clear all data? This resets the settings, deletes the cached files (including downloaded AI models) and permanently deletes all your saved searches, AI responses and chat messages. This cannot be undone.",
    );

    if (!sureToDelete) return;

    addLogEntry("User initiated data clearing");

    setState((prev) => ({ ...prev, isClearingData: true }));

    let clearedSuccessfully = false;

    try {
      self.localStorage.clear();

      if (self.caches) {
        try {
          for (const cacheName of await self.caches.keys()) {
            try {
              await self.caches.delete(cacheName);
            } catch (error) {
              addLogEntry(
                `Error deleting cache ${cacheName}: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              );
            }
          }
        } catch (error) {
          addLogEntry(
            `Error listing caches: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }

      try {
        const dbNames = await Dexie.getDatabaseNames();

        for (const dbName of dbNames) {
          await Dexie.delete(dbName);
          addLogEntry(`Deleted database: ${dbName}`);
        }
      } catch (error) {
        addLogEntry(
          `Error deleting databases: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }

      const { clearWllamaCache } = await import("../../../../modules/wllama");

      await clearWllamaCache();

      clearedSuccessfully = true;
      addLogEntry("All data cleared successfully");
    } catch (error) {
      addLogEntry(
        `Error clearing data: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      setState((prev) => ({
        ...prev,
        isClearingData: false,
        hasClearedData: clearedSuccessfully,
      }));

      navigate("/", { replace: true });

      self.location.reload();
    }
  };

  return (
    <Stack gap="xs">
      <Button
        onClick={handleClearDataButtonClick}
        variant="default"
        loading={state.isClearingData}
        loaderProps={{ type: "bars" }}
        disabled={state.hasClearedData}
      >
        {state.hasClearedData ? "Data cleared" : "Clear all data"}
      </Button>
      <Text size="xs" c="dimmed">
        Reset settings, delete cached files and erase your search and chat
        history.
      </Text>
    </Stack>
  );
}
