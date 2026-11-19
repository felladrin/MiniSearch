/**
 * Brave Search turned its result links into encrypted redirects on
 * `search.brave.com/go/v1` (https://brave.com/blog/google-goto-anti-scraping/),
 * whose destination only a browser that asks Brave for the key can read.
 * SearXNG's brave engine passes them on as `http:///go/v1/...`, which parses
 * to the single-label host `go`, and a fallback provider has answered with the
 * same shape. A result like that renders as a link that leads nowhere, and the
 * model cites it as a source.
 */
export function isOpenableUrl(url: string): boolean {
  if (!URL.canParse(url)) return false;
  const { protocol, hostname } = new URL(url);
  return (
    (protocol === "http:" || protocol === "https:") && hostname.includes(".")
  );
}
