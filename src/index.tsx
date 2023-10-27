import { dedent } from "ts-dedent";
import { useEffect, useRef, FormEvent } from "react";
import { createRoot } from "react-dom/client";
import { createPubSub } from "create-pubsub";
import { usePubSub } from "create-pubsub/react";
import Markdown from "markdown-to-jsx";
import he from "he";
import LoadBar from "loadbar";
import "water.css/out/water.css";

let isWebGPUAvailable = "gpu" in navigator;

if (isWebGPUAvailable) {
  try {
    const adapter = await (
      navigator as unknown as {
        gpu: { requestAdapter: () => Promise<never> };
      }
    ).gpu.requestAdapter();
    if (!adapter) {
      throw Error("Couldn't request WebGPU adapter.");
    }
    isWebGPUAvailable = true;
  } catch (error) {
    isWebGPUAvailable = false;
  }
}

function createLocalStoragePubSub<T>(localStorageKey: string, defaultValue: T) {
  const localStorageValue = localStorage.getItem(localStorageKey);
  const localStoragePubSub = createPubSub(
    localStorageValue ? (JSON.parse(localStorageValue) as T) : defaultValue,
  );

  const [, onValueChange] = localStoragePubSub;

  onValueChange((value) =>
    localStorage.setItem(localStorageKey, JSON.stringify(value)),
  );

  return localStoragePubSub;
}

const disableAiResponseSettingPubSub = createLocalStoragePubSub(
  "disableAiResponse",
  false,
);
const [, , getDisableAiResponseSetting] = disableAiResponseSettingPubSub;

const summarizeLinksSettingPubSub = createLocalStoragePubSub(
  "summarizeLinks",
  false,
);
const [, , getSummarizeLinksSetting] = summarizeLinksSettingPubSub;

const useLargerModelSettingPubSub = createLocalStoragePubSub(
  "useLargerModel",
  false,
);
const [, , getUseLargerModelSetting] = useLargerModelSettingPubSub;

if (import.meta.env.DEV) import("./devTools");

const loadBar = new LoadBar({
  height: "4px",
  backgroundColor: "var(--focus)",
  startPoint: 1,
});

type SearchResults = [title: string, snippet: string, url: string][];

const promptPubSub = createPubSub("Analyzing query...");
const [updatePrompt] = promptPubSub;
const responsePubSub = createPubSub("Loading...");
const [updateResponse] = responsePubSub;
const searchResultsPubSub = createPubSub<SearchResults>([]);
const [updateSearchResults, , getSearchResults] = searchResultsPubSub;
const urlsDescriptionsPubSub = createPubSub<Record<string, string>>({});
const [updateUrlsDescriptions, , getUrlsDescriptions] = urlsDescriptionsPubSub;

const searchQueryKey = "searchQuery";

const urlParams = new URLSearchParams(window.location.search);
const debug = urlParams.has("debug");
const query = urlParams.get("q");
const Worker = urlParams.has("disableWorkers") ? undefined : window.Worker;

const sleep = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

async function search(query: string, limit?: number) {
  const searchUrl = new URL("/search", window.location.origin);
  searchUrl.searchParams.set("q", query);
  if (limit && limit > 0) {
    searchUrl.searchParams.set("limit", limit.toString());
  }
  const response = await fetch(searchUrl.toString());
  return await response.json();
}

function decodeSearchResults(searchResults: SearchResults): SearchResults {
  return searchResults.map(([title, snippet, url]) => [
    he.decode(title),
    he.decode(snippet),
    url,
  ]);
}

