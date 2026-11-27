import { MantineProvider } from "@mantine/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { addLogEntry } from "@/modules/logEntries";
import WllamaModelSelect from "./WllamaModelSelect";

const cache = vi.hoisted(() => ({ getModels: vi.fn() }));

vi.mock("@wllama/wllama", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  // A constructor that returns an object hands that object to `new`.
  ModelManager: vi.fn(function ModelManager() {
    return { getModels: cache.getModels };
  }),
}));
vi.mock("@/modules/logEntries", () => ({ addLogEntry: vi.fn() }));
vi.mock("@/modules/textGenerationUtilities", () => ({
  defaultContextSize: 4096,
}));

/** A cached model as wllama reports it: its first-shard URL and its own verdict. */
function cachedModel(url: string, status: "valid" | "invalid") {
  return { url, validate: () => status };
}

const gemmaUrl =
  "https://huggingface.co/Felladrin/gguf-sharded-Q4_K_S-gemma-3-270m-it/resolve/main/model.shard-00001-of-00002.gguf";
const qwenUrl =
  "https://huggingface.co/Felladrin/gguf-sharded-UD-Q4_K_XL-Qwen3-0.6B/resolve/main/model.shard-00001-of-00004.gguf";

const gemmaOption = "250 MB • Gemma 3 270M";
const qwenOption = "406 MB • Qwen 3 0.6B";

function modelInput() {
  return screen.getByRole("combobox", { name: /AI Model/i });
}

/**
 * Opens the picker and waits for the option with this exact label. jsdom runs no
 * CSS transitions, so an open dropdown stays `display: none`, which is why the
 * option query passes `hidden: true`.
 */
async function openPickerAndWaitForOption(name: string) {
  fireEvent.mouseDown(modelInput());
  fireEvent.click(modelInput());

  return screen.findByRole("option", { name, hidden: true });
}

function renderSelect(value = "lfm2.5-230m", onChange = vi.fn()) {
  render(
    <MantineProvider>
      <WllamaModelSelect value={value} onChange={onChange} />
    </MantineProvider>,
  );
  return onChange;
}

describe("WllamaModelSelect", () => {
  beforeEach(() => {
    // jsdom has no layout, so Mantine cannot scroll the active option into view.
    Element.prototype.scrollIntoView = vi.fn();
    vi.clearAllMocks();
    cache.getModels.mockResolvedValue([]);
  });

  it("marks the model that is fully in the cache, and only that one", async () => {
    cache.getModels.mockResolvedValue([cachedModel(qwenUrl, "valid")]);
    renderSelect();

    await openPickerAndWaitForOption(`${qwenOption} • Downloaded`);
    expect(
      screen.getByRole("option", { name: gemmaOption, hidden: true }),
    ).toBeInTheDocument();
  });

  it("shows the marker on the closed field too", async () => {
    cache.getModels.mockResolvedValue([cachedModel(qwenUrl, "valid")]);
    renderSelect("qwen-3-0.6b");

    expect(
      await screen.findByDisplayValue(`${qwenOption} • Downloaded`),
    ).toBeVisible();
  });

  it("leaves a model whose download stopped halfway unmarked", async () => {
    cache.getModels.mockResolvedValue([cachedModel(gemmaUrl, "invalid")]);
    renderSelect();

    await openPickerAndWaitForOption(gemmaOption);
    expect(screen.queryByText(/Downloaded/)).not.toBeInTheDocument();
  });

  it("keeps the picker usable and logs when the cache cannot be read", async () => {
    cache.getModels.mockRejectedValue(new Error("OPFS is unavailable"));
    const onChange = renderSelect();

    const gemma = await openPickerAndWaitForOption(gemmaOption);
    expect(screen.queryByText(/Downloaded/)).not.toBeInTheDocument();
    expect(addLogEntry).toHaveBeenCalledWith(
      "Failed to read the Wllama model cache: OPFS is unavailable",
    );

    fireEvent.click(gemma);
    expect(onChange).toHaveBeenCalledWith("gemma-3-270m");
  });

  it("refreshes the markers when the dropdown opens", async () => {
    renderSelect();
    await openPickerAndWaitForOption(qwenOption);
    expect(screen.queryByText(/Downloaded/)).not.toBeInTheDocument();

    fireEvent.keyDown(modelInput(), { key: "Escape" });
    cache.getModels.mockResolvedValue([cachedModel(qwenUrl, "valid")]);

    expect(
      await openPickerAndWaitForOption(`${qwenOption} • Downloaded`),
    ).toBeInTheDocument();
  });
});
