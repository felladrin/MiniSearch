# Changelog

Notable changes, grouped by date, most recent first.

## 2026-11-27

- Images found by a follow-up question are no longer lost when a second follow-up is sent before they arrive. The second follow-up's image search took over, so when the first one's images landed they were dropped, on screen and in history. They are now added to the list either way.
- Images found by a follow-up question now show even when the first image search failed. The "Failed to search for images" alert stayed for the rest of the visit and hid them, although they were saved and showed after restoring the search. The alert now shows only while there are no images.
- Restoring another search from history while a follow-up is being answered now stops that follow-up. The old chat stayed on screen under the restored search, so sending was blocked until the old answer ended, and that answer was built from the restored search's results and then suggested a question about the old search. The follow-up is now cancelled when the restore switches searches: its question is saved under its own search with "The answer was interrupted.", and the restored chat can be used at once.

## 2026-11-26

- Restoring the search already on screen while a follow-up is being answered keeps the live text results and page excerpts used by that answer.
- A search's saved images no longer lose the first search's or a follow-up's images when you leave the search before both arrive. Whichever image search finished last replaced the other's images in history, so restoring that search later showed only one set. Images that arrive after you left a search are now added to the ones it already saved.
- A follow-up answer no longer disappears when the same search is restored from history while that answer is still coming. If the answer arrived while the restore was reading the saved chat, the restore put back the older list without it, and the next message sent then removed it from history too. The question being answered also vanished from the chat until its answer arrived. Restoring the search already on screen now leaves a chat that is still answering as it is; restoring any other search still shows that search's saved chat.
- A follow-up question no longer disappears when "AI response" is turned off and back on while it is still being answered. Turning the setting off stopped the follow-up and saved the question with "The answer was interrupted.", but the chat shown after turning it back on was rebuilt without it, and the next message sent from that chat then removed it from history too. The question and its note now stay, on screen and in history.
- Images found by a follow-up question no longer replace the first search's images, or the other way around. When the first image search was still running as a follow-up was asked, whichever finished last replaced the other's images on screen and in history. While you stay on that search, both sets are now kept.
- Regenerating the main answer, or retrying the search, now also clears its follow-ups from history once the new answer is saved. The chat on screen was cleared, but the follow-ups stayed in storage, so restoring that search later showed the old follow-ups under the new answer. A follow-up still generating when the main answer was regenerated could also write the old conversation back. A regenerate that is stopped or fails keeps the old answer and its follow-ups.
- An AI answer that finishes after its search was replaced no longer lands in another search. When a new search, a restore from history, or Stop followed by Regenerate replaced an answer that was still generating, the old answer could still be saved under the new search's history entry, shown in place of the new answer, and mark it completed. A replaced answer is now dropped when it returns, and an answer is always saved under the search that asked for it. Restoring a search from history also stops the answer that was generating.
- A long chat no longer summarizes the same earlier messages again on every turn. Once a chat outgrew the model's window, each new message sent every earlier message that no longer fit back to the model for summarizing, so the summarizing work kept growing with the chat, and small models eventually fell back to a plain transcript instead of a summary. Each message is now summarized once. An edit that reaches into the summarized messages, or restoring another chat that starts with the same question, starts the summary over.
- Stop now ends the answer it was pressed for, and only that one. Stopping went through a shared flag, so with a search answer and a chat reply running at once, Stop could cancel the wrong request or none at all, and an answer from an OpenAI-compatible API that had not sent its first word yet kept going until it did. A chat reply also kept running after a new search replaced the chat, and Stop on that new search could end it instead. Each answer now has its own cancel signal: Stop cancels the search answer's request at once, even before any text arrives, a new search cancels the previous search's answer, and closing the chat cancels its reply. A chat question whose reply was cancelled this way stays in the saved chat, with a note that the answer was interrupted, so a restore still shows it.
- A follow-up conversation restored from history now shows the same turns you left. Regenerating an answer, editing a question or a failed send only changed the screen: storage kept the rejected answer (which also went back into the model's context on later turns), kept the pairs an edit had removed, and dropped the question of a failed send. A follow-up answered after a new search had started was also saved under the new search. Every change to the conversation is now saved the same way, under the search it was asked in.
- A slow search or follow-up no longer overwrites a newer search's results. Submitting a new search, retrying, or restoring a past search while an older search was still in flight could let the slower one replace the screen's text or image results, grounding snippets, page reads, or error state, and save its results into the new search's history entry; late follow-up refreshes racing inside the same conversation could also drop newer results from the list. Each search and follow-up refresh now checks that it is still current before updating the screen, saves history under its own run ID, and skips writing when a newer attempt owns that run.
- Long chats no longer send the model more than its context allows once older turns are summarized. The earlier turns were trimmed to fit before the new summary was written, and the summary was then added to the prompt without trimming again, so the prompt could overshoot the history budget by the size of the summary; the summary's 800-token limit was also only a request to the model. Room for a full-size summary is now reserved before the earlier turns are trimmed, and the summary is cut to 800 tokens. Chats short enough to need no summary send the same messages as before.
- An AI Horde job that lost the race before the Horde had even confirmed it is now cancelled too. With no model chosen, MiniSearch sends two jobs and uses whichever answers first; when the winner answered while the other job's submit was still on its way, that submit was dropped, so MiniSearch never learned the job's id and could not cancel it, and a community worker could still spend GPU time (or your kudos) on it. The submit now finishes, and the job it created is cancelled right away.
- An AI answer with a reference link or footnote no longer freezes the page when it has a long run of blank lines. Trimming the blank lines around such an answer took quadratic time on the main thread, on every streamed piece of text: 20,000 blank lines followed by more text took about 1.7 seconds per update. It now takes a few milliseconds.
- A footnote in an AI answer now jumps to its own note. Every answer, chat reply and reasoning block named its first footnote `user-content-fn-1`, so with two footnoted answers on the page, clicking `1` in the second one scrolled to the first answer's note, and its back-reference to the first answer's text. Each of them now gets its own footnote ids.
- Reference-style links and footnotes in an AI answer now render. A definition such as `[1]: https://www.usgs.gov/` or `[^1]: USGS overview.` sits in its own paragraph, and each paragraph used to be rendered alone, so `[USGS][1]` and `[^1]` showed as plain text and the footnote text was lost. An answer that has a definition is now rendered as one document, with the footnotes listed once at the end. Links inside the answer, such as a footnote and its back-reference, now jump within the page instead of opening a new tab. Answers without definitions render as before.
- The browser model now answers one question at a time. Two searches submitted while the model was still loading could load it twice at once: while the model is not cached yet the second load fails on the browser's exclusive file lock, and once it is cached both copies sit in memory at the same time. The same could happen between a search and a follow-up question, or a chat send and a follow-up. Every answer that uses the browser model now waits its turn, so only one runs at a time, and a run that fails or cannot release its model releases the turn for the next one.
- An AI Horde answer no longer fails because one of its two jobs did. With no model chosen, MiniSearch sends two jobs and uses whichever answers first, but a job that failed first, such as one whose worker crashed, ended the whole answer with "Generation failed" while the other job was about to finish. A failed job is now ignored as long as the other one is still running, and the answer fails only when both do. When both fail, a stop you pressed still ends it without a new attempt, and a job that could not run on the top models still sends the second round to any model.
- Stop now ends an answer from the instance's own AI right away. The request was never cancelled: pressing Stop only took effect when the next piece of text arrived, so a stalled answer kept going until the server gave up, and even after Stop the connection stayed open, so the server kept generating and counted the answer as streamed instead of abandoned. The same happened when the answer ended with an error. The request is now cancelled on Stop, even while nothing is arriving, and whenever the answer does not finish.
- A SearXNG that stops answering no longer holds a search until the client gives up. The request to SearXNG had no time limit, so a stalled instance kept a search waiting for up to 300 seconds, past the client's 30 second timeout, and the fallback providers were then skipped because the search's time had run out. The request, its retries and the waits between them are now canceled after 15 seconds when a fallback could still answer, leaving it the remaining 10, and after 25 seconds otherwise; each canceled request counts toward opening the SearXNG circuit. A failed SearXNG answer now also releases its connection right away, and a search whose every retry got a 500 says so in the log.
- A failed regeneration no longer loses the answer. Regenerate removed the answer from the chat before asking for a new one, and when the model errored it was gone, with the regenerate button, and the follow-up suggestion was cleared too, so the question had to be typed again; the only trace was a line in the logs. The previous answer and the follow-up suggestion now come back, a red notification says the regeneration failed, and the answer can be regenerated again.

## 2026-11-25

- An AI Horde job that is no longer needed is now cancelled on every path, so no community worker spends GPU time (or your kudos) on an answer nobody reads. Before, only the losing job of a finished race was cancelled: a job that failed, could not be taken by its model, was interrupted, or was replaced by the fallback round to any model stayed queued. The winning answer also no longer waits for the losing job's cancel request.
- Six server variables that never had an effect are gone from the documentation: `MODEL_MAX_RETRIES`, `MODEL_BASE_BACKOFF_MS`, `MODEL_MAX_BACKOFF_MS`, `MODEL_MAX_CONCURRENT_REQUESTS`, `MODEL_TEMPERATURE` and `MODEL_TOP_P`. Nothing read them, so setting them changed nothing; an instance that sets them can drop them. `MODEL_DEFAULT_MAX_TOKENS` and `MODEL_REQUEST_TIMEOUT_MS` now take digits only: `"8k"` used to be read as 8, which cut every answer to 8 tokens, and `"1e4"` as 1; both are now logged once and replaced by the default. A timeout above 2147483647 ms is refused the same way, since Node fires a longer timer after 1 ms and every attempt would have been aborted as stalled.
- An answer from the instance's own AI that stops at the output token limit now says so. The server always reported a finished answer as complete (`finish_reason` `stop`), even when the API had cut it at `max_tokens`, so a cut answer looked like a short one. The server now passes on the API's reason, and the browser adds a line to the logs when an answer was cut short.
- Answers from the instance's own AI are no longer cut short. The browser sized every request to it for a 4096-token window, so with search results and page excerpts in the prompt the answer often got fewer than 2048 tokens, and the server capped it at 2048 anyway; a reasoning model could spend all of that thinking. The window now defaults to 131072 tokens (128K) and can be set with `INTERNAL_OPENAI_COMPATIBLE_API_CONTEXT_LENGTH`, and the server's cap, `MODEL_DEFAULT_MAX_TOKENS`, now defaults to 8192. With the larger window, more of each page read also goes into the prompt.
- Admins can now set the reasoning effort of the instance's own AI. The new `INTERNAL_OPENAI_COMPATIBLE_API_REASONING_EFFORT` variable is sent as `reasoning_effort` on every request to the internal OpenAI-compatible API, for every model in the list, so a reasoning model can be told to think less (or not at all) and answer faster. Left empty, nothing is sent and the API keeps its own default.

- Follow-up questions are now shown when the main AI answer came back empty. The first follow-up question and its answer used to be hidden for good, "Copy conversation" left them out, and they could not be regenerated. A last answer that came back empty now shows "No response" with its Re-generate button, instead of showing nothing to retry from.
- The AI answer is now saved to the history in full. Response updates are throttled to about 12 a second, and the save read the throttled channel right after the stream ended, before the write carrying the last tokens had run, so the stored answer could miss everything that arrived since the last publish — up to the whole answer, which with a reasoning model left a history row that restored as an unfinished thought. The save now takes the text the generation call returns, and the full answer is published before the generation state turns to completed, so the restored history row and the follow-up chat start from the complete answer. Restoring a saved answer publishes it the same way.
- Earlier chat turns no longer send their thinking back to the model. Stored answers keep their reasoning block, and every prompt built from the conversation was sending it again: wasted tokens, and older turns dropped from the context sooner because of it. The reasoning is now stripped where the prompt is built, for the continuation, the rolling summary and the follow-up question suggestions. The chat and the History still show it.
- Fetches triggered by the settings are cancelled when superseded and give up after 10 seconds. Typing a base URL or a Horde key used to fire one request per character, and the slowest answer won: an old server's model list could replace the correct one, a cleared field could show the old user again, and an endpoint that never answers left the model dropdown stuck or delayed the start of an AI response indefinitely. Clearing the base URL now clears the model list too.
- Follow-up question suggestions are now written from the question prompt alone. The prompt went out the way a chat answer does, behind the system prompt with the search results, which buried the instructions for the question under unrelated text; it now goes out on its own, like the related search query. A reply with no question in it also no longer leaves a blank entry in the list of earlier suggestions the next prompt asks the model not to repeat, which pushed a real one out of that list.
- Searching from an embedded MiniSearch no longer depends on which frame comes first in the embedding page. The query was posted to an origin read from the parent's first child frame, so when that frame was another site (an ad, a chat widget, or a cross-origin frame of the app's own when not embedded), the browser refused the read and the search did nothing, and restoring a search from the history left the app stuck mid-restore. Browsers without `location.ancestorOrigins` never received the query at all. The query is now posted only to the origins in the new `PARENT_WINDOW_ORIGINS` setting, `https://huggingface.co` by default, and the browser delivers it only when the embedding page is on one of them.

