import { Button } from "@mantine/core";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { addLogEntry } from "../../../../modules/logEntries";

const MenuDrawer = lazy(() => import("./MenuDrawer"));

interface MenuState {
  isDrawerOpen: boolean;
  isDrawerLoaded: boolean;
}

export default function MenuButton() {
  const [state, setState] = useState<MenuState>({
    isDrawerOpen: false,
    isDrawerLoaded: false,
  });

  const openDrawer = useCallback(() => {
    setState((prev) => ({ ...prev, isDrawerOpen: true }));
    addLogEntry("User opened the menu");
  }, []);

  const closeDrawer = useCallback(() => {
    setState((prev) => ({ ...prev, isDrawerOpen: false }));
    addLogEntry("User closed the menu");
  }, []);

  const handleDrawerLoad = useCallback(() => {
    if (!state.isDrawerLoaded) {
      addLogEntry("Menu drawer loaded");
      setState((prev) => ({ ...prev, isDrawerLoaded: true }));
    }
  }, [state.isDrawerLoaded]);

  return (
    <>
      <Button
        size="xs"
        onClick={openDrawer}
        variant="default"
        loading={state.isDrawerOpen && !state.isDrawerLoaded}
      >
        Menu
      </Button>
      {(state.isDrawerOpen || state.isDrawerLoaded) && (
        <Suspense fallback={<SuspenseListener onUnload={handleDrawerLoad} />}>
          <MenuDrawer onClose={closeDrawer} opened={state.isDrawerOpen} />
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
