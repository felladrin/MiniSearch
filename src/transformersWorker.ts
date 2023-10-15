import { Pipeline, pipeline } from "@xenova/transformers";

let generatorInstance: Promise<Pipeline>;

const getGenerator = (model: string | undefined) => {
  if (!generatorInstance) {
    generatorInstance = pipeline("text2text-generation", model, {
      progress_callback: self.postMessage,
    });
  }
  return generatorInstance;
};

const messageQueue: {
  model: string;
  text: string;
  max_new_tokens: number;
  id: string;
}[] = [];

self.addEventListener("message", (event) => {
  messageQueue.push(event.data);
  if (messageQueue.length === 1) {
    processQueue();
  }
});

async function processQueue() {
  const message = messageQueue[0];
  try {
    const generator = await getGenerator(message.model);

    const [output] = await generator(message.text, {
      max_new_tokens: message.max_new_tokens,
      callback_function: (outputs: { output_token_ids: number[] }[]) => {
        self.postMessage({
          status: "update",
          output: generator.tokenizer.decode(outputs[0].output_token_ids, {
            skip_special_tokens: true,
          }),
          id: message.id,
        });
      },
    });

    self.postMessage({
      status: "complete",
      output: output,
      id: message.id,
    });
  } catch (error) {
    self.postMessage({
      status: "error",
      error,
      id: message.id,
    });
  } finally {
    messageQueue.shift();
    if (messageQueue.length > 0) {
      processQueue();
    }
  }
}
