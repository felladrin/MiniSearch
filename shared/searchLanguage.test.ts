import { describe, expect, it } from "vitest";
import {
  isSearxngLanguage,
  resolveSearchLanguage,
  searchLanguageOptions,
} from "./searchLanguage";

describe("resolveSearchLanguage", () => {
  it("sends the browser's own locale for Browser language", () => {
    expect(resolveSearchLanguage("browser", "pt-BR")).toBe("pt-BR");
  });

  it.each([
    ["es-419", "es"],
    ["zh-Hant-TW", "zh"],
    ["pt-BR-brazil", "pt"],
  ])(
    "falls back to the language subtag of %s, which SearXNG cannot take",
    (browserLanguage, sent) => {
      expect(resolveSearchLanguage("browser", browserLanguage)).toBe(sent);
    },
  );

  it("sends nothing when even the language subtag does not fit", () => {
    // The server answers such a value 400, so the search is better served
    // without a language than refused outright.
    expect(resolveSearchLanguage("browser", "x-klingon")).toBeUndefined();
    expect(resolveSearchLanguage("browser", "")).toBeUndefined();
  });

  it("sends a chosen locale as it is, whatever the browser reports", () => {
    expect(resolveSearchLanguage("pt-BR", "en-US")).toBe("pt-BR");
    expect(resolveSearchLanguage("all", "en-US")).toBe("all");
    expect(resolveSearchLanguage("auto", "en-US")).toBe("auto");
  });

  it("sends nothing for a search that has no language setting at all", () => {
    expect(resolveSearchLanguage(undefined, "en-US")).toBeUndefined();
  });
});

describe("isSearxngLanguage", () => {
  it.each(["pt", "pt-BR", "en-US", "zh-CN", "all", "auto", "fil"])(
    "accepts %s",
    (value) => {
      expect(isSearxngLanguage(value)).toBe(true);
    },
  );

  it.each([
    "",
    "p",
    "PT",
    "pt_br",
    "pt-BR-extra",
    "Portuguese",
    "toolongcode",
    "pt-BR-BR",
  ])("refuses %s", (value) => {
    expect(isSearxngLanguage(value)).toBe(false);
  });

  it("accepts every locale the settings select offers", () => {
    for (const { value } of searchLanguageOptions) {
      // "browser" is MiniSearch's own value and never reaches the server.
      if (value === "browser") continue;
      expect(isSearxngLanguage(value)).toBe(true);
    }
  });
});
