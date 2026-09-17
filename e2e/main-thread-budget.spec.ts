import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, type Page, test } from "@playwright/test";

// Issue #2571: keep long tasks off the main thread while an answer streams.
//
// A `longtask` PerformanceObserver is installed via addInitScript BEFORE the
// app boots, so it sees every task the app runs. The streaming window is
// bracketed in page-clock terms: it opens when the inference request is
// issued (fetch wrapper) and closes once the full answer has rendered. We
// assert no single long task overlapped that window for more than 200 ms.
//
// Everything external is mocked for determinism: /api/config, /search/text,
// /page-content, and the OpenAI-compatible inference stream. The stream is
// served by a local SSE server (not route.fulfill) so chunks arrive spread
// over ~1s — that is what produces the repeated throttled re-renders whose
// per-frame cost this check exists to catch.
//
// Served by the production build, which mounts the server hooks and serves
// reliably without live upstreams. Run it bound to IPv4 (the default binds to
// ::1 here, which the baseURL cannot reach):
//
//   npm run build && HOST=127.0.0.1 PORT=7861 npm run start
//
// Then:
//   PLAYWRIGHT_BROWSERS_PATH=<browsers> PLAYWRIGHT_BASE_URL=http://127.0.0.1:7861 \
//     npx playwright test e2e/main-thread-budget.spec.ts
//
// The full-Chromium channel needs its system libraries and a fontconfig with
// at least one font present, or the renderer aborts in SkFontMgr. On a
// fully-provisioned host those are already installed; otherwise export
// LD_LIBRARY_PATH and FONTCONFIG_SYSROOT at the call site.

const LONG_TASK_BUDGET_MS = 200;

// `longtask` PerformanceObserver entries are only emitted by the new headless
// (full Chromium), not by chrome-headless-shell — the old headless never
// reports them. Pin this spec to the full Chromium channel so the probe has
// data to assert on.
test.use({ channel: "chromium" });

// Multi-paragraph markdown with links but NO code block: this exercises the
// per-frame markdown re-parse and the citation-link listeners without
// triggering Shiki. The full-bundle Shiki load is a separate, known long
// task (see the annotation below) addressed by perf/shiki-lazy-language-subset.
const ANSWER = [
  "MiniSearch runs the whole search-and-answer loop in your browser, so the",
  "answer streams token by token while the page stays interactive.",
  "",
  "Under the hood the response is throttled to twelve updates a second,",
  "and each update re-renders the markdown so far — links, lists and",
  "blockquotes included. The longer the answer grows, the more work each",
  "frame carries, which is exactly the cost this budget guards.",
  "",
  "Citations are rendered as expandable links that measure their own width,",
  "and the result cards below carry thumbnails and snippets read from the",
  "pages themselves.",
  "",
  "For the full design notes see the [project README](https://example.com/readme)",
  "and the [issue thread](https://example.com/issues/2571) tracking this work.",
].join(" ");

function sseChunk(content: string): string {
  return `data: ${JSON.stringify({
    id: "mock-1",
    object: "chat.completion.chunk",
    created: 1,
    model: "mock-model",
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
  })}\n\n`;
}

/**
 * A local OpenAI-compatible SSE endpoint that drips the answer in chunks so
 * the client's 12 Hz throttle produces many streamed frames over ~1s.
 */
function startMockInferenceServer(): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    // The AI SDK sends Authorization + content-type, so the browser preflights.
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "content-type, authorization, accept",
    );
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const words = ANSWER.split(" ");
    let i = 0;
    const timer = setInterval(() => {
      // ~3 words per chunk, ~30ms apart → ~30 chunks over ~0.9s.
      const chunk = words.slice(i, i + 3).join(" ");
      i += 3;
      if (i >= words.length) {
        res.write(sseChunk(chunk));
        res.write(
          `data: ${JSON.stringify({
            id: "mock-1",
            object: "chat.completion.chunk",
            created: 1,
            model: "mock-model",
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          })}\n\n`,
        );
        res.write("data: [DONE]\n\n");
        clearInterval(timer);
        res.end();
        return;
      }
      res.write(sseChunk(`${chunk} `));
    }, 30);
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, port });
    });
  });
}

