import { MantineProvider } from "@mantine/core";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VoiceOption } from "@/modules/textToSpeech";
import VoiceSettingsForm from "./VoiceSettingsForm";

const localVoice: VoiceOption = {
  value: "piper:en_US-lessac-high",
  label: "lessac • English (high)",
  engine: "local",
  languageCode: "en_US",
};

const systemVoice: VoiceOption = {
  value: "system:os-voice",
  label: "OS Voice • en-US",
  engine: "system",
  languageCode: "en-US",
};

const { settings, setSettings, listVoices } = vi.hoisted(() => ({
  settings: {
    current: {
      enableDictation: false,
      enableLocalDictationModel: true,
      selectedVoiceId: "",
      textToSpeechEngine: "local" as "local" | "system",
    },
  },
  setSettings: vi.fn(),
  listVoices: vi.fn(),
}));

vi.mock("create-pubsub/react", () => ({
  usePubSub: () => [settings.current, setSettings],
}));

vi.mock("@/modules/textToSpeech", () => ({
  listVoices: (_languageCode: string | undefined, engine: "local" | "system") =>
    listVoices(engine),
}));

/**
 * jsdom runs no CSS transitions, so Mantine leaves the dropdown `display: none`
 * even once it is open; every query in this file passes `hidden: true` to read
 * the options that were rendered into it.
 */
function openSelect(input: HTMLElement) {
  fireEvent.mouseDown(input);
  fireEvent.click(input);
  const listbox = document.getElementById(
    input.getAttribute("aria-controls") ?? "",
  );
  if (!listbox) throw new Error("The select did not render a listbox");
  return within(listbox);
}

function renderForm() {
  return render(
    <MantineProvider>
      <VoiceSettingsForm />
    </MantineProvider>,
  );
}

function voiceInput() {
  return screen.getByPlaceholderText("Auto-detected") as HTMLElement;
}

beforeEach(() => {
  // jsdom has no layout, so Mantine cannot scroll the active option into view.
  Element.prototype.scrollIntoView = vi.fn();
  vi.clearAllMocks();
  settings.current = {
    enableDictation: false,
    enableLocalDictationModel: true,
    selectedVoiceId: "",
    textToSpeechEngine: "local",
  };
  setSettings.mockImplementation((next: Record<string, unknown>) => {
    settings.current = { ...settings.current, ...next };
  });
  listVoices.mockImplementation((engine: "local" | "system") =>
    Promise.resolve(engine === "local" ? [localVoice] : [systemVoice]),
  );
});

describe("VoiceSettingsForm", () => {
  it("lists only the local voices while the local engine is selected", async () => {
    renderForm();
    await screen.findByText("Voice Selection");

    const options = openSelect(voiceInput()).getAllByRole("option", {
      hidden: true,
    });

    expect(options.map((option) => option.textContent)).toEqual([
      "🇺🇸 lessac • English (high)",
    ]);
  });

  it("lists only the system voices while the system engine is selected", async () => {
    settings.current.textToSpeechEngine = "system";
    renderForm();
    await screen.findByText("Voice Selection");

    const options = openSelect(voiceInput()).getAllByRole("option", {
      hidden: true,
    });

    expect(options.map((option) => option.textContent)).toEqual([
      "🇺🇸 OS Voice • en-US",
    ]);
  });

  it("disables the on-device model switch while dictation itself is off", () => {
    renderForm();
    expect(
      screen.getByRole("switch", {
        name: /On-device dictation model/i,
      }),
    ).toBeDisabled();
  });

  it("persists toggling the on-device dictation model while dictation is on", () => {
    settings.current.enableDictation = true;
    renderForm();

    const switchInput = screen.getByRole("switch", {
      name: /On-device dictation model/i,
    }) as HTMLInputElement;
    expect(switchInput).not.toBeDisabled();

    fireEvent.click(switchInput);

    expect(setSettings).toHaveBeenCalledWith(
      expect.objectContaining({ enableLocalDictationModel: false }),
      expect.anything(),
    );
  });

  it("goes back to auto-detection when the engine changes", async () => {
    settings.current.selectedVoiceId = localVoice.value;
    renderForm();

    const engine = screen.getAllByRole("combobox")[0] as HTMLElement;
    fireEvent.click(
      openSelect(engine).getByRole("option", {
        name: "System voices (Multi-lingual)",
        hidden: true,
      }),
    );

    expect(setSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({
        textToSpeechEngine: "system",
        selectedVoiceId: "",
      }),
      expect.anything(),
    );
    expect((voiceInput() as HTMLInputElement).value).toBe("");
  });
});
