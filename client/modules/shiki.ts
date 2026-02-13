import { createShikiAdapter } from "@mantine/code-highlight";

/**
 * Loads and configures Shiki syntax highlighter
 * @returns Promise resolving to a configured Shiki highlighter
 */
async function loadShiki() {
  const { createHighlighter, bundledLanguages } = await import(
    "shiki/bundle/full"
  );

  return await createHighlighter({
    langs: Object.keys(bundledLanguages),
    themes: [],
  });
}

/**
 * Mantine adapter for Shiki syntax highlighting
 */
export const shikiAdapter = createShikiAdapter(loadShiki);
