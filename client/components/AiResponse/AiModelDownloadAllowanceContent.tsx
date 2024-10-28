import { Alert, Button, Group, Text } from "@mantine/core";
import { IconCheck, IconInfoCircle, IconX } from "@tabler/icons-react";
import { usePubSub } from "create-pubsub/react";
import { useState } from "react";
import { addLogEntry } from "../../modules/logEntries";
import { settingsPubSub } from "../../modules/pubSub";

export default function AiModelDownloadAllowanceContent() {
  const [settings, setSettings] = usePubSub(settingsPubSub);
  const [hasDeniedDownload, setDeniedDownload] = useState(false);

  const handleAccept = () => {
    setSettings({
      ...settings,
      allowAiModelDownload: true,
    });
    addLogEntry("User allowed the AI model download");
  };

  const handleDecline = () => {
    setDeniedDownload(true);
    addLogEntry("User denied the AI model download");
  };

  return hasDeniedDownload ? null : (
    <Alert
      variant="light"
      color="blue"
      title="Allow AI model download?"
      icon={<IconInfoCircle />}
    >
      <Text size="sm" mb="md">
        To obtain AI responses, a language model needs to be downloaded to your
        browser. Enabling this option lets the app store it and load it
        instantly on subsequent uses.
      </Text>
      <Text size="sm" mb="md">
        Please note that the download size ranges from 100 MB to 4 GB, depending
        on the model you select in the Menu, so it's best to avoid using mobile
        data for this.
      </Text>
      <Group justify="flex-end" mt="md">
        <Button
          variant="subtle"
          color="gray"
          leftSection={<IconX size="1rem" />}
          onClick={handleDecline}
          size="xs"
        >
          Not now
        </Button>
        <Button
          leftSection={<IconCheck size="1rem" />}
          onClick={handleAccept}
          size="xs"
        >
          Allow download
        </Button>
      </Group>
    </Alert>
  );
}
