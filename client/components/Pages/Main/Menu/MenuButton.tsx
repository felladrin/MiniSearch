import { Button } from "@mantine/core";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { useDrawerState } from "@/hooks/useDrawerState";
import { addLogEntry } from "@/modules/logEntries";

const MenuDrawer = lazy(() => import("./MenuDrawer"));

export default function MenuButton() {
  const { isDrawerOpen, openDrawer, closeDrawer } = useDrawerState(
    "User opened the menu",
    "User closed the menu",
  );
  const [isDrawerLoaded, setIsDrawerLoaded] = useState(false);

  const handleDrawerLoad = useCallback(() => {
    if (!isDrawerLoaded) {
      addLogEntry("Menu drawer loaded");
      setIsDrawerLoaded(true);
    }
  }, [isDrawerLoaded]);

  return (
    <>
      <Button
        size="xs"
        onClick={openDrawer}
        variant="default"
        loading={isDrawerOpen && !isDrawerLoaded}
      >
        Menu
      </Button>
      {(isDrawerOpen || isDrawerLoaded) && (
        <Suspense fallback={<SuspenseListener onUnload={handleDrawerLoad} />}>
          <MenuDrawer onClose={closeDrawer} opened={isDrawerOpen} />
        </Suspense>
      )}
    </>
  );
}

function SuspenseListener({ onUnload }: { onUnload: () => void }) {
  useEffect(() => {
    return () => onUnload();
  }, [onUnload]);

  return null;
}
