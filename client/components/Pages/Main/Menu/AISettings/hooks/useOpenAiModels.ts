import { useEffect, useState } from "react";
import { listOpenAiCompatibleModels } from "../../../../../../../shared/openaiModels";
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
        const models = await listOpenAiCompatibleModels(
          settings.openAiApiBaseUrl,
          settings.openAiApiKey,
        );
        const uniqueModelIds = [
          ...new Set(models.map((m: { id: string }) => m.id)),
        ];
        const options: ModelOption[] = uniqueModelIds.map((id) => ({
          label: id,
          value: id,
        }));

        setOpenAiModels(options);
        setUseTextInput(!Array.isArray(options) || options.length === 0);
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
