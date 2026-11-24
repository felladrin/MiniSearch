import type { IncomingMessage } from "node:http";

const REQUEST_URL_BASE = "http://localhost";

// A hostname (letters, digits, dot, hyphen, underscore) or a bracketed IPv6
// literal, with an optional port.
const HOST_HEADER_PATTERN =
  /^(?:[A-Za-z0-9._-]+|\[[0-9A-Fa-f:.]+\])(?::(\d{1,5}))?$/;

function isValidHostHeader(host: string): boolean {
  const match = HOST_HEADER_PATTERN.exec(host);
  if (!match) return false;
  return match[1] === undefined || Number(match[1]) <= 65535;
}

/**
 * Parses the request target, or returns `null` for a request that should be
 * answered with a 400.
 *
 * The URL is parsed against a fixed base instead of the Host header: the
 * endpoint hooks read only `pathname` and `searchParams`, and a Host header such
 * as `bad host` makes `new URL(path, "http://bad host")` throw. Inside an async
 * middleware that throw is an unhandled rejection, and Node exits. A Host
 * header that is present but malformed is refused here, as RFC 9112 asks.
 */
export function parseRequestUrl(
  request: Pick<IncomingMessage, "url" | "headers">,
): URL | null {
  const host = request.headers.host;
  if (typeof host === "string" && host.length > 0 && !isValidHostHeader(host)) {
    return null;
  }

  try {
    return new URL(request.url ?? "/", REQUEST_URL_BASE);
  } catch {
    return null;
  }
}
