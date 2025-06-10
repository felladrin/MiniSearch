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

export const shikiAdapter = createShikiAdapter(loadShiki);
