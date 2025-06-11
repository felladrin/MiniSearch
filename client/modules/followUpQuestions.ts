import type { ChatMessage } from "gpt-tokenizer/GptEncoding";
import { addLogEntry } from "./logEntries";
import { generateChatResponse } from "./textGeneration";

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
        content: `CRITICAL INSTRUCTION: You MUST use the EXACT SAME LANGUAGE as the original question and response. Also, note that the following follow-up questions were already asked. Do NOT repeat them or their meaning:
${
  previousQuestions.length > 0
    ? previousQuestions.map((q, i) => `${i + 1}. ${q}`).join("\n")
    : "(No previous follow-up questions yet)"
}

Knowing that, generate one short follow-up question that explores an important unexplored aspect of the topic.

- The question MUST be in the SAME LANGUAGE as the previous text (this is the highest priority requirement)
- The question MUST be different from all previously asked questions above
- Keep it to 1-2 sentences maximum
- End with a question mark

Respond with just the question, no additional text or explanations.`,
      },
    ];

    const response = await generateChatResponse(promptMessages, () => {});

    const lines = response
      .trim()
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    let questionLine = lines
      .reverse()
      .find(
        (line) =>
          line.endsWith("?") || line.endsWith('?"') || line.endsWith("?'"),
      );

    if (!questionLine) {
      addLogEntry("No valid follow-up question generated");
      return "";
    }

    if (questionLine.startsWith('"') || questionLine.startsWith("'")) {
      questionLine = questionLine.slice(1);
    }

    if (questionLine.endsWith('"') || questionLine.endsWith("'")) {
      questionLine = questionLine.slice(0, -1);
    }

    addLogEntry("Generated follow-up question successfully");

    return questionLine;
  } catch (error) {
    addLogEntry(`Error generating follow-up question: ${error}`);
    return "";
  }
}