## 2026-11-24

- Pinned searches now stay in the History drawer however many searches you make after them. The drawer only loaded your 200 most recent searches, and listed 100 of them, so an older pinned search disappeared from it, and from the filter, while it was still stored and protected from cleanup. Every pinned search is now shown in the Pinned section, and the filter finds it. Pinned searches are found through a new index, so this does not slow down as the history grows, and searches pinned before this update are picked up the first time the app opens after it.
- `/status` no longer names the internal models. Its `inference.byModel` was an object keyed by model id, and `/status` needs no token, so anyone probing an instance could read which upstream models it runs, or with the random pool the upstream's whole catalog. It is now an array: with `INTERNAL_OPENAI_COMPATIBLE_API_MODEL` set, entry _i_ is the model at position _i_ of that list, zero-filled when untried, and with the random pool the entries follow first-seen order. The counters themselves are unchanged, so a dead member of the pool is still visible.
- Settings read from the browser now start from the shipped defaults with the stored values applied on top. A profile saved before a setting was added used to see that setting as undefined until initialization finished a moment later, and parts of the page read it before then. A stored settings value that could not be parsed now counts as no stored settings at all, so such a profile gets the server's defaults instead of being pinned to the shipped ones.
- `/status` no longer misreports two counters. The average search time (`searches.averageTextualMs`) divided SearXNG's response times by every text search served, fallback-served ones included, so during an outage it sank toward 0 while SearXNG answered nothing; it now averages only the searches SearXNG answered, as the docs say (image searches the same). And a PDF that cannot be parsed (password-protected or malformed), or a page whose text cannot be extracted, is counted as the new `pageReads.skipped.unparsable` instead of `failed`. `failed` counts as the host refusing the read, so three locked PDFs from one site used to make the server skip that site, its ordinary pages included, for five minutes.
- The History drawer's Analytics tab now counts every saved search. It read only the newest 1,000, so with a longer history (Maximum Entries goes up to 10,000) Total Searches stopped at 1,000, and Daily Average, Most Active Hour, Search Sources and the activity heatmap left out everything older. The tab now reads only the time and source of each search, never the saved results.
- Keenable is now one of the three default search fallback providers, alongside Parallel and You.com. When SearXNG fails, an instance that runs the fallback now tries Keenable too without any setup: with no key it uses Keenable's keyless endpoint, and setting `SEARCH_FALLBACK_KEENABLE_API_KEY` switches it to the authenticated one. To leave it out, name the providers you want with `SEARCH_FALLBACK_PROVIDERS`.
- An unknown path under `/search/` no longer runs a search. Any path there other than `/search/text` and `/search/images`, such as `/search/foo` or `/search/textual`, was served as a search: it checked the token and spent a rate-limit point, then queried SearXNG, as an image search unless the path began with `/search/text`, and was counted in the search counters. Such a request now gets a 404 with a JSON error, before the token is checked.
- A failed access key check on load no longer deletes the saved key. When the app had loaded its configuration but the check of the saved key then got no usable answer, such as a dropped connection, a proxy's error page on that request, or a server restarting between the two, the key was deleted and had to be entered again even though it had time left. It is now deleted only when the server says it is invalid, when it has expired, or when the saved value is unreadable. Otherwise it is kept and checked again on the next load.
- A page load where the server configuration could not be fetched no longer saves the shipped defaults as the browser's settings. On a first visit that failure used to lock in the built-in model and inference type, so the server's own defaults were never applied to that browser afterwards. The model the app switches to when the saved one has left the catalog follows the same rule: it is saved only when the server's configuration was available.
- The suggestion shown in an empty search box now uses up one stored suggestion each time the box is emptied, and the suggestions are drawn evenly from the whole list. Deleting the last character or pressing Clear used to use up two and show one, and when none were stored it fetched the list twice at the same moment. The shuffle also favoured entries near the top of the list, so some suggestions came up far more often than others.

