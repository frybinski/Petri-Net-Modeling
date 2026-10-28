import type { Id } from './model';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
const ID_LENGTH = 11;

/**
 * Creates a URL-safe identifier from a cryptographically secure random source.
 * 11 characters of a 64-letter alphabet give 66 bits of entropy.
 */
export function createId(): Id {
  const bytes = new Uint8Array(ID_LENGTH);
  globalThis.crypto.getRandomValues(bytes);
  let id = '';
  for (const byte of bytes) {
    // 256 is a multiple of 64, so masking introduces no modulo bias.
    id += ALPHABET.charAt(byte & 63);
  }
  return id;
}
