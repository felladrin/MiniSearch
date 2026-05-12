import { useCallback, useState } from "react";
import { addLogEntry } from "@/modules/logEntries";

/** Manages open/close state for a drawer, logging the provided messages on each transition. */
export function useDrawerState(openMessage: string, closeMessage: string) {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const openDrawer = useCallback(() => {
    setIsDrawerOpen(true);
    addLogEntry(openMessage);
  }, [openMessage]);

  const closeDrawer = useCallback(() => {
    setIsDrawerOpen(false);
    addLogEntry(closeMessage);
  }, [closeMessage]);

  return { isDrawerOpen, openDrawer, closeDrawer };
}
