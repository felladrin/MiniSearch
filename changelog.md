# Changelog

Notable changes, grouped by date, most recent first.


## 2026-09-11

- Added text-to-speech playback that reads answers aloud with a local neural TTS model, falling back to OS voices.

## 2026-09-10

- Added a wake lock that keeps the screen awake while a response is generating.

## 2026-09-08

- Fixed search history cleanup failing with a TransactionInactiveError.

## 2026-08-31

- Dropped image results that come back without a thumbnail URL instead of rendering broken tiles.

## 2026-08-30

- Added the server start time to the /status endpoint.
- Added a token-gated /thumbnail endpoint that loads image result thumbnails lazily through the server.

## 2026-08-28

- Made searches degrade to cached and image results when the search engines are down.

## 2026-08-26

- Kept the reranker relevance score on results and tagged results in the prompt for the model.
- Fixed untrusted text in the prompt by labeling all of it, not only page excerpts.

## 2026-08-25

- Fixed OpenAI-compatible inference to retry the next model when a stream reports an error.

## 2026-08-23

- Security: refused token and access-key hashes with mismatched argon2 parameters.
- Security: refused an already-rejected token without performing a second argon2 verification.
- Fixed searches that came back empty with unresponsive engines by retrying them.

## 2026-08-21

- Security: rate-limited the access-key validation endpoint.
- Improved page-content excerpt selection by fusing bi-encoder dense scores with lexical ranking, reading PDF results instead of dropping them, and overlapping splits of long passages.
- Fixed the configured request timeout to act as an idle timeout on the upstream stream.

## 2026-08-20

- Fixed treating a SearXNG response with unresponsive engines as a successful search.
- Added operational reporting to /status for search timing, reranker effect, dropped thumbnails, inference outcomes, and token and rate-limit rejections.

## 2026-08-19

- Security: pinned deepmerge-ts to 8.0.1 via overrides to address a vulnerability.

## 2026-08-17

- Fixed duplicate inference when the search form remounts.

## 2026-08-16

- Showed the model size while a model is downloading.
- Reworked the search results hierarchy and the drawer transitions.
- Fixed the search form submitting while composing text with an IME.
- Fixed non-Latin follow-up questions being mangled.

## 2026-08-15

- Security: guarded thumbnail fetches against SSRF with a size cap, rate-limited requests before token verification, and stopped logging whole error objects on the internal API endpoint.
- Fixed the image lightbox source label crashing on relative URLs.
- Fixed failed searches being reported as "no results".
- Added a value proposition and AI opt-in prompt on first run, shown only after the first search.

## 2026-08-14

- Security: bumped nanoid to 3.3.18 to address a vulnerability.
- Fixed the server logging the search query.
- Added grounding of AI answers on fetched page content.

## 2026-08-13

- Fixed pre-stream inference failures to return 503.

## 2026-08-12

- Fixed treating an empty upstream stream as a successful response.

## 2026-08-10

- Published the Docker image as `latest` instead of `main`, with provenance, SBOM, and a scan.

## 2026-08-08

- Security: bumped postcss to resolve a nanoid vulnerability.

## 2026-08-07

- Set LittleLamb 290M as the new default Wllama model.
- Scaled the default CPU thread count with the machine.
- Fixed the UI transitioning to the generating state before any content arrived.

## 2026-08-05

- Replaced the reranker with a multilingual cross-encoder.

## 2026-07-31

- Security: validated and clamped server proxy inputs.

## 2026-07-30

- Removed secret build args from the Dockerfile and hardened .dockerignore.
- Made client configuration runtime-resolved via a new /api/config endpoint.
- Fixed truncating reranker input by characters instead of tokens.
- Fixed handling of chunk boundaries in internal API streams.
- Consolidated duplicate circuit breakers in the web search service.

## 2026-07-29

- Fixed /status reporting sessions as zero.

## 2026-07-28

