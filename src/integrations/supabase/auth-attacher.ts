// Client-side middleware that attaches the signed-in user's access token to
// every `createServerFn` call, so `requireSupabaseAuth` (auth-middleware.ts)
// has something to verify on the other end. Registered once as a global
// `functionMiddleware` in `src/start.ts` — without that registration the
// browser builds server-fn requests with no Authorization header at all,
// and every one of them fails auth.
import { createMiddleware } from "@tanstack/react-start";

import { supabase } from "./client";

export const attachSupabaseAuth = createMiddleware({ type: "function" }).client(
  async ({ next }) => {
    // Reads the session Supabase already holds in localStorage; refreshes
    // the token first if it's expired. No token (signed out, or a call made
    // before the client ever established a session) just means the request
    // goes out with no Authorization header, and `requireSupabaseAuth`
    // rejects it — that's the correct outcome, not something to special-case
    // here.
    let token: string | undefined;
    try {
      const { data } = await supabase.auth.getSession();
      token = data.session?.access_token;
    } catch (error) {
      console.error("[Supabase] Failed to read session for outgoing request:", error);
    }

    return next({ headers: token ? { Authorization: `Bearer ${token}` } : {} });
  },
);
