import { listOpenAiCompatibleModels } from "@shared/openaiModels";
import { useEffect, useState } from "react";
import { addLogEntry } from "@/modules/logEntries";
import type { defaultSettings } from "@/modules/settings";
import type { ModelOption } from "../types";

type Settings = typeof defaultSettings;

/**
 * Falls back to a free-text model input when the API does not list its models
 * or cannot be reached, so the setting stays usable either way.
 *
 * Settings change on every keystroke, so each change aborts the request of the
 * previous one: only the latest base URL and key can update the list.
 */
export const useOpenAiModels = (settings: Settings) => {
  const [openAiModels, setOpenAiModels] = useState<ModelOption[]>([]);
  const [useTextInput, setUseTextInput] = useState(false);

  useEffect(() => {
    if (settings.inferenceType !== "openai") return;

    if (!settings.openAiApiBaseUrl) {
      // No server: forget the previous server's models.
      setOpenAiModels([]);
      setUseTextInput(false);
      return;
    }

    const controller = new AbortController();

    async function fetchOpenAiModels() {
      try {
        const models = await listOpenAiCompatibleModels(
          settings.openAiApiBaseUrl,
          settings.openAiApiKey,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        const uniqueModelIds = [...new Set(models.map((m) => m.id))];
        const options: ModelOption[] = uniqueModelIds.map((id) => ({
          label: id,
          value: id,
        }));

        setOpenAiModels(options);
        setUseTextInput(options.length === 0);
      } catch (error) {
        if (controller.signal.aborted) return;
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        addLogEntry(`Error fetching OpenAI models: ${errorMessage}`);
        setOpenAiModels([]);
        setUseTextInput(true);
      }
    }

    fetchOpenAiModels();
    return () => controller.abort();
  }, [
    settings.inferenceType,
    settings.openAiApiBaseUrl,
    settings.openAiApiKey,
  ]);

  return { openAiModels, useTextInput };
};
