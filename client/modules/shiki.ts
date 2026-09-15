import { createShikiAdapter } from "@mantine/code-highlight";

async function loadShiki() {
  const { createHighlighter } = await import("shiki/bundle/full");

  return await createHighlighter({
    langs: [],
    themes: [],
  });
}

/**
 * Mantine CodeHighlighter adapter backed by the full bundled Shiki language
 * set. The highlighter starts with no languages loaded; each language is
 * loaded on demand from the full bundle the first time a code block that uses
 * it renders.
 */
export const shikiAdapter = createShikiAdapter(loadShiki, {
  resolveLanguage: (language) => language,
});
