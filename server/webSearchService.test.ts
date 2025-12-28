import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockedFunction,
  vi,
} from "vitest";
import { fetchSearXNG, getWebSearchStatus } from "./webSearchService";

function createMockResponse(text: string, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    statusText: ok ? "OK" : "Internal Server Error",
    headers: new Headers(),
    redirected: false,
    type: "basic" as ResponseType,
    url: "http://test.com",
    clone: function () {
      return this;
    },
    body: null,
    bodyUsed: false,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    blob: () => Promise.resolve(new Blob()),
    formData: () => Promise.resolve(new FormData()),
    json: () => Promise.resolve(JSON.parse(text)),
    text: () => Promise.resolve(text),
  } as unknown as Response;
}

let originalFetch: typeof fetch;
let fetchMock: MockedFunction<typeof fetch>;

beforeEach(() => {
  originalFetch = global.fetch;
  fetchMock = vi.fn() as unknown as MockedFunction<typeof fetch>;
  global.fetch = fetchMock;
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe("WebSearchService", () => {
  it("should report service not available when fetch throws", async () => {
    (global.fetch as MockedFunction<typeof fetch>).mockImplementation(() => {
      throw new Error("Network error");
    });
    const status = await getWebSearchStatus();
    expect(status).toBe(false);
  });

  it("should return false when health endpoint does not return OK", async () => {
    (global.fetch as MockedFunction<typeof fetch>).mockResolvedValue(
      createMockResponse("NOT_OK", false),
    );
    const status = await getWebSearchStatus();
    expect(status).toBe(false);
  });

  it("should return true when health endpoint returns OK", async () => {
    (global.fetch as MockedFunction<typeof fetch>).mockResolvedValue(
      createMockResponse("OK"),
    );
    const status = await getWebSearchStatus();
    expect(status).toBe(true);
  });

  it("should return empty array on fetchSearXNG error", async () => {
    (global.fetch as MockedFunction<typeof fetch>).mockRejectedValue(
      new Error("Network failure"),
    );
    const results = await fetchSearXNG("test query", "text");
    expect(Array.isArray(results)).toBe(true);
    expect(results).toHaveLength(0);
  });
});
