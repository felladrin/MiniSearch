import type { ServerConfig } from "@shared/serverConfig";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getConfig } from "@/modules/config";
import App from "./App";

vi.mock("@/modules/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/config")>()),
  getConfig: vi.fn(),
}));

vi.mock("@/modules/accessKey", () => ({
  verifyStoredAccessKey: vi.fn().mockResolvedValue(false),
}));

vi.mock("../Pages/Main/MainPage", () => ({
  default: () => <div data-testid="main-page" />,
}));

vi.mock("../Pages/AccessPage", () => ({
  default: () => <div data-testid="access-page" />,
}));

const serverConfig: ServerConfig = {
  accessKeysEnabled: false,
  accessKeyTimeoutHours: 24,
  wllamaDefaultModelId: "littlelamb-290m",
  wllamaDefaultGpuModelId: "gemma-3-4b",
  internalApiEnabled: false,
  internalApiName: "Internal API",
  defaultInferenceType: "browser",
  searchToken: "a".repeat(64),
  parentWindowOrigins: ["https://huggingface.co"],
};

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("shows the main page when access keys are disabled", async () => {
    vi.mocked(getConfig).mockResolvedValue(serverConfig);

    render(<App />);

    expect(await screen.findByTestId("main-page")).toBeInTheDocument();
  });

  it("shows the access page when access keys are enabled", async () => {
    vi.mocked(getConfig).mockResolvedValue({
      ...serverConfig,
      accessKeysEnabled: true,
    });

    render(<App />);

    expect(await screen.findByTestId("access-page")).toBeInTheDocument();
    expect(screen.queryByTestId("main-page")).not.toBeInTheDocument();
  });

  /**
   * Renders a fresh module instance so the settings module reads the profile
   * seeded here, since it captures localStorage once at import.
   */
  async function renderWithStoredSettings(
    stored?: Record<string, unknown>,
    config: ServerConfig = serverConfig,
  ) {
    vi.resetModules();
    if (stored) localStorage.setItem("settings", JSON.stringify(stored));

    const [
      { getConfig: freshGetConfig },
      { default: FreshApp },
      { getSettings },
    ] = await Promise.all([
      import("@/modules/config"),
      import("./App"),
      import("@/modules/pubSub"),
    ]);
    vi.mocked(freshGetConfig).mockResolvedValue(config);

    render(<FreshApp />);
    await screen.findByTestId("main-page");

    return getSettings;
  }

  it("fills in a setting the stored profile predates", async () => {
    const getSettings = await renderWithStoredSettings({
      enableAiResponse: true,
    });

    await waitFor(() =>
      expect(getSettings().enablePageContentFetch).toBe(true),
    );
  });

  // The other half of that merge: a stored value is a choice, including one
  // that turns off something shipped on.
  it("keeps a setting the user turned off", async () => {
    const getSettings = await renderWithStoredSettings({
      enableAiResponse: true,
      enablePageContentFetch: false,
    });

    await waitFor(() =>
      expect(getSettings().enablePageContentFetch).toBe(false),
    );
  });

  /** Renders a fresh module instance against a server whose config fails to load. */
  async function renderWithoutConfig(stored?: Record<string, unknown>) {
    vi.resetModules();
    if (stored) localStorage.setItem("settings", JSON.stringify(stored));

    const [
      { getConfig: freshGetConfig },
      { default: FreshApp },
      { webGpuSupport },
    ] = await Promise.all([
      import("@/modules/config"),
      import("./App"),
      import("@/modules/webGpu"),
    ]);
    vi.mocked(freshGetConfig).mockRejectedValue(new Error("Network error"));

    render(<FreshApp />);
    await screen.findByText(/could not load the server configuration/i);
    // Settings are initialized once the WebGPU check is in, so let it finish.
    await webGpuSupport;
    await act(async () => {});
  }

  describe("when the config cannot be loaded", () => {
    it("saves no settings on a first visit", async () => {
      await renderWithoutConfig();

      expect(localStorage.getItem("settings")).toBeNull();
    });

    it("leaves a stored profile as it was", async () => {
      const stored = { enableAiResponse: true };

      await renderWithoutConfig(stored);

      expect(localStorage.getItem("settings")).toBe(JSON.stringify(stored));
    });

    // Settings saved from shipped defaults would count as the user's own
    // choices, and the server's defaults could never seed them again.
    it("lets a later load seed the server's defaults", async () => {
      await renderWithoutConfig();
      cleanup();

      const getSettings = await renderWithStoredSettings(undefined, {
        ...serverConfig,
        defaultInferenceType: "openai",
      });

      await waitFor(() => expect(getSettings().inferenceType).toBe("openai"));
    });
  });

  // An unreachable /api/config must not look like `accessKeysEnabled: false`,
  // which would let the app through the gate.
  it("refuses to render the app when the config cannot be loaded", async () => {
    vi.mocked(getConfig).mockRejectedValue(new Error("Network error"));

    render(<App />);

    await waitFor(() => {
      expect(
        screen.getByText(/could not load the server configuration/i),
      ).toBeInTheDocument();
    });
    expect(screen.queryByTestId("main-page")).not.toBeInTheDocument();
    expect(screen.queryByTestId("access-page")).not.toBeInTheDocument();
  });
});
