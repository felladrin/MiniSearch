import http from "node:http";
import type { RequestOptions } from "node:https";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";

// https is stubbed so the TLS options the pin relies on — servername, Host,
// the lookup override — can be inspected without a certificate. http stays
// real: one test below drives an actual socket through the pin.
const httpsRequestMock = vi.hoisted(() => vi.fn());

vi.mock("node:https", () => ({
  default: { request: httpsRequestMock },
}));

import {
  readCappedStream,
  requestPinnedToVettedAddress,
} from "./pinnedFetch.ts";

type LookupFn = (
  hostname: string,
  options: unknown,
  callback: (
    error: NodeJS.ErrnoException | null,
    addresses: string | { address: string; family: number }[],
    family?: number,
  ) => void,
) => void;

/**
 * Runs a pinned https request against a stub that answers with an empty
 * 200, and hands back the options the request was built with.
 */
async function captureHttpsOptions(
  url: URL,
  address: string,
): Promise<RequestOptions> {
  httpsRequestMock.mockImplementation(
    (_options: RequestOptions, callback: (response: unknown) => void) => ({
      on: () => undefined,
      end: () => callback({ statusCode: 200, headers: {} }),
    }),
  );
  await requestPinnedToVettedAddress(url, address);
  const calls = httpsRequestMock.mock.calls;
  return calls[calls.length - 1][0] as RequestOptions;
}

/** Drives the lookup override and reports what it answers with. */
function resolveViaPin(
  options: RequestOptions,
  queriedHostname: string,
  lookupOptions: unknown = {},
): Promise<{ address: string; family: number }> {
  const lookup = options.lookup as LookupFn;
  return new Promise((resolve, reject) => {
    lookup(queriedHostname, lookupOptions, (error, addresses, family) => {
      if (error) reject(error);
      else if (typeof addresses === "string")
        resolve({ address: addresses, family: family ?? 0 });
      else resolve(addresses[0]);
    });
  });
}

function hostOf(options: RequestOptions): string {
  return (options.headers as Record<string, string>).Host;
}

