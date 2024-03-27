import express from "express";
import { crossOriginIsolationHeaders } from "./headers";
import { fetchSearXNG } from "./fetchSearXNG";

export const app = express();

app.use((_, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  crossOriginIsolationHeaders.forEach(({ key, value }) => {
    res.header(key, value);
  });
  next();
});

app.use(express.static("dist"));

app.get("/search", async (request, response) => {
  const query = request.query.q as string;

  if (!query) {
    response.status(400).send("Missing the query parameter.");
    return;
  }

  const limitParam = request.query.limit as string | undefined;
  const limit =
    limitParam && Number(limitParam) > 0 ? Number(limitParam) : undefined;
  const searchResults = await fetchSearXNG(query, limit);

  response.send(searchResults);
});

if (process.env.NODE_ENV !== "development") {
  const port = process.env.PORT ?? 5173;
  const url = `http://localhost:${port}/`;
  app.listen(port);
  console.log(`Server started! ${url}`);
}
