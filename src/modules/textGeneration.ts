import { dedent } from "ts-dedent";
import { isWebGPUAvailable } from "./gpu";
import {
  updatePrompt,
  updateSearchResults,
  getDisableAiResponseSetting,
  getSummarizeLinksSetting,
  getUseLargerModelSetting,
  updateResponse,
  getSearchResults,
  updateUrlsDescriptions,
  getUrlsDescriptions,
} from "./pubSub";
import { loadBar } from "./loadBar";
import { SearchResults, search, decodeSearchResults } from "./search";
import { sleep } from "./sleep";
import { query, debug, disableWorkers } from "./urlParams";

const Worker = disableWorkers ? undefined : window.Worker;

export async function prepareTextGeneration() {
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
      Mistral: "Mistral-7B-Instruct-v0.1-q4f32_1",
      TinyLlama: "TinyLlama-1.1B-1T-OpenOrca-q4f32_1",
    };

    const selectedModel = getUseLargerModelSetting()
      ? availableModels.Mistral
      : availableModels.TinyLlama;

    const commonChatMlConfig = {
      temperature: 0,
      repetition_penalty: 1.1,
      top_p: 1,
    };

    const chatConfigPerModel = {
      [availableModels.Mistral]: {
        ...commonChatMlConfig,
      },
      [availableModels.TinyLlama]: {
        ...commonChatMlConfig,
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
      },
    };

    const appConfig = {
      model_list: [
        {
          model_url:
            "https://huggingface.co/Felladrin/mlc-chat-Mistral-7B-Instruct-v0.1-q4f32_1/resolve/main/params/",
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
          "https://huggingface.co/Felladrin/mlc-chat-Mistral-7B-Instruct-v0.1-q4f32_1/resolve/main/Mistral-7B-Instruct-v0.1-q4f32_1-webgpu.wasm",
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
    }

    await chat.resetChat();

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
    const errorMessage =
      error instanceof Error ? error.message : (error as string);

    console.info(dedent`
        Could not load web-llm chat module: ${errorMessage}

        Falling back to transformers.js.
      `);

    const { createWorker } = await import(
      "../../node_modules/typed-worker/dist"
    );

    const textToTextGenerationModel = "Felladrin/onnx-Smol-Llama-101M-Chat-v1";

    const MobileDetect = (await import("mobile-detect")).default;

    const isRunningOnMobile =
      new MobileDetect(window.navigator.userAgent).mobile() !== null;

    const shouldUseQuantizedModels = isRunningOnMobile;

    const shouldUseBeamSearch = shouldUseQuantizedModels;

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

    let handleModelLoadingProgress:
      | ((e: { file: string; progress: number }) => void)
      | undefined = (e: { file: string; progress: number }) => {
      filesProgress[e.file] = e.progress ?? 100;
      const lowestProgress = Math.min(...Object.values(filesProgress));
      updateResponse(`Loading: ${lowestProgress.toFixed(0)}%`);
    };

    type Actions = import("./transformersWorker").Actions;

    let transformersWorker:
      | ReturnType<typeof createWorker<Actions>>
      | undefined;

    if (Worker) {
      transformersWorker = createWorker<Actions>(() => {
        const worker = new Worker(
          new URL("./transformersWorker", import.meta.url),
          {
            type: "module",
          },
        );

        worker.addEventListener("message", (event) => {
          if (
            handleModelLoadingProgress &&
            event.data.type === "model-loading-progress"
          ) {
            handleModelLoadingProgress(event.data.payload);
          }
        });

        return worker;
      });
    }

    let runTextToTextGenerationPipeline!: typeof import("./transformers").runTextToTextGenerationPipeline;

    if (!transformersWorker) {
      const transformersModule = await import("./transformers");
      runTextToTextGenerationPipeline =
        transformersModule.runTextToTextGenerationPipeline;
    }

    const generateResponse = async <T extends string | string[]>(
      input: T,
      pipelineArguments?: Record<string, unknown>,
    ): Promise<T> => {
      const paramsForResponse = {
        handleModelLoadingProgress: transformersWorker
          ? undefined
          : handleModelLoadingProgress,
        input,
        textToTextGenerationModel,
        quantized: shouldUseQuantizedModels,
        pipelineArguments,
      };

      return transformersWorker
        ? (transformersWorker.run(
            "runTextToTextGenerationPipeline",
            paramsForResponse,
          ) as unknown as Promise<T>)
        : runTextToTextGenerationPipeline(paramsForResponse);
    };

    await generateResponse("Hi!", { max_length: 1 });

    handleModelLoadingProgress = undefined;

    await updateResponseWithTypingEffect("Preparing response...");

    if (!getDisableAiResponseSetting()) {
      const request = dedent`
        <|im_start|>system
        You are a helpful assistant. You will analyze markdown links in a given context and then respond to a question.<|im_end|>
        <|im_start|>user
        Context:
        ${getSearchResults()
          .map(([title, snippet, url]) => `- [${title}](${url} "${snippet}")`)
          .join("\n")}
        
        Question:
        ${query}<|im_end|>
        <|im_start|>assistant
      `;

      const response = await generateResponse(
        request,
        shouldUseBeamSearch
          ? {
              add_special_tokens: true,
              max_new_tokens: 256,
              num_beams: 3,
              early_stopping: true,
            }
          : {
              add_special_tokens: true,
              max_new_tokens: 256,
              repetition_penalty: 1.01,
              penalty_alpha: 0.5,
              top_k: 5,
            },
      );
      const formattedResponse = response
        .substring(response.indexOf("<|im_start|>assistant"))
        .replace("<|im_start|>assistant", "")
        .replace("<|im_end|>", "");

      await updateResponseWithTypingEffect(formattedResponse);
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
          <|im_start|>system
          You are a helpful assistant. You will summarize a link.<|im_end|>
          <|im_start|>user
          Link: [${title}](${url} "${snippet}")<|im_end|>
          <|im_start|>assistant
          This link is about
        `;

        const response = await generateResponse(
          request,
          shouldUseBeamSearch
            ? {
                add_special_tokens: true,
                max_new_tokens: 128,
                repetition_penalty: 1.02,
                num_beams: 3,
                early_stopping: true,
              }
            : {
                add_special_tokens: true,
                max_new_tokens: 128,
                repetition_penalty: 1.02,
                penalty_alpha: 0.5,
                top_k: 5,
              },
        );

        const formattedResponse = response
          .substring(response.indexOf("<|im_start|>assistant"))
          .replace("<|im_start|>assistant", "")
          .replace("<|im_end|>", "");

        await updateUrlsDescriptionsWithTypingEffect(url, formattedResponse);
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
