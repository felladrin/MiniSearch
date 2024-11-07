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
} from "@mantine/core";
import { IconBrandGithub } from "@tabler/icons-react";
import prettyMilliseconds from "pretty-ms";
import { Suspense, lazy } from "react";
import { repository } from "../../../../../package.json";
import { addLogEntry } from "../../../../modules/logEntries";
import { getSemanticVersion } from "../../../../modules/stringFormatters";

const AISettingsForm = lazy(() => import("./AISettingsForm"));
const SearchSettingsForm = lazy(() => import("./SearchSettingsForm"));
const InterfaceSettingsForm = lazy(() => import("./InterfaceSettingsForm"));
const ActionsForm = lazy(() => import("./ActionsForm"));

export default function MenuDrawer(drawerProps: DrawerProps) {
  const repoName = repository.url.split("/").pop();

  return (
    <Drawer
      {...drawerProps}
      position="right"
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
          <Accordion.Item value="searchSettings">
            <Accordion.Control>Search Settings</Accordion.Control>
            <Accordion.Panel>
              <Suspense>
                <SearchSettingsForm />
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
