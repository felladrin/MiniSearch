import { useEffect, useState } from "react";
import { addLogEntry } from "@/modules/logEntries";
import type { defaultSettings } from "@/modules/settings";
import { fetchHordeModels } from "@/modules/textGenerationWithHorde";
import type { ModelOption } from "../types";

/**
 * Type alias for the settings object
 */
type Settings = typeof defaultSettings;

/**
 * Hook for fetching and managing AI Horde models
 * @param settings - Application settings object
 * @returns Array of available AI Horde models formatted as ModelOption[]
 */
export const useHordeModels = (settings: Settings) => {
  const [hordeModels, setHordeModels] = useState<ModelOption[]>([]);

  useEffect(() => {
    /**
     * Fetches available models from AI Horde and formats them for UI
     */
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
