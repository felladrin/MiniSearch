/**
 * The default system prompt template, kept in a side-effect-free module so
 * that both the client (client/modules/settings.ts) and the offline eval
 * (eval/) use the exact same text. The eval imports this directly; a stale
 * copy there would let prompt regressions ship green, which is the point the
 * eval exists to prevent.
 *
 * The {{searchResults}} and {{currentDate}} placeholders are filled by
 * client/modules/systemPrompt.ts.
 */
/**
 * The citation example inside the prompt, on a placeholder domain: the
 * previous example, a real video link, was copied by small models as if it
 * were one of the sources.
 */
export const CITATION_EXAMPLE = "[example.com](https://example.com/page)";

export const DEFAULT_SYSTEM_PROMPT = `Answer the question using the search results below. Reply in the same language as the question.

Cite each fact with a Markdown link right after it, using the site's domain as the link text. Example: ${CITATION_EXAMPLE}.

If you answer from your own knowledge because the results do not cover it, say so.

Use only these Markdown elements: link, bold, italic, code, quote, table.

Today's date is {{currentDate}}. Use it for relative dates such as "yesterday".

Search results:

{{searchResults}}`;