- Changing a setting in one section of the menu no longer undoes a change made in another. The AI, Search, Interface, History and Voice forms each kept a copy of every setting from the moment the menu opened and wrote the whole copy back on each change, so turning off Text Search and then switching Enter to Submit switched Text Search back on, and a model the app had fallen back to during a search was replaced by the one the menu opened with. Each form now writes only the settings it changed.
- The search fallback can use Keenable as a third provider. It is opt-in: it joins the default list only when `SEARCH_FALLBACK_KEENABLE_API_KEY` is set, or when `SEARCH_FALLBACK_PROVIDERS` names `keenable`, in which case its keyless endpoint is used without a key. Instances that already run the fallback keep Parallel and You.com as before.
- Removing a search from the history now removes its AI answer and chat with it. Automatic cleanup, by age or by the entry limit, and deleting a single entry used to delete only the search, so its answer and chat stayed in the browser's storage for good, out of reach of the History drawer. Follow-up question suggestions also no longer write chat rows that nothing reads, and the rows that earlier versions left behind are removed once, the first time the app opens after this update. Pinned searches keep everything.
- A search that fails now says why in the log. A timeout while the results were still arriving was reported as a JSON parsing error, and a dropped connection got no network label in any browser, because the check looked for the word "network" and Chrome, Firefox and Safari each word it differently. Both are now named where they happen, so the log shows a timeout as a timeout and a network failure as one, also on the line that says it served results from a previous search.
- An AI Horde answer no longer fails, or submits extra jobs, because of a passing rate limit or server error while it waits. A 429 or 5xx on a status check was read as "Generation not possible with the selected model", and in automatic mode that sent two fresh jobs to any model, doubling the kudos spent. Such a check is now retried, waiting a little longer each time, and the answer fails only after five in a row, with the server's reason and without the extra jobs. A job that is gone ends right away with Horde's message, a finished job with no text says "No text generated", and a refused API key now shows Horde's reason instead of "Failed to start generation".
- A page whose address lookup never comes back no longer holds up page reads past their 6 second limit. The lookup ran outside that limit, once per redirect, so a stuck DNS resolver could stretch a single page read to tens of seconds and delay the AI answer waiting on the batch. The lookup now counts against the same 6 seconds, the read is counted as timed out instead of blocked, and three of them in a row make the server skip that site for a while, as it already does for sites that time out.
- Editing a question or regenerating the last answer now works when an earlier AI answer in the chat is empty. An empty answer, which is saved when a response stream ends with no text, shifted the positions the chat used, so the Re-generate button disappeared from the last answer and Edit on a later question loaded a different, earlier question and cut the chat back to it.
- A collapsed citation link in an AI answer now shows the right first character. A link whose text is bold or code, such as **Reuters**, showed `[` instead of `R`, and a link starting with an emoji showed `�`. The pill now takes the first visible character, and keeps an emoji, a flag or a combined emoji such as 👩‍💻 whole.
- Daily Average in the History analytics now counts days by your local calendar, like Most Active Hour and the activity heatmap. It used to split days at UTC midnight, so outside UTC, searches made late at night or early in the morning could land on a different day, lower the average and disagree with the heatmap's active days.
- Image results hosted on Wikimedia (`upload.wikimedia.org`) now show their thumbnails. The server fetched thumbnails without saying who it was, and Wikimedia refuses such requests, so those results showed the site's name instead of the picture. Thumbnail requests now identify themselves as MiniSearch, the same way page reads already did.
- An image-result thumbnail larger than 500 KB is no longer shown cut off. The server used to send the first 500 KB of it as if it were the whole image and keep that copy for an hour, so the tile showed a damaged picture (a JPEG lost everything below the cut, other formats could fail to show at all). Such a thumbnail is now refused, and the tile shows the site's name, like other thumbnails that cannot be loaded.
- Turning off "Enable Search History" now stops saving searches. After a reload with the setting off, every search, its results, the AI answer and follow-up chat messages were still written to the browser's storage, while the History drawer that could show or delete them stayed hidden. Nothing is read from or written to the history while the setting is off.
- Clearing the context length, CPU threads, history max entries or history retention field no longer saves an empty value. It now falls back to the default number, and an empty value already saved in the browser is repaired when the app loads, so AI answers keep their token budget and history cleanup keeps running.
- Requests to an OpenAI-compatible backend and to the internal API no longer ask for an answer as long as the whole context window. `max_tokens` used to be the full Context Length, so prompt plus answer could not fit, and backends that check the sum rejected the request or cut the answer short. It is now what the window has left after the prompt, at least 64 tokens, measured against the same window the page excerpts and chat history use.
- A bi-encoder worker that stays alive but stops answering no longer stalls page content reads. Its scoring requests waited with no deadline, so every later read queued behind it, AI answers waited out the browser's 20 second timeout and lost their page excerpts until the server restarted. A scoring request now gets 10 seconds, after which the passages are ranked lexically, as when the model is not loaded, and the log says so.
- Restoring a saved search that has no saved results and no saved answer (a failed search, a search with zero results and AI answers off, an abandoned search) no longer appends a duplicate entry to the history nor starts a new live search. The same happened when Regenerate was clicked, or the "enable AI response" prompt accepted, after restoring an entry. The restored query is now treated as handled, like a submitted or auto-searched one.
- When the browser blocks site data (for example Safari "Block All Cookies" or Chrome "sites can't save data"), the app no longer crashes on load with a blank page. Settings and other persisted values stay in memory for the session and simply do not write through.

