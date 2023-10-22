import fetch from "node-fetch";
import express from "express";
import open from "open";

async function search(query: string, limit?: number) {
  try {
    const url = new URL("http://0.0.0.0:8080/search");
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

      for (const result of results) {
        const stripHtmlTags = (str: string) => str.replace(/<[^>]*>?/gm, "");

        const content = stripHtmlTags(result.content).trim();

        if (content === "") continue;

        const title = stripHtmlTags(result.title);
        const url = result.url as string;

        searchResults.push([title, content, url]);
      }
    }
    return searchResults;
  } catch (e) {
    console.error(e);
    return [];
  }
}

export const app = express();

app.use(express.static("dist"));

app.get("/search", async (request, response) => {
  const query = request.query.q as string;

  if (!query) {
    response.status(400).send("Missing the query parameter.");
    return;
  }

  const limitParam = request.query.limit as string | undefined;
  const limit = limitParam && Number(limitParam) > 0 ? Number(limitParam) : 6;
  const searchResults = await search(query, limit);

  response.send(searchResults);
});

if (process.env.NODE_ENV !== "development") {
  const port = process.env.PORT ?? 5173;
  const url = `http://localhost:${port}/`;
  app.listen(port);
  console.log(`Server started! ${url}`);
  await open(url);
}
