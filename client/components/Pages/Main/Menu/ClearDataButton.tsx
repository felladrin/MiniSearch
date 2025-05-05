import { Button, Stack, Text } from "@mantine/core";
import Dexie from "dexie";
import { useState } from "react";
import { useLocation } from "wouter";
import { addLogEntry } from "../../../../modules/logEntries";

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
      "Are you sure you want to reset the settings and delete all files in cache?",
    );

    if (!sureToDelete) return;

    addLogEntry("User initiated data clearing");

    setState((prev) => ({ ...prev, isClearingData: true }));

    self.localStorage.clear();

    for (const cacheName of await self.caches.keys()) {
      await self.caches.delete(cacheName);
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

    setState((prev) => ({
      ...prev,
      isClearingData: false,
      hasClearedData: true,
    }));

    addLogEntry("All data cleared successfully");

    navigate("/", { replace: true });

    self.location.reload();
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
        Reset settings and delete all files in cache to free up space.
      </Text>
    </Stack>
  );
}
