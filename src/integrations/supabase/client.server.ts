// Service-role Supabase client — bypasses RLS entirely. Server-only: this
// module must never be imported at the top level of anything that ships to
// the client bundle (a route file or a `*.functions.ts` module). The one
// legitimate consumer today (public-share.functions.ts) loads it with a
// dynamic `await import(...)` inside its handlers for exactly that reason;
// keep doing that rather than switching to a static import.
//
// Reach for this only when a request has no authenticated user to scope RLS
// to — a public share link is the only case in this app right now. Every
// authenticated read/write should go through `requireSupabaseAuth`'s
// per-request client instead, so RLS stays the actual enforcement layer.
import { createClient } from "@supabase/supabase-js";

import { createSupabaseFetch, requireServiceRoleSupabaseEnv } from "./env";
import type { Database } from "./types";

function createSupabaseAdminClient() {
  const { url, key } = requireServiceRoleSupabaseEnv();
  return createClient<Database>(url, key, {
    global: { fetch: createSupabaseFetch(key) },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

let cached: ReturnType<typeof createSupabaseAdminClient> | undefined;

/** SECURITY: server-only, and only for the unauthenticated-request case
 * described above. Load via `await import("@/integrations/supabase/client.server")`. */
export const supabaseAdmin = new Proxy({} as ReturnType<typeof createSupabaseAdminClient>, {
  get(_, prop, receiver) {
    if (!cached) cached = createSupabaseAdminClient();
    return Reflect.get(cached, prop, receiver);
  },
});
