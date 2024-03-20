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
import { SearchResults, search } from "./search";
import { sleep } from "./sleep";
import { query, debug, disableWorkers, beta } from "./urlParams";

const Worker = disableWorkers ? undefined : window.Worker;

async function generateTextWithWebLlm() {
  const { ChatWorkerClient, ChatModule, hasModelInCache } = await import(
    "@mlc-ai/web-llm"
  );

  type ChatOptions = import("@mlc-ai/web-llm").ChatOptions;

  const chat = Worker
    ? new ChatWorkerClient(
        new Worker(new URL("./webLlmWorker.ts", import.meta.url), {
          type: "module",
        }),
      )
    : new ChatModule();

  const availableModels = {
    Phi: "Phi2-q4f32_1-1k",
    TinyLlama: "TinyLlama-1.1B-Chat-v0.4-q4f32_1-1k",
  };

  const selectedModel = getUseLargerModelSetting()
    ? availableModels.Phi
    : availableModels.TinyLlama;

  const commonChatMlConfig: ChatOptions = {
    temperature: 0,
    repetition_penalty: 1.1,
    max_gen_len: 256,
  };

  const chatConfigPerModel: { [x: string]: ChatOptions } = {
    [availableModels.Phi]: {
      ...commonChatMlConfig,
    },
    [availableModels.TinyLlama]: {
      ...commonChatMlConfig,
      conv_template: "custom",
      conv_config: {
        system_template: "{system_message}",
        system_message: dedent`
          <|im_start|>system
          You are a highly knowledgeable and friendly assistant. Your goal is to understand and respond to user inquiries with clarity. Your interactions are always respectful, helpful, and focused on delivering the most accurate information to the user.<|im_end|>
          <|im_start|>user
          Hello!<|im_end|>
          <|im_start|>assistant
          Hi! How can I help you today?
        `,
        roles: {
          user: "<|im_start|>user",
          assistant: "<|im_start|>assistant",
        },
        offset: 0,
        seps: ["<|im_end|>\n"],
        role_content_sep: "\n",
        role_empty_sep: "\n",
        stop_str: ["<|im_end|>"],
        stop_token_ids: [2, 32002],
      },
    },
  };

  const appConfig = {
    model_list: [
      {
        local_id: availableModels.Phi,
        model_url:
          "https://huggingface.co/mlc-ai/phi-2-q4f32_1-MLC/resolve/main/",
        model_lib_url:
          "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/phi-2/phi-2-q4f32_1-ctx2k-webgpu.wasm",
      },
      {
        local_id: availableModels.TinyLlama,
        model_url:
          "https://huggingface.co/mlc-ai/TinyLlama-1.1B-Chat-v0.4-q0f32-MLC/resolve/main/",
        model_lib_url:
          "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/TinyLlama-1.1B-Chat-v0.4/TinyLlama-1.1B-Chat-v0.4-q0f32-ctx2k-webgpu.wasm",
      },
    ],
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
          .slice(0, 5)
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
        When searching for "${query}", this link was found: [${title}](${url} "${snippet}")
        Now, tell me: What is this link about and how is it related to the search?
        Note: Don't cite the link in your response. Just summarize it and let me know if it's worth visiting.
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
}

async function generateTextWithWllama() {
  const { initializeWllama, runCompletion, exitWllama } = await import(
    "./wllama"
  );

  await initializeWllama({
    modelUrl: getUseLargerModelSetting()
      ? "https://huggingface.co/Qwen/Qwen1.5-0.5B-Chat-GGUF/resolve/main/qwen1_5-0_5b-chat-q5_k_m.gguf"
      : "https://huggingface.co/Felladrin/gguf-Llama-160M-Chat-v1/resolve/main/Llama-160M-Chat-v1.Q5_K_M.gguf",
  });

  if (!getDisableAiResponseSetting()) {
    updateResponse("Preparing response...");

    const prompt = dedent`
      <|im_start|>system
      You are a highly knowledgeable and friendly assistant. Your goal is to understand and respond to user inquiries with clarity. Your interactions are always respectful, helpful, and focused on delivering the most accurate information to the user.<|im_end|>
      <|im_start|>user
      Hello!<|im_end|>
      <|im_start|>assistant
      Hi! How can I help you today?<|im_end|>
      <|im_start|>user
      Context:
      ${getSearchResults()
        .slice(0, 5)
        .map(([title, snippet]) => `- ${title}: ${snippet}`)
        .join("\n")}<|im_end|>
      
      Question:
      ${query}<|im_end|>
      <|im_start|>assistant

    `;

    if (!query) return;

    const completion = await runCompletion({
      prompt,
      nPredict: 512,
      sampling: {
        temp: 0.3,
        top_k: 0,
        top_p: 1,
        min_p: 0.1,
      },
      onNewToken: (_token, _piece, currentText) => {
        updateResponse(currentText);
      },
    });

    updateResponse(completion.replaceAll("<|im_end|>", ""));
  }

  if (getSummarizeLinksSetting()) {
    for (const [title, snippet, url] of getSearchResults()) {
      const prompt = dedent`
        <|im_start|>system
        You are a highly knowledgeable and friendly assistant. Your goal is to understand and respond to user inquiries with clarity. Your interactions are always respectful, helpful, and focused on delivering the most accurate information to the user.<|im_end|>
        <|im_start|>user
        Hello!<|im_end|>
        <|im_start|>assistant
        Hi! How can I help you today?<|im_end|>
        <|im_start|>user
        Context:
        ${title}: ${snippet}

        Question:
        What is this text about?<|im_end|>
        <|im_start|>assistant
        This text is about
      `;

      const completion = await runCompletion({
        prompt,
        nPredict: 128,
        sampling: {
          temp: 0.3,
          top_k: 0,
          top_p: 1,
          min_p: 0.1,
        },
        onNewToken: (_token, _piece, currentText) => {
          updateUrlsDescriptions({
            ...getUrlsDescriptions(),
            [url]: `This link is about ${currentText}`,
          });
        },
      });

      updateUrlsDescriptions({
        ...getUrlsDescriptions(),
        [url]: `This link is about ${completion.replaceAll("<|im_end|>", "")}`,
      });
    }
  }

  await exitWllama();
}

async function generateTextWithTransformersJs() {
  const { createWorker } = await import("../../node_modules/typed-worker/dist");

  const MobileDetect = (await import("mobile-detect")).default;

  const isRunningOnMobile =
    new MobileDetect(window.navigator.userAgent).mobile() !== null;

  const models = {
    mobileDefault: "Felladrin/onnx-Minueza-32M-UltraChat",
    mobileLarger: "Felladrin/onnx-Minueza-32M-UltraChat",
    desktopDefault: "Felladrin/onnx-TinyMistral-248M-Chat-v1",
    desktopLarger: "Xenova/Qwen1.5-0.5B-Chat",
  } as const;

  const defaultModel = isRunningOnMobile
    ? models.mobileDefault
    : models.desktopDefault;

  const largerModel = isRunningOnMobile
    ? models.mobileLarger
    : models.desktopLarger;

  const shouldUserLargerModel = getUseLargerModelSetting();

  const textGenerationModel = shouldUserLargerModel
    ? largerModel
    : defaultModel;

  const shouldUseQuantizedModels = !isRunningOnMobile || !shouldUserLargerModel;

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

  let transformersWorker: ReturnType<typeof createWorker<Actions>> | undefined;

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
            .slice(0, 5)
            .map(([title, snippet]) => `- ${title}: ${snippet}`)
            .join("\n")}
          
          Question:
          ${query}
        `,
      },
    ]);

    const response = await generateResponse(request, {
      max_new_tokens: 256,
      repetition_penalty:
        textGenerationModel === models.mobileDefault
          ? 1.02
          : textGenerationModel === models.desktopDefault
            ? 1.01
            : 1.0,
      num_beams: 3,
      early_stopping: true,
    });

    const formattedResponse = response
      .substring(response.lastIndexOf("assistant\n"))
      .replace("assistant\n", "")
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
          content: `What is this text about?\n${title}: ${snippet}`,
        },
      ]);

      const request = `${formattedChat}This text is about`;

      const response = await generateResponse(
        request,
        textGenerationModel === models.mobileDefault
          ? {
              max_new_tokens: 128,
              repetition_penalty: 1.06,
              penalty_alpha: 0.5,
              top_k: 4,
            }
          : textGenerationModel === models.desktopDefault
            ? {
                max_new_tokens: 128,
                repetition_penalty: 1.035,
                penalty_alpha: 0.5,
                top_k: 4,
              }
            : {
                max_new_tokens: 128,
                repetition_penalty: 1.0,
                penalty_alpha: 0.5,
                top_k: 4,
              },
      );

      const formattedResponse = response
        .substring(response.lastIndexOf("assistant\n"))
        .replace("assistant\nThis text is about", "This link is about")
        .replace("<|im_end|>", "");

      await updateUrlsDescriptionsWithTypingEffect(url, formattedResponse);
    }

    if (transformersWorker) {
      transformersWorker.destroy();
    }
  }
}

async function rankSearchResults(searchResults: SearchResults, query: string) {
  const { createWorker } = await import("../../node_modules/typed-worker/dist");

  type Actions = import("./transformersWorker").Actions;

  let transformersWorker: ReturnType<typeof createWorker<Actions>> | undefined;

  if (Worker) {
    transformersWorker = createWorker<Actions>(() => {
      const worker = new Worker(
        new URL("./transformersWorker", import.meta.url),
        {
          type: "module",
        },
      );

      return worker;
    });
  }

  let rank!: typeof import("./transformers").rank;

  if (!transformersWorker) {
    const transformersModule = await import("./transformers");
    rank = transformersModule.rank;
  }

  const snippets = searchResults.map(
    ([title, snippet]) => `${title}: ${snippet}`,
  );

  const rankedSearchResults: SearchResults = (
    await (transformersWorker
      ? transformersWorker.run("rank", query, snippets)
      : rank(query, snippets))
  ).map(({ corpus_id }) => searchResults[corpus_id]);

  if (transformersWorker) {
    transformersWorker.destroy();
  }

  return rankedSearchResults;
}

export async function prepareTextGeneration() {
  if (query === null) return;

  document.title = query;

  updatePrompt(query);

  const searchResults = await search(query, 30);

  updateSearchResults(searchResults);

  updateUrlsDescriptions(
    searchResults.reduce(
      (acc, [, snippet, url]) => ({ ...acc, [url]: snippet }),
      {},
    ),
  );

  const rankedSearchResults = await rankSearchResults(searchResults, query);

  updateSearchResults(rankedSearchResults);

  if (getDisableAiResponseSetting() && !getSummarizeLinksSetting()) return;

  if (debug) console.time("Response Generation Time");

  loadBar.start();

  try {
    if (beta) {
      await generateTextWithWllama();
    } else {
      if (!isWebGPUAvailable) throw Error("WebGPU is not available.");

      await generateTextWithWebLlm();
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : (error as string);

    console.info(dedent`
        Could not load web-llm chat module: ${errorMessage}

        Falling back to transformers.js.
      `);

    await generateTextWithTransformersJs();
  }

  loadBar.done();

  if (debug) {
    console.timeEnd("Response Generation Time");
  }
}