/**
 * Installs the long-task probe before any app script runs. Wraps fetch to
 * stamp the page-clock time the inference stream opens; the test closes it.
 */
function installLongTaskProbe(page: Page) {
  return page.addInitScript(() => {
    type LongTask = {
      start: number;
      duration: number;
      attribution: string;
    };
    // lib.dom has no PerformanceLongTaskTiming; describe the shape we read.
    type LongTaskEntry = PerformanceEntry & {
      attribution?: Array<{ containerType: string; containerName?: string }>;
    };
    const w = window as unknown as {
      __longTasks: LongTask[];
      __streamWindow: { start: number; end: number | null };
    };
    w.__longTasks = [];
    w.__streamWindow = { start: 0, end: null };

    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const longTask = entry as LongTaskEntry;
        const attribution = (longTask.attribution ?? [])
          .map((a) => `${a.containerType}:${a.containerName || "?"}`)
          .join(", ");
        w.__longTasks.push({
          start: entry.startTime,
          duration: entry.duration,
          attribution: attribution || "unknown",
        });
      }
    });
    // buffered: true so tasks that ran before the callback attached are kept.
    observer.observe({ type: "longtask", buffered: true });

    const originalFetch = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof Request
            ? input.url
            : String(input);
      if (url.includes("/chat/completions") && w.__streamWindow.start === 0) {
        w.__streamWindow.start = performance.now();
      }
      return originalFetch(input, init);
    };
  });
}

function seedSettings(page: Page, inferencePort: number) {
  const settings = {
    showEnableAiResponsePrompt: false, // render the answer, not the opt-in prompt
    enableAiResponse: true,
    enableImageSearch: false, // keep the streaming window free of image churn
    wllamaModelId: "littlelamb-290m",
    cpuThreads: 2,
    searchResultsLimit: 15,
    systemPrompt: "Answer using {{searchResults}}",
    inferenceType: "openai", // remote path: no browser model download in the window
    openAiApiBaseUrl: `http://127.0.0.1:${inferencePort}/v1`,
    openAiApiKey: "test-key",
    openAiApiModel: "mock-model", // set so no /models listing is fetched
    openAiContextLength: 4096,
    hordeApiKey: "0000000000",
    hordeModel: "",
    enterToSubmit: true,
    enableAiResponseScrolling: true,
    allowAiModelDownload: false,
    enableTextSearch: true,
    enableHistory: false, // no IndexedDB writes inside the measured window
    historyMaxEntries: 1000,
    historyAutoCleanup: true,
    historyRetentionDays: 30,
    historyGroupByDate: true,
    selectedVoiceId: "",
    enableDictation: false, // no moonshine wasm in the window
    enableLocalDictationModel: false,
    textToSpeechEngine: "system",
    reasoningStartMarker: "think",
    reasoningEndMarker: "think",
    enableNotificationOnAiComplete: false,
    enablePageContentFetch: true, // exercise the search→generation handoff
  };
  return page.addInitScript(
    (s) => localStorage.setItem("settings", JSON.stringify(s)),
    settings,
  );
}

