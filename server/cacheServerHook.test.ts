import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { cacheServerHook } from "./cacheServerHook";

let root: string;

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "cache-hook-"));
  mkdirSync(path.join(root, "dist", "assets"), { recursive: true });
  writeFileSync(path.join(root, "dist", "assets", "index-abc123.js"), "");
  writeFileSync(path.join(root, "dist", "secret.txt"), "");
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

async function cacheControlFor(url: string) {
  const use = vi.fn();
  cacheServerHook({
    middlewares: { use },
    config: { root, build: { outDir: "dist" } },
  } as never);
  const handler = use.mock.calls[0][0] as (
    req: { url: string },
    res: { setHeader: (name: string, value: string) => void },
    next: () => void,
  ) => Promise<void>;
  const setHeader = vi.fn();
  const next = vi.fn();
  await handler({ url }, { setHeader }, next);
  expect(next).toHaveBeenCalled();
  return setHeader.mock.calls[0][1] as string;
}

describe("cacheServerHook", () => {
  it("marks an existing hashed asset immutable", async () => {
    expect(await cacheControlFor("/assets/index-abc123.js")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(await cacheControlFor("/assets/index-abc123.js?v=1")).toBe(
      "public, max-age=31536000, immutable",
    );
  });

  it("does not mark a missing asset immutable", async () => {
    expect(await cacheControlFor("/assets/index-OLD.js")).toBe("no-cache");
    expect(await cacheControlFor("/assets/")).toBe("no-cache");
  });

  it("does not look outside the assets folder", async () => {
    expect(await cacheControlFor("/assets/..%2fsecret.txt")).toBe("no-cache");
    expect(await cacheControlFor("/assets/%E0%A4%A.js")).toBe("no-cache");
  });

  it("keeps HTML on no-cache and other files on a one-day cache", async () => {
    expect(await cacheControlFor("/")).toBe("no-cache");
    expect(await cacheControlFor("/index.html")).toBe("no-cache");
    expect(await cacheControlFor("/favicon.png")).toBe(
      "public, max-age=86400, must-revalidate",
    );
  });
});
