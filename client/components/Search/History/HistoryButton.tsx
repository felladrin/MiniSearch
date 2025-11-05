import { Button } from "@mantine/core";
import { usePubSub } from "create-pubsub/react";
import { lazy, Suspense, useCallback, useState } from "react";
import type { SearchEntry } from "../../../modules/history";
import { addLogEntry } from "../../../modules/logEntries";
import { settingsPubSub } from "../../../modules/pubSub";

const HistoryDrawer = lazy(() => import("./HistoryDrawer"));

interface HistoryState {
  isDrawerOpen: boolean;
}

interface HistoryButtonProps {
  onSearchSelect?: (entry: SearchEntry) => void;
}

export default function HistoryButton({ onSearchSelect }: HistoryButtonProps) {
  const [state, setState] = useState<HistoryState>({
    isDrawerOpen: false,
  });
  const [settings] = usePubSub(settingsPubSub);
  const isEnabled = settings.enableHistory;

  const openDrawer = useCallback(() => {
    setState((prev) => ({ ...prev, isDrawerOpen: true }));
    addLogEntry("User opened the search history");
  }, []);

  const closeDrawer = useCallback(() => {
    setState((prev) => ({ ...prev, isDrawerOpen: false }));
    addLogEntry("User closed the search history");
  }, []);

  return (
    <>
      {isEnabled && (
        <Button size="xs" onClick={openDrawer} variant="default">
          History
        </Button>
      )}

      {state.isDrawerOpen && (
        <Suspense fallback={null}>
          <HistoryDrawer
            opened={state.isDrawerOpen}
            onClose={closeDrawer}
            onSearchSelect={(entry) => {
              if (onSearchSelect) {
                onSearchSelect(entry);
              }
              closeDrawer();
            }}
          />
        </Suspense>
      )}
    </>
  );
}