- Validated cached model files before reusing them.
- Security: overrode adm-zip to 0.6.0 to clear GHSA-xcpc-8h2w-3j85.
- Replaced llama.cpp with ONNX Runtime for reranking.
- Made the reranker retry on CPU when the GPU provider fails.
- Made image thumbnails keyboard accessible.

## 2026-07-27

- Security: generated the search token with a CSPRNG, widened access-key and search-token hash digests to 32 bytes, and tightened search token file permissions.

## 2026-07-24

- Fixed internal API stream errors being swallowed instead of surfaced.

## 2026-07-23

- Used SHA-256 for cache keys and included the result limit in the hash input.
- Added screen-reader landmarks and a live region for streaming responses.

## 2026-07-22

- Keyed the rate limiter on the client IP behind a TRUST_PROXY setting to close a rate-limit bypass, and cleaned up verified tokens.

## 2026-07-21

- Clamped max_tokens on the /inference proxy.

## 2026-07-13

- Removed the searchResultsToConsider setting and hardcoded it to 6.

## 2026-07-08

- Replaced the recent-activity list with a contribution heatmap.
- Added a browser notification when an AI response is ready, which focuses the tab when clicked, with a toggle that properly requests permission.

## 2026-06-27

- Removed user-configurable sampling parameters from the settings and UI.

## 2026-05-11

- Replaced WebLLM with Wllama WebGPU support and fixed Wllama not receiving search results in its prompt.

## 2026-03-07

- Gave each log entry a unique ID so the Logs modal renders them correctly.

## 2026-02-13

- Fixed image results and the image carousel not displaying by using the correct thumbnail property.
- Fixed analytics handling an undefined search source.
- Added a loading state during access key validation.

## 2026-02-12

- Replaced the axios and searxng packages with a native fetch implementation.
- Added binary-compatibility detection and platform logging to the reranker service.

## 2026-02-03

- Added Unicode surrogate sanitization to the reranker service.

## 2026-01-01

- Fixed the counting of daily average searches.
- Added reasoning content streaming support for AI responses.

## 2025-12-01

- Ensured the model always has access to search results relevant to the current question, not just the original search query.

## 2025-11-21

- Added auto-restart on error for the reranker service.

## 2025-11-08

- Fixed stale chat messages carrying over by clearing them before a new search starts.

## 2025-11-07

- Prevented duplicate auto-initialization of searches triggered from the URL query.

## 2025-11-06

- Recorded searches made from the address bar in the search history.

## 2025-11-05

- Implemented a search history system.

## 2025-10-14

- Removed the PM2 process manager in favor of a direct npm start command.

## 2025-10-13

- Implemented conversation summarization to handle context window overflow.

## 2025-10-07

- Added message editing and response regeneration to the chat interface.

## 2025-10-03

- Added automatic retry with random model fallback for OpenAI-compatible APIs.

## 2025-09-15

- Added model auto-selection for text generation with OpenAI-compatible APIs.

## 2025-09-01

- Added blockquote support to the Markdown renderer.

## 2025-08-14

- Enabled flash attention in Wllama for faster inference.

## 2025-08-11

- Made AI Horde text generation race parallel requests and use the first to finish.

## 2025-08-10

- Implemented parallel text generation for AI Horde.

## 2025-08-09

- Added an error boundary fallback for code highlighting of unknown languages.

## 2025-07-06

- Ensured unique model IDs in the model dropdown.

## 2025-07-02

- Downgraded Wllama to a version that can run larger models without running out of memory.

## 2025-06-11

- Tracked and prevented duplicate follow-up questions.
- Interrupted the AI Horde waiting loop when the selected model cannot fulfill the request.
- Improved text-to-speech preprocessing by removing reasoning blocks and preserving link text.

## 2025-06-10

- Kept the system prompt with search results when the context buffer fills and preserved user/assistant alternation when truncating messages.
- Implemented related search query generation with accumulation of search results.
- Fixed the key used to deduplicate image results from new search results.
- Added expandable links so users can see what a link is about while the response generates.

## 2025-06-06

