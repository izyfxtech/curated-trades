// The single source of truth for "is anyone signed in, and who" on the
// client. Before this existed, four different places each ran their own
// copy of `supabase.auth.getSession()` + `onAuthStateChange` and kept their
// own local status flag: the landing page, the sign-in page, the
// authenticated layout, and the onboarding page. Four independent
// implementations of the same check is how you get inconsistent behavior
// for free — e.g. one tab signs out, and whichever of those four
// implementations happens to be mounted reacts on its own schedule, with no
// shared state to keep them in sync. `AuthProvider` mounts once at the root
// and does this exactly once for the whole app; everything else reads it
// through `useAuth()`.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";

export type AuthStatus = "loading" | "authed" | "anon";

interface AuthContextValue {
  status: AuthStatus;
  session: Session | null;
  userId: string | null;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  // `undefined` (not yet checked) vs `null` (checked, signed out) — collapsed
  // into the public "loading" status below, but kept distinct internally so
  // a signed-out flash can't be mistaken for "still checking".
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (mounted) setSession(data.session);
    });

    // Fires on every sign-in, sign-out, and token refresh — including ones
    // triggered by another tab, since Supabase's client broadcasts auth
    // changes across tabs via a storage event. This is the one and only
    // subscription for the whole app's lifetime.
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (mounted) setSession(nextSession);
    });

    return () => {
      mounted = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status: session === undefined ? "loading" : session ? "authed" : "anon",
      session: session ?? null,
      userId: session?.user.id ?? null,
    }),
    [session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Read the app's single auth state. Must be called under `<AuthProvider>`
 * (mounted once in `__root.tsx`) — throws otherwise so a missing provider
 * fails loudly at the call site instead of silently returning stale data. */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth() must be used within <AuthProvider>");
  return context;
}
