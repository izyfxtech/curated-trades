// Server-side auth verification for every `createServerFn`. This is the
// actual security boundary for this app — every server function that
// touches user data adds `requireSupabaseAuth` to its `.middleware([...])`
// list (see AGENTS.md and profile.functions.ts's header comment). A route's
// client-side redirect-if-signed-out check is UX only; this is enforcement.
//
// What it does, in order: pull the bearer token off the request, verify its
// signature locally against Supabase's JWKS (no round trip to Supabase's
// auth server on the common path — see `getVerifier()` below for why that
// matters), then hand the handler a Postgres client that carries the
// caller's own token, so RLS policies see the real `auth.uid()`.
import { createClient } from "@supabase/supabase-js";
import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import { createSupabaseFetch, requireServerPublicSupabaseEnv } from "./env";
import type { Database } from "./types";

class UnauthorizedError extends Error {
  constructor(reason: string) {
    super(`Unauthorized: ${reason}`);
    this.name = "UnauthorizedError";
  }
}

/** Pulls a `Bearer <jwt>` token out of the request's Authorization header,
 * with a specific, actionable failure for each way it can be malformed —
 * these show up directly in server logs when something upstream (a proxy
 * stripping headers, a stale client build) breaks token delivery. */
function extractBearerToken(): string {
  const headers = getRequest()?.headers;
  if (!headers) throw new UnauthorizedError("no request headers available");

  const authHeader = headers.get("authorization");
  if (!authHeader) throw new UnauthorizedError("no authorization header provided");
  if (!authHeader.startsWith("Bearer ")) throw new UnauthorizedError("only Bearer tokens are supported");

  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) throw new UnauthorizedError("no token provided");
  if (token.split(".").length !== 3) throw new UnauthorizedError("malformed token");
  return token;
}

// A single, process-wide client used ONLY to verify JWTs (`getClaims`) —
// safe to share across every request/user because `getClaims` takes the
// token as an argument instead of reading it from client-held session
// state; it's a pure verifier, not a per-user session holder.
//
// This project's publishable key is the new `sb_publishable_...` format,
// which implies asymmetric JWT signing: Supabase's SDK verifies tokens
// locally via WebCrypto against a JWKS document it fetches once and caches
// in memory on the GoTrueClient instance. That cache is what makes
// `getClaims` fast and free of network I/O on the common path — but only if
// the *same* client instance is reused. Building a fresh client inside this
// middleware on every call (the naive way to write this) creates a new,
// empty JWKS cache every time, turning a local signature check into a real
// network round trip to Supabase's `/.well-known/jwks.json` on every single
// server function call in the app. One shared client means that fetch
// happens once per process (and again only when the cache expires, on the
// order of minutes), not once per request.
let verifier: ReturnType<typeof createClient<Database>> | undefined;
function getVerifier() {
  if (!verifier) {
    const { url, key } = requireServerPublicSupabaseEnv();
    verifier = createClient<Database>(url, key, {
      global: { fetch: createSupabaseFetch(key) },
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    });
  }
  return verifier;
}

export const requireSupabaseAuth = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    const token = extractBearerToken();

    const { data, error } = await getVerifier().auth.getClaims(token);
    if (error || !data?.claims) throw new UnauthorizedError("invalid or expired token");
    if (!data.claims.sub) throw new UnauthorizedError("token has no user id");

    // Unlike the verifier above, this client genuinely must be built fresh
    // per request: it carries this specific caller's token so every
    // Postgres RLS policy the handler's queries hit sees the right
    // `auth.uid()`. Constructing it is cheap (no I/O) — the expensive part
    // was always the verification above, which is now handled separately.
    const { url, key } = requireServerPublicSupabaseEnv();
    const supabase = createClient<Database>(url, key, {
      global: {
        fetch: createSupabaseFetch(key),
        headers: { Authorization: `Bearer ${token}` },
      },
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    });

    return next({
      context: { supabase, userId: data.claims.sub, claims: data.claims },
    });
  },
);
