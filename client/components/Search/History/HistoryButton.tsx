import { Button } from "@mantine/core";
import { usePubSub } from "create-pubsub/react";
import { lazy, Suspense } from "react";
import { useDrawerState } from "@/hooks/useDrawerState";
import type { SearchEntry } from "@/modules/history";
import { settingsPubSub } from "@/modules/pubSub";

const HistoryDrawer = lazy(() => import("./HistoryDrawer"));

interface HistoryButtonProps {
  onSearchSelect?: (entry: SearchEntry) => void;
}

export default function HistoryButton({ onSearchSelect }: HistoryButtonProps) {
  const { isDrawerOpen, openDrawer, closeDrawer } = useDrawerState(
    "User opened the search history",
    "User closed the search history",
  );
  const [settings] = usePubSub(settingsPubSub);
  const isEnabled = settings.enableHistory;

  return (
    <>
      {isEnabled && (
        <Button size="xs" onClick={openDrawer} variant="default">
          History
        </Button>
      )}

      {isDrawerOpen && (
        <Suspense fallback={null}>
          <HistoryDrawer
            opened={isDrawerOpen}
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
