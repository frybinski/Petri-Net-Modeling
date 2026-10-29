import { describe, expect, it } from 'vitest';
import { clientAddress, isAllowed, normalizeAddress, parseNetList } from '../src/net-filter';

const KIT = parseNetList(['129.13.0.0/16', '141.52.0.0/16', '10.0.0.0/8', 'fd00::/8']);
const PROXIES = parseNetList(['172.20.0.0/16']);
const NONE = parseNetList([]);

describe('parseNetList', () => {
  it('matches addresses in a network and single addresses', () => {
    const list = parseNetList(['10.1.0.0/16', '192.168.1.7']);
    expect(list.contains('10.1.200.3')).toBe(true);
    expect(list.contains('10.2.0.1')).toBe(false);
    expect(list.contains('192.168.1.7')).toBe(true);
    expect(list.contains('192.168.1.8')).toBe(false);
  });

  it('handles IPv6 and IPv4-mapped IPv6', () => {
    expect(KIT.contains('fd12:3456::1')).toBe(true);
    expect(KIT.contains('2001:db8::1')).toBe(false);
    expect(KIT.contains('::ffff:129.13.5.5')).toBe(true);
    expect(KIT.contains('::ffff:8.8.8.8')).toBe(false);
  });

  it('can be opened completely', () => {
    const all = parseNetList(['0.0.0.0/0', '::/0']);
    expect(all.contains('8.8.8.8')).toBe(true);
    expect(all.contains('2001:db8::1')).toBe(true);
  });

  it('rejects entries that are not networks', () => {
    for (const bad of [
      'banana',
      '10.0.0.0/33',
      '10.0.0.0/-1',
      '10.0.0/8',
      '1.2.3.4/8/9',
      '::1/129',
    ]) {
      expect(() => parseNetList([bad]), bad).toThrow(/is not an address or a network/);
    }
  });

  it('does not match garbage', () => {
    expect(KIT.contains('')).toBe(false);
    expect(KIT.contains('not-an-ip')).toBe(false);
  });
});

describe('normalizeAddress', () => {
  it('unwraps IPv4-mapped addresses and drops zone ids', () => {
    expect(normalizeAddress('::ffff:10.0.0.1')).toBe('10.0.0.1');
    expect(normalizeAddress('fe80::1%eth0')).toBe('fe80::1');
    expect(normalizeAddress(' 10.0.0.1 ')).toBe('10.0.0.1');
  });
});

describe('clientAddress', () => {
  it('uses the peer when nobody is trusted, whatever X-Forwarded-For says', () => {
    const client = clientAddress('203.0.113.9', '129.13.1.1', NONE);
    expect(client).toMatchObject({ address: '203.0.113.9', forwarded: false });
    expect(isAllowed(client, KIT)).toBe(false);
  });

  it('ignores X-Forwarded-For from a peer that is not a trusted proxy', () => {
    const client = clientAddress('203.0.113.9', '129.13.1.1', PROXIES);
    expect(client.address).toBe('203.0.113.9');
    expect(isAllowed(client, KIT)).toBe(false);
  });

  it('reads X-Forwarded-For from a trusted proxy', () => {
    const inside = clientAddress('172.20.0.2', '129.13.1.1', PROXIES);
    expect(inside).toMatchObject({ address: '129.13.1.1', forwarded: true });
    expect(isAllowed(inside, KIT)).toBe(true);
    const outside = clientAddress('172.20.0.2', '203.0.113.9', PROXIES);
    expect(isAllowed(outside, KIT)).toBe(false);
  });

  it('takes the rightmost address that is not a proxy, so a forged left part does not count', () => {
    const forged = clientAddress('172.20.0.2', '129.13.1.1, 203.0.113.9', PROXIES);
    expect(forged.address).toBe('203.0.113.9');
    expect(isAllowed(forged, KIT)).toBe(false);
    const chain = clientAddress('172.20.0.2', '203.0.113.9, 129.13.1.1, 172.20.0.5', PROXIES);
    expect(chain.address).toBe('129.13.1.1');
  });

  it('refuses a header that cannot be read', () => {
    const client = clientAddress('172.20.0.2', 'garbage', PROXIES);
    expect(client.address).toBeNull();
    expect(isAllowed(client, KIT)).toBe(false);
  });

  it('takes the first hop when every hop is a proxy', () => {
    expect(clientAddress('172.20.0.2', '172.20.0.9, 172.20.0.5', PROXIES).address).toBe(
      '172.20.0.9',
    );
  });

  it('knows IPv4-mapped peers', () => {
    expect(clientAddress('::ffff:129.13.0.7', undefined, NONE).address).toBe('129.13.0.7');
  });
});

describe('isAllowed', () => {
  it('lets the machine itself in, for the health check of the container', () => {
    expect(isAllowed(clientAddress('127.0.0.1', undefined, NONE), KIT)).toBe(true);
    expect(isAllowed(clientAddress('::1', undefined, NONE), KIT)).toBe(true);
    expect(isAllowed(clientAddress('::ffff:127.0.0.1', undefined, NONE), KIT)).toBe(true);
  });

  it('does not let a forwarded loopback address in', () => {
    // The proxy appends the real client, so the loopback entry is to the left of it.
    const client = clientAddress('172.20.0.2', '127.0.0.1, 203.0.113.9', PROXIES);
    expect(isAllowed(client, KIT)).toBe(false);
  });

  it('refuses an unknown peer', () => {
    expect(isAllowed(clientAddress(undefined, undefined, NONE), KIT)).toBe(false);
  });
});
