import * as webLLM from "@mlc-ai/web-llm";
import { dedent } from "ts-dedent";
import React, { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { createPubSub } from "create-pubsub";
import { usePubSub } from "create-pubsub/react";
import Markdown from "markdown-to-jsx";
import he from "he";
import LoadBar from "loadbar";
import { pipeline } from "@xenova/transformers";
import MobileDetect from "mobile-detect";
import "water.css/out/water.css";

if (import.meta.env.DEV) import("./devTools");

const mobileDetect = new MobileDetect(window.navigator.userAgent);

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
const finishedRespondingPubSub = createPubSub(false);
const [updateFinishedResponding] = finishedRespondingPubSub;

const searchQueryKey = "searchQuery";

const urlParams = new URLSearchParams(window.location.search);
const debug = urlParams.has("debug");
const query = urlParams.get("q");
const Worker = urlParams.has("disableWorkers") ? undefined : window.Worker;
const useLargerModel = urlParams.has("useLargerModel");

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

  if (debug) console.time("Time Taken");

  loadBar.start();

  document.title = query;

  updatePrompt(query);

  const searchResults: SearchResults = await search(query, 6);

  updateSearchResults(decodeSearchResults(searchResults));

  try {
    const chat = Worker
      ? new webLLM.ChatWorkerClient(
          new Worker(new URL("./webLlmWorker.ts", import.meta.url), {
            type: "module",
          }),
        )
      : new webLLM.ChatModule();

    chat.setInitProgressCallback((report) =>
      updateResponse(
        `Loading: ${report.text.replaceAll("[", "(").replaceAll("]", ")")}`,
      ),
    );

    const availableModels = {
      Mistral: "Mistral-7B-OpenOrca-q4f32_1",
      TinyLlama: "TinyLlama-1.1B-1T-OpenOrca-q4f32_1",
    };

    const selectedModel = useLargerModel
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
          <|im_start|>user: Hi!<|im_end|>
          <|im_start|>assistant: Hello! How can I help you?<|im_end|>
          <|im_start|>user: I'll ask and request a few things, and I'll need you to provide responses always formatted in Markdown, so that they can be easily read, ok?<|im_end|>
          <|im_start|>assistant: Ok!
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

    await chat.reload(
      selectedModel,
      chatConfigPerModel[selectedModel],
      appConfig,
    );

    updateResponse("Preparing response...");

    await chat.generate(dedent`
      Keep in mind the following links. They might be useful for your response later, ok?

      ${getSearchResults()
        .map(
          ([title, snippet, url], index) =>
            `${index + 1}. [${title}](${url} "${snippet}")`,
        )
        .join("\n")}
    `);

    await chat.generate(query, (_, message) => {
      if (message.length === 0) {
        chat.interruptGenerate();
      } else {
        updateResponse(message);
      }
    });

    await chat.resetChat();

    for (const [title, snippet, url] of getSearchResults()) {
      const request = dedent`
        In summary, what is this link about?

        Link title: ${title}
        Link snippet: ${snippet}
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

    if (debug) {
      console.info(await chat.runtimeStatsText());

      console.timeEnd("Time Taken");
    }

    chat.unload();

    updateFinishedResponding(true);
  } catch (error) {
    if (error instanceof Error) {
      console.warn(dedent`
        Failed to load web-llm chat module: ${error.message}

        Falling back to transformers.js.
      `);
    }

    const defaultModel = mobileDetect.mobile()
      ? "Xenova/LaMini-Flan-T5-77M"
      : "Xenova/LaMini-Flan-T5-248M";

    const largerModel = mobileDetect.mobile()
      ? "Xenova/LaMini-Flan-T5-248M"
      : "Xenova/LaMini-Flan-T5-783M";

    const text2TextGenerationModel = useLargerModel
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

    const filesProgress: Record<string, number> = {};

    const generator = await pipeline(
      "text2text-generation",
      text2TextGenerationModel,
      {
        progress_callback: (e: { file: string; progress: number }) => {
          filesProgress[e.file] = e.progress ?? 100;
          const lowestProgress = Math.min(...Object.values(filesProgress));
          updateResponse(dedent`
            Loading: ${lowestProgress.toFixed(0)}%

            It may take a while to load for the first time, but next time it will load instantly.
          `);
        },
      },
    );

    await updateResponseWithTypingEffect("Preparing response...");

    const generate = async (input: string): Promise<string> => {
      return generator(input, {
        min_length: 32,
        max_new_tokens: 256,
        no_repeat_ngram_size: 2,
      });
    };

    const [response] = await generate(
      dedent`
        REQUEST:
        ${query}

        RELATED LINKS:
        ${getSearchResults()
          .map(
            ([title, snippet, url], index) =>
              `${index + 1}. [${title}](${url} "${snippet}")`,
          )
          .join("\n")}
      `,
    );

    await updateResponseWithTypingEffect(response);

    for (const [title, snippet, url] of getSearchResults()) {
      const request = dedent`
        [${title}](${url} "${snippet}")

        This link is about...
      `;
      const [output] = await generate(request);
      await updateUrlsDescriptionsWithTypingEffect(url, output);
    }

    updateFinishedResponding(true);

    await generator.dispose();
  }

  loadBar.done();
}

main();

function SearchForm() {
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const searchQuery = localStorage.getItem(searchQueryKey) ?? "";

  const startSearching = () => {
    if (textAreaRef.current) {
      const encodedQuery = encodeURIComponent(textAreaRef.current?.value);
      window.location.href = `./?q=${encodedQuery}`;
    }
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
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
  finishedResponding,
}: {
  prompt: string;
  response: string;
  searchResults: SearchResults;
  urlsDescriptions: Record<string, string>;
  finishedResponding: boolean;
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
      <div>
        <Markdown>{response}</Markdown>
      </div>
      <hr />
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
      {finishedResponding && !useLargerModel && (
        <>
          <hr />
          <div
            style={{
              marginTop: "15px",
              textAlign: "center",
            }}
          >
            <span
              style={{
                fontSize: "0.6em",
                fontStyle: "italic",
              }}
            >
              Not the response you were looking for?{" "}
              <a href={`${window.location.search}&useLargerModel`}>
                Try again with a larger model
              </a>
            </span>
          </div>
        </>
      )}
    </>
  );
}

function App() {
  const [prompt] = usePubSub(promptPubSub);
  const [response] = usePubSub(responsePubSub);
  const [searchResults] = usePubSub(searchResultsPubSub);
  const [urlsDescriptions] = usePubSub(urlsDescriptionsPubSub);
  const [finishedResponding] = usePubSub(finishedRespondingPubSub);

  return (
    <>
      {new URLSearchParams(window.location.search).has("q") ? (
        <ResponseView
          prompt={prompt}
          response={response}
          searchResults={searchResults}
          urlsDescriptions={urlsDescriptions}
          finishedResponding={finishedResponding}
        />
      ) : (
        <SearchForm />
      )}
    </>
  );
}

createRoot(document.body.appendChild(document.createElement("div"))).render(
  <App />,
);
