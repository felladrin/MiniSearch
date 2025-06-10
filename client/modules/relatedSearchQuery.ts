import type { ChatMessage } from "gpt-tokenizer/GptEncoding";
import { addLogEntry } from "./logEntries";
import { generateChatResponse } from "./textGeneration";

export async function generateRelatedSearchQuery(
  conversation: ChatMessage[],
): Promise<string> {
  try {
    const prompt = [...conversation];

    const lastConversationMessage = prompt[prompt.length - 1];

    const question = lastConversationMessage.content;

    prompt[prompt.length - 1] = {
      ...lastConversationMessage,
      content: `Generate a short web search query (no more than 12 words) to find the most relevant and up-to-date information for the following question:

${question}

Ensure the generated web search query is in the same language as the question above.

Respond with only the search query text, no quotes or additional text.`,
    };

    const raw = await generateChatResponse(prompt, () => {});

    let webSearchQuery = raw.split("\n").reverse()[0]?.trim() ?? "";

    if (webSearchQuery.startsWith('"') || webSearchQuery.startsWith("'")) {
      webSearchQuery = webSearchQuery.slice(1);
    }

    if (webSearchQuery.endsWith('"') || webSearchQuery.endsWith("'")) {
      webSearchQuery = webSearchQuery.slice(0, -1);
    }

    addLogEntry(`Generated follow-up search query: '${webSearchQuery}'`);

    return webSearchQuery;
  } catch (error) {
    addLogEntry(`Error generating follow-up search query: ${error}`);
    return "";
  }
}
