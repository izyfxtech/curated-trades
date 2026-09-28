// Browser Supabase client (anon/publishable key — every query it makes is
// subject to RLS). Lazily constructed behind a Proxy so importing this
// module has no side effects at load time: on the server, nothing here runs
// until a code path actually touches `supabase.*` (there shouldn't be one —
// see AGENTS.md's "server functions, not direct client calls" rule — but a
// stray import should never crash SSR just by existing), and in the browser
// it means env-var validation errors surface at first real use with a clear
// stack, not at module-evaluation time buried in a bundler's boot sequence.
import { createClient } from "@supabase/supabase-js";

import { createSupabaseFetch, requirePublicSupabaseEnv } from "./env";
import type { Database } from "./types";

function createSupabaseClient() {
  const { url, key } = requirePublicSupabaseEnv();
  return createClient<Database>(url, key, {
    global: { fetch: createSupabaseFetch(key) },
    auth: {
      // No `window` during SSR: fall back to Supabase's ephemeral in-memory
      // store so a server-rendered pass never touches (or throws on) a
      // browser-only API. The real session always lives in the browser.
      storage: typeof window === "undefined" ? undefined : window.localStorage,
      persistSession: true,
      autoRefreshToken: true,
    },
  });
}

let cached: ReturnType<typeof createSupabaseClient> | undefined;

/** Import as: `import { supabase } from "@/integrations/supabase/client";` */
export const supabase = new Proxy({} as ReturnType<typeof createSupabaseClient>, {
  get(_, prop, receiver) {
    if (!cached) cached = createSupabaseClient();
    return Reflect.get(cached, prop, receiver);
  },
});
