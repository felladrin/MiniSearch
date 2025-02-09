import { useEffect, useState } from "react";
import { addLogEntry } from "../../../../../../modules/logEntries";
import type { defaultSettings } from "../../../../../../modules/settings";
import type { ModelOption } from "../types";

type Settings = typeof defaultSettings;

export const useOpenAiModels = (settings: Settings) => {
  const [openAiModels, setOpenAiModels] = useState<ModelOption[]>([]);
  const [useTextInput, setUseTextInput] = useState(false);

  useEffect(() => {
    async function fetchOpenAiModels() {
      try {
        const response = await fetch(`${settings.openAiApiBaseUrl}/models`, {
          headers: {
            Authorization: `Bearer ${settings.openAiApiKey}`,
          },
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch models: ${response.statusText}`);
        }

        const data = await response.json();
        const models = data.data.map((model: { id: string }) => ({
          label: model.id,
          value: model.id,
        }));

        setOpenAiModels(models);
        setUseTextInput(!Array.isArray(models) || models.length === 0);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        addLogEntry(`Error fetching OpenAI models: ${errorMessage}`);
        setOpenAiModels([]);
        setUseTextInput(true);
      }
    }

    if (settings.inferenceType === "openai" && settings.openAiApiBaseUrl) {
      fetchOpenAiModels();
    }
  }, [
    settings.inferenceType,
    settings.openAiApiBaseUrl,
    settings.openAiApiKey,
  ]);

  return { openAiModels, useTextInput };
};