async function main() {
  if (query === null) return;

  document.title = query;

  updatePrompt(query);

  const searchResults: SearchResults = await search(query, 6);

  updateSearchResults(decodeSearchResults(searchResults));

  if (getDisableAiResponseSetting() && !getSummarizeLinksSetting()) return;

  if (debug) console.time("Response Generation Time");

  loadBar.start();

  try {
    if (!isWebGPUAvailable) throw Error("WebGPU is not available.");

    const { ChatWorkerClient, ChatModule, hasModelInCache } = await import(
      "@mlc-ai/web-llm"
    );

    const chat = Worker
      ? new ChatWorkerClient(
          new Worker(new URL("./webLlmWorker.ts", import.meta.url), {
            type: "module",
          }),
        )
      : new ChatModule();

    const availableModels = {
      Mistral: "Mistral-7B-OpenOrca-q4f32_1",
      TinyLlama: "TinyLlama-1.1B-1T-OpenOrca-q4f32_1",
    };

    const selectedModel = getUseLargerModelSetting()
      ? availableModels.Mistral
      : availableModels.TinyLlama;

    const chatMlConfig = {
      temperature: 0,
      repetition_penalty: 1.2,
      top_p: 1,
      mean_gen_len: 32,
      max_gen_len: 256,
      conv_template: "llama-2",
      conv_config: {
        system: dedent`
          <|im_start|>user: You are a helpful assistant.<|im_end|>
          <|im_start|>assistant: Yeah!<|im_end|>
          <|im_start|>user: You feel happy to help with almost anything and will do your best to understand exactly what is needed.<|im_end|>
          <|im_start|>assistant: Ok!<|im_end|>
          <|im_start|>user: You also try to avoid giving false or misleading information, and it caveats when it isn't entirely sure about the right answer.<|im_end|>
          <|im_start|>assistant: Sure!<|im_end|>
          <|im_start|>user: That said, you are practical, do your best, and don't let caution get too much in the way of being useful.<|im_end|>
          <|im_start|>assistant: I'll do my best to help you.
        `,
        roles: ["<|im_start|>user", "<|im_start|>assistant"],
        seps: ["<|im_end|>\n"],
        stop_str: "<|im_end|>",
      },
    };

    const chatConfigPerModel = {
      [availableModels.Mistral]: chatMlConfig,
      [availableModels.TinyLlama]: chatMlConfig,
    };

    const appConfig = {
      model_list: [
        {
          model_url:
            "https://huggingface.co/Felladrin/mlc-chat-Mistral-7B-OpenOrca-q4f32_1/resolve/main/params/",
          local_id: availableModels.Mistral,
        },
        {
          model_url:
            "https://huggingface.co/Felladrin/mlc-chat-TinyLlama-1.1B-1T-OpenOrca-q4f32_1/resolve/main/params/",
          local_id: availableModels.TinyLlama,
        },
      ],
      model_lib_map: {
        [availableModels.Mistral]:
          "https://huggingface.co/Felladrin/mlc-chat-Mistral-7B-OpenOrca-q4f32_1/resolve/main/Mistral-7B-OpenOrca-q4f32_1-webgpu.wasm",
        [availableModels.TinyLlama]:
          "https://huggingface.co/Felladrin/mlc-chat-TinyLlama-1.1B-1T-OpenOrca-q4f32_1/resolve/main/TinyLlama-1.1B-1T-OpenOrca-q4f32_1-webgpu.wasm",
      },
    };

    if (!(await hasModelInCache(selectedModel, appConfig))) {
      chat.setInitProgressCallback((report) =>
        updateResponse(
          `Loading: ${report.text.replaceAll("[", "(").replaceAll("]", ")")}`,
        ),
      );
    }

    await chat.reload(
      selectedModel,
      chatConfigPerModel[selectedModel],
      appConfig,
    );

    if (!getDisableAiResponseSetting()) {
      updateResponse("Preparing response...");

      await chat.generate(
        dedent`
          Context:
          ${getSearchResults()
            .map(([title, snippet]) => `- ${title}: ${snippet}`)
            .join("\n")}
          
          Provide an answer for the question below. If you don't know the answer, you can base your answer on the context above.
          
          Question:
          ${query}
        `,
        (_, message) => {
          if (message.length === 0) {
            chat.interruptGenerate();
          } else {
            updateResponse(message);
          }
        },
      );

      await chat.resetChat();
    }

    if (getSummarizeLinksSetting()) {
      for (const [title, snippet, url] of getSearchResults()) {
        const request = dedent`
          Context:
          Link title: ${title}
          Link snippet: ${snippet}

          Question:
          What is this link about?
        `;

        await chat.generate(request, (_, message) => {
          if (message.length === 0) {
            chat.interruptGenerate();
          } else {
            updateUrlsDescriptions({
              ...getUrlsDescriptions(),
              [url]: message,
            });
          }
        });

        await chat.resetChat();
      }
    }

    if (debug) {
      console.info(await chat.runtimeStatsText());
    }

    chat.unload();
  } catch (error) {
    if (error instanceof Error) {
      console.info(dedent`
        Could not load web-llm chat module: ${error.message}

        Falling back to transformers.js.
      `);
    }

    const { preloadModels, runTextToTextGenerationPipeline } = await import(
      "./transformers"
    );

    const { createWorker } = await import("../node_modules/typed-worker/dist");

    const MobileDetect = (await import("mobile-detect")).default;

    const isRunningOnMobile =
      new MobileDetect(window.navigator.userAgent).mobile() !== null;

    const defaultModel = "Xenova/LaMini-Flan-T5-77M";

    const largerModel = "Xenova/LaMini-Flan-T5-248M";

    const textToTextGenerationModel = getUseLargerModelSetting()
      ? largerModel
      : defaultModel;

    const updateResponseWithTypingEffect = async (text: string) => {
      let response = "";
      updateResponse(response);

      for (const character of text) {
        response = response + character;
        updateResponse(response);
        await sleep(5);
      }

      await sleep(text.length);
    };

    const filesProgress: Record<string, number> = {};

    const handleModelLoadingProgress = (e: {
      file: string;
      progress: number;
    }) => {
      filesProgress[e.file] = e.progress ?? 100;
      const lowestProgress = Math.min(...Object.values(filesProgress));
      updateResponse(`Loading: ${lowestProgress.toFixed(0)}%`);
    };

    await preloadModels({
      handleModelLoadingProgress,
      textToTextGenerationModel,
      quantized: isRunningOnMobile,
    });

    await updateResponseWithTypingEffect("Preparing response...");

    type Actions = import("./transformersWorker").Actions;

    let transformersWorker:
      | ReturnType<typeof createWorker<Actions>>
      | undefined;

    if (Worker) {
      transformersWorker = createWorker<Actions>(
        () =>
          new Worker(new URL("./transformersWorker", import.meta.url), {
            type: "module",
          }),
      );
    }

    if (!getDisableAiResponseSetting()) {
      const paramsForResponse = {
        input: dedent`
        Context:
        ${getSearchResults()
          .map(([title, snippet]) => `- ${title}: ${snippet}`)
          .join("\n")}
        
        Question:
        ${query}
      `,
        textToTextGenerationModel,
        quantized: isRunningOnMobile,
      };

      const response = transformersWorker
        ? await transformersWorker.run(
            "runTextToTextGenerationPipeline",
            paramsForResponse,
          )
        : await runTextToTextGenerationPipeline(paramsForResponse);

      await updateResponseWithTypingEffect(response);
    }

    if (getSummarizeLinksSetting()) {
      const updateUrlsDescriptionsWithTypingEffect = async (
        url: string,
        description: string,
      ) => {
        let newDescription = "";
        updateUrlsDescriptions({
          ...getUrlsDescriptions(),
          [url]: newDescription,
        });

        for (const character of description) {
          newDescription = newDescription + character;
          updateUrlsDescriptions({
            ...getUrlsDescriptions(),
            [url]: newDescription,
          });
          await sleep(5);
        }

        await sleep(description.length);
      };

      for (const [title, snippet, url] of getSearchResults()) {
        const request = dedent`
          Context:
          Link title: ${title}
          Link snippet: ${snippet}

          Question:
          What is this link about?
        `;

        const paramsForOutput = {
          input: request,
          textToTextGenerationModel,
          quantized: isRunningOnMobile,
        };

        const output = transformersWorker
          ? await transformersWorker.run(
              "runTextToTextGenerationPipeline",
              paramsForOutput,
            )
          : await runTextToTextGenerationPipeline(paramsForOutput);

        await updateUrlsDescriptionsWithTypingEffect(url, output);
      }

      if (transformersWorker) {
        transformersWorker.destroy();
      }
    }
  }

  loadBar.done();

  if (debug) {
    console.timeEnd("Response Generation Time");
  }
}

