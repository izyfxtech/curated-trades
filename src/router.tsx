// Creates the TanStack Router instance and its shared QueryClient. This
// function runs once per request on the server and once on the client, so
// the QueryClient (and its defaults below) genuinely is shared app-wide —
// there's exactly one cache, not one per route.
import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { sessionQueryOptions } from "@/lib/queries";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Default staleTime is 0, which means every mount AND every window
        // refocus refetches. The Journal page alone fires ~6 independent
        // queries — each one paying a real server round trip — every time
        // you tab back into the app. 30s is plenty fresh for a journal
        // you're manually updating, not a live ticker.
        staleTime: 30_000,
        // Default retry is 3 attempts with exponential backoff (~1s, 2s,
        // 4s). On a slow or flaky request that's up to ~7s of silent
        // retrying before any error shows — indistinguishable from a hang.
        // Fail fast instead; the person can hit "Try again".
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    // Start loading a route the moment the person hovers or focuses its
    // link — not on click. Combined with the /app loader below (which
    // primes the "workspace" query the same way), this is what actually
    // shortens the visible "Loading…" gate on in-app navigation: by the
    // time a click lands, the fetch has often already been running for the
    // however-long the cursor was on its way to the link.
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
  });

  // The one and only Supabase auth subscription in the app. It lives here —
  // not in a component — because this is the only place that holds both the
  // QueryClient (where the session is cached, see `sessionQueryOptions`) and
  // the router (whose `beforeLoad` guards decide who may see what). Every
  // sign-in, sign-out, token refresh and cross-tab auth change lands here, is
  // written into the query cache, and — when the signed-in/out state itself
  // changed — makes the router re-run its guards, which is what redirects
  // someone out of /app after signing out (or into it after signing in).
  // Browser only: a server render has no localStorage session to listen to.
  if (!import.meta.env.SSR) {
    supabase.auth.onAuthStateChange((event, session) => {
      queryClient.setQueryData(sessionQueryOptions.queryKey, session);
      if (event === "SIGNED_OUT") queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== "auth" });
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        // Supabase warns against calling back into its own client from inside
        // this callback (the auth lock is still held, so it can deadlock).
        // Re-running the guards triggers loaders that read the session, so
        // defer to after the callback returns.
        setTimeout(() => void router.invalidate(), 0);
      }
    });
  }

  return router;
};
