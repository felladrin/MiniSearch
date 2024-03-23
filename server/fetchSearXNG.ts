import fetch from "node-fetch";

export async function fetchSearXNG(query: string, limit?: number) {
  try {
    const url = new URL("http://127.0.0.1:8080/search");

    url.search = new URLSearchParams({
      q: query,
      language: "auto",
      safesearch: "0",
      format: "json",
    }).toString();

    const response = await fetch(url);

    let { results } = (await response.json()) as {
      results: { url: string; title: string; content: string }[];
    };

    const searchResults: [title: string, content: string, url: string][] = [];

    if (results) {
      if (limit && limit > 0) {
        results = results.slice(0, limit);
      }

      const uniqueUrls = new Set<string>();

      for (const result of results) {
        const stripHtmlTags = (str: string) => str.replace(/<[^>]*>?/gm, "");

        const content = stripHtmlTags(result.content).trim();

        if (content === "") continue;

        const title = stripHtmlTags(result.title);

        const url = result.url as string;

        if (uniqueUrls.has(url)) continue;

        uniqueUrls.add(url);

        searchResults.push([title, content, url]);
      }
    }

    return searchResults;
  } catch (e) {
    console.error(e);
    return [];
  }
}
