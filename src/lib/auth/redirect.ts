// Shared "where do we send someone after auth" helper. Used by every route
// that accepts a `?redirect=` param (sign-in, sign-up) so the open-redirect
// protection lives in exactly one place instead of being re-implemented
// (and potentially re-broken) per route.
export const DEFAULT_AUTH_REDIRECT = "/app";

/** Only ever returns a same-origin, absolute path. Rejects anything that
 * isn't a string, doesn't start with a single `/` (protocol-relative URLs
 * like `//evil.com` start with two), or otherwise doesn't look like a plain
 * in-app path — the standard defense against an attacker crafting a sign-in
 * link that looks legitimate but redirects to an external site post-login. */
export function sanitizeRedirect(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_AUTH_REDIRECT;
  if (!value.startsWith("/") || value.startsWith("//")) return DEFAULT_AUTH_REDIRECT;
  return value;
}
