import { lazy, Suspense, useState } from "react";
import { Button } from "@mantine/core";
import { addLogEntry } from "../../../../modules/logEntries";

const MenuDrawer = lazy(() => import("./MenuDrawer"));

export default function MenuButton() {
  const [isDrawerOpen, setDrawerOpen] = useState(false);

  const openDrawer = () => {
    setDrawerOpen(true);
    addLogEntry("User opened the menu");
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    addLogEntry("User closed the menu");
  };

  return (
    <>
      <Button size="xs" onClick={openDrawer} variant="default">
        Menu
      </Button>
      <Suspense>
        <MenuDrawer opened={isDrawerOpen} onClose={closeDrawer} />
      </Suspense>
    </>
  );
}
