// Creates the TanStack Router instance and its shared QueryClient. This
// function runs once per request on the server and once on the client, so
// the QueryClient (and its defaults below) genuinely is shared app-wide —
// there's exactly one cache, not one per route.
import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
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

  return router;
};
