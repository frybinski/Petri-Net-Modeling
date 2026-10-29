import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/** One account: `name:scrypt:<salt hex>:<hash hex>`. */
export interface BasicAccount {
  user: string;
  salt: Buffer;
  hash: Buffer;
}

const KEY_LENGTH = 32;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1 } as const;

function derive(password: string, salt: Buffer): Buffer {
  return scryptSync(password.normalize('NFKC'), salt, KEY_LENGTH, SCRYPT_OPTIONS);
}

/** The entry for `PNM_BASIC_AUTH` of a user and password. */
export function hashPassword(user: string, password: string): string {
  if (user === '' || user.includes(':') || user.includes(',')) {
    throw new Error('The user name must not be empty or contain ":" or ",".');
  }
  if (password === '') throw new Error('The password must not be empty.');
  const salt = randomBytes(16);
  return `${user}:scrypt:${salt.toString('hex')}:${derive(password, salt).toString('hex')}`;
}

/** Reads `PNM_BASIC_AUTH`: entries separated by commas. Throws an `Error` for a malformed one. */
export function parseAccounts(text: string): BasicAccount[] {
  const accounts: BasicAccount[] = [];
  for (const entry of text.split(',')) {
    const trimmed = entry.trim();
    if (trimmed === '') continue;
    const [user, scheme, salt, hash, ...extra] = trimmed.split(':');
    if (
      user === undefined ||
      user === '' ||
      scheme !== 'scrypt' ||
      salt === undefined ||
      hash === undefined ||
      extra.length > 0 ||
      !/^[0-9a-f]{32}$/i.test(salt) ||
      !/^[0-9a-f]{64}$/i.test(hash)
    ) {
      throw new Error(
        'each entry must look like user:scrypt:<salt>:<hash>; make one with "node server.js hash-password <user>"',
      );
    }
    accounts.push({ user, salt: Buffer.from(salt, 'hex'), hash: Buffer.from(hash, 'hex') });
  }
  return accounts;
}

export interface BasicAuth {
  /** True if the `Authorization` header holds a known user with the right password. */
  check(header: string | undefined): boolean;
  readonly enabled: boolean;
}

/** How long a verified header is remembered, so that scrypt does not run for every request. */
const REMEMBER_MS = 5 * 60 * 1000;
const REMEMBER_MAX = 256;

export function createBasicAuth(
  accounts: readonly BasicAccount[],
  now: () => number = Date.now,
): BasicAuth {
  const remembered = new Map<string, number>();
  // A user that does not exist takes as long as one that does, so the answer says nothing.
  const dummy = { salt: randomBytes(16), hash: randomBytes(KEY_LENGTH) };

  return {
    enabled: accounts.length > 0,
    check(header) {
      if (accounts.length === 0) return true;
      if (header === undefined || !/^basic\s+/i.test(header)) return false;
      const key = createHash('sha256').update(header).digest('hex');
      const until = remembered.get(key);
      if (until !== undefined && until > now()) return true;

      const encoded = header.replace(/^basic\s+/i, '').trim();
      const decoded = Buffer.from(encoded, 'base64').toString('utf8');
      const colon = decoded.indexOf(':');
      if (colon <= 0) return false;
      const user = decoded.slice(0, colon);
      const password = decoded.slice(colon + 1);
      const account = accounts.find((a) => a.user === user);
      const target = account ?? dummy;
      const matches = timingSafeEqual(derive(password, target.salt), target.hash);
      if (!matches || account === undefined) return false;
      if (remembered.size >= REMEMBER_MAX) remembered.clear();
      remembered.set(key, now() + REMEMBER_MS);
      return true;
    },
  };
}
