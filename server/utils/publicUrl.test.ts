import { beforeEach, describe, expect, it, vi } from "vitest";

const lookupMock = vi.hoisted(() => vi.fn());

vi.mock("node:dns/promises", () => ({
  default: { lookup: lookupMock },
  lookup: lookupMock,
}));

import { isBlockedAddress, resolvePublicUrl } from "./publicUrl";

function resolvesTo(...addresses: string[]) {
  lookupMock.mockResolvedValue(
    addresses.map((address) => ({
      address,
      family: address.includes(":") ? 6 : 4,
    })),
  );
}

describe("isBlockedAddress", () => {
  it.each([
    "0.0.0.0",
    "10.1.2.3",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "198.18.0.1",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::127.0.0.1",
    "2002:7f00:1::",
    "64:ff9b::7f00:1",
  ])("blocks %s", (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each([
    "8.8.8.8",
    "1.1.1.1",
    "172.32.0.1",
    "192.169.0.1",
    "99.64.0.1",
    "2606:4700:4700::1111",
    "::ffff:8.8.8.8",
  ])("allows %s", (address) => {
    expect(isBlockedAddress(address)).toBe(false);
  });

  it("blocks anything it cannot parse as an address", () => {
    expect(isBlockedAddress("not-an-address")).toBe(true);
    expect(isBlockedAddress("999.1.1.1")).toBe(true);
    expect(isBlockedAddress("")).toBe(true);
  });
});

describe("resolvePublicUrl", () => {
  beforeEach(() => {
    lookupMock.mockReset();
    resolvesTo("93.184.216.34");
  });

  it("returns the parsed URL for a host that resolves publicly", async () => {
    const url = await resolvePublicUrl("https://example.com/article?a=1");

    expect(url.hostname).toBe("example.com");
    expect(lookupMock).toHaveBeenCalledWith("example.com", { all: true });
  });

  it("rejects schemes other than HTTP and HTTPS", async () => {
    await expect(resolvePublicUrl("file:///etc/passwd")).rejects.toThrow(
      "Unsupported URL scheme",
    );
    await expect(resolvePublicUrl("ftp://example.com")).rejects.toThrow(
      "Unsupported URL scheme",
    );
  });

  it("rejects a malformed URL", async () => {
    await expect(resolvePublicUrl("not a url")).rejects.toThrow(
      "Malformed URL",
    );
  });

  it("rejects a literal private address without asking DNS", async () => {
    await expect(
      resolvePublicUrl("http://127.0.0.1:8888/search"),
    ).rejects.toThrow("non-public address");
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("rejects a bracketed IPv6 loopback literal", async () => {
    await expect(resolvePublicUrl("http://[::1]/")).rejects.toThrow(
      "non-public address",
    );
  });

  it("rejects a name that resolves into a blocked range", async () => {
    resolvesTo("169.254.169.254");

    await expect(resolvePublicUrl("http://metadata.internal/")).rejects.toThrow(
      "169.254.169.254",
    );
  });

  it("rejects when only one of several answers is private", async () => {
    resolvesTo("93.184.216.34", "10.0.0.5");

    await expect(
      resolvePublicUrl("https://split-horizon.test/"),
    ).rejects.toThrow("10.0.0.5");
  });

  it("rejects a host with no DNS answer", async () => {
    lookupMock.mockResolvedValue([]);

    await expect(resolvePublicUrl("https://nowhere.test/")).rejects.toThrow(
      "Could not resolve host",
    );
  });
});
