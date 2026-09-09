/**
 * Pure log-redaction helper (AC-SEC-07/08). `EgressGuard` already never logs
 * a header or a body (D10), so no secret ever reaches its logger by design —
 * this is defence in depth for every *other* place a message reaches the
 * Output Channel (pipeline errors, provider failures): any known secret
 * value is replaced before the message is ever appended.
 */

/** What every redaction in this module substitutes in. */
export const PLACEHOLDER = "[REDACTED]";

/** Replaces every occurrence of a known secret with a fixed placeholder. */
export function redactSecrets(text: string, secrets: readonly string[]): string {
  let result = text;
  for (const secret of secrets) {
    if (secret.length === 0) {
      continue;
    }
    result = result.split(secret).join(PLACEHOLDER);
  }
  return result;
}

/**
 * Shapes that are almost certainly a secret, redacted even when the value
 * was never registered with `Logger.trackSecret` (S6.1 audit F-08).
 *
 * `trackSecret` only knows keys the user typed into `Set Provider API Key`.
 * A key that arrives another way — inside a `baseUrl`'s userinfo segment, in
 * an `Authorization` header echoed back by a provider's error body, in the
 * message of an exception nobody caught — is invisible to it. These
 * patterns close that gap by shape rather than by value.
 *
 * Each entry replaces only the *secret* part of the match, keeping enough
 * context for the line to stay diagnosable ("Bearer [REDACTED]", not
 * "[REDACTED]").
 */
const SECRET_PATTERNS: readonly { pattern: RegExp; replace: (match: string, ...groups: string[]) => string }[] = [
  // `scheme://user:secret@host` and `scheme://secret@host` — the userinfo
  // segment of a URL, in full.
  {
    pattern: /\b([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+(?::[^/\s@]*)?@/gi,
    replace: (_match, scheme) => `${scheme}${PLACEHOLDER}@`
  },
  // `Authorization: Bearer <token>` / `Basic <token>` / a bare `Bearer x`.
  {
    pattern: /\b(bearer|basic|token)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
    replace: (_match, scheme) => `${scheme} ${PLACEHOLDER}`
  },
  // `api_key=…`, `apiKey: …`, `access_token=…`, `x-api-key: …` in a query
  // string, a header dump or a JSON fragment.
  {
    pattern: /\b((?:x-)?api[-_]?key|access[-_]?token|auth[-_]?token|secret)(\s*[=:]\s*"?)[A-Za-z0-9._~+/=-]{8,}"?/gi,
    replace: (_match, name, separator) => `${name}${separator}${PLACEHOLDER}`
  },
  // Vendor-prefixed keys that are recognisable on their own.
  {
    pattern: /\b(sk|pk|rk)-[A-Za-z0-9_-]{16,}/g,
    replace: () => PLACEHOLDER
  }
];

/**
 * Redacts by shape. Applied *after* `redactSecrets` so a known value is
 * already gone by the time these patterns run, and applied to the whole
 * formatted line (message included), not just to structured fields.
 */
export function redactSecretPatterns(text: string): string {
  let result = text;
  for (const { pattern, replace } of SECRET_PATTERNS) {
    result = result.replace(pattern, (match, ...groups) => replace(match, ...(groups as string[])));
  }
  return result;
}
