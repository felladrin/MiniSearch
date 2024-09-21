import { Text, Button, Stack, Loader, Center } from "@mantine/core";
import { Suspense, useState } from "react";
import { lazy } from "react";
import { addLogEntry } from "../../modules/logEntries";
import { notifications } from "@mantine/notifications";

const LogsModal = lazy(() => import("../Logs/LogsModal"));

export function ActionsForm() {
  const [isLogsModalOpen, setLogsModalOpen] = useState(false);

  const handleClearDataButtonClick = async () => {
    const sureToDelete = window.confirm(
      "Are you sure you want to reset the settings and delete all files in cache?",
    );

    if (!sureToDelete) return;

    addLogEntry("User initiated data clearing");

    notifications.show({
      title: "Clearing data...",
      message: "Please wait while we clear your data.",
      color: "blue",
    });

    window.localStorage.clear();

    for (const cacheName of await window.caches.keys()) {
      await window.caches.delete(cacheName);
    }

    for (const databaseInfo of await window.indexedDB.databases()) {
      if (databaseInfo.name) window.indexedDB.deleteDatabase(databaseInfo.name);
    }

    notifications.show({
      title: "Data cleared!",
      message: "All data has been successfully cleared.",
      color: "green",
      onClose: () => window.location.reload(),
    });

    addLogEntry("All data cleared successfully");
  };

  const handleShowLogsButtonClick = () => {
    addLogEntry("User opened the logs modal");
    setLogsModalOpen(true);
  };

  const handleCloseLogsButtonClick = () => {
    addLogEntry("User closed the logs modal");
    setLogsModalOpen(false);
  };

  return (
    <Stack gap="lg">
      <Stack gap="xs">
        <Button onClick={handleClearDataButtonClick} variant="default">
          <Stack align="flex-start" gap="xs">
            Clear all data
          </Stack>
        </Button>
        <Text size="xs" c="dimmed">
          Reset settings and delete all files in cache to free up space.
        </Text>
      </Stack>
      <Stack gap="xs">
        <Suspense
          fallback={
            <Center>
              <Loader color="gray" type="bars" />
            </Center>
          }
        >
          <Button
            size="sm"
            onClick={handleShowLogsButtonClick}
            variant="default"
          >
            Show logs
          </Button>
          <Text size="xs" c="dimmed">
            View session logs for debugging.
          </Text>
          <LogsModal
            opened={isLogsModalOpen}
            onClose={handleCloseLogsButtonClick}
          />
        </Suspense>
      </Stack>
    </Stack>
  );
}
