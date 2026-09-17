import type { IncomingMessage } from "node:http";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";

/**
 * What the capped reader needs from a response body: an async stream of
 * chunks that can be torn down early. `IncomingMessage` satisfies it, and so
 * does a test double, which keeps the reader testable without a socket.
 */
export interface CappedReadable extends AsyncIterable<Uint8Array> {
  destroy(): void;
}

/**
 * GETs `url` over a socket pinned to `address`, the address the caller
 * already vetted with `resolvePublicUrlAndAddress`. The custom `lookup`
 * never touches DNS, so nothing re-resolves between the check and the
 * connect: the rebinding window a check-then-`fetch` leaves open, where a
 * second DNS answer could steer the socket into private space, is closed.
 *
 * The original hostname survives the pin three ways: it stays the request's
 * `hostname`, so TLS SNI and certificate verification run against it, not
 * against the IP being dialled, and the `Host` header is set explicitly so
 * virtual-host routing is unaffected.
 *
 * @param url - The URL to fetch; its protocol picks http or https
 * @param address - The vetted IP literal to connect to, IPv4 or IPv6
 * @throws When the protocol is not http(s) or the request fails
 */
export function requestPinnedToVettedAddress(
  url: URL,
  address: string,
  options: { signal?: AbortSignal } = {},
): Promise<IncomingMessage> {
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return Promise.reject(new Error(`Unsupported URL scheme: ${url.protocol}`));
  }

  const isTls = url.protocol === "https:";
  const defaultPort = isTls ? 443 : 80;
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const port = url.port ? Number(url.port) : defaultPort;
  // An IPv6 host needs its brackets back in the Host header.
  const bracketed = isIP(hostname) === 6 ? `[${hostname}]` : hostname;
  const hostHeader = port === defaultPort ? bracketed : `${bracketed}:${port}`;

  const requestOptions: https.RequestOptions = {
    path: `${url.pathname}${url.search}`,
    method: "GET",
    hostname,
    port,
    // SNI and certificate verification follow the hostname, not the pinned
    // address, so a wrong-host certificate still fails the request.
    servername: isTls ? hostname : undefined,
    headers: { Host: hostHeader },
    // The pin itself: the socket connects to the vetted address and no
    // resolver is consulted, so the address checked is the address reached.
    // Node's Happy Eyeballs path (autoSelectFamily, on by default since
    // Node 20) asks the resolver with `all: true` and reads an array back,
    // so the pin answers in whichever shape the connect layer asked for —
    // one entry either way, the vetted address.
    lookup: (
      _hostname: string,
      lookupOptions: unknown,
      callback: (
        error: NodeJS.ErrnoException | null,
        addresses: string | { address: string; family: number }[],
        family?: number,
      ) => void,
    ) => {
      const family = isIP(address);
      if ((lookupOptions as { all?: boolean } | undefined)?.all) {
        callback(null, [{ address, family }]);
      } else {
        callback(null, address, family);
      }
    },
    signal: options.signal,
  };

  return new Promise<IncomingMessage>((resolve, reject) => {
    const request = isTls
      ? https.request(requestOptions, resolve)
      : http.request(requestOptions, resolve);
    request.on("error", reject);
    request.end();
  });
}

/**
 * Reads at most `maxBytes` from a Node response stream, the counterpart of
 * `readCappedBytes` for the `node:http` world: a hostile or merely huge
 * upstream must not be able to pin the server's memory, and a caller that
 * only needs the head of the body gains nothing from the tail. Breaking out
 * of the iteration destroys the stream, releasing the socket instead of
 * draining the rest.
 */
export async function readCappedStream(
  stream: CappedReadable,
  maxBytes: number,
): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  const chunks: Uint8Array[] = [];
  let bytesRead = 0;
  let truncated = false;

  for await (const chunk of stream) {
    const remaining = maxBytes - bytesRead;
    if (chunk.byteLength > remaining) {
      chunks.push(chunk.subarray(0, remaining));
      bytesRead = maxBytes;
      truncated = true;
      break;
    }
    chunks.push(chunk);
    bytesRead += chunk.byteLength;
  }

  const bytes = new Uint8Array(bytesRead);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, truncated };
}
