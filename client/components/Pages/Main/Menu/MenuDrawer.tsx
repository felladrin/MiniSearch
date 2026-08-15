import {
  Accordion,
  ActionIcon,
  Alert,
  Center,
  Code,
  Drawer,
  type DrawerProps,
  FocusTrap,
  Group,
  HoverCard,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { repository } from "@root/package.json";
import { IconBrandGithub, IconBulb } from "@tabler/icons-react";
import { usePubSub } from "create-pubsub/react";
import prettyMilliseconds from "pretty-ms";
import HistorySettings from "@/components/Settings/HistorySettings";
import { appName, appVersion } from "@/modules/appInfo";
import { addLogEntry } from "@/modules/logEntries";
import {
  menuExpandedAccordionsPubSub,
  showFeatureTipsPubSub,
} from "@/modules/pubSub";
import ActionsForm from "./ActionsForm";
import AISettingsForm from "./AISettings/AISettingsForm";
import InterfaceSettingsForm from "./InterfaceSettingsForm";
import SearchSettingsForm from "./SearchSettingsForm";
import VoiceSettingsForm from "./VoiceSettingsForm";

/**
 * Accordion control label with a one-line description, so each section's
 * purpose is visible while collapsed.
 */
function ControlLabel({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <>
      <Text span fw={500} display="block">
        {title}
      </Text>
      <Text span size="xs" c="dimmed" display="block">
        {description}
      </Text>
    </>
  );
}

export default function MenuDrawer(drawerProps: DrawerProps) {
  const [menuExpandedAccordions, updateMenuExpandedAccordions] = usePubSub(
    menuExpandedAccordionsPubSub,
  );
  const [showFeatureTips, setShowFeatureTips] = usePubSub(
    showFeatureTipsPubSub,
  );

  return (
    <Drawer
      {...drawerProps}
      position="right"
      size="md"
      title={
        <Group gap="xs">
          <Tooltip label="View source code on GitHub">
            <ActionIcon
              variant="subtle"
              component="a"
              color="var(--mantine-color-text)"
              href={repository.url}
              target="_blank"
              onClick={() => addLogEntry("User clicked the GitHub link")}
            >
              <IconBrandGithub size={16} />
            </ActionIcon>
          </Tooltip>
          <HoverCard shadow="md" withArrow>
            <HoverCard.Target>
              <Center>{appName}</Center>
            </HoverCard.Target>
            <HoverCard.Dropdown>
              <Stack gap="xs">
                <Center>{`v${appVersion}`}</Center>
                <Center>
                  Released{" "}
                  {prettyMilliseconds(
                    Date.now() - new Date(VITE_BUILD_DATE_TIME).getTime(),
                    {
                      compact: true,
                      verbose: true,
                    },
                  )}{" "}
                  ago
                </Center>
              </Stack>
            </HoverCard.Dropdown>
          </HoverCard>
        </Group>
      }
    >
      <FocusTrap.InitialFocus />
      <Drawer.Body>
        {showFeatureTips && (
          <Alert
            // Override Mantine's default role="alert": this is an
            // informational tips box, not an assertive alert.
            role="note"
            variant="light"
            color="blue"
            icon={<IconBulb size="1rem" />}
            title="Tips"
            withCloseButton
            closeButtonLabel="Dismiss tips"
            onClose={() => setShowFeatureTips(false)}
            mb="md"
          >
            <Stack gap="xs">
              <Text size="xs" lh="sm">
                Make it your browser's default search engine: add{" "}
                <Code>{`${self.location.origin}/?q=%s`}</Code> as a custom
                search engine (the same pattern works in a Raycast Quicklink).
              </Text>
              <Text size="xs" lh="sm">
                Turn on AI Response, then use the speaker button on an answer to
                hear it read aloud.
              </Text>
            </Stack>
          </Alert>
        )}
        <Accordion
          variant="separated"
          multiple
          value={menuExpandedAccordions}
          onChange={updateMenuExpandedAccordions}
        >
          <Accordion.Item value="aiSettings">
            <Accordion.Control>
              <ControlLabel
                title="AI Settings"
                description="AI responses, where inference runs, and reasoning"
              />
            </Accordion.Control>
            <Accordion.Panel>
              <AISettingsForm />
            </Accordion.Panel>
          </Accordion.Item>
          <Accordion.Item value="searchSettings">
            <Accordion.Control>
              <ControlLabel
                title="Search Settings"
                description="Text and image results, and how many to show"
              />
            </Accordion.Control>
            <Accordion.Panel>
              <SearchSettingsForm />
            </Accordion.Panel>
          </Accordion.Item>
          <Accordion.Item value="interfaceSettings">
            <Accordion.Control>
              <ControlLabel
                title="Interface Settings"
                description="Appearance and search-box input"
              />
            </Accordion.Control>
            <Accordion.Panel>
              <InterfaceSettingsForm />
            </Accordion.Panel>
          </Accordion.Item>
          <Accordion.Item value="historySettings">
            <Accordion.Control>
              <ControlLabel
                title="History Settings"
                description="How long and how many searches to keep"
              />
            </Accordion.Control>
            <Accordion.Panel>
              <HistorySettings />
            </Accordion.Panel>
          </Accordion.Item>
          <Accordion.Item value="voiceSettings">
            <Accordion.Control>
              <ControlLabel
                title="Voice Settings"
                description="The voice used when reading answers aloud"
              />
            </Accordion.Control>
            <Accordion.Panel>
              <VoiceSettingsForm />
            </Accordion.Panel>
          </Accordion.Item>
          <Accordion.Item value="actions">
            <Accordion.Control>
              <ControlLabel
                title="Actions"
                description="Clear stored data and view the log"
              />
            </Accordion.Control>
            <Accordion.Panel>
              <ActionsForm />
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      </Drawer.Body>
    </Drawer>
  );
}