- Search results, page contents, AI answers, the status report and access key checks are now sent with `Cache-Control: no-store`, errors included, so a shared cache or proxy in front of the server can no longer keep them. In production the access key and AI answer responses used to be marked as publicly cacheable for 24 hours, and the search, page content and status responses carried no caching directive at all. The AI answer stream changes from `no-cache` to `no-store`.
- "Clear all data" now finishes resetting and reloads the page even when Cache Storage is unavailable (such as on a plain HTTP LAN deployment) or when clearing a cache or the in-browser AI model cache fails. It also releases the temporary Wllama worker after clearing the model cache instead of leaving it alive until the reload.
- A failed or empty conversation summary fold no longer erases the summary already built for a long chat. When summarizing older turns fails and the fallback returns empty (for example after dropping a very long message) or the model returns an empty summary, MiniSearch keeps the existing stored summary and includes it in the prompt for the current turn.
- Restoring a saved search from history no longer turns off follow-up question suggestions for the rest of the session. Sending a chat message in the restored conversation or starting a new search now generates follow-up suggestions again, restoring an entry with no saved answer no longer suppresses them, and a follow-up question still generating from a previous search is cancelled so it cannot land in the restored session.
- A missing file under `/assets/` is no longer sent with a one-year immutable cache header. During a partial deploy, or for an outdated link, the server answered such a request with the app page or a 404 marked immutable, so browsers could keep that wrong answer for the asset's URL for a year. Only files that exist in the build are now marked immutable; anything else under `/assets/` gets `no-cache`.
- A search that found nothing is no longer reported as failed when the query has no keywords. A query made only of common words, such as "how about that", used to be retried with its keywords after finding no results; with none left, the retry sent an empty query, which was rejected, so the search showed as failed and, with AI answers on, ran the image fallback meant for outages. The retry is now skipped and the search completes with no results. A query over 2000 characters with no keywords is now searched without its surrounding spaces when that fits, and otherwise completes with no results instead of failing. A failed text search now also leaves a log entry with its error.
- A relative date in a search query is now recognised the way people type it. "next year’s champion" with a curly apostrophe, the default on iPhone and Mac, no longer gets a year added, and a non-breaking or double space no longer hides "next year". A date the query already carries in another spelling ("2026 December", "Dec 2026", "2026-12") is not appended again, and a year inside a longer number such as "120265" is no longer taken for one. A follow-up search that is only a year no longer starts with a space, which gave the same search two cache entries.
- Reading an answer aloud no longer speaks unfinished reasoning. When a response's reasoning block never closed, such as after an interrupted generation or a reply that ended mid-thought, the Listen button used to read the whole thing, reasoning and literal marker text included, because text-to-speech only removed properly closed blocks. Reasoning is now split the same way the on-screen display splits it: an unterminated block has no answer to speak, so nothing is read, and a marker that only shows up mid-answer is left as ordinary text.

## 2026-11-23

- A request with a malformed `Host` header, such as `Host: bad host`, no longer shuts the server down. The search, page content, thumbnail and AI inference endpoints used to build the request URL from that header, so one unauthenticated request made the server exit; they now answer 400 and keep serving. The thumbnail endpoint answered 500 for the same request before. The `/status` endpoint also answers a 500 instead of exiting when the build's commit hash define is malformed.
- Saved searches in the History drawer can now be restored with the keyboard. The query used to be a plain card that only a click could activate, so Tab skipped it; it is now a button that Enter and Space activate, separate from the pin and delete buttons.
- When the in-browser AI model fails during its warm-up, the model and its worker are now released, so the failed start no longer keeps the model's memory allocated until the page is reloaded. The original error is still the one reported, and the log says if the release itself failed.
- When the access key cannot be checked because the server is unreachable, the access page now says "Could not reach the server. Please try again." instead of "Invalid access key", so a network problem no longer looks like a wrong key. Access still stays closed until the key is checked.
- With the AI Horde engine, the answer card and its Stop button now appear as soon as the request is queued, instead of a loading skeleton for the whole wait, which can take minutes. Stop now works during that wait, and it also cancels the queued job on the Horde, so a stopped answer no longer keeps spending kudos.
- The search box placeholder now always shows a suggestion. When the suggestion list could not be loaded, came back empty, or held empty entries in the browser's storage, the placeholder could end up blank; it now falls back to "Anything you need!". The log now names why the list failed to load and how many suggestions were actually stored.
- The "Clear all data" confirmation now says everything it deletes: besides resetting the settings and the cached files (including downloaded AI models), it permanently deletes the saved searches, AI responses and chat messages. It used to mention only the settings and the cache. The note under the button says the same.
- A saved AI backend that the server no longer offers is now switched to one it does. When an operator removed the internal API, a profile that had picked it kept routing answers there, so they failed, and the AI settings showed no backend selected and no way to tell why. The saved choice now moves to the server's default backend, or to running in the browser if the server's default is gone too, and the log says what changed. A choice the server still offers stays as it is, and so does any choice when the server's settings could not be loaded.
- With "Enter to submit" turned off in the interface settings, Shift+Enter now submits the search, as the setting's description says. It used to do nothing, so the search could only be sent with the Search button. The suggested follow-up question in the chat box follows the same setting: Shift+Enter sends it when the setting is off, and Enter adds a new line instead.
- Chat replies now always see the question being asked. When the search results, page excerpts and conversation summary used up the room set aside for the chat, the newest question was folded into the summary with the older messages and the model answered without it, from the summary alone and with no error. With the default settings that happened to any message longer than about 300 tokens, such as a pasted log, and with a large Context Length in the OpenAI-compatible settings it could happen on every turn. Now the question is always sent and only older messages are summarized, the chat history is measured against the configured Context Length instead of always 4096, and a message larger than the whole context fails with an error instead of a reply that ignores it. Follow-up question suggestions no longer overwrite the chat's summary with their own prompt either.
- A follow-up question typed with more than 2000 characters now searches with its first 2000 characters. It used to send the whole text, which the server rejects, so the follow-up got no new search results and only a line in the log. The same limit now also holds for the keyword search the first question falls back to.
- The "Thinking" indicator of the reasoning section no longer keeps animating after an answer stops while the model is still reasoning, for example when you interrupt it, it reaches the token limit or the connection drops. The unfinished reasoning now shows as a collapsed "Thought Process", as do older chat messages that end the same way.
- The in-app log now keeps the newest 1000 entries and drops older ones. It used to grow for as long as the tab stayed open, copying the whole log on every new line, so a long session slowed down logging and the Logs window. The download from the Logs window holds those 1000 entries.
- The AI settings panel no longer crashes when AI Horde answers the user lookup with incomplete data, such as a username without kudos. The answer is now logged as malformed and the API key field shows the anonymous-access hint, as it does for the default key.
- A local model that declares stop strings now has its answer cut at the stop string. Before, the answer was trimmed by the stop string's length from the end of the text, so `abcdefghijklSTOPxyz` with the stop string `STOP` came out as `abcdefghijklSTO`: three characters of the marker stayed in and the text after it was lost. No bundled model declares stop strings yet, so nobody saw this.
- Page bodies of exactly 1,500,000 bytes are no longer counted as truncated in `/status`'s `pageReads.bodiesTruncated`. The text was always complete, only the counter was wrong.
- `ACCESS_KEYS` and `ALLOWED_HOSTS` now ignore spaces around each entry and empty entries, so `key1, key2,` works as written. Before, a key after a comma and a space was never accepted, `ALLOWED_HOSTS="localhost, example.com"` blocked `example.com`, and `ACCESS_KEYS=","` made the app ask every visitor for an access key that no one could enter.
- `/inference`, `/status` and `/thumbnail` now answer only on their exact path. Before, any path that started with the route, such as `/inferences`, `/statuses` or `/thumbnails`, was claimed by the endpoint instead of falling through to the app.
- Search result snippets now reach the AI prompt exactly as written. Before, the prompt's own template rules rewrote them: LaTeX like `$$x^2$$` lost a dollar sign, and a crafted page could inject text that looked like the app's own instructions. Custom prompts that repeat a placeholder now fill every occurrence too.
- The Context Length field in the OpenAI-compatible settings now accepts values below 4096, down to 512, so a model with a 2048-token context can be set up. It used to snap any smaller value back to 4096 when the field lost focus. Its arrows now move in steps of 1024 instead of 4096. The default stays 4096.
- The numpad Enter key now submits the search and sends chat messages, like the main Enter key. Before, it inserted a new line into the text box instead, because the Enter check looked at the physical key (`event.code`) and numpad Enter reports `NumpadEnter`. Shift+Enter behaves the same way for both keys.
- When SearXNG fails and the fallback search answers, the server log now gets two lines instead of four: the engines that failed, and the provider that served the search. A failed thumbnail download is now logged with a timestamp, like the other lines. The log still never names the image's host, since it comes from the search results.
- The Docker image now switches on Mojeek in its SearXNG settings. Since the last SearXNG update, the Brave web engine is off by default, which left DuckDuckGo and Google CSE as the only general web engines, and DuckDuckGo often answers a CAPTCHA to servers. Mojeek runs its own index: in a test run it returned 10 results on each of 10 queries, and 7 to 9 of them per query came from no other engine. To keep the old engine set, replace the settings file as described in "Tuning the Search Engines" in `docs/configuration.md`.
- When SearXNG fails and the fallback search answers through Parallel, the AI answer now grounds on the text Parallel already sent with each result instead of downloading those pages. Parallel picks excerpts that match the query, a median of about 2,500 characters per result (measured over 30 results), and the result's snippet showed only 400 of them. So those answers wait for no page downloads, and they no longer lose the pages that refuse the server (on the public demo, 48% of page reads failed). `/status` counts these pages under `pageReads.servedFromSearchExcerpts`.
- Reopening a search from history now restores its saved images even when the entry also contains text results. Image-only searches and older history entries still restore as before.

