import {
  Accordion,
  ActionIcon,
  Center,
  Drawer,
  type DrawerProps,
  FocusTrap,
  Group,
  HoverCard,
  Stack,
  Tooltip,
} from "@mantine/core";
import { IconBrandGithub } from "@tabler/icons-react";
import { usePubSub } from "create-pubsub/react";
import prettyMilliseconds from "pretty-ms";
import { repository } from "../../../../../package.json";
import { appName, appVersion } from "../../../../modules/appInfo";
import { addLogEntry } from "../../../../modules/logEntries";
import { menuExpandedAccordionsPubSub } from "../../../../modules/pubSub";
import ActionsForm from "./ActionsForm";
import AISettingsForm from "./AISettings/AISettingsForm";
import InterfaceSettingsForm from "./InterfaceSettingsForm";
import SearchSettingsForm from "./SearchSettingsForm";
import VoiceSettingsForm from "./VoiceSettingsForm";

export default function MenuDrawer(drawerProps: DrawerProps) {
  const [menuExpandedAccordions, updateMenuExpandedAccordions] = usePubSub(
    menuExpandedAccordionsPubSub,
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
                <Center>{appName}</Center>
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
        <Accordion
          variant="separated"
          multiple
          value={menuExpandedAccordions}
          onChange={updateMenuExpandedAccordions}
        >
          <Accordion.Item value="aiSettings">
            <Accordion.Control>AI Settings</Accordion.Control>
            <Accordion.Panel>
              <AISettingsForm />
            </Accordion.Panel>
          </Accordion.Item>
          <Accordion.Item value="searchSettings">
            <Accordion.Control>Search Settings</Accordion.Control>
            <Accordion.Panel>
              <SearchSettingsForm />
            </Accordion.Panel>
          </Accordion.Item>
          <Accordion.Item value="interfaceSettings">
            <Accordion.Control>Interface Settings</Accordion.Control>
            <Accordion.Panel>
              <InterfaceSettingsForm />
            </Accordion.Panel>
          </Accordion.Item>
          <Accordion.Item value="voiceSettings">
            <Accordion.Control>Voice Settings</Accordion.Control>
            <Accordion.Panel>
              <VoiceSettingsForm />
            </Accordion.Panel>
          </Accordion.Item>
          <Accordion.Item value="actions">
            <Accordion.Control>Actions</Accordion.Control>
            <Accordion.Panel>
              <ActionsForm />
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      </Drawer.Body>
    </Drawer>
  );
}
