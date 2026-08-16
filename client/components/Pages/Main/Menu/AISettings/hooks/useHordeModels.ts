import { useEffect, useState } from "react";
import { addLogEntry } from "@/modules/logEntries";
import type { defaultSettings } from "@/modules/settings";
import { fetchHordeModels } from "@/modules/textGenerationWithHorde";
import type { ModelOption } from "../types";

type Settings = typeof defaultSettings;

/** AI Horde models as select options; only fetched while Horde is the selected backend. */
export const useHordeModels = (settings: Settings) => {
  const [hordeModels, setHordeModels] = useState<ModelOption[]>([]);

  useEffect(() => {
    async function fetchAvailableHordeModels() {
      try {
        const models = await fetchHordeModels();
        const formattedModels = models.map((model) => ({
          label: model.name,
          value: model.name,
        }));
        setHordeModels(formattedModels);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        addLogEntry(`Error fetching AI Horde models: ${errorMessage}`);
        setHordeModels([]);
      }
    }

    if (settings.inferenceType === "horde") {
      fetchAvailableHordeModels();
    }
  }, [settings.inferenceType]);

  return hordeModels;
};