## 2026-11-22

- `INTERNAL_OPENAI_COMPATIBLE_API_MODEL` now takes several models, separated by commas, in order of preference. When a model fails before the answer starts, the server moves to the next one, and after the last one it starts the list over once. A server with a single model used to give up on the first error; that model now gets one retry, so a short outage of the upstream no longer fails the answer. `/status` also counts each failed attempt by reason (`inference.attemptFailures`: rate limit, server error, other HTTP error, stall, or other), which tells whether the upstream wants fewer requests, a retry or another model.
- Search results are ranked much faster on servers with few CPUs, such as a 2-vCPU Hugging Face Space. The reranker's model now uses at most four threads, and no more than the CPUs the server is allowed to use. It used to start one thread per core of the host machine, even inside a container limited to two CPUs, so the threads fought over those two. Under a 2-CPU limit, scoring one result went from 138ms to 5.6ms; the public demo averaged 2.1 seconds per text rerank before this change. Rankings stay the same.
- The in-browser AI answers several times faster: the browser engine, wllama, is now version 4.0.0. Measured with Qwen 3.5 0.8B on CPU (four threads, headless Chromium on a Ryzen AI MAX+ 395) over 15 questions run twice: the model reads the prompt 4.1x faster (81 against 20 tokens per second, median), writes the answer 3.7x faster (34 against 9), and loads from the cache in 3.4 seconds instead of 9.4. Models already downloaded stay in the cache and are not downloaded again. A new browser model under 2000 MiB can now ship as the single GGUF file from its original HuggingFace repo, because wllama 4 loads a GGUF as-is; bigger models stay split, since an incognito window stops each file at 2000 MiB.

## 2026-11-19

