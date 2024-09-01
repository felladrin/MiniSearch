import { useState } from "react";
import { SettingsForm } from "./SettingsForm";
import { ActionsForm } from "./ActionsForm";
import { Button, Drawer, Panel, PanelGroup } from "rsuite";

export function MenuButton() {
  const [isDrawerOpen, setDrawerOpen] = useState(false);

  const openDrawer = () => {
    setDrawerOpen(true);
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
  };

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
          <Drawer.Title>Menu</Drawer.Title>
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
