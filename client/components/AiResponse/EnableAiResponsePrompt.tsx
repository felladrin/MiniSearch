import {
  ActionIcon,
  Alert,
  Button,
  Grid,
  Group,
  Popover,
  Stack,
  Text,
} from "@mantine/core";
import { IconCheck, IconInfoCircle, IconX } from "@tabler/icons-react";

interface EnableAiResponsePromptProps {
  onAccept: () => void;
  onDecline: () => void;
}

export default function EnableAiResponsePrompt({
  onAccept,
  onDecline,
}: EnableAiResponsePromptProps) {
  const helpContent = (
    <Stack gap="xs" p="xs">
      <Text size="sm">
        MiniSearch is a web-searching app with an integrated AI assistant.
      </Text>
      <Text size="sm">
        With AI Responses enabled, it will generate summaries and answer
        questions based on search results.
      </Text>
      <Text size="sm">
        If disabled, it will function as a classic web search tool.
      </Text>
      <Text size="sm" c="dimmed" component="em">
        You can toggle this feature at anytime through the Menu.
      </Text>
    </Stack>
  );

  return (
    <Alert variant="light" color="blue" p="xs">
      <Grid justify="space-between" align="center">
        <Grid.Col span="content">
          <Group gap="xs">
            <Text fw={500}>Enable AI Responses?</Text>
            <Popover
              width={300}
              styles={{ dropdown: { maxWidth: "92vw" } }}
              position="bottom"
              withArrow
              shadow="md"
            >
              <Popover.Target>
                <ActionIcon variant="subtle" color="blue" size="sm">
                  <IconInfoCircle size="1rem" />
                </ActionIcon>
              </Popover.Target>
              <Popover.Dropdown>{helpContent}</Popover.Dropdown>
            </Popover>
          </Group>
        </Grid.Col>
        <Grid.Col span="auto">
          <Group justify="end">
            <Button
              variant="subtle"
              color="gray"
              leftSection={<IconX size="1rem" />}
              onClick={onDecline}
              size="xs"
            >
              No, thanks
            </Button>
            <Button
              leftSection={<IconCheck size="1rem" />}
              onClick={onAccept}
              size="xs"
            >
              Yes, please
            </Button>
          </Group>
        </Grid.Col>
      </Grid>
    </Alert>
  );
}
