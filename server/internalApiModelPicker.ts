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
  let availableModels: { id: string }[] = [];
  const attemptedModels = new Set<string>();
  // Set before the refetch so a failing `/models` endpoint does not trigger
  // another one on the next failed attempt.
  let hasRefetched = false;

  return {
    /** The model for the first attempt. Throws when the API's model list cannot be fetched. */
    async first(): Promise<string | undefined> {
      if (models.length > 0) return models[0];
      availableModels = await listOpenAiCompatibleModels(baseUrl, apiKey);
      return selectRandomModel(availableModels) || undefined;
    },

    markAttempted(model: string): void {
      attemptedModels.add(model);
    },

    /** The model for the attempt after `attempt` (counted from 1), or undefined when none is left. */
    async next(attempt: number): Promise<string | undefined> {
      if (models.length > 0) return ladder[attempt];

      // A provider whose pool changes mid-flight needs a fresh listing to
      // recover; without the `hasRefetched` guard we would loop on a stale
      // list.
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

      return selectRandomModel(availableModels, attemptedModels) ?? undefined;
    },
  };
}
