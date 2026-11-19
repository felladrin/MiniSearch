import { addLogEntry } from "./logEntries";
import { generateReplyToMessages } from "./textGeneration";
import type { ChatMessage } from "./types";

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

The query must make sense on its own, without the rest of the conversation: if the question refers to something mentioned earlier, name that thing in the query.

If the question has a relative date, copy it word for word instead of writing a date.

Ensure the generated web search query is in the same language as the question above.

Respond with only the search query text, no quotes or additional text.`,
    };

    const raw = await generateReplyToMessages(prompt);

    let webSearchQuery = raw.split("\n").reverse()[0]?.trim() ?? "";

    // Models also wrap the query in the quote marks of other languages.
    webSearchQuery = webSearchQuery
      .replace(/^["'“”‘’「」『』«»]/, "")
      .replace(/["'“”‘’「」『』«»]$/, "");

    addLogEntry(`Generated follow-up search query: '${webSearchQuery}'`);

    return webSearchQuery;
  } catch (error) {
    addLogEntry(`Error generating follow-up search query: ${error}`);
    return "";
  }
}
