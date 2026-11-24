import { describe, expect, it } from "vitest";
import { parseRequestUrl } from "./requestUrl.ts";

function parse(url: string | undefined, host?: string) {
  return parseRequestUrl({
    url,
    headers: host === undefined ? {} : { host },
  });
}

describe("parseRequestUrl", () => {
  it("reads the path and query parameters the same way for a valid Host", () => {
    const url = parse("/search/text?q=a%20b&token=t", "localhost:7860");
    expect(url?.pathname).toBe("/search/text");
    expect(url?.searchParams.get("q")).toBe("a b");
    expect(url?.searchParams.get("token")).toBe("t");
  });

  it.each([
    undefined,
    "",
    "localhost",
    "localhost:7860",
    "example.com",
    "my_service:3000",
    "127.0.0.1:80",
    "[::1]:7860",
  ])("accepts the Host header %j", (host) => {
    expect(parse("/x", host)).not.toBeNull();
  });

  it.each([
    "bad host",
    "localhost:99999",
    "local host:80",
    "host/path",
    "host?x=1",
    "host:80:80",
    "[::1",
    "a b\tc",
  ])("returns null for the malformed Host header %j", (host) => {
    expect(parse("/x", host)).toBeNull();
  });

  it("does not let the Host header change the parsed path or query", () => {
    const url = parse("/page-content?url=http://a.test", "evil.test:1");
    expect(url?.pathname).toBe("/page-content");
    expect(url?.searchParams.get("url")).toBe("http://a.test");
    expect(url?.host).toBe("localhost");
  });
});
