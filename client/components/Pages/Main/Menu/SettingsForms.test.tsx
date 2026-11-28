import { MantineProvider } from "@mantine/core";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
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

/** Opens the time-range select and picks the option with this label. */
function pickTimeRange(label: string) {
  const select = screen.getByRole("combobox", { name: /time range/i });
  fireEvent.mouseDown(select);
  fireEvent.click(select);
  const listbox = document.getElementById(
    select.getAttribute("aria-controls") ?? "",
  );
  if (!listbox) throw new Error("The select did not render a listbox");
  fireEvent.click(within(listbox).getByText(label));
}

/**
 * Types `search` into the language select to filter it, then picks the option
 * with this label. The typing is the point: the list is long enough that a
 * reader has to search it.
 */
function pickLanguage(search: string, label: string) {
  const select = screen.getByRole("combobox", { name: /search language/i });
  fireEvent.mouseDown(select);
  fireEvent.click(select);
  fireEvent.change(select, { target: { value: search } });
  const listbox = document.getElementById(
    select.getAttribute("aria-controls") ?? "",
  );
  if (!listbox) throw new Error("The select did not render a listbox");
  fireEvent.click(within(listbox).getByText(label));
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

  it("writes the time range chosen in the search section", () => {
    render(
      <MantineProvider>
        <SearchSettingsForm />
      </MantineProvider>,
    );

    expect(screen.getByRole("combobox", { name: /time range/i })).toHaveValue(
      "Anytime",
    );

    pickTimeRange("Past week");

    expect(getSettings()).toMatchObject({ searchTimeRange: "week" });
  });

  it("writes the language chosen in the search section", () => {
    render(
      <MantineProvider>
        <SearchSettingsForm />
      </MantineProvider>,
    );

    expect(
      screen.getByRole("combobox", { name: /search language/i }),
    ).toHaveValue("Browser language");

    pickLanguage("portug", "Português (Brasil)");

    expect(getSettings()).toMatchObject({ searchLanguage: "pt-BR" });
  });
});