- Implemented statistical filtering for search results.
- Added web search service health checks, exposed the health status on /status, and added a Docker healthcheck.
- Added log filtering to the logs view.

## 2025-05-22

- Improved API auth token handling by moving the token to query parameters with proper status codes and error formatting.

## 2025-05-21

- Replaced react-syntax-highlighter with Mantine's Shiki-based code highlight component.

## 2025-05-16

- Fell back to "text" syntax highlighting when no language is provided for a code block.

## 2025-05-11

- Added an AI response opt-in prompt for first-time users.

## 2025-05-07

- Migrated the Docker base image from Alpine to Debian for compatibility with the latest SearXNG image.

## 2025-05-05

- Updated the WebLLM package and its model IDs to Qwen3-0.6B.
- Refactored search caching to use Dexie.js.

## 2025-03-14

- Fixed the transition from the "Preparing response" to "Generating response" state when using Wllama.

## 2025-03-05

- Added a loader indicating that the AI thinking process is running.

## 2025-03-02

- Fixed an issue preventing typing in the input field from the Follow-up Questions area.

## 2025-02-22

- Fixed image results occasionally appearing duplicated.

## 2025-02-21

- Added an AI reasoning section driven by custom markers in the response.

## 2025-02-20

- Improved search result quality by removing less relevant matches.
- Fixed image re-ranking returning the unranked list and added a one-second timeout when fetching image thumbnails.

## 2025-02-11

- Changed the default models to 1B-parameter models.

## 2025-02-09

- Replaced the "openai" package with "@ai-sdk/openai-compatible" for OpenAI-compatible inference.

## 2025-02-08

- Displayed the username and kudos balance of the configured AI Horde API key.

## 2025-02-02

- Reduced the Docker image size by switching to a multi-stage build.

## 2025-01-25

- Switched the reranker to a faster model running on a single thread.
- Replaced the node-llama-cpp dependency with a llama-server instance running inside the container.

## 2025-01-24

- Allowed setting allowed-hosts via environment variable.

## 2025-01-23

- Opened links in AI responses in new tabs.
- Improved the read-aloud feature by cleaning the text before invoking speech synthesis.
- Allowed manually entering a model name when the API returns an empty model list.

## 2025-01-17

- Streamed responses from AI Horde models.

## 2025-01-05

- Added an AI Horde model selection dropdown.

## 2025-01-03

- Fixed unhandled errors in the read-aloud (speak response) feature.
- Allowed users to supply their own AI Horde API key for faster responses.

## 2024-12-28

- Allowed manually setting the model identifier when the /models endpoint is unavailable.

## 2024-12-03

- Removed the custom Wllama cache manager now that iOS 18 caches correctly by default.

## 2024-12-01

- Increased the default context size to 4096 tokens and updated Wllama cache settings.
- Improved markdown rendering in AI responses with copyable code blocks, table styling, and correct nested list items.
- Added error and loading handling to the search results section.

## 2024-11-26

- Added voice selection for AI responses.

## 2024-11-25

- Added speech synthesis for reading AI responses aloud.

## 2024-11-24

- Allowed users to customize AI inference parameters such as temperature, top-p, frequency penalty, and presence penalty.

## 2024-11-23

- Filtered out invalid image results to avoid broken entries in image search.
- Decoupled text and image search so results load independently, raising the rate limit to match.

## 2024-11-20

- Fixed the model selector resetting the chosen model when re-opening the menu on Remote Server (API).

## 2024-11-14

- Reduced Wllama memory usage by switching the cache from f16 to q8_0.

## 2024-11-13

- Made searches faster by processing SearXNG results concurrently.

## 2024-11-09

- Added AI Horde as an additional inference provider alongside the existing browser-based and OpenAI options.

## 2024-11-07

- Added a Search Settings section to the menu, including a new Search Results Limit setting.

## 2024-11-06

- Capped the maximum number of search results server-side while keeping the client-side setting configurable.

## 2024-11-03

