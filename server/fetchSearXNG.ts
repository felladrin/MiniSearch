import { convert as convertHtmlToPlainText } from "html-to-text";
import { strip as stripEmojis } from "node-emoji";
import { SearxngService } from "searxng";
import axios from "axios";

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
    let { results } = await searxng.search(query, {
      categories: ["general", "news", "images"],
    });

    const textResults: [title: string, content: string, url: string][] = [];
    const imageResults: [
      title: string,
      url: string,
      thumbnailUrl: string,
      sourceUrl: string,
    ][] = [];

    if (limit && limit > 0) {
      results = results.slice(0, limit);
    }

    const uniqueHostnames = new Set<string>();

    const processContent = (html: string): string => {
      return stripEmojis(
        convertHtmlToPlainText(html, { wordwrap: false }).trim(),
        { preserveSpaces: true },
      );
    };

    const imagePromises = results
      .filter((result) => result.category === "images")
      .map(async (result) => {
        let thumbnailUrlIsValid = true;

        try {
          new URL(result.thumbnail_src);
        } catch {
          thumbnailUrlIsValid = false;
        }

        if (thumbnailUrlIsValid) {
          try {
            const axiosResponse = await axios.get(result.thumbnail_src, {
              responseType: "arraybuffer",
            });

            const contentType = axiosResponse.headers["content-type"];
            const base64 = Buffer.from(axiosResponse.data).toString("base64");
            const thumbnailUrl = `data:${contentType};base64,${base64}`;

            return [result.title, result.url, thumbnailUrl, result.img_src];
          } catch {
            return null;
          }
        }

        return null;
      });

    const resolvedImageResults = await Promise.all(imagePromises);
    imageResults.push(
      ...resolvedImageResults.filter(
        (result): result is [string, string, string, string] => result !== null,
      ),
    );

    results
      .filter((result) => result.category === "general")
      .forEach((result) => {
        const { hostname } = new URL(result.url);

        if (!uniqueHostnames.has(hostname) && result.content) {
          const title = convertHtmlToPlainText(result.title, {
            wordwrap: false,
          }).trim();

          const content = processContent(result.content);

          if (title && content) {
            textResults.push([title, content, result.url]);
            uniqueHostnames.add(hostname);
          }
        }
      });

    return { textResults, imageResults };
  } catch (e) {
    console.error(e);
    return { textResults: [], imageResults: [] };
  }
}
