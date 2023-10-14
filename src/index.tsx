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

const defaultMaxNewTokens = 256;

type SearchResults = [title: string, snippet: string, url: string][];

const promptPubSub = createPubSub("Analyzing query...");
const [updatePrompt] = promptPubSub;
const responsePubSub = createPubSub("Loading...");
const [updateResponse] = responsePubSub;
const searchResultsPubSub = createPubSub<SearchResults>([]);
const [updateSearchResults, , getSearchResults] = searchResultsPubSub;
const urlsDescriptionsPubSub = createPubSub<Record<string, string>>({});
const [updateUrlsDescriptions, , getUrlsDescriptions] = urlsDescriptionsPubSub;
const [
  updateLinkDescriptionsComplete,
  onLinkDescriptionsCompleteUpdated,
  getLinkDescriptionsComplete,
] = createPubSub(0);

const Worker = new URLSearchParams(window.location.search).has("disableWorkers")
  ? undefined
  : window.Worker;

const useLargerModel = new URLSearchParams(window.location.search).has(
  "useLargerModel"
);

const searchQueryKey = "searchQuery";

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
  const urlParams = new URLSearchParams(window.location.search);
  const query = urlParams.get("q");
  const debug = urlParams.get("debug") !== null;

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
          })
        )
      : new webLLM.ChatModule();

    chat.setInitProgressCallback((report) =>
      updateResponse(report.text.replaceAll("[", "(").replaceAll("]", ")"))
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
      repetition_penalty: 1.5,
      top_p: 1,
      mean_gen_len: 512,
      max_gen_len: 1024,
      conv_template: "llama-2",
      conv_config: {
        system:
          "<|im_start|>system: You are an AI assistant that follows instructions extremely well. Your responses are always formatted in Markdown, aiming for readability. Help as much as you can.",
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
      appConfig
    );

    updateResponse("Analyzing links...");

    for (const [title, snippet, url] of getSearchResults()) {
      const request = dedent`
        What is this link about?

        Link title: ${title}
        Link snippet: ${snippet}

        Start your response with "This link is about".
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

    await chat.generate(
      dedent`
        Provide a concise response to the following request:

        ${query}

        Feel free to paraphrase the links below to enhance your response:

        ${getSearchResults()
          .map(
            ([title, , url]) => dedent`
              Link title: ${title}
              Link description: ${getUrlsDescriptions()[url]}
            `
          )
          .join("\n\n")}
      `,
      (_, message) => {
        if (message.length === 0) {
          chat.interruptGenerate();
        } else {
          updateResponse(message);
        }
      }
    );

    if (debug) {
      console.info(await chat.runtimeStatsText());

      console.timeEnd("Time Taken");
    }

    chat.unload();
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

    if (Worker) {
      const worker = new Worker(
        new URL("./transformersWorker.ts", import.meta.url),
        {
          type: "module",
        }
      );

      worker.addEventListener("message", (e: MessageEvent) => {
        switch (e.data.status) {
          case "initiate":
            break;

          case "progress":
            updateResponse(`Loading: ${e.data.progress.toFixed(0)}%`);
            break;

          case "done":
            updateResponse(`Model file ${e.data.file} loaded`);
            break;

          case "ready":
            updateResponse("Analyzing links...");
            break;

          case "update":
            if (e.data.id === "query") {
              updateResponse(e.data.output);
            } else {
              updateUrlsDescriptions({
                ...getUrlsDescriptions(),
                [e.data.id]: e.data.output,
              });
            }
            break;

          case "complete":
            if (Object.keys(getUrlsDescriptions()).includes(e.data.id)) {
              updateLinkDescriptionsComplete(getLinkDescriptionsComplete() + 1);
            }
            break;
        }
      });

      onLinkDescriptionsCompleteUpdated((linkDescriptionsComplete) => {
        if (linkDescriptionsComplete !== searchResults.length) return;

        worker.postMessage({
          id: "query",
          text: dedent`
            Provide a response to the query: ${query}
  
            If you don't know how to respond, you can paraphrase the links below:
  
            ${getSearchResults()
              .map(
                ([title, , url]) => dedent`
                  Link title: ${title}
                  Link description: ${getUrlsDescriptions()[url]}
                `
              )
              .join("\n\n")}
            `,
          max_new_tokens: defaultMaxNewTokens,
          model: text2TextGenerationModel,
        });
      });

      for (const [title, snippet, url] of getSearchResults()) {
        const request = dedent`
            What is this link about?
  
            Link title: ${title}
            Link snippet: ${snippet}
  
            Start your response with "This link is about".
          `;
        worker.postMessage({
          id: url,
          text: request,
          max_new_tokens: snippet.length,
          model: text2TextGenerationModel,
        });
      }
    } else {
      const generator = await pipeline(
        "text2text-generation",
        text2TextGenerationModel,
        {
          progress_callback: (e: { progress: number }) => {
            if (e.progress) {
              updateResponse(`Loading: ${e.progress.toFixed(0)}%`);
            } else {
              updateResponse("Loading...");
            }
          },
        }
      );

      for (const [title, snippet, url] of getSearchResults()) {
        const request = dedent`
          What is this link about?

          Link title: ${title}
          Link snippet: ${snippet}

          Start your response with "This link is about".
        `;
        const [output] = await generator(request, {
          max_new_tokens: snippet.length,
        });
        updateUrlsDescriptions({
          ...getUrlsDescriptions(),
          [url]: output,
        });
      }

      const [initialResponse] = await generator(query, {
        max_new_tokens: defaultMaxNewTokens,
      });

      const [secondResponse] = await generator(
        dedent`
          The links below that are related to the query "${query}".

          ${getSearchResults()
            .map(
              ([title, , url]) => dedent`
                Link title: ${title}
                Link description: ${getUrlsDescriptions()[url]}
              `
            )
            .join("\n\n")}

          Summarize them in a single paragraph.
        `,
        {
          max_new_tokens: defaultMaxNewTokens,
        }
      );

      const [finalResponse] = await generator(
        dedent`
          Check the following info:

          1. ${initialResponse}

          2. ${secondResponse}

          Now answer: ${query}
        `,
        {
          max_new_tokens: defaultMaxNewTokens,
        }
      );

      updateResponse(finalResponse);
    }
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
        placeholder="Ask anything..."
        autoFocus
        ref={textAreaRef}
        defaultValue={searchQuery}
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
        <SearchForm />
      )}
    </>
  );
}

createRoot(document.body.appendChild(document.createElement("div"))).render(
  <App />
);
