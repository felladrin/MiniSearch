import { useEffect, useState } from "react";
import { addLogEntry } from "@/modules/logEntries";
import type { defaultSettings } from "@/modules/settings";
import {
  aiHordeDefaultApiKey,
  fetchHordeUserInfo,
} from "@/modules/textGenerationWithHorde";
import type { HordeUserInfo } from "../types";

/**
 * Type alias for the settings object
 */
type Settings = typeof defaultSettings;

/**
 * Hook for fetching and managing AI Horde user information
 * @param settings - Application settings object
 * @returns Horde user information or null if not authenticated
 */
export const useHordeUserInfo = (settings: Settings) => {
  const [hordeUserInfo, setHordeUserInfo] = useState<HordeUserInfo | null>(
    null,
  );

  useEffect(() => {
    /**
     * Fetches user information from AI Horde API
     */
    async function fetchUserInfo() {
      try {
        if (
          settings.hordeApiKey &&
          settings.hordeApiKey !== aiHordeDefaultApiKey
        ) {
          const userInfo = await fetchHordeUserInfo(settings.hordeApiKey);
          setHordeUserInfo(userInfo);
        } else {
          setHordeUserInfo(null);
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        addLogEntry(`Error fetching AI Horde user info: ${errorMessage}`);
        setHordeUserInfo(null);
      }
    }

    if (settings.inferenceType === "horde") {
      fetchUserInfo();
    }
  }, [settings.inferenceType, settings.hordeApiKey]);

  return hordeUserInfo;
};
