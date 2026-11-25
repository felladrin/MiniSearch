import {
  listOpenAiCompatibleModels,
  selectRandomModel,
} from "../shared/openaiModels.ts";
import { recordModelsRefetched } from "./inferencesSinceLastRestart.ts";

/**
 * Chooses the model for each attempt of one `/inference` request. With
 * configured models, it walks them in order of preference and then once
 * more, so a single configured model also gets one retry. Without them, it
 * picks at random from the API's `/models`, never the same model twice.
 */
export function createModelPicker({
  models,
  baseUrl,
  apiKey,
}: {
  models: string[];
  baseUrl: string;
  apiKey: string;
}) {
  const ladder = [...models, ...models];
  let position = 0;
  let availableModels: { id: string }[] = [];
  // Every model handed out counts as attempted: the hook runs each one it
  // gets, so marking here keeps the exclusion from depending on the caller.
  const attemptedModels = new Set<string>();
  let hasRefetched = false;

  function handOut(model: string | null | undefined): string | undefined {
    if (!model) return undefined;
    attemptedModels.add(model);
    return model;
  }

  return {
    /** The model for the first attempt. Throws when the API's model list cannot be fetched. */
    async first(): Promise<string | undefined> {
      if (models.length > 0) return handOut(ladder[position]);
      availableModels = await listOpenAiCompatibleModels(baseUrl, apiKey);
      return handOut(selectRandomModel(availableModels));
    },

    /** The model for the next attempt, or undefined when none is left. */
    async next(): Promise<string | undefined> {
      if (models.length > 0) {
        position++;
        return handOut(ladder[position]);
      }

      // A provider whose pool changes mid-flight needs a fresh listing to
      // recover. Once per request at most.
      if (
        availableModels.every((m) => attemptedModels.has(m.id)) &&
        !hasRefetched
      ) {
        hasRefetched = true;
        try {
          availableModels = await listOpenAiCompatibleModels(baseUrl, apiKey);
          recordModelsRefetched();
        } catch (refetchError) {
          console.warn(
            "Failed to refetch models:",
            refetchError instanceof Error ? refetchError.message : refetchError,
          );
        }
      }

      return handOut(selectRandomModel(availableModels, attemptedModels));
    },
  };
}
