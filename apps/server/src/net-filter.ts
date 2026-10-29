import { BlockList, isIP } from 'node:net';

/** An address as the filter compares it: IPv4-mapped IPv6 (`::ffff:1.2.3.4`) becomes IPv4. */
export function normalizeAddress(address: string): string {
  const trimmed = address.trim();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(trimmed);
  const plain = mapped?.[1] ?? trimmed;
  // A zone id (`fe80::1%eth0`) does not belong to the address.
  return plain.replace(/%.*$/, '');
}

function familyOf(address: string): 'ipv4' | 'ipv6' | null {
  const kind = isIP(address);
  return kind === 4 ? 'ipv4' : kind === 6 ? 'ipv6' : null;
}

/** A list of networks (CIDR) or single addresses. */
export interface NetList {
  /** True if the address (IPv4 or IPv6, text form) is in one of the networks. */
  contains(address: string): boolean;
  readonly size: number;
}

/**
 * Reads `10.0.0.0/8, 192.168.1.5, fd00::/8`. Throws an `Error` that names the entry which is not a
 * network.
 */
export function parseNetList(entries: readonly string[]): NetList {
  const list = new BlockList();
  for (const entry of entries) {
    const [address = '', prefixText, ...extra] = entry.trim().split('/');
    const normalized = normalizeAddress(address);
    const family = familyOf(normalized);
    const max = family === 'ipv4' ? 32 : 128;
    const prefix = prefixText === undefined ? max : Number(prefixText);
    if (
      family === null ||
      extra.length > 0 ||
      (prefixText !== undefined && !/^\d+$/.test(prefixText)) ||
      !Number.isInteger(prefix) ||
      prefix < 0 ||
      prefix > max
    ) {
      throw new Error(`"${entry.trim()}" is not an address or a network like 10.0.0.0/8`);
    }
    if (prefix === max) list.addAddress(normalized, family);
    else list.addSubnet(normalized, prefix, family);
  }
  return {
    size: entries.length,
    contains(address) {
      const normalized = normalizeAddress(address);
      const family = familyOf(normalized);
      return family !== null && list.check(normalized, family);
    },
  };
}

/** The addresses of this machine; they always pass the filter (the health check of the container). */
const LOOPBACK = parseNetList(['127.0.0.0/8', '::1']);

export interface ClientAddress {
  /** The address of the client, or `null` if the forwarded header cannot be read. */
  address: string | null;
  /** The address of the socket peer. */
  peer: string;
  /** The address came from `X-Forwarded-For`. */
  forwarded: boolean;
}

/**
 * Finds the address of the client. `X-Forwarded-For` counts only if the peer is a trusted proxy;
 * then the list is read from the right, skipping trusted proxies, and the first address that is not
 * one is the client (a client cannot forge entries to the right of its own). A peer that is not
 * trusted is the client, whatever it sends.
 */
export function clientAddress(
  peerAddress: string | undefined,
  forwardedFor: string | undefined,
  trusted: NetList,
): ClientAddress {
  const peer = normalizeAddress(peerAddress ?? '');
  if (forwardedFor === undefined || forwardedFor.trim() === '' || !trusted.contains(peer)) {
    return { address: peer === '' ? null : peer, peer, forwarded: false };
  }
  const hops = forwardedFor
    .split(',')
    .map((hop) => normalizeAddress(hop))
    .filter((hop) => hop !== '');
  for (let i = hops.length - 1; i >= 0; i -= 1) {
    const hop = hops[i] ?? '';
    if (familyOf(hop) === null) return { address: null, peer, forwarded: true };
    if (!trusted.contains(hop)) return { address: hop, peer, forwarded: true };
  }
  // Every hop is a trusted proxy: the request started inside the proxy network.
  return { address: hops[0] ?? peer, peer, forwarded: true };
}

/** True if the client may use the server. Loopback always may; an unknown address never. */
export function isAllowed(client: ClientAddress, allowed: NetList): boolean {
  if (client.address === null) return false;
  return LOOPBACK.contains(client.address) || allowed.contains(client.address);
}