- When no voice is chosen in Voice Settings, the local engine now picks the best-sounding voice of the answer's language instead of the first one in the catalogue: medium quality first, then low, then x-low. Portuguese, for example, now gets `pt_BR-faber-medium` where it used to get `pt_BR-edresson-low`, at the same 63 MB download. High-quality voices are picked only when a language publishes nothing else, since they cost up to 137 MB against the 63 MB of a medium one. And when the answer is in the browser's language, a voice of the browser's region now wins among the ones of the same quality, so an `en-US` browser gets an American voice.
- Raon-1 nano 3B (2083 MB, Apache-2.0, Korean and English) joins the Wllama catalog, labeled "(wllama support pending)": its architecture is not yet in the llama.cpp build the browser engine ships, so it cannot answer until upstream support lands ([ggml-org/llama.cpp#32200](https://github.com/ggml-org/llama.cpp/pull/32200) is open). The sharded copy is published and the entry is ready, so it starts working the day the engine updates.
- A follow-up answer now reads the pages behind its own new results, as the first answer does, instead of answering from their titles and snippets alone. A page both searches returned also gets an excerpt picked for the follow-up question, where it used to keep the one picked for the first question.
- The search query of a follow-up question now names what the question refers to: when the previous answer says Marvel moved Avengers: Doomsday to December 2026, "why did they delay the release" now searches for "Avengers: Doomsday release delay reasons" instead of a query that names nothing. The query is also written in the language of the question more often, because the model no longer sees the search results while writing it. Measured with Gemma 3 4B in the browser on seven conversations, three runs each: the query kept the subject in 21 of 21 runs (16 before) and the question's language in 20 of 21 (16 before).
- The six search results an AI answer reads are now the six with the best relevance score, for the first question and for follow-ups. The result list still shows the search engine's first result at the top, but that result no longer takes one of the six places when its score is low.
- A follow-up question with a relative date, such as "what comes out next month", now searches with the month and year written out ("December 2026"), as the first question already did, so the results match the right period.
- When a search was still waiting for permission to download the in-browser model and a second one started (for example, by accepting the "Enable AI Responses?" prompt with AI responses already on), allowing the download loaded the model twice at the same time, and both answers failed with a file-lock error. Now only the newest search loads the model.
- A follow-up question with a relative date ("who won it last year", "明年的呢") now keeps that date in its search query more often, so the date anchor turns it into the right year instead of the model writing a year itself ("2023" for last year). Measured with Gemma 3 4B in the browser on three such questions, three runs each: the relative date reached the anchor in 6 of 9 runs, against 3 of 9 before.
- The search query of a follow-up question no longer keeps the quote marks some models wrap it in (“ ”, 「 」, « »), as it already did with straight quotes.
- The search query of a follow-up question in Chinese, Japanese, Korean, Thai, Greek or Hebrew now stays in that language: when the model writes it in another script, the query is translated back, and when that fails too, the typed question is searched. Measured with Gemma 3 4B in the browser, "它大概多少钱" after a question about Apple's new phone searched in Chinese, naming the phone, in 9 of 9 runs; before, the query came out in Turkish, Persian or English in most runs. A question in another script (Latin, Arabic, Cyrillic...) whose query changes script also searches for the typed question now.
- A follow-up question with a relative date now searches for the date the user meant even when the model writes a year of its own: "明年的呢" after a question about Apple's new phone used to search "苹果 2025 新手机 发布时间", and now searches "苹果 新手机 发布时间 2027年". The year comes from the question as typed, and a year the user wrote is kept. Measured with Gemma 3 4B in the browser on three such questions, nine runs each: the right date reached the search in 27 of 27 runs, against 17 of 27 with the old code on the same queries.
- Security: the npm inside the Docker image now carries `undici` 6.29.1 and `ip-address` 10.7.6, clearing six of the image's eight code scanning findings (three high, three medium). The two left, in npm's own `glob` 13.0.6 and `minimatch` 10.2.5, have fixes only in new major versions that npm does not accept yet, up to npm 12.2.3.

## 2026-11-18

- Search results whose link no browser can open are now dropped, from SearXNG and from the fallback providers alike: links on a host without a domain, and links that are not `http` or `https`. Brave Search now sends its result links through encrypted redirects, which SearXNG's Brave engine passes on as `http:///go/v1/...`. Those results reached the list with "go" as the site name, and the AI response cited them as sources. They are dropped before the result limit applies, so they do not take the place of a usable result, and the server log names the engine that sent them.
- With the AI Horde engine and no model selected, the automatic pick now counts only models with at least one online worker that writes 1024 tokens or more. Models served only by workers capped at 256 or 512 tokens no longer make the top five.
- On servers whose CPU has AVX512_VNNI (a feature of many modern datacenter CPUs), the reranker now loads the VNNI build of its model instead of the portable one: same weights, ranking quality within noise (0.8039 against 0.7992 nDCG@10 on the 240-query MIRACL set), and reranking measured 1.32x faster on a two-core pin of a desktop CPU. Other hosts load the portable build, as before.

## 2026-11-17

- With the AI Horde engine and no model selected, the request no longer lands on a random model: it now goes to the five text models with online workers that have the most requests this month, so answers come from the models the community actually uses. The ranking refreshes every 5 minutes. If it cannot be fetched, or none of those models can take the job, the request falls back to any available model, as before.

## 2026-11-12

- The follow-up question field and its Send button now look like one control: the field has square right corners and shares a single border with the button. The microphone button no longer turns into a solid gray block while an answer is being generated, and its hover and recording fills stay inside the field's border, in the follow-up field and in the search field.

## 2026-11-09

- The in-browser engine, wllama, moves from 3.8.1 to 3.13.0. It now handles a model download that stopped midway by itself, so MiniSearch no longer deletes those files before each load.
- Dictation's on-device model is now Qwen3-ASR 0.6B, run through wllama, instead of Moonshine. It understands every language MiniSearch answers in, not only English, so the setting that prefers it is now on by default for every browser; a profile saved before keeps its value, so a non-English profile turns it on in the Voice settings. The text now appears when the user stops recording rather than while they speak (about 2 seconds for a short query on WebGPU), and a recording ends on its own after two minutes. The first press downloads about 700 MB from Hugging Face, against 51 MB before, and later presses load it from the browser's storage in about 2 seconds; leaving the page or turning dictation off mid-download aborts it. The Moonshine runtime leaves the build, which shrinks from 35.7 MB to 22.2 MB, and the `/dictation-models/` route and `DICTATION_MODELS_DIR` are gone, since the server no longer serves model files. `docs/speech-model-evaluation.md` records the speech models tried for dictation and reading aloud, and why the others were turned down.

- Reading answers aloud now speaks the answer's language. With no voice chosen, the voice is picked for the language the answer is written in, detected with `franc-min`, instead of the browser's: on an English browser, an answer in Portuguese is read by a Portuguese voice. The Voice settings panel lists every local voice (124 in 34 languages today) grouped by language, with the browser's language first, where it used to list only the browser's language, and the engine is no longer labeled "English-only". The detector is a new dependency, a 109 KB script (51 KB compressed) loaded on the first Listen press rather than with the page. A browser language the detector does not know (Danish, Finnish and Catalan among them) keeps its voice, as before, and a chosen voice reads every answer. Japanese, Korean and Hindi have no local voice, so their answers are read by an OS voice of that language.

## 2026-11-08

- MiniSearch now checks that the GPU can run wllama's shaders before using it, instead of only checking that the browser has WebGPU. The shaders use subgroups and the `subgroup_id` builtin, so the GPU is used only when the browser's shader compiler supports `subgroup_id`, an adapter answers within 5 seconds, it is not a software fallback, and it has the `subgroups` feature. Otherwise the model runs on the CPU and a new profile starts on the CPU default model. On Chrome 137, which has WebGPU but not `subgroup_id`, every model used to abort; it now answers on the CPU with LittleLamb 290M. The logs say which check failed.
- A model download that was interrupted, for example by reloading the page halfway, no longer stops every model from loading. wllama 3.8.1 checks every model in its cache before loading any, and throws on the first one that misses a file; before each load, MiniSearch now deletes the files of models whose download did not finish, so only that model downloads again.
- The default system prompt's citation example is now a placeholder, `[example.com](https://example.com/page)`, instead of a real YouTube video link that small models copied as if it were a source. On the benchmark's eleven core questions, over 110 answers from five small models, links to URLs that are not among the results fell from 12 to 7, the YouTube link disappeared, and the share of answers citing a result stayed level (48% before, 50% after). A saved prompt that is exactly the previous default moves to the new one; an edited prompt stays as it is.
- Four models leave the Wllama catalog because they answer worse than LittleLamb 290M, the default for browsers without WebGPU and the catalog's quality floor: StableLM 2 Zephyr 1.6B, SmolLM 2 135M, Granite 4.0 350M and Pints 1.5B (16 to 25 points out of 84 on the benchmark, against 38 for LittleLamb). Granite 4.0 1B goes too: on WebGPU it writes only `@` characters until it is stopped, though it answers well on the CPU. `docs/wllama-model-evaluation.md` now holds the scores of every catalog model and the rule that decided.
- A browser whose saved settings point at a model that left the catalog switches to the default model on its next answer, and records the switch in the logs. Before, it failed to answer at all.
- Browsers with WebGPU now start on their own default model, Gemma 3 4B, set with the new `WLLAMA_DEFAULT_GPU_MODEL_ID`; browsers without it keep LittleLamb 290M from `WLLAMA_DEFAULT_MODEL_ID`, which runs well on the CPU. Both only seed a profile that never saved settings. The GPU variable does not fall back to the CPU one, because `.env.example` sets that one and most deployments would otherwise hand GPUs the CPU model; a deployment that pinned `WLLAMA_DEFAULT_MODEL_ID` and wants the same model on GPUs should set both. Gemma 3 4B scored highest of twelve GPU candidates on the benchmark (`docs/wllama-model-evaluation.md`), with every point in two runs of fifteen questions in eleven languages, and on WebGPU it started answering in about 8 seconds.
- Qwen 3.5 0.8B (533 MB) joins the Wllama catalog. On the benchmark's eleven core questions it scored 70 of 84 (one run), above larger models such as Qwen 3 1.7B (66) and Granite 4.2 3B (59), and on WebGPU it writes about 32 tokens per second. Like Qwen 3.5 4B it ignores `reasoning_effort`, so it thinks for the full 1024 tokens before most answers (about 33 seconds on an Apple M1 Max).
- The README and the docs no longer give a number of models or a size range, so adding or removing a model does not leave them out of date.
- Thinking models get a 1024-token reasoning budget instead of 256, because a chain of thought cut off that early degraded the answer. Every model is also asked for `reasoning_effort: "low"`, which Granite 4.2 and Spark X2.6 honor by thinking less; the other templates ignore it. Five models that think by default had no budget at all and now get the same 1024 tokens: LittleLamb 290M, Qwen 3 0.6B, Qwen 3 1.7B, Polaris 4B and DeepSeek R1 Distill Qwen 1.5B. LittleLamb, the default for browsers without WebGPU, thought for up to 3,663 tokens on a single answer and sometimes never answered; with the budget it answered all 33 questions of three benchmark runs.

## 2026-11-05

- Relative month and year words in a query are anchored to absolute ones before the search leaves the browser: "next month" reaches the engines as "December 2026" and "明年" as "2027年". The anchor is appended rather than substituted, so a query that already names a year keeps its own phrasing, and two anchors per query is the ceiling. The typed query still drives the prompt, the UI, and the history entry; only the copy sent to the search engines changes, and the search cache key changes with it. Anchors skip titles and phrases that are not dates ("明年今日", "登上月球", "the last year of college") and leave "recent" and "latest" alone, because recency is what the engines already rank for. Day words ("tomorrow", "明天") stay as typed: their anchor would be an ISO date, which pages rarely write, and many queries use them as names ("usa today"). Only English and Chinese phrases are recognized. `shared/relativeDates.ts` holds the rules and `client/modules/textGeneration.ts` applies them.
- The page reader drops structural navigation before it extracts text: `nav`, `aside`, `header`, `footer` and `form` blocks go, and so does any block whose text is mostly links (60% or more, in blocks of 120 characters and up), judged innermost-first so a page-wide wrapper cannot take the article down with it. Inside an `<article>`, a `<main>` or a `role="main"` block, link density removes nothing, because a list of linked titles there is usually the answer itself. The page's title and h1/h2 words also join the passage score at 0.15 weight, so a page whose heading names the query breaks ties against its own navigation. On the sortiraparis December page the extracted text fell from 57,160 to 2,128 characters and the answering passage moved from 10th of 61 to 3rd of 8, which is what puts it inside a page's excerpt share. A link-list home page now contributes far less body text, and the reader accepts that trade: a thin excerpt beats one made of navigation links.
- A result from the site the query names gets a bonus on its semantic score before the score filter: +0.5 when a query word equals the domain's label ("disney" and disney.com, subdomains included), +0.75 when the label is the query's own words joined ("disney plus" and disneyplus.com, "coca cola" and coca-cola.com). The bonus is added rather than multiplied because the reranker returns a raw logit that is usually negative, where a factor above one would demote the named site instead of promoting it. Substrings do not count (disneyfan.com gets nothing), filler words never match on their own (plus.com, news.com), and a query that names a year will not promote a page that states a different year, so a brand's recap of last year's event cannot displace fresher reporting; a page that states no year at all keeps the bonus, because relative-time queries are anchored to a year before they reach the search. A label that spells only the start of the query leaves words unused and gets nothing (`tesla investor relations` and teslainvestor.com), a label that starts with a filler word is skipped (`the disney store` and thedisney.com), a split label counts from four characters, and a trailing dot on the hostname changes nothing. The site's name comes from the public suffix list, private section included (the `tldts` package), so bbc.co.uk answers "bbc" and a tenant of a shared host such as someone.github.io answers its own name, not "github". The pinned top result is never boosted, so the score spread the client reads relevance tags from keeps its shape. The reranker still never sees the URL, and a result the search did not return cannot be added here: the boost reorders and re-selects what the pipeline already holds, which is enough to move a page into the six the model reads. `server/authorityRanking.ts` holds the rule and `docs/reranking.md` records it.
- A text search that asks for an official page can now reach the official site even when the engine's results never included it, behind a new setting, `SEARCH_OFFICIAL_LANE_ENABLED`, which is off by default because it sends the engines a second request. When it is on, the query carries navigation intent (`官网`, `排片`, `营业时间`, `official`, `hours`, `showtimes` and the like, in Chinese and English only), and one of the returned results names a site, the server sends a second, `site:`-scoped query to SearXNG and merges up to three of its results, deduplicated by URL and kept to that registrable domain, behind the pinned first result: the ranking re-sorts only what follows the top result, so a page appended past that window would never be re-sorted at all. The domain has to come from the results themselves, by the same rule the score bonus uses, because guessing `<token>.com` from the query would turn a search box into a scanner; a query that names a brand whose official site is absent from every result gets no second query. The second query is one request with no retry, and its failures count toward neither the SearXNG circuit nor the engine health in `/status`, so it cannot slow down or degrade the searches users are waiting on. SearXNG still sees the extra request, so an engine that suspends the instance after a CAPTCHA does so for every search. It runs only when SearXNG served the search (never after the fallback), never uses the last five seconds of the search deadline, and is canceled at eight seconds; a failure only logs and is counted, so it can add results but never turn a served search into a 502. `/status` reports `searches.officialLane` (searches, `resultsAdded`, `failures`), and `server/officialLane.ts` holds the rule.

## 2026-11-03

- The five thinking models added on 2026-11-02 (Spark X2.6 1.7B and 4B, Granite 4.2 3B, Qwen 3.5 4B, Gemma 4 E2B) no longer ship with thinking switched off. Their chain of thought arrives on wllama's `reasoning_content` channel and is now wrapped in the configured reasoning markers, so the existing thinking UI shows it while the model reasons and the answer streams in after. The model warmup counts a reasoning token as a working model, so thinking models no longer log a failed warmup.
- The same five models now cap their chain of thought with `reasoningBudgetTokens` (wllama's `reasoning_budget_tokens`, 256 tokens): when the model has thought that long without answering, the engine closes the reasoning channel and forces the final answer. Without the cap, Spark X2.6 and Granite 4.2 could spend the whole 4096-token context on reasoning and deliver no answer at all.

## 2026-11-02

- Five new browser models joined the Wllama catalog: Spark X2.6 1.7B, Granite 4.2 3B, Qwen 3.5 4B, Gemma 4 E2B and Spark X2.6 4B, each tested end to end against the shipped wasm build with the search-answer prompt. The Gemma 4 and Qwen 3.5 architectures were previously absent from the catalog, and the new entries run on the wasm engine's supported architectures (`gemma4`, `qwen35`, `spark2_5`, `granite`). Models whose chat template thinks by default ship with `chatTemplateKwargs: { enable_thinking: false }`, a new per-model field passed to wllama as `chat_template_kwargs`, because MiniSearch renders only the content channel and a thinking template would otherwise spend the whole token budget on reasoning and answer with nothing. `docs/ai-integration.md` now records the two measured ceilings a candidate must fit (shard files under 2000 MiB, since Chromium's OPFS silently truncates beyond it; total weights under ~3.7 GB, since the wasm linear memory caps at 4 GiB), and `npm run wllama-catalog-check` HEADs every shard of every catalog model on HuggingFace to verify the claimed sizes.

## 2026-10-10

- The text-search fallback now cascades over Parallel and You.com instead of asking a single provider. On each search the configured providers are tried in a random order, one after the other, until one returns results, under the same 15-second budget, which is split across the providers still untried and not paused so a hanging one cannot starve the rest. A provider that answers HTTP 429 is paused until its `Retry-After` and skipped meanwhile, as You.com's acceptable use policy asks. A single search can now reach more than one provider; each sees the query text and this server's IP address, never the user's. `SEARCH_FALLBACK_PROVIDERS` picks the providers (all of them when empty), and `SEARCH_FALLBACK_PARALLEL_API_KEY` and `SEARCH_FALLBACK_YOUCOM_API_KEY` hold the optional keys. `SEARCH_FALLBACK_PROVIDER` and `SEARCH_FALLBACK_API_KEY` are removed: if either is still set while the fallback is enabled, the server stops at start with an error naming the replacement, and so does a provider key with a control character inside it. `/status` gained per-provider counters under `searches.fallbackProviders`.

## 2026-10-08

- `/status` now reports `authorization.distinctRejectedTokens`, the number of distinct dead tokens the server has cached and keeps refusing. A steady stream of invalid-token rejections with a value of 1 there is one client replaying one stale token, not many old search links, which the existing counters could not tell apart.
- Added an optional second source for text searches, so a SearXNG outage no longer has to end in a 502. It stays off unless `SEARCH_FALLBACK_ENABLED` is `true` or `1`, and flipping it takes a restart, since a process keeps the environment it was started with. When it is on, the second source is consulted only after SearXNG has failed (an HTTP error, a network error, every engine unresponsive, or an open circuit), under one 15-second budget for the whole exchange and under a 25-second deadline measured from the start of the search, and only for text searches: image searches still answer 502 as before. The query goes to `search.parallel.ai`, which sees the query text and this server's IP address, never the user's. A retry that comes back with nothing usable now answers HTTP 200 with no results, so the UI shows "No results found" rather than "Text search unavailable"; a retry that fails itself, or that the search deadline has left under two seconds for, falls through to the old 502. `SEARCH_FALLBACK_API_KEY` is optional and is sent as a Bearer token, which raises the provider's free-tier rate limits. `/status` gained `searchesServedByFallback` and `searchesFailedOnFallback`, plain counts that never carry a query, so you can see whether the second source is earning its place.

## 2026-10-07

- Security: cleared the flagged copy of `postcss-selector-parser` that lives inside the npm the image ships. npm pins its own dependency tree exactly, so neither `npm install -g npm@latest` nor a dependency bump reaches a bundled copy, and the npm in the image still carried 7.1.4. This was the one of the image's three code scanning findings that no dependency bump could fix. The image's npm-bundle repair now lists that package among its targets, so the build replaces the bundled copy with the patched release and fails if any copy of that major line survives.

## 2026-09-23

- Moved the Dictate control inside the search field, as an icon button at its right edge, and gave the follow-up question box the same control, so dictating a follow-up no longer means typing it. It shows a microphone when idle, a red stop button while it listens, and the model download progress in its tooltip and its accessible name. Pressing it never takes the focus off the field, so the caret stays where it was and a phone keeps its on-screen keyboard open. In the chat box it is disabled rather than hidden while an answer is generating, and a session still running when generation starts is stopped instead of writing into a field that has gone read-only.
- Moved the bi-encoder's dense passage scoring to a worker thread. `onnxruntime-node` runs inference synchronously on the calling thread, so a scoring pass stopped the server's event loop for its whole duration and nothing else could be served while it ran, including the concurrent /page-content reads that share the model. On a 200-passage pool the worst main-thread stall went from 815 ms to 1.5 ms, and the pass finished in 2.7 s instead of 6.1 s, with the scores byte-identical. A worker that fails to start or dies mid-request answers with empty scores, which the page reader already treats as "rank lexically".

## 2026-09-22

- Security: the search token is now generated by each server process on first use instead of being read from the temp directory. The image build used to write one into the image, so every container of a build ran with the same token, and anyone who pulled the image could read it from the layer. That token gates /search, /page-content, /thumbnail and /inference.
- Batched the bi-encoder's dense passage scoring so a page of passages runs in a few forward passes instead of one per passage, cutting the dense-scoring time.
- Fixed the history filter re-reading the whole history window from IndexedDB on every keystroke; typing now re-filters the entries already loaded, with the search debounced.
- Removed the dismissible "Tips" box from the settings menu. The features it pointed at are documented in the repository.
- Fixed SearXNG dying at startup with "attempt to write a readonly database" on instances that mount their own settings file. The image build ran its import check as root and left SearXNG's SQLite caches owned by root, so the container, running as `node`, could not rebuild them when its secret key differed from the build-time one. Every query returned a 502 while the container still reported healthy. The build now clears those caches and their `-shm` and `-wal` sidecars, so the running user creates its own on first start.
- Fixed an open tab staying stuck on a 401 after the server rotated its search token. A restart, a second instance, or a dev-server reload left the client hashing a token the server never issued, and the cached /api/config was never dropped. A 401 from the search endpoint now refetches the config and retries the search once; a second 401 is reported as the failure it is, so a token the server will never accept cannot drive a loop of config fetches.
- Documented how to tune the bundled SearXNG engines at container start through `SEARXNG_SETTINGS_PATH`, without rebuilding the image: the difference between the `disabled` and `inactive` switches, why a build arg with the same name changes nothing at runtime, and the /status, log, and direct-query checks that show which engines are answering and which are blocked from your IP.

## 2026-09-21

- Security: cleared every fixable high and critical vulnerability from the Docker image, covering the Debian base packages, npm's bundled dependency tree, SearXNG's vendored Python packages, and build-only dependencies that were shipping in the runtime image.
- Answered a rejected or stripped search token with a readable page that links back to the app, when the browser asked for HTML.
- Fixed page-content ranking to fuse dense bi-encoder scores with the lexical ranking instead of using lexical alone, so the passages selected for the prompt match the query better.
- Fixed the "Clear all history" button to stay enabled when AI responses or chat messages remain even with no searches, and its confirmation now names all three things it deletes.

## 2026-09-19

- Added a per-host circuit breaker to the page reader: a host that refused the last three reads is skipped for five minutes, then probed with one read. Skipped reads are counted on /status under pageReads.skipped.skippedByBreaker.

## 2026-09-13

- Fixed /status reporting the web search service as healthy while its circuit breaker was open and every search was failing.
- Added a degraded state and per-engine failure counts to the web search service status on /status.

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
