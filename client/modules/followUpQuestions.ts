import type { ChatMessage } from "gpt-tokenizer/GptEncoding";
import { addLogEntry } from "./logEntries";
import { generateChatResponse } from "./textGeneration";

export interface FollowUpQuestionParams {
  topic: string;
  currentContent: string;
}

export async function generateFollowUpQuestion({
  topic,
  currentContent,
}: FollowUpQuestionParams): Promise<string> {
  try {
    addLogEntry("Generating a follow-up question");

    const promptMessages: ChatMessage[] = [
      {
        role: "user",
        content: topic,
      },
      {
        role: "assistant",
        content: currentContent,
      },
      {
        role: "user",
        content:
          "Based on the previous question and your response, generate a single, " +
          "concise follow-up question that explores an important unexplored aspect " +
          "of the topic. The question should be 1-2 sentences maximum and end with a question mark. " +
          "Respond with just the question, no additional text or explanations. " +
          "Generate it using the same language as the previous question and your response.",
      },
    ];

    const response = await generateChatResponse(promptMessages, () => {});

    const lines = response
      .trim()
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const questionLine = lines.reverse().find((line) => line.endsWith("?"));

    if (!questionLine) {
      addLogEntry("No valid follow-up question generated");
      return "";
    }

    addLogEntry("Generated follow-up question successfully");

    return questionLine;
  } catch (error) {
    addLogEntry(`Error generating follow-up question: ${error}`);
    return "";
  }
}
