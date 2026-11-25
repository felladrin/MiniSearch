import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../shared/openaiModels.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../shared/openaiModels.ts")>()),
  listOpenAiCompatibleModels: vi.fn(),
}));

import { listOpenAiCompatibleModels } from "../shared/openaiModels.ts";
import { getInferenceStats } from "./inferencesSinceLastRestart.ts";
import { createModelPicker } from "./internalApiModelPicker.ts";

const connection = { baseUrl: "http://test-api", apiKey: "test-key" };

afterEach(() => {
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

describe("createModelPicker", () => {
  it("walks the configured models in order, then once more", async () => {
    const picker = createModelPicker({
      ...connection,
      models: ["model-a", "model-b"],
    });

    const picked = [await picker.first()];
    for (let i = 0; i < 4; i++) picked.push(await picker.next());

    expect(picked).toEqual([
      "model-a",
      "model-b",
      "model-a",
      "model-b",
      undefined,
    ]);
    expect(listOpenAiCompatibleModels).not.toHaveBeenCalled();
  });

  it("never hands out the same random model twice", async () => {
    vi.mocked(listOpenAiCompatibleModels).mockResolvedValue([
      { id: "model-a" },
      { id: "model-b" },
      { id: "model-c" },
    ]);
    const picker = createModelPicker({ ...connection, models: [] });

    const picked = [await picker.first(), await picker.next()];
    picked.push(await picker.next());

    expect(new Set(picked)).toEqual(new Set(["model-a", "model-b", "model-c"]));
  });

  it("lists the pool again once every model was tried, and picks from the new list", async () => {
    vi.mocked(listOpenAiCompatibleModels)
      .mockResolvedValueOnce([{ id: "model-a" }])
      .mockResolvedValueOnce([{ id: "model-a" }, { id: "model-b" }]);
    const picker = createModelPicker({ ...connection, models: [] });
    const refetchesBefore = getInferenceStats().modelsRefetched;

    expect(await picker.first()).toBe("model-a");
    expect(await picker.next()).toBe("model-b");
    expect(getInferenceStats().modelsRefetched).toBe(refetchesBefore + 1);
  });

  // Before the try/catch, a failed refetch escaped `next()` and the client got
  // a 500 instead of the 503 that says every model failed.
  it("gives up quietly when listing the pool again fails", async () => {
    vi.mocked(listOpenAiCompatibleModels)
      .mockResolvedValueOnce([{ id: "model-a" }])
      .mockRejectedValueOnce(new Error("models endpoint down"));
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const picker = createModelPicker({ ...connection, models: [] });
    const refetchesBefore = getInferenceStats().modelsRefetched;

    await picker.first();

    await expect(picker.next()).resolves.toBeUndefined();
    expect(consoleWarn).toHaveBeenCalledWith(
      "Failed to refetch models:",
      "models endpoint down",
    );
    expect(getInferenceStats().modelsRefetched).toBe(refetchesBefore);
  });

  it("lists the pool again at most once per request", async () => {
    vi.mocked(listOpenAiCompatibleModels)
      .mockResolvedValueOnce([{ id: "model-a" }])
      .mockResolvedValueOnce([{ id: "model-b" }])
      .mockResolvedValueOnce([{ id: "model-c" }]);
    const picker = createModelPicker({ ...connection, models: [] });

    await picker.first();
    await picker.next();

    expect(await picker.next()).toBeUndefined();
    expect(listOpenAiCompatibleModels).toHaveBeenCalledTimes(2);
  });
});
