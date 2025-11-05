import {
  Alert,
  Button,
  Group,
  Modal,
  NumberInput,
  Stack,
  Switch,
  Text,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import { IconInfoCircle } from "@tabler/icons-react";
import { usePubSub } from "create-pubsub/react";
import { useState } from "react";
import { useSearchHistory } from "../../hooks/useSearchHistory";
import { addLogEntry } from "../../modules/logEntries";
import { settingsPubSub } from "../../modules/pubSub";

interface HistorySettingsProps {
  onClose?: () => void;
}

export default function HistorySettings({ onClose }: HistorySettingsProps) {
  const [settings, setSettings] = usePubSub(settingsPubSub);
  const { recentSearches, clearAll } = useSearchHistory();
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const form = useForm({
    initialValues: {
      enableHistory: settings.enableHistory,
      historyMaxEntries: settings.historyMaxEntries,
      historyAutoCleanup: settings.historyAutoCleanup,
      historyRetentionDays: settings.historyRetentionDays,
    },
    onValuesChange: (values) => {
      setSettings({
        ...settings,
        ...values,
      });
    },
  });

  const handleClearHistory = async () => {
    try {
      await clearAll();
      setShowClearConfirm(false);
      notifications.show({
        title: "History Cleared",
        message: "All search history has been cleared",
        color: "blue",
      });
      addLogEntry("User cleared all search history");
    } catch (_) {
      notifications.show({
        title: "Clear Failed",
        message: "Failed to clear history. Please try again.",
        color: "red",
      });
    }
  };

  return (
    <>
      <Stack gap="md" p="md">
        <Switch
          {...form.getInputProps("enableHistory", {
            type: "checkbox",
          })}
          label="Enable Search History"
          description="Store your searches for quick access and suggestions"
        />

        {form.values.enableHistory && (
          <>
            <NumberInput
              {...form.getInputProps("historyMaxEntries")}
              label="Maximum Entries"
              description="Maximum number of searches to keep in history"
              min={10}
              max={10000}
              step={50}
            />

            <Switch
              {...form.getInputProps("historyAutoCleanup", {
                type: "checkbox",
              })}
              label="Automatic Cleanup"
              description="Automatically remove old entries to maintain performance"
            />

            {form.values.historyAutoCleanup && (
              <NumberInput
                {...form.getInputProps("historyRetentionDays")}
                label="Retention Days"
                min={0}
              />
            )}

            <Button
              color="default"
              variant="default"
              onClick={() => setShowClearConfirm(true)}
              disabled={recentSearches.length === 0}
            >
              Clear all history
            </Button>

            {onClose && (
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
            )}
          </>
        )}
      </Stack>

      <Modal
        opened={showClearConfirm}
        onClose={() => setShowClearConfirm(false)}
        title="Clear Search History"
        centered
      >
        <Stack gap="md">
          <Alert color="orange" icon={<IconInfoCircle size={16} />}>
            This action will permanently delete all {recentSearches.length}{" "}
            search entries. This cannot be undone.
          </Alert>

          <Text size="sm">
            Are you sure you want to clear your entire search history?
          </Text>

          <Group justify="flex-end" gap="sm">
            <Button
              variant="subtle"
              color="default"
              onClick={handleClearHistory}
            >
              Clear History
            </Button>
            <Button
              variant="default"
              color="default"
              onClick={() => setShowClearConfirm(false)}
            >
              Cancel
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
