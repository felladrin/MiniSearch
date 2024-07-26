import { convert as convertHtmlToPlainText } from "html-to-text";
import { strip as stripEmojis } from "node-emoji";
import { SearxngService } from "searxng";

const searxng = new SearxngService({
  baseURL: "http://127.0.0.1:8080",
  defaultSearchParams: {
    lang: "auto",
    safesearch: 0,
    format: "json",
  },
});

export async function fetchSearXNG(query: string, limit?: number) {
  try {
    let { results } = await searxng.search(query);

    const searchResults: [title: string, content: string, url: string][] = [];

    if (limit && limit > 0) {
      results = results.slice(0, limit);
    }

    const uniqueUrls = new Set<string>();

    const processContent = (html: string): string => {
      let text = convertHtmlToPlainText(html, { wordwrap: false }).trim();
      text = stripEmojis(text, { preserveSpaces: true });
      return text;
    };

    for (const result of results) {
      if (uniqueUrls.has(result.url) || !result.content) continue;

      const title = convertHtmlToPlainText(result.title, {
        wordwrap: false,
      }).trim();

      const content = processContent(result.content);

      if (title === "" || content === "") continue;

      const url = result.url;

      searchResults.push([title, content, url]);

      uniqueUrls.add(url);
    }

    return searchResults;
  } catch (e) {
    console.error(e);
    return [];
  }
}
