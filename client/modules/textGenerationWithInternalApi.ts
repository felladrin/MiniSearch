import { GenerationRateMeter } from "./generationRate";
import { addLogEntry } from "./logEntries";
import {
  updateGenerationRate,
  updateResponse,
  updateTextGenerationState,
} from "./pubSub";
import { getSearchTokenHash } from "./searchTokenHash";
import {
  ChatGenerationError,
  canStartResponding,
  getDefaultChatCompletionCreateParamsStreaming,
  getDefaultChatMessages,
  getFormattedSearchResults,
} from "./textGenerationUtilities";
import type { ChatMessage } from "./types";

interface InternalApiStreamPayload {
  error?: unknown;
  choices?: Array<{ delta?: { content?: unknown }; finish_reason?: unknown }>;
  usage?: { completion_tokens?: unknown };
}

export async function generateTextWithInternalApi(signal?: AbortSignal) {
  await canStartResponding(signal);
  updateTextGenerationState("preparingToGenerate");

  const messages = getDefaultChatMessages(
    await getFormattedSearchResults(true),
  );

  let generating = false;

  const rateMeter = new GenerationRateMeter();

  const streamedMessage = await processStreamResponse(
    messages,
    (message) => {
      if (!generating) {
        generating = true;
        updateTextGenerationState("generating");
      }

      updateResponse(message);
    },
    "Generation interrupted",
    signal,
    rateMeter,
  );

  updateResponse(streamedMessage);
  updateGenerationRate(rateMeter.rate());

  return streamedMessage;
}

export async function generateChatWithInternalApi(
  messages: ChatMessage[],
  onUpdate: (partialResponse: string) => void,
  signal?: AbortSignal,
) {
  return processStreamResponse(
    messages,
    onUpdate,
    "Chat generation interrupted",
    signal,
  );
}

/**
 * Streams one answer from the server's `/inference` endpoint. The request is
 * cancelled whenever the answer does not finish: when the caller's signal
 * aborts, at once even while the stream is silent, and on any error thrown
 * while reading.
 * Cancelling closes the connection, which is how the server learns that the
 * reader is gone and stops streaming the run.
 *
 * `rateMeter` times the answer and takes the completion count off the stream's
 * `usage` when one arrives. The `/inference` proxy forwards no usage today, so
 * most answers here have no exact count and show no rate.
 */
async function processStreamResponse(
  messages: ChatMessage[],
  onChunk: (message: string) => void,
  interruptedMessage: string,
  callerSignal?: AbortSignal,
  rateMeter?: GenerationRateMeter,
): Promise<string> {
  const controller = new AbortController();
  const { signal } = controller;
  const interrupt = () => {
    controller.abort(new ChatGenerationError(interruptedMessage));
  };
  if (callerSignal?.aborted) interrupt();
  callerSignal?.addEventListener("abort", interrupt, { once: true });
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  // The browser also errors the body when its fetch is aborted, but only a
  // cancel ends a read that is already waiting on a silent stream everywhere.
  const cancelReader = () => {
    reader?.cancel(signal.reason).catch(() => {});
  };
  signal.addEventListener("abort", cancelReader, { once: true });
  let completed = false;

  try {
    const inferenceUrl = new URL("/inference", self.location.origin);
    const token = await getSearchTokenHash();
    inferenceUrl.searchParams.set("token", token);

    const response = await fetch(inferenceUrl.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...(await getDefaultChatCompletionCreateParamsStreaming(messages)),
        messages,
      }),
      signal,
    });

    if (!response.ok || !response.body) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let streamedMessage = "";
    let bufferedText = "";

    const processLine = (line: string) => {
      const data = line.replace(/^data: /, "").trim();
      if (data === "" || data === "[DONE]") return;

      let parsedLine: InternalApiStreamPayload;
      try {
        parsedLine = JSON.parse(data) as InternalApiStreamPayload;
      } catch {
        return;
      }

      if (typeof parsedLine?.error === "string") {
        throw new ChatGenerationError(parsedLine.error);
      }

      if (parsedLine?.choices?.[0]?.finish_reason === "length") {
        addLogEntry(
          "The answer was cut short: the model reached its output token limit",
        );
      }

      // Only an exact completion count is usable; a delta is not one token.
      if (typeof parsedLine?.usage?.completion_tokens === "number") {
        rateMeter?.setTokenCount(parsedLine.usage.completion_tokens);
      }

      const deltaContent = parsedLine?.choices?.[0]?.delta?.content;
      if (typeof deltaContent === "string" && deltaContent !== "") {
        streamedMessage += deltaContent;
        rateMeter?.onDelta();
        onChunk(streamedMessage);
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      // A cancelled read resolves as done, so the abort is checked first.
      signal.throwIfAborted();
      if (done) break;

      bufferedText += decoder.decode(value, { stream: true });
      const lines = bufferedText.split("\n");
      bufferedText = lines.pop() ?? "";

      for (const line of lines) {
        processLine(line);
      }
    }

    bufferedText += decoder.decode();
    processLine(bufferedText);

    completed = true;
    return streamedMessage;
  } finally {
    callerSignal?.removeEventListener("abort", interrupt);
    // Any way out but a finished stream cancels the request.
    if (!completed) controller.abort();
    signal.removeEventListener("abort", cancelReader);
  }
}
