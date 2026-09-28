// Shared Supabase connection helpers. The three Supabase clients in this
// folder (browser, service-role/admin, and the request-verification client
// in auth-middleware.ts) all need the same three things: read the right env
// vars for their context, fail loudly and specifically if one is missing,
// and patch outgoing requests so the "new-style" opaque Supabase API keys
// (sb_publishable_... / sb_secret_...) don't get sent as a bearer token.
//
// Previously each of those three files defined its own copy of this logic.
// That's a real hazard, not just repetition: a fix or behavior change made
// in one copy (e.g. the API-key-detection rule, or the error message shape)
// silently doesn't apply to the other two unless someone remembers to hunt
// down every copy — the kind of drift that produces "it works in one place
// but not another" bugs that are hard to trace back to a cause. One
// implementation, imported everywhere, means there's only one place left to
// get it right.

/** New-style Supabase API keys are opaque strings, not bearer JWTs, and must
 * never be sent as `Authorization: Bearer <key>` — only as the `apikey`
 * header. Legacy JWT-shaped keys (anon/service_role) are fine either way. */
export function isOpaqueSupabaseApiKey(value: string): boolean {
  return value.startsWith("sb_publishable_") || value.startsWith("sb_secret_");
}

/** Wraps `fetch` so every outgoing Supabase request carries the right
 * `apikey` header and never leaks an opaque key into `Authorization`. */
export function createSupabaseFetch(supabaseKey: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
    );
    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    }
    if (isOpaqueSupabaseApiKey(supabaseKey) && headers.get("Authorization") === `Bearer ${supabaseKey}`) {
      headers.delete("Authorization");
    }
    headers.set("apikey", supabaseKey);
    return fetch(input, { ...init, headers });
  };
}

class MissingSupabaseEnvError extends Error {
  constructor(missing: string[]) {
    super(`Missing Supabase environment variable(s): ${missing.join(", ")}. Set them in your .env file.`);
    this.name = "MissingSupabaseEnvError";
  }
}

function readEnv(names: readonly [string, string], label: string, values: readonly [string | undefined, string | undefined]) {
  const [urlName, keyName] = names;
  const [url, key] = values;
  if (!url || !key) {
    const missing = [...(!url ? [urlName] : []), ...(!key ? [keyName] : [])];
    const error = new MissingSupabaseEnvError(missing);
    console.error(`[Supabase:${label}] ${error.message}`);
    throw error;
  }
  return { url, key };
}

/** Public URL + publishable key, resolved for the browser bundle (Vite
 * inlines `import.meta.env` at build time) with a `process.env` fallback for
 * the initial server-rendered pass of a universal component. */
export function requirePublicSupabaseEnv() {
  const url = import.meta.env["VITE_SUPABASE_URL"] || process.env["SUPABASE_URL"];
  const key = import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] || process.env["SUPABASE_PUBLISHABLE_KEY"];
  return readEnv(["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY"], "public", [url, key]);
}

/** Server-only publishable key lookup (no `import.meta.env` fallback) for
 * code that only ever runs on the server, e.g. the JWT-verification client. */
export function requireServerPublicSupabaseEnv() {
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  return readEnv(["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY"], "server", [url, key]);
}

/** Service-role key — bypasses RLS. Server-only, never bundled to the client. */
export function requireServiceRoleSupabaseEnv() {
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  return readEnv(["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"], "admin", [url, key]);
}
