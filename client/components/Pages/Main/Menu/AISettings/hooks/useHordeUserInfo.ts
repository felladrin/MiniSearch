import { useEffect, useState } from "react";
import { addLogEntry } from "../../../../../../modules/logEntries";
import type { defaultSettings } from "../../../../../../modules/settings";
import {
  aiHordeDefaultApiKey,
  fetchHordeUserInfo,
} from "../../../../../../modules/textGenerationWithHorde";
import type { HordeUserInfo } from "../types";

type Settings = typeof defaultSettings;

export const useHordeUserInfo = (settings: Settings) => {
  const [hordeUserInfo, setHordeUserInfo] = useState<HordeUserInfo | null>(
    null,
  );

  useEffect(() => {
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
