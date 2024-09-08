import { useState } from "react";
import { SettingsForm } from "./SettingsForm";
import { ActionsForm } from "./ActionsForm";
import { Button, Drawer, Panel, PanelGroup, IconButton, Stack } from "rsuite";
import { Icon } from "@rsuite/icons";
import { FaGithub } from "react-icons/fa";
import { repository } from "../../../../../../package.json";

export function MenuButton() {
  const [isDrawerOpen, setDrawerOpen] = useState(false);

  const openDrawer = () => {
    setDrawerOpen(true);
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
  };

  const repoName = repository.url.split("/").pop();

  return (
    <>
      <Button
        size="sm"
        onClick={(event) => {
          event.preventDefault();
          if (isDrawerOpen) {
            closeDrawer();
          } else {
            openDrawer();
          }
        }}
      >
        Menu
      </Button>
      <Drawer open={isDrawerOpen} onClose={closeDrawer} size="xs">
        <Drawer.Header>
          <Drawer.Title>
            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
            >
              {repoName}
              <IconButton
                appearance="subtle"
                href={repository.url}
                target="_blank"
                icon={<Icon as={FaGithub} />}
                circle
              />
            </Stack>
          </Drawer.Title>
        </Drawer.Header>
        <Drawer.Body style={{ padding: 0 }}>
          <PanelGroup>
            <Panel header="Settings">
              <SettingsForm />
            </Panel>
            <Panel header="Actions">
              <ActionsForm />
            </Panel>
          </PanelGroup>
        </Drawer.Body>
      </Drawer>
    </>
  );
}
