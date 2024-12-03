import { Button, Stack, Text } from "@mantine/core";
import { useState } from "react";
import { useLocation } from "wouter";
import { addLogEntry } from "../../../../modules/logEntries";

export default function ClearDataButton() {
  const [isClearingData, setIsClearingData] = useState(false);
  const [hasClearedData, setHasClearedData] = useState(false);
  const [, navigate] = useLocation();

  const handleClearDataButtonClick = async () => {
    const sureToDelete = self.confirm(
      "Are you sure you want to reset the settings and delete all files in cache?",
    );

    if (!sureToDelete) return;

    addLogEntry("User initiated data clearing");

    setIsClearingData(true);

    self.localStorage.clear();

    for (const cacheName of await self.caches.keys()) {
      await self.caches.delete(cacheName);
    }

    for (const databaseInfo of await self.indexedDB.databases()) {
      if (databaseInfo.name) self.indexedDB.deleteDatabase(databaseInfo.name);
    }

    const { clearWllamaCache } = await import("../../../../modules/wllama");

    await clearWllamaCache();

    setIsClearingData(false);

    setHasClearedData(true);

    addLogEntry("All data cleared successfully");

    navigate("/", { replace: true });

    self.location.reload();
  };

  return (
    <Stack gap="xs">
      <Button
        onClick={handleClearDataButtonClick}
        variant="default"
        loading={isClearingData}
        loaderProps={{ type: "bars" }}
        disabled={hasClearedData}
      >
        {hasClearedData ? "Data cleared" : "Clear all data"}
      </Button>
      <Text size="xs" c="dimmed">
        Reset settings and delete all files in cache to free up space.
      </Text>
    </Stack>
  );
}
