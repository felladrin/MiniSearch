import { useState } from "react";
import { SettingsForm } from "./SettingsForm";
import { ActionsForm } from "./ActionsForm/ActionsForm";
import {
  Button,
  Drawer,
  Accordion,
  ActionIcon,
  Tooltip,
  Group,
  Center,
} from "@mantine/core";
import { IconBrandGithub } from "@tabler/icons-react";
import { repository } from "../../../../../../package.json";
import prettyMilliseconds from "pretty-ms";
import { getSemanticVersion } from "../../../../../modules/stringFormatters";
import { addLogEntry } from "../../../../../modules/logEntries";

export function MenuButton() {
  const [isDrawerOpen, setDrawerOpen] = useState(false);

  const openDrawer = () => {
    setDrawerOpen(true);
    addLogEntry("User opened the menu");
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    addLogEntry("User closed the menu");
  };

  const repoName = repository.url.split("/").pop();

  return (
    <>
      <Button size="xs" onClick={openDrawer} variant="default">
        Menu
      </Button>
      <Drawer
        opened={isDrawerOpen}
        position="right"
        onClose={closeDrawer}
        size="md"
        title={
          <Group>
            <ActionIcon
              variant="subtle"
              component="a"
              color="var(--mantine-color-text)"
              href={repository.url}
              target="_blank"
              size="sm"
              onClick={() => addLogEntry("User clicked the GitHub link")}
            >
              <IconBrandGithub />
            </ActionIcon>
            <Tooltip
              label={
                <>
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
                </>
              }
            >
              <span>{repoName}</span>
            </Tooltip>
          </Group>
        }
      >
        <Drawer.Body>
          <Accordion variant="separated" multiple>
            <Accordion.Item value="settings">
              <Accordion.Control>Settings</Accordion.Control>
              <Accordion.Panel>
                <SettingsForm />
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
    </>
  );
}
