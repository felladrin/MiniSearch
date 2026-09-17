# Long-task profile: search with AI response and page content

Issue: [#2571](https://github.com/felladrin/MiniSearch/issues/2571) — keep long tasks off the main thread during search and generation.

This is the "recorded before and after" evidence the issue asks for. The measurement harness is
[`e2e/main-thread-budget.spec.ts`](../e2e/main-thread-budget.spec.ts): a `longtask`
`PerformanceObserver` installed with `page.addInitScript` before the app boots, so it sees every
task the app runs, with a streaming window opened when the inference request is issued and closed
once the full answer has rendered.

## Method

- Production build (`npm run build && HOST=127.0.0.1 PORT=<p> npm run start`), Chromium full
  channel — `chrome-headless-shell` never emits `longtask` entries, so it cannot be used for this.
- Everything external is mocked (config, search, page content, and the OpenAI-compatible inference
  stream served by a local SSE server), so the numbers are not noisy and no live service is involved.
- `enablePageContentFetch: true`, so the search-to-generation handoff is exercised.
- The profiled answer is an 18.8 kB streamed answer: 70 markdown paragraphs, ~70 inline links and
  one JavaScript code block. The size is deliberate — the per-frame cost the issue describes grows
  with the answer, so a short answer shows nothing.
- 5 runs per build, alternating, on the same machine.

## Result

| Build | Long tasks in the streaming window | Total main-thread time blocked | Longest single task |
| --- | --- | --- | --- |
| `main` (before) | 30, 31, 31, 32, 32 | 2008, 2050, 2143, 2149, 2207 ms | 108–186 ms |
| All seven fixes merged (after) | 0, 0, 1, 1, 1 | 0, 0, 51, 52, 52 ms | ≤ 52 ms |

Roughly **2.1 seconds of blocking main-thread work per streamed answer is gone**, and the worst
single task drops from ~160–190 ms to at or below the 50 ms long-task reporting threshold — i.e.
after the change there is effectively nothing left to report.

## What removed what

| Long task on `main` | Removed by |
| --- | --- |
| Full-markdown re-parse on every throttled frame (12 Hz), growing with the answer | `perf/memoized-markdown-blocks` — top-level blocks are memoized, so a frame that only extends the last block re-renders that block |
| Shiki loading from `shiki/bundle/full` for the first code block | `perf/shiki-lazy-language-subset` — web subset, and a language outside it degrades without a load attempt |
| One `resize` listener per citation link, each reading `scrollWidth` and calling `setState` | `perf/shared-resize-observer-citation-links` — one shared `ResizeObserver`, and the expand animates `transform`/`opacity` instead of `width` |
| `gptTokenizer.encode()` over every full page body at the search-to-generation handoff | `perf/page-excerpt-tokenization-worker` — the tokenization runs in a worker, with a synchronous fallback |
| Re-encoding the whole joined candidate per iteration in the rolling summary | `perf/incremental-rolling-summary-tokens` — each part encoded once, running count kept |

## Reproducing

The committed spec asserts the 200 ms budget on a code-block-free answer, which is the path that
passes on `main` too. To reproduce the table above, widen the answer (paragraphs + links + a code
block), raise the budget so the assertion cannot fail, and read the collected task list against a
`main` build and against the merged branches.

## Caveats

- Measured on one machine (arm64 Linux, Chromium 153). Absolute numbers move with the hardware; the
  before/after gap is large enough that the direction is not in doubt.
- The numbers cover the mocked streaming path. A real deployment adds upstream latency, not
  main-thread work, so the main-thread picture is representative.
- `perf/e2e-long-task-budget` is the branch that carries the guard; the seven fixes are the ones
  that moved these numbers.
