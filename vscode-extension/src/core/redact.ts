/**
 * Pure log-redaction helper (AC-SEC-07/08). `EgressGuard` already never logs
 * a header or a body (D10), so no secret ever reaches its logger by design —
 * this is defence in depth for every *other* place a message reaches the
 * Output Channel (pipeline errors, provider failures): any known secret
 * value is replaced before the message is ever appended.
 */

/** Replaces every occurrence of a known secret with a fixed placeholder. */
export function redactSecrets(text: string, secrets: readonly string[]): string {
  let result = text;
  for (const secret of secrets) {
    if (secret.length === 0) {
      continue;
    }
    result = result.split(secret).join("[REDACTED]");
  }
  return result;
}
