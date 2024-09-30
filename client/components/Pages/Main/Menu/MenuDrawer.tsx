import { lazy, Suspense } from "react";
import {
  Drawer,
  Accordion,
  ActionIcon,
  HoverCard,
  Stack,
  Group,
  Center,
  FocusTrap,
} from "@mantine/core";
import { IconBrandGithub } from "@tabler/icons-react";
import { repository } from "../../../../../package.json";
import prettyMilliseconds from "pretty-ms";
import { getSemanticVersion } from "../../../../modules/stringFormatters";
import { addLogEntry } from "../../../../modules/logEntries";

const AISettingsForm = lazy(() => import("./AISettingsForm"));
const ActionsForm = lazy(() => import("./ActionsForm"));
const InterfaceSettingsForm = lazy(() => import("./InterfaceSettingsForm"));

export default function MenuDrawer({
  opened,
  onClose,
}: {
  opened: boolean;
  onClose: () => void;
}) {
  const repoName = repository.url.split("/").pop();

  return (
    <Drawer
      opened={opened}
      position="right"
      onClose={onClose}
      size="md"
      title={
        <Group gap="xs">
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
          <HoverCard shadow="md" withArrow>
            <HoverCard.Target>
              <Center>{repoName}</Center>
            </HoverCard.Target>
            <HoverCard.Dropdown>
              <Stack gap="xs">
                <Center>{repoName}</Center>
                <Center>
                  {`v${getSemanticVersion(VITE_BUILD_DATE_TIME)}+${VITE_COMMIT_SHORT_HASH}`}
                </Center>
                <Center>
                  Released{" "}
                  {prettyMilliseconds(
                    new Date().getTime() -
                      new Date(VITE_BUILD_DATE_TIME).getTime(),
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
        <Accordion variant="separated" multiple>
          <Accordion.Item value="aiSettings">
            <Accordion.Control>AI Settings</Accordion.Control>
            <Accordion.Panel>
              <Suspense>
                <AISettingsForm />
              </Suspense>
            </Accordion.Panel>
          </Accordion.Item>
          <Accordion.Item value="interfaceSettings">
            <Accordion.Control>Interface Settings</Accordion.Control>
            <Accordion.Panel>
              <Suspense>
                <InterfaceSettingsForm />
              </Suspense>
            </Accordion.Panel>
          </Accordion.Item>
          <Accordion.Item value="actions">
            <Accordion.Control>Actions</Accordion.Control>
            <Accordion.Panel>
              <Suspense>
                <ActionsForm />
              </Suspense>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      </Drawer.Body>
    </Drawer>
  );
}