function stubEndpoints(page: Page) {
  return Promise.all([
    page.route("**/api/config", (route) =>
      route.fulfill({
        json: {
          accessKeysEnabled: false,
          accessKeyTimeoutHours: 24,
          wllamaDefaultModelId: "littlelamb-290m",
          internalApiEnabled: false,
          internalApiName: "Internal API",
          defaultInferenceType: "openai",
          searchToken: "test-token",
        },
      }),
    ),
    page.route("**/search/text*", (route) =>
      route.fulfill({
        json: [
          [
            "MiniSearch",
            "Private AI search with sources",
            "https://a.example/1",
            0.9,
          ],
          ["Streaming answers", "Token by token", "https://a.example/2", 0.8],
          ["Browser inference", "Runs on device", "https://a.example/3", 0.7],
          [
            "Markdown rendering",
            "Re-parsed per frame",
            "https://a.example/4",
            0.6,
          ],
          ["Citations", "Expandable links", "https://a.example/5", 0.5],
          ["Privacy", "No tracking", "https://a.example/6", 0.4],
        ],
      }),
    ),
    page.route("**/page-content*", (route) =>
      route.fulfill({
        json: {
          "https://a.example/1":
            "MiniSearch keeps the search and answer loop in the browser. " +
            "The answer streams token by token while the page stays interactive. ".repeat(
              40,
            ),
          "https://a.example/2":
            "Streaming responses are throttled to twelve updates per second. ".repeat(
              40,
            ),
        },
      }),
    ),
  ]);
}

test.describe("main-thread budget during answer streaming", () => {
  let server: Server;
  let port: number;

  test.beforeAll(async () => {
    ({ server, port } = await startMockInferenceServer());
  });

  test.afterAll(() => {
    server.close();
  });

  test("no long task over 200ms on the main thread while an answer streams", async ({
    page,
  }) => {
    await installLongTaskProbe(page);
    await seedSettings(page, port);
    await stubEndpoints(page);

    await page.goto("/?q=minisearch");

    // The search settles with results on screen.
    await expect(page.getByTestId("search-result-link").first()).toBeVisible({
      timeout: 30_000,
    });

    // The answer streams to completion: the closing words render and the
    // header has flipped from "Generating AI Response..." to "AI Response".
    await expect(page.getByText("tracking this work")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText("AI Response", { exact: true })).toBeVisible({
      timeout: 30_000,
    });

    // The longtask observer callback is delivered asynchronously after the
    // task ends; settle so the last entries are recorded before we read.
    await page.waitForTimeout(300);

    // Close the streaming window in page-clock terms, then read the probe.
    const { tasks, window: streamWindow } = await page.evaluate(() => {
      const w = window as unknown as {
        __longTasks: Array<{
          start: number;
          duration: number;
          attribution: string;
        }>;
        __streamWindow: { start: number; end: number | null };
      };
      w.__streamWindow.end = performance.now();
      return { tasks: w.__longTasks, window: { ...w.__streamWindow } };
    });

    expect(streamWindow.start, "inference stream never opened").toBeGreaterThan(
      0,
    );
    expect(streamWindow.end, "streaming window never closed").not.toBeNull();

    const windowEnd = streamWindow.end as number;
    const inWindow = tasks.filter(
      (t) => t.start < windowEnd && t.start + t.duration > streamWindow.start,
    );

    const offenders = inWindow.filter((t) => t.duration > LONG_TASK_BUDGET_MS);
    const longest = inWindow.reduce(
      (max, t) => (t.duration > max.duration ? t : max),
      { start: 0, duration: 0, attribution: "none" },
    );

    // Known long task NOT on this path: the first code block in an answer
    // pays for Shiki's full language bundle (client/modules/shiki.ts). This
    // spec deliberately streams a code-block-free answer so the assertion
    // stays enabled on the path that passes today. perf/shiki-lazy-language-subset
    // removes that long task; when it lands, a code block can join this answer.
    test.info().annotations.push({
      type: "known-long-task",
      description:
        "Shiki full-bundle load on first code-block render is excluded from " +
        "this path (answer has no code block). Removed by " +
        "perf/shiki-lazy-language-subset.",
    });

    expect(
      offenders,
      `Long task(s) over ${LONG_TASK_BUDGET_MS}ms during streaming. ` +
        `Longest: ${longest.duration.toFixed(1)}ms ` +
        `(start ${longest.start.toFixed(0)}, ${longest.attribution}). ` +
        `Window: ${streamWindow.start.toFixed(0)}→${windowEnd.toFixed(0)}. ` +
        `Offenders: ${JSON.stringify(offenders)}`,
    ).toEqual([]);
  });
});