- Improved error handling in the AI Settings form when Remote Server (API) is selected.
- Allowed copying messages from the Follow-up Questions area.
- Added a button to regenerate the response.

## 2024-11-01

- Improved image search quality and speed by downloading only images that pass similarity checks.

## 2024-10-30

- Fixed the Interrupt Generation behavior.
- Added an option to turn AI response auto-scrolling on and off.

## 2024-10-28

- Stopped fetching the model list until the user sets an API Base URL.
- Displayed a suggested CPU thread count for Wllama.

## 2024-10-26

- Fixed the categories queried from SearXNG, avoiding errors from unused categories.
- Displayed the model size alongside the model download progress bar.

## 2024-10-25

- Displayed Wllama model sizes in megabytes, matching the WebLLM models.
- Added average searches per session statistics.

## 2024-10-24

- Renamed "Inference Type" to "AI Processing Location" for clarity.
- Made the Docker image runnable on both ARM64 and AMD64 platforms.
- Displayed an error message under the API Model field when listing models from the API fails.
- Added access key persistence with a configurable timeout, including an ACCESS_KEY_TIMEOUT_HOURS build argument.

## 2024-10-23

- Improved the re-ranking of search results.

## 2024-10-22

- Fixed the response state not updating after approving an AI model download.

## 2024-10-21

- Required user permission before downloading AI models, for transparency and data-usage control.
- Included search result URLs in Wllama prompts by default.
- Implemented dynamic context window management using token counting for chat responses.

## 2024-10-19

- Passed only the last three messages when continuing a Follow-up Questions conversation, to fit small context limits.

## 2024-10-18

- Removed search results whose snippets start with "[data:image".

## 2024-10-16

- Fixed link snippets overflowing their container when content contains extremely long strings.
- Added a button to restore the default AI instructions.

## 2024-10-13

- Allowed reading the default inference type from the DEFAULT_INFERENCE_TYPE environment variable.

## 2024-10-11

- Added automatic selection of the first available model when configuring an OpenAI-compatible API.

## 2024-10-10

- Added support for asking follow-up questions to the AI response.

## 2024-10-08

- Fixed OpenAI-compatible inference for models that do not accept a System role.
- Added support for an internal OpenAI-compatible API as a text-generation backend.

## 2024-10-05

- Added support for customizing the default models via the `.env` file.

## 2024-10-04

- Added an access page that gates the app when `ACCESS_KEYS` is configured in the `.env` file.

## 2024-09-29

- Replaced the image zoom library with `yet-another-react-lightbox` to improve previewing of image results.
- Made the model selection list searchable to handle long model lists.

## 2024-09-23

- Added sending the search query to the parent window via postMessage when navigating from an embedded instance.

## 2024-09-21

- Made Qwen 0.5B the default Wllama model.
- Added a setting to enable or disable submitting a search with the Enter key.
- Added a dark mode toggle to the interface settings.

## 2024-09-18

- Fixed settings to always fall back to a valid model when a previously selected model is no longer available.
- Added an option to show the full AI response without a scroll bar.

## 2024-09-16

- Integrated an OpenAI-compatible API for text generation.

## 2024-09-15

- Replaced the image results scroll area with a carousel.
- Limited text results only after processing them so more results are available for reranking.
- Displayed the AI response in a card and added a button to copy it.
- Added recommended-model indicators for WebGPU and CPU in the model selection.

## 2024-09-14

- Switched production server process management to PM2.
- Migrated the UI components from React Suite to Mantine.

## 2024-09-09

- Kept the already-generated part of the AI response visible by showing failure messages below it instead of hiding the response.
- Added a logs viewer accessible from a menu button.

## 2024-09-08

- Fixed duplicate source URLs for image results returned by SearXNG.
- Added a setting for customizing the AI instructions.

## 2024-09-07

- Added image search with zoomable image results.

## 2024-09-05

- Added a setting to select the model used when running inference on CPU.

## 2024-09-04

- Fixed the CPU thread count saved through the settings menu being stored with the wrong type.

