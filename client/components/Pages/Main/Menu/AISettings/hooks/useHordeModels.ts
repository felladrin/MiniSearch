import { withTimeout } from "@shared/withTimeout";
import { useEffect, useState } from "react";
import { addLogEntry } from "@/modules/logEntries";
import type { defaultSettings } from "@/modules/settings";
import { fetchHordeModels } from "@/modules/textGenerationWithHorde";
import type { ModelOption } from "../types";

type Settings = typeof defaultSettings;

/** How long `/status/models` may take before the list falls back to empty. */
const HORDE_MODELS_TIMEOUT_MS = 10_000;

/**
 * AI Horde models as select options; only fetched while Horde is the selected
 * backend. Switching away aborts the request in flight.
 */
export const useHordeModels = (settings: Settings) => {
  const [hordeModels, setHordeModels] = useState<ModelOption[]>([]);

  useEffect(() => {
    if (settings.inferenceType !== "horde") return;

    const controller = new AbortController();

    async function fetchAvailableHordeModels() {
      try {
        const models = await fetchHordeModels(
          withTimeout(controller.signal, HORDE_MODELS_TIMEOUT_MS),
        );
        if (controller.signal.aborted) return;
        setHordeModels(
          models.map((model) => ({ label: model.name, value: model.name })),
        );
      } catch (error) {
        if (controller.signal.aborted) return;
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        addLogEntry(`Error fetching AI Horde models: ${errorMessage}`);
        setHordeModels([]);
      }
    }

    fetchAvailableHordeModels();
    return () => controller.abort();
  }, [settings.inferenceType]);

  return hordeModels;
};
