import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ImageResults, SearchEntry, TextResults } from "@/modules/history";
import { getLatestLlmResponseForEntry } from "@/modules/history";
import {
  getLlmTextSearchResults,
  getSuppressNextFollowUp,
  imageSearchResultsPubSub,
  imageSearchStatePubSub,
  isRestoringFromHistoryPubSub,
  textSearchResultsPubSub,
  updateImageSearchResults,
  updateSuppressNextFollowUp,
} from "@/modules/pubSub";
import { useHistoryRestore } from "./useHistoryRestore";

vi.mock("wouter", () => ({
  useLocation: () => ["/", vi.fn()],
}));

vi.mock("@/modules/logEntries", () => ({ addLogEntry: vi.fn() }));

vi.mock("@/modules/config", () => ({
  getConfig: vi.fn().mockResolvedValue({
    parentWindowOrigins: ["https://huggingface.co"],
  }),
}));

vi.mock("@/modules/history", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/history")>()),
  getLatestLlmResponseForEntry: vi.fn().mockResolvedValue(null),
  getChatMessagesForQuery: vi.fn().mockResolvedValue([]),
}));

const textResults: TextResults = {
  type: "text",
  items: [
    {
      title: "Saved text",
      snippet: "Saved snippet",
      url: "https://example.com/text",
    },
  ],
};

const imageResults: ImageResults = {
  type: "image",
  items: [
    {
      title: "Saved image",
      url: "https://example.com/image.png",
      thumbnail: "https://example.com/thumbnail.png",
      sourceUrl: "https://example.com/source",
    },
    {
      title: "Image without a source",
      url: "https://example.com/other.png",
      thumbnail: "https://example.com/other-thumbnail.png",
    },
  ],
};

const expectedImages = [
  [
    "Saved image",
    "https://example.com/image.png",
    "https://example.com/thumbnail.png",
    "https://example.com/source",
  ],
  [
    "Image without a source",
    "https://example.com/other.png",
    "https://example.com/other-thumbnail.png",
    "",
  ],
];

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(getLatestLlmResponseForEntry).mockResolvedValue(null);
  updateSuppressNextFollowUp(false);
  updateImageSearchResults([
    ["Previous image", "old.png", "old-thumb.png", ""],
  ]);
});

afterEach(() => {
  cleanup();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

async function restoreEntry(payload: Partial<SearchEntry>) {
  const { result } = renderHook(() => useHistoryRestore(vi.fn()));
  await act(async () => {
    await result.current.restoreSearch({
      query: "saved search",
      timestamp: 1,
      ...payload,
    });
  });
}

describe("useHistoryRestore", () => {
  it("restores both text and images from the same search", async () => {
    await restoreEntry({ results: textResults, textResults, imageResults });

    expect(imageSearchResultsPubSub[2]()).toEqual(expectedImages);
    const expectedText = [
      ["Saved text", "Saved snippet", "https://example.com/text"],
    ];
    expect(textSearchResultsPubSub[2]()).toEqual(expectedText);
    expect(getLlmTextSearchResults()).toEqual(expectedText);
    expect(imageSearchStatePubSub[2]()).toBe("completed");
  });

  it.each([
    { name: "image-only entry", payload: { imageResults } },
    { name: "legacy image-only entry", payload: { results: imageResults } },
    {
      name: "legacy images alongside newer text results",
      payload: { textResults, results: imageResults },
    },
    {
      name: "newer images alongside an empty legacy image payload",
      payload: {
        imageResults,
        results: { type: "image", items: [] } as ImageResults,
      },
    },
  ])("restores $name", async ({ payload }) => {
    await restoreEntry(payload);

    expect(imageSearchResultsPubSub[2]()).toEqual(expectedImages);
    expect(imageSearchStatePubSub[2]()).toBe("completed");
  });

  it("clears previous images when the saved search has none", async () => {
    await restoreEntry({ textResults });

    expect(imageSearchResultsPubSub[2]()).toEqual([]);
    expect(imageSearchStatePubSub[2]()).toBe("completed");
  });

  it("leaves suppressNextFollowUp false when the restored entry has no saved response", async () => {
    await restoreEntry({ textResults });

    expect(getSuppressNextFollowUp()).toBe(false);
  });

  it("sets suppressNextFollowUp true when the restored entry has a saved response", async () => {
    vi.mocked(getLatestLlmResponseForEntry).mockResolvedValueOnce(
      "Saved AI answer.",
    );

    await restoreEntry({ textResults });

    expect(getSuppressNextFollowUp()).toBe(true);
  });

  it("finishes the restore when embedded after a cross-origin frame", async () => {
    const parentWindow = {
      0: {
        get location(): Location {
          throw new DOMException("Blocked a frame", "SecurityError");
        },
      },
      postMessage: vi.fn(),
    };
    vi.stubGlobal("parent", parentWindow);

    try {
      await restoreEntry({ textResults });
      act(() => {
        vi.runOnlyPendingTimers();
      });

      expect(isRestoringFromHistoryPubSub[2]()).toBe(false);
      expect(parentWindow.postMessage).toHaveBeenCalledWith(
        { queryString: "q=saved%20search", hash: "" },
        "https://huggingface.co",
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
