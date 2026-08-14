import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Address blocks a server-side fetch of a client-supplied URL must never
 * reach: loopback, link-local (which includes the cloud metadata endpoint at
 * 169.254.169.254), private and carrier-grade-NAT ranges, multicast and
 * reserved space. IPv4 blocks are matched in their IPv4-mapped IPv6 form, so
 * one table covers both families.
 */
const BLOCKED_CIDRS = [
  // Covers the unspecified address, ::1, and IPv4-compatible addresses such as
  // ::127.0.0.1, which are another spelling of an IPv4 destination.
  "::/96",
  // NAT64, 6to4 and Teredo embed an IPv4 address that this guard cannot vet,
  // so the whole prefix is refused rather than trusted.
  "64:ff9b::/96",
  "2002::/16",
  "2001::/32",
  "fc00::/7",
  "fec0::/10",
  "fe80::/10",
  "ff00::/8",
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.0.0.0/24",
  "192.168.0.0/16",
  "198.18.0.0/15",
  "224.0.0.0/4",
  "240.0.0.0/4",
];

const IPV4_MAPPED_PREFIX = 0xffffn << 32n;
const ADDRESS_BITS = 128n;

function parseIpv4(address: string): bigint | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;

  let value = 0n;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = (value << 8n) | BigInt(octet);
  }
  return value;
}

function parseIpv6(address: string): bigint | null {
  const sides = address.split("::");
  if (sides.length > 2) return null;

  const toGroups = (side: string): string[] | null => {
    if (side.length === 0) return [];
    const groups: string[] = [];
    for (const piece of side.split(":")) {
      // A trailing dotted-quad ("::ffff:127.0.0.1") stands for two groups.
      if (piece.includes(".")) {
        const embedded = parseIpv4(piece);
        if (embedded === null) return null;
        groups.push(
          ((embedded >> 16n) & 0xffffn).toString(16),
          (embedded & 0xffffn).toString(16),
        );
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/i.test(piece)) return null;
      groups.push(piece);
    }
    return groups;
  };

  const head = toGroups(sides[0]);
  const tail = sides.length === 2 ? toGroups(sides[1]) : [];
  if (head === null || tail === null) return null;

  const missing = 8 - head.length - tail.length;
  if (sides.length === 1 ? missing !== 0 : missing < 0) return null;

  let value = 0n;
  for (const group of [...head, ...Array(missing).fill("0"), ...tail]) {
    value = (value << 16n) | BigInt(Number.parseInt(group, 16));
  }
  return value;
}

function parseAddress(address: string): bigint | null {
  switch (isIP(address)) {
    case 4: {
      const value = parseIpv4(address);
      return value === null ? null : IPV4_MAPPED_PREFIX | value;
    }
    case 6:
      return parseIpv6(address);
    default:
      return null;
  }
}

const BLOCKED_RANGES = BLOCKED_CIDRS.map((cidr) => {
  const [address, prefix] = cidr.split("/");
  const base = parseAddress(address);
  if (base === null) throw new Error(`Malformed blocked CIDR: ${cidr}`);

  const bits = BigInt(Number(prefix)) + (isIP(address) === 4 ? 96n : 0n);
  const mask = ((1n << bits) - 1n) << (ADDRESS_BITS - bits);
  return { base: base & mask, mask };
});

/**
 * Whether an IP literal falls inside a range MiniSearch refuses to fetch from.
 * Addresses that fail to parse are treated as blocked, since an address the
 * guard cannot reason about is not one it can clear.
 */
export function isBlockedAddress(address: string): boolean {
  const value = parseAddress(address);
  if (value === null) return true;
  return BLOCKED_RANGES.some(({ base, mask }) => (value & mask) === base);
}

/**
 * Validates a URL that the server is about to fetch on a client's behalf,
 * rejecting non-HTTP schemes and hosts that resolve into a blocked range.
 *
 * The DNS answer is checked, not pinned: a name that resolves to a public
 * address here and to a private one microseconds later during the fetch would
 * still get through, and returning the extracted text is what would carry the
 * result back, so this is a real gap rather than one the response shape closes.
 * Pinning means connecting to the vetted IP with the hostname preserved for TLS,
 * which needs a custom `undici` dispatcher this project has no other use for.
 * The residual risk is up to one GET per redirect hop from inside the instance's
 * network, and the readable text of whatever those GETs return.
 *
 * @param rawUrl - The URL to validate
 * @returns The parsed URL when it is safe to fetch
 * @throws When the scheme is unsupported or the host resolves into a blocked range
 */
export async function resolvePublicUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Malformed URL: ${rawUrl}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Unsupported URL scheme: ${url.protocol}`);
  }

  // URL keeps IPv6 literals bracketed; isIP does not accept the brackets.
  const hostname = url.hostname.replace(/^\[|\]$/g, "");

  if (isIP(hostname)) {
    if (isBlockedAddress(hostname)) {
      throw new Error(`Refusing to fetch a non-public address: ${hostname}`);
    }
    return url;
  }

  const addresses = await lookup(hostname, { all: true });
  if (addresses.length === 0) {
    throw new Error(`Could not resolve host: ${hostname}`);
  }

  const blocked = addresses.find(({ address }) => isBlockedAddress(address));
  if (blocked) {
    throw new Error(
      `Refusing to fetch ${hostname}: it resolves to the non-public address ${blocked.address}`,
    );
  }

  return url;
}
