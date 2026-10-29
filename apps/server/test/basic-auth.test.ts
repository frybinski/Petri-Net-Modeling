import { describe, expect, it } from 'vitest';
import { createBasicAuth, hashPassword, parseAccounts } from '../src/basic-auth';

const header = (user: string, password: string): string =>
  `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;

describe('hashPassword and parseAccounts', () => {
  it('makes entries that parse back', () => {
    const entry = hashPassword('alice', 'pw-1');
    expect(entry).toMatch(/^alice:scrypt:[0-9a-f]{32}:[0-9a-f]{64}$/);
    const [account] = parseAccounts(entry);
    expect(account?.user).toBe('alice');
  });

  it('uses a new salt every time', () => {
    expect(hashPassword('alice', 'pw')).not.toBe(hashPassword('alice', 'pw'));
  });

  it('reads several accounts and ignores blanks', () => {
    const text = `${hashPassword('a', 'x')}, ,${hashPassword('b', 'y')}`;
    expect(parseAccounts(text).map((a) => a.user)).toEqual(['a', 'b']);
    expect(parseAccounts('')).toEqual([]);
  });

  it('rejects malformed entries and bad user names', () => {
    expect(() => parseAccounts('alice:plain')).toThrow(/user:scrypt/);
    expect(() => parseAccounts('alice:scrypt:zz:zz')).toThrow();
    expect(() => hashPassword('a:b', 'x')).toThrow();
    expect(() => hashPassword('', 'x')).toThrow();
    expect(() => hashPassword('a', '')).toThrow();
  });
});

describe('createBasicAuth', () => {
  const accounts = parseAccounts(
    `${hashPassword('alice', 'correct horse')},${hashPassword('bob', 'tr0ub4dor')}`,
  );

  it('lets everyone in when there are no accounts', () => {
    const auth = createBasicAuth([]);
    expect(auth.enabled).toBe(false);
    expect(auth.check(undefined)).toBe(true);
  });

  it('accepts the right password and refuses the wrong one', () => {
    const auth = createBasicAuth(accounts);
    expect(auth.enabled).toBe(true);
    expect(auth.check(header('alice', 'correct horse'))).toBe(true);
    expect(auth.check(header('bob', 'tr0ub4dor'))).toBe(true);
    expect(auth.check(header('alice', 'wrong'))).toBe(false);
    expect(auth.check(header('carol', 'correct horse'))).toBe(false);
    expect(auth.check(header('alice', ''))).toBe(false);
  });

  it('refuses missing and malformed headers', () => {
    const auth = createBasicAuth(accounts);
    expect(auth.check(undefined)).toBe(false);
    expect(auth.check('Bearer abc')).toBe(false);
    expect(auth.check('Basic')).toBe(false);
    expect(auth.check('Basic !!!')).toBe(false);
    expect(auth.check(`Basic ${Buffer.from('nocolon').toString('base64')}`)).toBe(false);
  });

  it('accepts a password with colons and unicode', () => {
    const entry = hashPassword('dora', 'pa:ss wörd');
    const auth = createBasicAuth(parseAccounts(entry));
    expect(auth.check(header('dora', 'pa:ss wörd'))).toBe(true);
  });

  it('keeps working after the memory of a verified header has run out', () => {
    let now = 1_000;
    const auth = createBasicAuth(accounts, () => now);
    const h = header('alice', 'correct horse');
    expect(auth.check(h)).toBe(true);
    expect(auth.check(h)).toBe(true);
    now += 6 * 60 * 1000;
    expect(auth.check(h)).toBe(true);
    expect(auth.check(header('alice', 'wrong'))).toBe(false);
  });

  it('does not remember a failure', () => {
    const auth = createBasicAuth(accounts);
    expect(auth.check(header('alice', 'nope'))).toBe(false);
    expect(auth.check(header('alice', 'nope'))).toBe(false);
  });
});
