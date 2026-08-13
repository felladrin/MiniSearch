import { beforeEach, describe, expect, it, vi } from "vitest";

const lookupMock = vi.hoisted(() => vi.fn());

vi.mock("node:dns/promises", () => ({
  default: { lookup: lookupMock },
  lookup: lookupMock,
}));

import {
  extractReadableText,
  fetchPageContents,
  selectPassages,
  splitIntoPassages,
} from "./pageContentService";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

function respondWithHtml(html: string) {
  fetchMock.mockResolvedValue(
    new Response(html, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    }),
  );
}

function paragraph(text: string) {
  return `<p>${text} ${"Filler sentence that makes this block long enough to survive the passage merge. ".repeat(2)}</p>`;
}

const articlePage = `<!doctype html><html><head><title>Cats</title>
<style>.hidden{display:none}</style><script>track()</script></head>
<body><nav>Home Contact Login</nav>
<article>
${paragraph("Cats are small domesticated carnivores kept as pets.")}
${paragraph("Ferrets are unrelated mustelids and appear here only as a distraction.")}
${paragraph("Cats sleep between twelve and sixteen hours a day.")}
</article>
<footer>Copyright notice and a long list of unrelated site links.</footer>
</body></html>`;

beforeEach(() => {
  fetchMock.mockReset();
  lookupMock.mockReset();
  lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
});

describe("extractReadableText", () => {
  it("keeps the article and drops site chrome, scripts and styles", () => {
    const text = extractReadableText(articlePage);

    expect(text).toContain("Cats are small domesticated carnivores");
    expect(text).not.toContain("Home Contact Login");
    expect(text).not.toContain("Copyright notice");
    expect(text).not.toContain("track()");
    expect(text).not.toContain("display:none");
  });

  it("falls back to the body when there is no article container", () => {
    const text = extractReadableText(
      "<html><body><div><p>Body only content.</p></div></body></html>",
    );

    expect(text).toContain("Body only content.");
  });
});

describe("splitIntoPassages", () => {
  it("glues a heading onto the block that follows it", () => {
    const passages = splitIntoPassages(
      `SHORT HEADING\n\n${"A paragraph long enough to stand on its own. ".repeat(6)}`,
    );

    expect(passages).toHaveLength(1);
    expect(passages[0].startsWith("SHORT HEADING A paragraph")).toBe(true);
  });

  it("breaks a block that is too long to rank as one passage", () => {
    const passages = splitIntoPassages("A sentence here. ".repeat(200));

    expect(passages.length).toBeGreaterThan(1);
    for (const passage of passages) {
      expect(passage.length).toBeLessThanOrEqual(1200);
    }
  });

  it("collapses whitespace and drops empty blocks", () => {
    expect(splitIntoPassages("\n\n  \n\nfirst   block\n\n\n")).toEqual([
      "first block",
    ]);
  });
});

describe("selectPassages", () => {
  const passages = [
    "An introduction that mentions nothing in particular.",
    "The reranker model runs on ONNX Runtime inside the container.",
    "An unrelated aside about the weather.",
  ];

  it("prefers the passage that covers the query", () => {
    expect(selectPassages("onnx runtime reranker", passages, 80)).toEqual([
      passages[1],
    ]);
  });

  it("keeps the selected passages in document order", () => {
    const selected = selectPassages("onnx runtime reranker", passages, 120);

    expect(selected).toEqual([passages[0], passages[1]]);
  });

  it("stays within the character budget", () => {
    const selected = selectPassages("weather", passages, 60);

    expect(selected.join("\n").length).toBeLessThanOrEqual(60);
  });

  it("falls back to document order when the query has no usable terms", () => {
    expect(selectPassages("", passages, 500)).toEqual(passages);
  });

  it("matches a query term against the inflected form on the page", () => {
    const inflected = [
      "An introduction that mentions nothing in particular.",
      "Cats spend most of the day sleeping in warm places.",
    ];

    expect(selectPassages("how long does a cat sleep", inflected, 60)).toEqual([
      inflected[1],
    ]);
  });
});

describe("fetchPageContents", () => {
  it("returns the passages of a page that could be read", async () => {
    respondWithHtml(articlePage);

    const contents = await fetchPageContents("how long do cats sleep", [
      "https://example.com/cats",
    ]);

    expect(contents).toHaveLength(1);
    expect(contents[0].url).toBe("https://example.com/cats");
    expect(contents[0].content).toContain("twelve and sixteen hours");
  });

  it("never requests a URL whose host resolves into a private range", async () => {
    lookupMock.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);

    const contents = await fetchPageContents("anything", [
      "http://router.local/admin",
    ]);

    expect(contents).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("validates the target of a redirect before following it", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(null, {
          status: 301,
          headers: { location: "http://169.254.169.254/latest/meta-data" },
        }),
      )
      .mockResolvedValue(new Response("<html><body>secrets</body></html>"));

    const contents = await fetchPageContents("anything", [
      "https://example.com/redirect",
    ]);

    expect(contents).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("follows a redirect to another public page", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "/moved" },
        }),
      )
      .mockResolvedValue(
        new Response(articlePage, {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      );

    const contents = await fetchPageContents("cats", [
      "https://example.com/old",
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0].toString()).toBe(
      "https://example.com/moved",
    );
    expect(contents).toHaveLength(1);
  });

  it("skips responses that are not documents", async () => {
    fetchMock.mockResolvedValue(
      new Response("%PDF-1.7", {
        status: 200,
        headers: { "content-type": "application/pdf" },
      }),
    );

    expect(
      await fetchPageContents("cats", ["https://example.com/a.pdf"]),
    ).toEqual([]);
  });

  it("skips pages that answer with an error status", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 403 }));

    expect(await fetchPageContents("cats", ["https://example.com/x"])).toEqual(
      [],
    );
  });

  it("skips pages with too little readable text", async () => {
    respondWithHtml("<html><body><p>Accept cookies</p></body></html>");

    expect(
      await fetchPageContents("cats", ["https://example.com/wall"]),
    ).toEqual([]);
  });

  it("keeps the pages that worked when one of them fails", async () => {
    fetchMock.mockImplementation((url: URL) =>
      url.toString().includes("broken")
        ? Promise.reject(new Error("socket hang up"))
        : Promise.resolve(
            new Response(articlePage, {
              status: 200,
              headers: { "content-type": "text/html" },
            }),
          ),
    );

    const contents = await fetchPageContents("cats", [
      "https://broken.example.com/",
      "https://example.com/cats",
    ]);

    expect(contents.map(({ url }) => url)).toEqual([
      "https://example.com/cats",
    ]);
  });

  it("stops reading a body that never ends", async () => {
    const chunk = new TextEncoder().encode(
      `<p>${"cats sleep a lot. ".repeat(5000)}</p>`,
    );
    let chunksSent = 0;

    fetchMock.mockResolvedValue(
      new Response(
        new ReadableStream({
          pull(controller) {
            chunksSent++;
            controller.enqueue(chunk);
          },
        }),
        { status: 200, headers: { "content-type": "text/html" } },
      ),
    );

    const contents = await fetchPageContents("cats sleep", [
      "https://example.com/endless",
    ]);

    expect(contents).toHaveLength(1);
    // 1.5 MB cap over ~85 KB chunks: it stops long before an endless stream.
    expect(chunksSent).toBeLessThan(40);
  });
});
