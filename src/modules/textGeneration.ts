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
      TinyLlama: "TinyLlama-1.1B-Chat-v1.0-q4f32_1",
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
            <|user|>: You are a helpful assistant.</s>
            <|assistant|>: Yeah!</s>
            <|user|>: You feel happy to help with almost anything and will do your best to understand exactly what is needed.</s>
            <|assistant|>: Ok!</s>
            <|user|>: You also try to avoid giving false or misleading information, and it caveats when it isn't entirely sure about the right answer.</s>
            <|assistant|>: Sure!</s>
            <|user|>: That said, you are practical, do your best, and don't let caution get too much in the way of being useful.</s>
            <|assistant|>: I'll do my best to help you.
          `,
          roles: ["<|user|>", "<|assistant|>"],
          seps: ["</s>\n"],
          stop_str: "</s>",
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
            "https://huggingface.co/cfahlgren1/wasm-TinyLlama-1.1B-Chat-q4f342_1/resolve/main/params/",
          local_id: availableModels.TinyLlama,
        },
      ],
      model_lib_map: {
        [availableModels.Mistral]:
          "https://huggingface.co/Felladrin/mlc-chat-Mistral-7B-Instruct-v0.1-q4f32_1/resolve/main/Mistral-7B-Instruct-v0.1-q4f32_1-webgpu.wasm",
        [availableModels.TinyLlama]:
          "https://huggingface.co/cfahlgren1/wasm-TinyLlama-1.1B-Chat-q4f342_1/resolve/main/TinyLlama-1.1B-Chat-v1.0-q4f32_1-webgpu.wasm",
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

    const defaultModel = "Felladrin/onnx-Pythia-31M-Chat-v1";

    const largerModel = "Felladrin/onnx-Llama-160M-Chat-v1";

    const textGenerationModel = getUseLargerModelSetting()
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

    let applyChatTemplate!: typeof import("./transformers").applyChatTemplate;

    if (!transformersWorker) {
      const transformersModule = await import("./transformers");
      runTextToTextGenerationPipeline =
        transformersModule.runTextToTextGenerationPipeline;
      applyChatTemplate = transformersModule.applyChatTemplate;
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
        model: textGenerationModel,
        quantized: false,
        pipelineArguments,
      };

      return transformersWorker
        ? (transformersWorker.run(
            "runTextToTextGenerationPipeline",
            paramsForResponse,
          ) as unknown as Promise<T>)
        : runTextToTextGenerationPipeline(paramsForResponse);
    };

    const formatChatMessages = async (
      chat: {
        role: string;
        content: string;
      }[],
    ) => {
      const parameters = {
        modelNameOrPath: textGenerationModel,
        chat,
        addGenerationPrompt: true,
      };
      return transformersWorker
        ? transformersWorker.run("applyChatTemplate", parameters)
        : applyChatTemplate(parameters);
    };

    await generateResponse("Hi!", { max_length: 1 });

    handleModelLoadingProgress = undefined;

    await updateResponseWithTypingEffect("Preparing response...");

    if (!getDisableAiResponseSetting()) {
      const request = await formatChatMessages([
        {
          role: "system",
          content:
            "You are a friendly assistant who does your best to help the user. Start by providing an answer for the question below. If you don't know the answer, you can base your answer on the given context.",
        },
        {
          role: "user",
          content: dedent`
            Context:
            ${getSearchResults()
              .map(([title, snippet]) => `- ${title}: "${snippet}"`)
              .join("\n")}
            
            Question:
            ${query}
          `,
        },
      ]);

      const response = await generateResponse(request, {
        add_special_tokens: true,
        max_new_tokens: 256,
        repetition_penalty: getUseLargerModelSetting() ? 1.04 : 1.00008,
        num_beams: 3,
        early_stopping: true,
      });

      const formattedResponse = response
        .substring(response.lastIndexOf("<|im_start|>assistant"))
        .replace("<|im_start|>assistant\n", "")
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
        const formattedChat = await formatChatMessages([
          {
            role: "system",
            content:
              "You are a friendly assistant who does your best to help the user.",
          },
          {
            role: "user",
            content: `What is this text about?\n${title}: "${snippet}"`,
          },
        ]);

        const request = `${formattedChat}This text is about`;

        const response = await generateResponse(
          request,
          getUseLargerModelSetting()
            ? {
                add_special_tokens: true,
                max_new_tokens: 128,
                repetition_penalty: 1.04,
                penalty_alpha: 0.5,
                top_k: 5,
              }
            : {
                max_new_tokens: 128,
                do_sample: true,
                temperature: 0.4,
                top_p: 0.25,
                top_k: 7,
                repetition_penalty: 1.0008,
              },
        );

        const formattedResponse = response
          .substring(response.lastIndexOf("<|im_start|>assistant"))
          .replace(
            "<|im_start|>assistant\nThis text is about",
            "This link is about",
          )
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
