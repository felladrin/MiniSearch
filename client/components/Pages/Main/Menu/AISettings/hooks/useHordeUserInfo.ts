import { withTimeout } from "@shared/withTimeout";
import { useEffect, useState } from "react";
import { addLogEntry } from "@/modules/logEntries";
import type { defaultSettings } from "@/modules/settings";
import {
  aiHordeDefaultApiKey,
  fetchHordeUserInfo,
} from "@/modules/textGenerationWithHorde";
import type { HordeUserInfo } from "../types";

type Settings = typeof defaultSettings;

/** How long `/find_user` may take before the user info falls back to none. */
const HORDE_USER_INFO_TIMEOUT_MS = 10_000;

/**
 * The logged-in Horde user, or null when the key is empty or the anonymous one.
 * A key change aborts the request for the previous key, so a slow answer for an
 * old or cleared key can never show up afterwards.
 */
export const useHordeUserInfo = (settings: Settings) => {
  const [hordeUserInfo, setHordeUserInfo] = useState<HordeUserInfo | null>(
    null,
  );

  useEffect(() => {
    if (settings.inferenceType !== "horde") return;

    if (
      !settings.hordeApiKey ||
      settings.hordeApiKey === aiHordeDefaultApiKey
    ) {
      setHordeUserInfo(null);
      return;
    }

    const controller = new AbortController();

    async function fetchUserInfo() {
      try {
        const userInfo = await fetchHordeUserInfo(
          settings.hordeApiKey,
          withTimeout(controller.signal, HORDE_USER_INFO_TIMEOUT_MS),
        );
        if (controller.signal.aborted) return;
        setHordeUserInfo(userInfo);
      } catch (error) {
        if (controller.signal.aborted) return;
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        addLogEntry(`Error fetching AI Horde user info: ${errorMessage}`);
        setHordeUserInfo(null);
      }
    }

    fetchUserInfo();
    return () => controller.abort();
  }, [settings.inferenceType, settings.hordeApiKey]);

  return hordeUserInfo;
};
