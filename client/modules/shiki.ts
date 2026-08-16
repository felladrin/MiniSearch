import { createShikiAdapter } from "@mantine/code-highlight";

async function loadShiki() {
  const { createHighlighter, bundledLanguages } = await import(
    "shiki/bundle/full"
  );

  return await createHighlighter({
    langs: Object.keys(bundledLanguages),
    themes: [],
  });
}

/** Mantine CodeHighlighter adapter backed by the full bundled Shiki language set. */
export const shikiAdapter = createShikiAdapter(loadShiki);
