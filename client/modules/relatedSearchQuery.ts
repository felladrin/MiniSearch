import { addLogEntry } from "./logEntries";
import { generateReplyToMessages } from "./textGeneration";
import type { ChatMessage } from "./types";

const SCRIPTS = {
  Latin: /\p{Script=Latin}/gu,
  Arabic: /\p{Script=Arabic}/gu,
  Bengali: /\p{Script=Bengali}/gu,
  Cyrillic: /\p{Script=Cyrillic}/gu,
  Devanagari: /\p{Script=Devanagari}/gu,
  Greek: /\p{Script=Greek}/gu,
  Hangul: /\p{Script=Hangul}/gu,
  Hebrew: /\p{Script=Hebrew}/gu,
  Thai: /\p{Script=Thai}/gu,
  // Japanese mixes kanji and kana, so they count as one script.
  CJK: /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu,
};

type Script = keyof typeof SCRIPTS;

const SCRIPT_NAMES = Object.keys(SCRIPTS) as Script[];

/**
 * Scripts that name the question's language, so a translation can ask for it.
 * CJK is Chinese unless the question has kana. Arabic, Bengali, Cyrillic and
 * Devanagari each serve several languages, and naming the wrong one would
 * translate the query away from the user's language.
 */
const LANGUAGE_BY_SCRIPT: Partial<Record<Script, string>> = {
  Greek: "Greek",
  CJK: "Chinese",
  Hangul: "Korean",
  Hebrew: "Hebrew",
  Thai: "Thai",
};

function countLetters(text: string, script: Script): number {
  return text.match(SCRIPTS[script])?.length ?? 0;
}

/**
 * A CJK character or a Hangul syllable is a word on its own. In the other
 * scripts it takes three letters, because English questions write Greek
 * letters as symbols, alone or in pairs ("α and β error", "γδ T cells").
 */
function countWords(text: string, script: Script): number {
  if (script === "CJK" || script === "Hangul")
    return countLetters(text, script);
  const word = new RegExp(`(?:${SCRIPTS[script].source}){3,}`, "gu");
  return text.match(word)?.length ?? 0;
}

/**
 * Brand names make Latin letters outnumber the Chinese ones in "iPhone呢", so
 * any other script with a word wins over Latin.
 */
function questionScript(question: string): Script | undefined {
  let script: Script | undefined;
  let most = 0;
  for (const candidate of SCRIPT_NAMES) {
    const count = countWords(question, candidate);
    if (candidate !== "Latin" && count > most) {
      script = candidate;
      most = count;
    }
  }
  return script ?? (countLetters(question, "Latin") > 0 ? "Latin" : undefined);
}

/**
 * Latin letters are allowed anywhere, because correct Chinese queries carry
 * brand names ("iPhone价格"). Another script the question does not use marks
 * a drift, even next to the right one ("iPhone قیمت大概多少钱"), from three
 * letters on: one or two are a short name or a symbol ("Ω"). A Latin
 * question has no language to translate into, so a native name next to its
 * Latin words is kept ("Tencent founder 马化腾").
 */
function isWrittenLike(query: string, question: string): boolean {
  const script = questionScript(question);
  if (!script) return true;
  if (countLetters(query, script) === 0) return false;
  if (script === "Latin") return true;
  return SCRIPT_NAMES.every(
    (other) =>
      other === "Latin" ||
      countLetters(question, other) > 0 ||
      countLetters(query, other) < 3,
  );
}

function questionLanguage(question: string): string | undefined {
  if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(question))
    return "Japanese";
  const script = questionScript(question);
  return script && LANGUAGE_BY_SCRIPT[script];
}

function extractQuery(reply: string): string {
  return (
    (reply.trim().split("\n").pop()?.trim() ?? "")
      // Models also wrap the query in the quote marks of other languages.
      .replace(/^["'“”‘’「」『』«»]/, "")
      .replace(/["'“”‘’「」『』«»]$/, "")
  );
}

/** An empty query makes the caller search for the question as typed. */
function fallBackToQuestion(query: string): string {
  addLogEntry(
    `Follow-up search query '${query}' is not in the question's language; searching for the question instead`,
  );
  return "";
}

/**
 * Small models drift into another language when they write the query (Gemma
 * 3 4B turned "它大概多少钱" into Turkish or Persian), and asking harder in the
 * main prompt did not hold. A translation that names the language did, so
 * a query in the wrong script gets one, and the typed question is the
 * fallback when the language has no single name or the translation misses.
 */
async function keepQuestionLanguage(
  query: string,
  question: string,
): Promise<string> {
  if (query === "" || isWrittenLike(query, question)) return query;

  const language = questionLanguage(question);
  if (!language) return fallBackToQuestion(query);

  addLogEntry(`Translating follow-up search query '${query}' into ${language}`);
  const translation = extractQuery(
    await generateReplyToMessages([
      {
        role: "user",
        content: `Translate this web search query into ${language}, keeping its meaning.

${query}

Respond with only the translated search query.`,
      },
    ]),
  );

  return isWrittenLike(translation, question)
    ? translation
    : fallBackToQuestion(translation);
}

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

    const webSearchQuery = await keepQuestionLanguage(
      extractQuery(await generateReplyToMessages(prompt)),
      question,
    );

    addLogEntry(`Generated follow-up search query: '${webSearchQuery}'`);

    return webSearchQuery;
  } catch (error) {
    addLogEntry(`Error generating follow-up search query: ${error}`);
    return "";
  }
}
