import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getConfig } from "./config";
import { postMessageToParentWindow } from "./parentWindow";

vi.mock("./config", () => ({
  getConfig: vi.fn(),
}));

vi.mock("./logEntries", () => ({
  addLogEntry: vi.fn(),
}));

const message = { queryString: "q=test", hash: "" };

/**
 * A parent page whose first child frame is cross-origin, so reading that
 * frame's `location` throws, as it does in a browser.
 */
function stubParentWindow() {
  const crossOriginFrame = {
    get location(): Location {
      throw new DOMException("Blocked a frame", "SecurityError");
    },
  };
  const parentWindow = { 0: crossOriginFrame, postMessage: vi.fn() };
  vi.stubGlobal("parent", parentWindow);
  return parentWindow;
}

function serveOrigins(parentWindowOrigins: string[]) {
  vi.mocked(getConfig).mockResolvedValue({ parentWindowOrigins } as Awaited<
    ReturnType<typeof getConfig>
  >);
}

/** Lets the post that waits on the config run. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("postMessageToParentWindow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts once to each allowed origin, whatever frame comes first in the parent", async () => {
    const parentWindow = stubParentWindow();
    serveOrigins(["https://huggingface.co"]);

    expect(() => postMessageToParentWindow(message)).not.toThrow();
    await flush();

    expect(parentWindow.postMessage).toHaveBeenCalledTimes(1);
    expect(parentWindow.postMessage).toHaveBeenCalledWith(
      message,
      "https://huggingface.co",
    );
  });

  it("posts nothing when no origin is allowed", async () => {
    const parentWindow = stubParentWindow();
    serveOrigins([]);

    postMessageToParentWindow(message);
    await flush();

    expect(parentWindow.postMessage).not.toHaveBeenCalled();
  });

  it("posts nothing when the page is not embedded", async () => {
    const postMessage = vi.spyOn(window, "postMessage");
    serveOrigins(["https://huggingface.co"]);

    postMessageToParentWindow(message);
    await flush();

    expect(getConfig).not.toHaveBeenCalled();
    expect(postMessage).not.toHaveBeenCalled();
    postMessage.mockRestore();
  });

  it("posts nothing, and does not throw, when the config cannot be fetched", async () => {
    const parentWindow = stubParentWindow();
    vi.mocked(getConfig).mockRejectedValue(new Error("offline"));

    expect(() => postMessageToParentWindow(message)).not.toThrow();
    await flush();

    expect(parentWindow.postMessage).not.toHaveBeenCalled();
  });

  it("still posts to the other origins when one of them is not a valid target", async () => {
    const parentWindow = stubParentWindow();
    parentWindow.postMessage.mockImplementationOnce(() => {
      throw new DOMException("Invalid target origin", "SyntaxError");
    });
    serveOrigins(["huggingface.co", "https://huggingface.co"]);

    postMessageToParentWindow(message);
    await flush();

    expect(parentWindow.postMessage).toHaveBeenCalledTimes(2);
    expect(parentWindow.postMessage).toHaveBeenLastCalledWith(
      message,
      "https://huggingface.co",
    );
  });
});
