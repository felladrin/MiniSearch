import { describe, expect, it, vi } from "vitest";
import {
  buildAnswerFileName,
  buildAnswerMarkdown,
  downloadAnswerMarkdown,
} from "./answerExport";
import type { TextSearchResults } from "./types";

const date = new Date(2026, 10, 28);

const sources: TextSearchResults = [
  [
    "Mercury - Wikipedia",
    "Mercury is the smallest planet in the Solar System.",
    "https://en.wikipedia.org/wiki/Mercury",
  ],
  [
    "NASA - Mercury",
    "Mercury orbits the Sun in 88 days.",
    "https://www.nasa.gov/mercury",
  ],
];

describe("buildAnswerMarkdown", () => {
  it("writes the answer, the numbered sources and the footer", () => {
    const markdown = buildAnswerMarkdown({
      answer: "Mercury is the smallest planet. It orbits the Sun in 88 days.",
      sources,
      query: "mercury planet",
      date,
    });

    expect(markdown).toBe(
      [
        "Mercury is the smallest planet. It orbits the Sun in 88 days.",
        "",
        "## Sources",
        "",
        "1. [Mercury - Wikipedia](https://en.wikipedia.org/wiki/Mercury)",
        "2. [NASA - Mercury](https://www.nasa.gov/mercury)",
        "",
        'Searched for "mercury planet" on 2026-11-28 with MiniSearch',
        "",
      ].join("\n"),
    );
  });

  it("numbers the sources without adding markers to the answer", () => {
    const answer =
      "Mercury is the smallest planet [usgs.gov](https://www.usgs.gov/).\n\n[USGS][1].";

    const markdown = buildAnswerMarkdown({
      answer,
      sources,
      query: "mercury",
      date,
    });

    expect(markdown.startsWith(`${answer}\n\n## Sources`)).toBe(true);
    expect(markdown).toContain("[usgs.gov](https://www.usgs.gov/)");
    expect(markdown).toContain("[USGS][1]");
    expect(markdown).not.toMatch(/^\[\d+\]/m);
  });

  it("leaves out the Sources section when the answer has no sources", () => {
    const markdown = buildAnswerMarkdown({
      answer: "Mercury is the smallest planet.",
      sources: [],
      query: "mercury",
      date,
    });

    expect(markdown).toBe(
      'Mercury is the smallest planet.\n\nSearched for "mercury" on 2026-11-28 with MiniSearch\n',
    );
  });

  it("keeps the export valid when the answer is empty", () => {
    const markdown = buildAnswerMarkdown({
      answer: "   \n\n  ",
      sources: [sources[0]],
      query: "mercury",
      date,
    });

    expect(markdown).toBe(
      [
        "## Sources",
        "",
        "1. [Mercury - Wikipedia](https://en.wikipedia.org/wiki/Mercury)",
        "",
        'Searched for "mercury" on 2026-11-28 with MiniSearch',
        "",
      ].join("\n"),
    );
    expect(markdown).not.toMatch(/^#+\s*$/m);
  });

  it("keeps the export valid when the answer and the sources are both empty", () => {
    expect(
      buildAnswerMarkdown({ answer: "", sources: [], query: "", date }),
    ).toBe("Searched on 2026-11-28 with MiniSearch\n");
  });

  it("skips a source with no URL and keeps the numbering in order", () => {
    const markdown = buildAnswerMarkdown({
      answer: "Answer.",
      sources: [sources[0], ["No URL", "A snippet.", "  "], sources[1]],
      query: "mercury",
      date,
    });

    expect(markdown).toContain(
      [
        "1. [Mercury - Wikipedia](https://en.wikipedia.org/wiki/Mercury)",
        "2. [NASA - Mercury](https://www.nasa.gov/mercury)",
      ].join("\n"),
    );
  });

  it("escapes brackets in a source title and falls back to the URL", () => {
    const markdown = buildAnswerMarkdown({
      answer: "Answer.",
      sources: [
        ["Grid [F] plan", "A snippet.", "https://example.com/grid"],
        ["   ", "A snippet.", "https://example.com/untitled"],
      ],
      query: "grid",
      date,
    });

    expect(markdown).toContain(
      "1. [Grid \\[F\\] plan](https://example.com/grid)",
    );
    expect(markdown).toContain(
      "2. [https://example.com/untitled](https://example.com/untitled)",
    );
  });

  it("keeps a query that spans lines on one footer line", () => {
    const markdown = buildAnswerMarkdown({
      answer: "Answer.",
      sources: [],
      query: "mercury\n   probe",
      date,
    });

    expect(markdown).toContain('Searched for "mercury probe" on ');
  });
});

describe("buildAnswerFileName", () => {
  it("keeps the words of the query", () => {
    expect(buildAnswerFileName("mercury planet")).toBe("mercury planet.md");
    expect(buildAnswerFileName("computação quântica")).toBe(
      "computação quântica.md",
    );
  });

  it("replaces path separators and characters Windows refuses", () => {
    expect(buildAnswerFileName('a/b\\c:d*e?f"g<h>i|j')).toBe(
      "a-b-c-d-e-f-g-h-i-j.md",
    );
    expect(buildAnswerFileName("../etc/passwd")).toBe("etc-passwd.md");
    expect(buildAnswerFileName('mercury: the "planet"')).toBe(
      "mercury-the-planet.md",
    );
  });

  it("refuses a name Windows reserves for a device", () => {
    expect(buildAnswerFileName("con")).toBe("_con.md");
    expect(buildAnswerFileName("com1")).toBe("_com1.md");
  });

  it("bounds the length of a very long query", () => {
    expect(buildAnswerFileName(`${"a".repeat(59)} bb`)).toBe(
      `${"a".repeat(59)}.md`,
    );
    expect(buildAnswerFileName("x".repeat(500)).length).toBe(63);
  });

  it("falls back to a plain name when the query gives nothing", () => {
    expect(buildAnswerFileName("")).toBe("answer.md");
    expect(buildAnswerFileName("   ")).toBe("answer.md");
    expect(buildAnswerFileName("???")).toBe("answer.md");
    expect(buildAnswerFileName("...")).toBe("answer.md");
  });
});

describe("downloadAnswerMarkdown", () => {
  it("saves the markdown and releases the object URL", async () => {
    let link: HTMLAnchorElement | undefined;
    let blob: Blob | undefined;
    const createObjectURL = vi.fn((value: Blob) => {
      blob = value;
      return "blob:answer";
    });
    const revokeObjectURL = vi.fn();

    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      link = this;
    });

    try {
      downloadAnswerMarkdown("Answer.", "mercury.md");
    } finally {
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockRestore();
      vi.unstubAllGlobals();
    }

    expect(blob?.type).toBe("text/markdown");
    expect(await blob?.text()).toBe("Answer.");
    expect(link?.download).toBe("mercury.md");
    expect(link?.href).toBe("blob:answer");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:answer");
    expect(document.querySelector("a")).toBeNull();
  });
});
