import fetch from "node-fetch";
import express from "express";
import open from "open";

type SearchResults = [title: string, abstract: string, url: string][];

async function search(query: string, limit?: number) {
  try {
    query = encodeURIComponent(query.replace(/"/g, '\\"'));
    const html = await fetch(`https://duckduckgo.com/?q=${query}`).then((res) =>
      res.text(),
    );
    const matches = html.match(/vqd=['"](\d+-\d+(?:-\d+)?)['"]/);
    const vqd = matches ? matches[1] : null;
    if (!vqd) {
      return [];
    }
    const url = `https://links.duckduckgo.com/d.js?q=${query}&o=json&vqd=${vqd}`;
    const res = await fetch(url).then((res) => res.text());
    const result = JSON.parse(res);
    const searchResults: SearchResults = [];
    if (result.results) {
      let results = result.results;

      if (limit && limit > 0) {
        results = results.slice(0, limit);
      }

      for (const result of results) {
        if (result.n) continue;

        let abstract = result.a as string;

        if (!abstract || abstract === "") continue;

        const stripHtmlTags = (str: string) => str.replace(/<[^>]*>?/gm, "");

        const title = stripHtmlTags(result.t);
        abstract = stripHtmlTags(abstract);
        const url = result.u as string;

        searchResults.push([title, abstract, url]);
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
