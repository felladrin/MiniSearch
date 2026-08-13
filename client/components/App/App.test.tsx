import type { ServerConfig } from "@shared/serverConfig";
import { render, screen, waitFor } from "@testing-library/react";
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
  internalApiEnabled: false,
  internalApiName: "Internal API",
  defaultInferenceType: "browser",
  pageContentReadingEnabled: false,
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

  // Guards the fail-open regression: an unreachable /api/config used to look
  // exactly like `accessKeysEnabled: false`, letting the app through the gate.
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