main();

function ConfigForm() {
  const [disableAiResponse, setDisableAiResponse] = usePubSub(
    disableAiResponseSettingPubSub,
  );
  const [summarizeLinks, setSummarizeLinks] = usePubSub(
    summarizeLinksSettingPubSub,
  );
  const [useLargerModel, setUseLargerModel] = usePubSub(
    useLargerModelSettingPubSub,
  );

  return (
    <details>
      <summary>Settings</summary>
      <div>
        <label title="Disables the AI response, in case you only want to see the links from the web search results">
          <input
            type="checkbox"
            checked={disableAiResponse}
            onChange={(event) => setDisableAiResponse(event.target.checked)}
          />
          Disable AI response
        </label>
      </div>
      <div>
        <label title="Provides a short overview for each of the links from the web search results">
          <input
            type="checkbox"
            checked={summarizeLinks}
            onChange={(event) => setSummarizeLinks(event.target.checked)}
          />
          Summarize links
        </label>
      </div>
      <div>
        <label title="Generates better responses, but takes longer to load">
          <input
            type="checkbox"
            checked={useLargerModel}
            onChange={(event) => setUseLargerModel(event.target.checked)}
          />
          Use a better AI model
        </label>
      </div>
    </details>
  );
}

function SearchForm() {
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const searchQuery = localStorage.getItem(searchQueryKey) ?? "";

  const startSearching = () => {
    if (textAreaRef.current && textAreaRef.current.value.trim().length > 0) {
      const encodedQuery = encodeURIComponent(textAreaRef.current?.value);
      window.location.href = `./?q=${encodedQuery}`;
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    localStorage.removeItem(searchQueryKey);
    startSearching();
  };

  useEffect(() => {
    const keyboardEventHandler = (event: KeyboardEvent) => {
      if (event.code === "Enter" && !event.shiftKey) {
        event.preventDefault();
        startSearching();
      }
    };
    const textArea = textAreaRef.current;
    textArea?.addEventListener("keypress", keyboardEventHandler);
    return () => {
      textArea?.removeEventListener("keypress", keyboardEventHandler);
    };
  }, [textAreaRef]);

  return (
    <form onSubmit={handleSubmit} style={{ width: "100%" }}>
      <textarea
        placeholder="Anything you need!"
        ref={textAreaRef}
        defaultValue={searchQuery}
        autoFocus
      />
      <button type="submit" style={{ width: "100%", marginTop: "20px" }}>
        Submit
      </button>
    </form>
  );
}

function SearchResultsList({
  searchResults,
  urlsDescriptions,
}: {
  searchResults: SearchResults;
  urlsDescriptions: Record<string, string>;
}) {
  return (
    <ul>
      {searchResults.map(([title, snippet, url], index) => (
        <li key={index}>
          <a href={url} title={snippet}>
            {title}
          </a>
          {urlsDescriptions[url] && (
            <>
              <br />
              <blockquote>{urlsDescriptions[url]}</blockquote>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

function ResponseView({
  prompt,
  response,
  searchResults,
  urlsDescriptions,
}: {
  prompt: string;
  response: string;
  searchResults: SearchResults;
  urlsDescriptions: Record<string, string>;
}) {
  return (
    <>
      <blockquote
        style={{ cursor: "pointer" }}
        onClick={() => {
          localStorage.setItem(searchQueryKey, prompt);
          window.location.href = window.location.origin;
        }}
        title="Click to edit the query"
      >
        <Markdown>{prompt}</Markdown>
      </blockquote>
      {!getDisableAiResponseSetting() && (
        <>
          <div>
            <Markdown>{response}</Markdown>
          </div>
          <hr />
        </>
      )}
      <div>
        {searchResults.length > 0 ? (
          <SearchResultsList
            searchResults={searchResults}
            urlsDescriptions={urlsDescriptions}
          />
        ) : (
          "Searching the Web..."
        )}
      </div>
    </>
  );
}

function App() {
  const [prompt] = usePubSub(promptPubSub);
  const [response] = usePubSub(responsePubSub);
  const [searchResults] = usePubSub(searchResultsPubSub);
  const [urlsDescriptions] = usePubSub(urlsDescriptionsPubSub);

  return (
    <>
      {new URLSearchParams(window.location.search).has("q") ? (
        <ResponseView
          prompt={prompt}
          response={response}
          searchResults={searchResults}
          urlsDescriptions={urlsDescriptions}
        />
      ) : (
        <>
          <SearchForm />
          <ConfigForm />
        </>
      )}
    </>
  );
}

createRoot(document.body.appendChild(document.createElement("div"))).render(
  <App />,
);
