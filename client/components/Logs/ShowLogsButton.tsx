import { Button, Center, Loader, Stack, Text } from "@mantine/core";
import { lazy, Suspense, useState } from "react";
import { addLogEntry } from "../../modules/logEntries";

const LogsModal = lazy(() => import("./LogsModal"));

export default function ShowLogsButton() {
  const [isLogsModalOpen, setLogsModalOpen] = useState(false);

  const handleShowLogsButtonClick = () => {
    addLogEntry("User opened the logs modal");
    setLogsModalOpen(true);
  };

  const handleCloseLogsButtonClick = () => {
    addLogEntry("User closed the logs modal");
    setLogsModalOpen(false);
  };

  return (
    <Stack gap="xs">
      <Suspense
        fallback={
          <Center>
            <Loader color="gray" type="bars" />
          </Center>
        }
      >
        <Button size="sm" onClick={handleShowLogsButtonClick} variant="default">
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
  );
}
