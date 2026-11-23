import { describe, expect, it } from "vitest";
import { parseCommaSeparatedList } from "./parseCommaSeparatedList";

describe("parseCommaSeparatedList", () => {
  it("splits on commas", () => {
    expect(parseCommaSeparatedList("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("trims whitespace around each entry", () => {
    expect(parseCommaSeparatedList("localhost, example.com ")).toEqual([
      "localhost",
      "example.com",
    ]);
  });

  it("drops empty entries", () => {
    expect(parseCommaSeparatedList("key1, key2,")).toEqual(["key1", "key2"]);
    expect(parseCommaSeparatedList(",")).toEqual([]);
    expect(parseCommaSeparatedList(" , ,")).toEqual([]);
  });

  it("returns an empty list for an unset or empty value", () => {
    expect(parseCommaSeparatedList(undefined)).toEqual([]);
    expect(parseCommaSeparatedList("")).toEqual([]);
  });
});
