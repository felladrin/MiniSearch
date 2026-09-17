import { createShikiAdapter } from "@mantine/code-highlight";

// Language ids available from the Shiki web bundle, populated when the
// highlighter is created. The registry is a manifest of lazy import thunks:
// listing it loads no grammar; each grammar is fetched only on load.
let availableLanguages: Set<string> | null = null;

async function loadShiki() {
  const { createHighlighter, bundledLanguages } = await import(
    "shiki/bundle/web"
  );

  availableLanguages = new Set(Object.keys(bundledLanguages));

  return await createHighlighter({
    langs: [],
    themes: [],
  });
}

/**
 * Mantine CodeHighlighter adapter backed by the Shiki web language subset
 * (`shiki/bundle/web`: ~79 ids including aliases — js/ts/jsx/tsx, python,
 * bash/sh/zsh, json/yaml, sql, php, html/css, markdown, vue, svelte and
 * friends). The highlighter starts with no languages loaded; each language
 * is loaded on demand the first time a code block that uses it renders, so
 * an answer pays only for the languages it actually contains.
 *
 * Tradeoff: languages outside the web subset (e.g. ruby, go, rust) are not
 * highlightable. `resolveLanguage` returns null for them, so Mantine skips
 * the grammar load entirely and renders the block as plain text — no load
 * attempted, no throw, no reliance on the ErrorBoundary. The web subset
 * covers what a search/AI answer plausibly contains; degrading an exotic
 * language to plain text is cheaper than pulling in the full bundle (~80
 * more grammars) for the rare block that would use one.
 */
export const shikiAdapter = createShikiAdapter(loadShiki, {
  resolveLanguage: (language) =>
    availableLanguages?.has(language) ? language : null,
});