describe("requestPinnedToVettedAddress", () => {
  it("keeps the original hostname for TLS SNI and the Host header while dialling the vetted address", async () => {
    const options = await captureHttpsOptions(
      new URL("https://thumbs.example.com/a.jpg"),
      "93.184.216.34",
    );

    // SNI and certificate verification follow the hostname, not the IP,
    // so a wrong-host certificate still fails the request.
    expect(options.hostname).toBe("thumbs.example.com");
    expect(options.servername).toBe("thumbs.example.com");
    expect(options.port).toBe(443);
    expect(hostOf(options)).toBe("thumbs.example.com");
  });

  it("answers the lookup override with the pinned address without touching DNS", async () => {
    const options = await captureHttpsOptions(
      new URL("https://thumbs.example.com/a.jpg"),
      "93.184.216.34",
    );

    // Whatever hostname the connect layer asks about, the answer is the
    // vetted address: no resolver is consulted, so a second DNS answer
    // cannot exist to be rebound.
    const first = await resolveViaPin(options, "thumbs.example.com");
    const second = await resolveViaPin(options, "anything-else.test");
    expect(first).toEqual({ address: "93.184.216.34", family: 4 });
    expect(second).toEqual({ address: "93.184.216.34", family: 4 });

    // The Happy Eyeballs shape: asked for every answer, the pin hands
    // back exactly one — the vetted address.
    const all = await resolveViaPin(options, "anything.test", { all: true });
    expect(all).toEqual({ address: "93.184.216.34", family: 4 });
  });

  it("brackets an IPv6 host in the Host header and reports family 6", async () => {
    const address = "2001:db8:85a3::8a2e:370:7334";
    const options = await captureHttpsOptions(
      new URL(`https://[${address}]/x.png`),
      address,
    );

    expect(options.hostname).toBe(address);
    expect(hostOf(options)).toBe(`[${address}]`);
    const resolved = await resolveViaPin(options, "anything.test");
    expect(resolved).toEqual({ address, family: 6 });
  });

  it("preserves a non-default port through the pinned connect and the Host header", async () => {
    const options = await captureHttpsOptions(
      new URL("https://thumbs.example.com:8443/a.jpg"),
      "93.184.216.34",
    );

    expect(options.port).toBe(8443);
    expect(hostOf(options)).toBe("thumbs.example.com:8443");
  });

  it("omits the default port from the Host header", async () => {
    const options = await captureHttpsOptions(
      new URL("https://thumbs.example.com:443/a.jpg"),
      "93.184.216.34",
    );

    expect(options.port).toBe(443);
    expect(hostOf(options)).toBe("thumbs.example.com");
  });

  it("refuses a scheme that is not http(s)", async () => {
    await expect(
      requestPinnedToVettedAddress(
        new URL("ftp://example.com/x"),
        "93.184.216.34",
      ),
    ).rejects.toThrow("Unsupported URL scheme");
    expect(httpsRequestMock).not.toHaveBeenCalled();
  });

  it("dials the pinned address end-to-end while the server sees the original Host", async () => {
    // pinned-host.test has no DNS record: the request can only succeed if
    // the socket goes where the pin says, not where a resolver would.
    let seenHost = "";
    let seenTarget = "";
    const server = http.createServer((request, response) => {
      seenHost = request.headers.host ?? "";
      seenTarget = request.url ?? "";
      response.writeHead(200, { "content-type": "image/png" });
      response.end(Buffer.from([9, 8, 7]));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const { port } = server.address() as AddressInfo;

    try {
      const url = new URL(`http://pinned-host.test:${port}/img.png?v=1`);
      const response = await requestPinnedToVettedAddress(url, "127.0.0.1");
      const { bytes } = await readCappedStream(response, 1_000);

      expect(response.statusCode).toBe(200);
      expect(Array.from(bytes)).toEqual([9, 8, 7]);
      expect(seenHost).toBe(`pinned-host.test:${port}`);
      expect(seenTarget).toBe("/img.png?v=1");
    } finally {
      server.close();
    }
  });

  it("refuses to run a request whose signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      requestPinnedToVettedAddress(
        new URL("http://example.com/x"),
        "93.184.216.34",
        { signal: controller.signal },
      ),
    ).rejects.toThrow();
  });
});

describe("readCappedStream", () => {
  function fakeStream(chunks: Uint8Array[]) {
    return {
      async *[Symbol.asyncIterator]() {
        for (const chunk of chunks) yield chunk;
      },
      destroy: vi.fn(),
    };
  }

  it("truncates at the cap and reports it", async () => {
    const chunks = [new Uint8Array(300).fill(1), new Uint8Array(300).fill(2)];
    const { bytes, truncated } = await readCappedStream(
      fakeStream(chunks),
      500,
    );

    expect(bytes.byteLength).toBe(500);
    expect(truncated).toBe(true);
    // The kept tail is the head of the second chunk, not the whole thing.
    expect(Array.from(bytes.subarray(300))).toEqual(
      new Array(200).fill(2) as number[],
    );
  });

  it("reads an exact-fit body without truncation", async () => {
    const { bytes, truncated } = await readCappedStream(
      fakeStream([new Uint8Array([1, 2, 3, 4])]),
      4,
    );

    expect(Array.from(bytes)).toEqual([1, 2, 3, 4]);
    expect(truncated).toBe(false);
  });

  it("returns an empty buffer for an empty stream", async () => {
    const { bytes, truncated } = await readCappedStream(fakeStream([]), 10);

    expect(bytes.byteLength).toBe(0);
    expect(truncated).toBe(false);
  });

  it("concatenates chunks below the cap in order", async () => {
    const { bytes, truncated } = await readCappedStream(
      fakeStream([
        new Uint8Array([1]),
        new Uint8Array([2, 3]),
        new Uint8Array([4, 5]),
      ]),
      10,
    );

    expect(Array.from(bytes)).toEqual([1, 2, 3, 4, 5]);
    expect(truncated).toBe(false);
  });
});
