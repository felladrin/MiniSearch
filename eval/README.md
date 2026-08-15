# Offline eval

A small offline eval that gives a regression signal for changes to the
reranker, the system prompt, the search-results formatting, or the model. It
has two parts, both driven by a single fixed golden set (`goldenSet.ts`).

Some of it runs in the default `npm test` suite (and so in CI); the rest is a
local signal:

- `metrics.test.ts`, `goldenSet.test.ts`, `promptConstruction.test.ts` run in
  the default suite: pure math, golden-set structure, and prompt construction.
  No model, no API key.
- `retrieval.integration.test.ts` (real ONNX model) and
  `answer.integration.test.ts` (network calls) run only under
  `vitest.eval.config.ts`.

It is not a benchmark: the numbers are a stable baseline to read direction of
change, not an absolute quality score.

## The golden set

`goldenSet.ts` is a fixed, hand-curated list of queries. Each entry has:

- `query`: the search query.
- `results`: realistic candidate results (title, snippet, url), mixed
  relevant and irrelevant, the way a real search engine returns them.
- `relevant`: the indices into `results` a human would call relevant.
- `referenceAnswer`: the key facts a correct answer must contain.
- `rubric`: the points a good answer must satisfy, checked one at a time.

The set is a starting point. Grow it by adding entries with the same shape;
keep the relevant labels unambiguous so the metric does not hinge on a
borderline call. Keep the input top-3 from already holding every relevant
result it can fit: if it does, a no-op reranker (which preserves input order)
scores that entry as well as a working one and the retrieval floors stop being
falsifiable. `goldenSet.test.ts` pins this two ways: a per-entry validator that
rejects a saturated entry, and a "stays falsifiable" aggregate that scores the
whole set as a no-op reranker and asserts the mean stays below the floors.

## Retrieval eval (reranker)

Runs the real ONNX reranker through `server/rankSearchResults.ts` on every
golden query and scores the ranking with **nDCG@3** and **recall@3** against
the labeled relevant results. It calls `rankSearchResults` with
`preserveTopResults=true`, exactly as the app does for text search, so the
pinned-first-result branch is exercised. The golden set therefore includes a
few entries whose first candidate is irrelevant: that is the case where the pin
costs the ranking, and without it the eval could not tell a good pin from a
bad one. This is the regression signal for the reranker and for the score
filter / top-result logic in `rankSearchResults.ts`.

Known limit: with `preserveTopResults=true`, `rankSearchResults` sorts the first
`nextTopResultsCount` (9) surviving results and everything after them as two
separate blocks, so the tail is never interleaved with the head. Nothing is
dropped. The golden entries have 4-5 candidates, so that split never binds
here; it would matter only for much larger result sets.

The metrics live in `metrics.ts` (pure, unit-tested in `metrics.test.ts`).

```sh
npm run eval:retrieval
```

Loads the real model (already in `server/models/`), so it is excluded from the
default `npm test` suite and from CI (which has no model on disk), and runs
under the node-environment eval config. It is a local signal, matching the
`server/` integration-test house style. It prints a per-query table and the
mean, and fails if the mean drops below the regression thresholds.

## Answer eval (LLM judge)

Builds the exact prompt the app sends (via the real
`getFormattedSearchResults` + `getDefaultChatMessages`, with the pubSub state
mocked to the golden query), asks a chosen LLM backend for an answer, and
scores it with a separate LLM judge against the golden set's `referenceAnswer`
and `rubric`. This is the regression signal for the system prompt, the
results formatting, and the model.

The system prompt is imported from `shared/defaultSystemPrompt.ts`, the same
constant `client/modules/settings.ts` uses, so editing the real prompt is what
the eval grades against. A stale copy here would let prompt regressions ship
green, which is the point the eval exists to prevent.

The candidate results are fed in a fixed order (the golden set order), not the
reranker's output, so this signal isolates prompt/model changes from reranker
changes (which the retrieval eval covers separately).

It makes real network calls, so it is gated on an API key and skips cleanly
without one. The prompt-construction checks (no model, no key) live in
`promptConstruction.test.ts` and run in the default suite.

```sh
EVAL_LLM_API_KEY="..." \
EVAL_LLM_BASE_URL="https://api.openai.com/v1" \
EVAL_LLM_MODEL="gpt-4o-mini" \
EVAL_JUDGE_MODEL="gpt-4o" \
npm run eval:answer
```

`EVAL_LLM_MODEL` is the model under test; `EVAL_JUDGE_MODEL` (defaults to the
same) grades it. Use a different, stronger model as the judge when possible.
Any OpenAI-compatible chat-completions endpoint works.

Note: reasoning models bill their thinking tokens against max_tokens, so a
reasoning judge can hit the 512-token judge budget before it emits its JSON
and fail with a "truncated at max_tokens" error. Use a non-reasoning judge (or
raise JUDGE_MAX_TOKENS in the source) if you want to grade with one.

## Running everything

```sh
npm run eval
```
