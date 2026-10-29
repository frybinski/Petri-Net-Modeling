import { createHash } from 'node:crypto';
import type { ServerResponse } from 'node:http';

/**
 * The inline scripts of a page, as CSP hashes (`'sha256-…'`). The page `index.html` of the app has
 * one small script that sets the theme before the first paint; hashing it lets the policy stay free
 * of `'unsafe-inline'` for scripts.
 */
export function inlineScriptHashes(html: string): string[] {
  const hashes: string[] = [];
  const scripts = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(scripts)) {
    const body = match[1] ?? '';
    if (body.trim() === '') continue;
    hashes.push(`'sha256-${createHash('sha256').update(body).digest('base64')}'`);
  }
  return hashes;
}

/**
 * The content security policy. Everything comes from the server's own origin; the app runs its
 * simulation in a worker (`worker-src`) and creates object URLs for downloads and images
 * (`blob:`). `'unsafe-eval'` is needed because Ajv (JSON Schema for the token types) compiles its
 * validators with `new Function`; nothing in the page builds code from user text otherwise.
 */
export function contentSecurityPolicy(scriptHashes: readonly string[] = []): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-eval' ${scriptHashes.join(' ')}`.trim(),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/** Headers for every answer. */
export function applySecurityHeaders(res: ServerResponse, csp: string): void {
  res.setHeader('Content-Security-Policy', csp);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
}