## 2024-09-01

- Added a configurable background image.

## 2024-08-30

- Improved Markdown rendering and syntax highlighting, including fixing code blocks overflowing the container width.

## 2024-08-29

- Added IndexedDB caching for search results.

## 2024-08-25

- Avoided showing more than one search result from the same hostname.
- Added a setting to choose the AI model used when WebGPU is enabled.
- Added a button to interrupt response generation.

## 2024-08-24

- Removed the RatchetML inference backend.
- Fixed Wllama models not loading from cache on iPads by using a custom cache manager.
- Allowed multi-threading for Wllama on mobile devices.
- Added a progress bar when loading the AI model.

## 2024-08-22

- Revamped the UI using React Suite components.

## 2024-07-26

- Replaced the built-in search functionality with the SearXNG library.

## 2024-07-20

- Renamed settings to menu and added an option to reset settings and delete all cached files to free up space.

## 2024-07-13

- Allowed Wllama models to run when the browser reports no internet access.

## 2024-06-28

- Replaced react-router-dom with the wouter library to reduce memory usage.

## 2024-06-27

- Started responding immediately when the number of search results to consider is zero.

## 2024-06-23

- Added client-side caching of search results during a session.

## 2024-06-20

- Added a setting for the number of search results to consider when generating AI responses.

## 2024-06-14

- Restricted RatchetML inference to the Safari browser.
- Added a clear button shown when the search field is not empty.

## 2024-06-12

- Added a score threshold to avoid showing irrelevant search results.

## 2024-06-09

- Interrupted text generation when the user runs another search while one is still in progress.
- Added client-side routing so new searches no longer reload the page.

## 2024-06-05

- Added embedding-based reranking of search results using node-llama-cpp.

## 2024-05-21

- Started loading the AI model while web search results were being fetched, speeding up responses.
- Removed the Summarize Links feature.

## 2024-05-18

- Replaced the compression middleware with http-compression to support HTTP/2.

## 2024-05-17

- Added a setting for the number of CPU threads to use.

## 2024-05-11

- Switched to single-threaded Wllama on mobile devices due to low available memory.

## 2024-05-10

- Used sharded GGUF models on desktop to stay within Safari's cache size limit.
- Displayed the model loading progress percentage when using Wllama.

## 2024-05-08

- Increased the variety of query suggestions by fetching new ones at runtime instead of defining them at build time.

## 2024-05-06

- Improved the link summarization feature by using Jina AI Reader.

## 2024-05-03

- Added RatchetML as a WebGPU inference backend alongside Web-LLM.

## 2024-05-01

- Moved search result ranking to the backend so mobile devices benefit from better results.

## 2024-04-27

- Added a rate limiter and token verification to prevent abuse of the search endpoint.
- Added a /status endpoint for monitoring the server.

## 2024-04-20

- Added Llama 3 8B as the larger model for Web-LLM.

## 2024-04-17

- Replaced the Express server with Vite's preview server.

## 2024-03-28

- Added a keyword-based re-search when the original query returns no results.

## 2024-03-23

- Added suggested queries to the search form.

## 2024-03-22

- Displayed the domain alongside each search result link to increase click confidence.

## 2024-03-16

- Added Wllama as an alternative in-browser inference library.

## 2024-03-12

- Added re-ranking of search results before passing them to the language model.

## 2024-01-09

- Added three model sizes to fit all devices when running on transformers.js.

## 2023-12-31

- Added support for a larger model option when using transformers.js.

## 2023-12-23

- Switched from a text-to-text-generation model to a text-generation model.

## 2023-11-02

- Started publishing the Docker image to GitHub Packages.

## 2023-10-23

- Added a setting for disabling AI responses.

## 2023-10-22

- Adopted SearXNG as the metasearch engine.

## 2023-10-21

- Added a settings menu with options to toggle links summarization and use of a larger model.

## 2023-10-14

- Started MiniSearch as a self-hosted metasearch app with in-browser AI-generated answers.
