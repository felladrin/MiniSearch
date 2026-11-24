import { MantineProvider } from "@mantine/core";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { settingsPubSub } from "@/modules/pubSub";
import { defaultSettings } from "@/modules/settings";
import AISettingsForm from "./AISettings/AISettingsForm";
import InterfaceSettingsForm from "./InterfaceSettingsForm";
import SearchSettingsForm from "./SearchSettingsForm";

vi.mock("@/modules/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/config")>();
  return { ...actual, getConfig: async () => actual.FALLBACK_CONFIG };
});

const [updateSettings, , getSettings] = settingsPubSub;

function toggle(name: RegExp) {
  fireEvent.click(screen.getByRole("switch", { name }));
}

describe("the menu's settings forms", () => {
  beforeEach(() => {
    updateSettings(defaultSettings);
  });

  it("keep a change made in one section when another section changes", () => {
    render(
      <MantineProvider>
        <SearchSettingsForm />
        <InterfaceSettingsForm />
      </MantineProvider>,
    );

    toggle(/Text Search/);
    toggle(/Enter to Submit/);

    expect(getSettings()).toMatchObject({
      enableTextSearch: false,
      enterToSubmit: false,
    });
  });

  it("keep a setting another writer changed while the AI form is open", () => {
    render(
      <MantineProvider>
        <AISettingsForm />
      </MantineProvider>,
    );

    act(() =>
      updateSettings({ ...getSettings(), wllamaModelId: "another-model" }),
    );
    toggle(/AI Response/);

    expect(getSettings()).toMatchObject({
      enableAiResponse: true,
      wllamaModelId: "another-model",
    });
  });
});
