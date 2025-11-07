import { historyDatabase } from "./history";
import { addLogEntry } from "./logEntries";
import { getSuppressNextFollowUp } from "./pubSub";
import { generateChatResponse } from "./textGeneration";
import type { ChatMessage } from "./types";

interface FollowUpQuestionParams {
  topic: string;
  currentContent: string;
  previousQuestions?: string[];
}

export async function generateFollowUpQuestion({
  topic,
  currentContent,
  previousQuestions = [],
}: FollowUpQuestionParams): Promise<string> {
  try {
    if (getSuppressNextFollowUp()) {
      return "";
    }

    addLogEntry("Generating a follow-up question");

    await historyDatabase.chatHistory
      .add({
        role: "user",
        content: topic,
        timestamp: Date.now(),
        conversationId: `follow-up-${Date.now()}`,
      })
      .catch((error) => {
        addLogEntry(`Error saving chat history: ${error}`);
      });

    const promptMessages: ChatMessage[] = [
      {
        role: "user",
        content: `You are a question generator.

Your task is to generate a follow-up question to the topic based on the response.

The topic was:
~~~
${topic}
~~~

The response was:
~~~
${currentContent}
~~~

Follow these instructions:

1. Language detection and matching:
   - Carefully analyze the language of the original question and response.
   - The follow-up question must be written in the exact same language as both the original question and response.
   - Pay special attention to distinguishing between similar languages.
   - If in doubt, prioritize matching the language of the most recent message.

2. Question generation rules:
   - Generate one short follow-up question exploring an important unexplored aspect of the topic.
   - The question must be different from all previously asked questions listed below.
   - Keep it to 1-2 sentences maximum.
   - End with a question mark.

Previously asked follow-up questions (do not repeat):
${
  previousQuestions.length > 0
    ? previousQuestions.map((q, i) => `${i + 1}. ${q}`).join("\n")
    : "(No previous follow-up questions yet)"
}

Respond with just the question, no additional text or explanations.`,
      },
    ];

    const response = await generateChatResponse(promptMessages, () => {});

    await historyDatabase.chatHistory
      .add({
        role: "assistant",
        content: response,
        timestamp: Date.now(),
        conversationId: `follow-up-${Date.now()}`,
      })
      .catch((error) => {
        addLogEntry(`Error saving chat history: ${error}`);
      });

    const lines = response
      .trim()
      .split("\n")
      .map((line) => line.trim())
      .reverse()
      .find((line) => line.endsWith("?"));

    if (!lines) {
      addLogEntry("No valid follow-up question generated");
      return "";
    }

    let questionLine = lines.replace(/^[^a-zA-Z]+/, "");

    questionLine = questionLine.charAt(0).toUpperCase() + questionLine.slice(1);

    addLogEntry("Generated follow-up question successfully");

    await historyDatabase.chatHistory
      .add({
        role: "assistant",
        content: questionLine,
        timestamp: Date.now(),
        conversationId: `follow-up-${Date.now()}`,
      })
      .catch((error) => {
        addLogEntry(`Error saving chat history: ${error}`);
      });

    return questionLine;
  } catch (error) {
    addLogEntry(`Error generating follow-up question: ${error}`);
    return "";
  }
}
