// Sign-in page. Split out from what used to be a single combined
// sign-in/sign-up component — two flows sharing one pile of `error`/
// `notice`/`unconfirmedEmail` state made it easy for a message meant for one
// mode to leak into the other when someone toggled between them. Separate
// routes means separate state by construction, a bookmarkable/shareable
// `/sign-up` URL, and sign-up's account-already-exists handling (see that
// file) doesn't have to live here at all.
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";

import { AuthPageShell } from "@/components/auth/AuthPageShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth/session-context";
import { sanitizeRedirect } from "@/lib/auth/redirect";
import { getWorkspace } from "@/lib/portfolios.functions";

export const Route = createFileRoute("/sign-in")({
  head: () => ({
    meta: [
      { title: "Sign in — Curated Trades" },
      { name: "description", content: "Sign in to your Curated Trades journal." },
    ],
  }),
  // `redirect` stays genuinely optional (undefined, not defaulted) so a
  // plain visit to /sign-in doesn't trigger a search-param canonicalization
  // redirect on load.
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => {
    if (typeof search["redirect"] !== "string") return {};
    return { redirect: sanitizeRedirect(search["redirect"]) };
  },
  component: SignInPage,
});

function SignInPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { status } = useAuth();
  const search = Route.useSearch();
  const target = search.redirect ?? "/app";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [unconfirmedEmail, setUnconfirmedEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Already signed in (back button, a stale tab, a link opened twice) — the
  // shared AuthProvider already knows this without a fresh network call.
  useEffect(() => {
    if (status === "authed") void navigate({ to: target });
  }, [status, navigate, target]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Explicit re-entry guard rather than relying on the submit button's
    // `disabled` attribute alone — a fast double click/tap can fire this
    // handler twice before React commits the disabled state to the DOM.
    if (isSubmitting) return;
    setError("");
    setNotice("");
    setUnconfirmedEmail("");
    setIsSubmitting(true);

    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    setIsSubmitting(false);

    if (signInError) {
      if (signInError.message.toLowerCase().includes("email not confirmed")) {
        setError("Your email hasn't been confirmed yet.");
        setUnconfirmedEmail(email.trim());
        return;
      }
      setError(signInError.message);
      return;
    }

    if (!data.session) {
      setError("Something went wrong signing you in. Please try again.");
      return;
    }

    // Fire the workspace fetch now, in parallel with the route transition,
    // instead of waiting for /app to mount and request it: that's the
    // difference between "sign-in round trip, then a second, separate
    // workspace round trip" and "both in flight together". Deliberately not
    // awaited — the point is to overlap it with navigation, not delay it.
    void queryClient.prefetchQuery({ queryKey: ["workspace"], queryFn: () => getWorkspace() });
    void navigate({ to: target });
  }

  async function onResendConfirmation() {
    if (!unconfirmedEmail) return;
    setError("");
    setNotice("");
    const { error: resendError } = await supabase.auth.resend({ type: "signup", email: unconfirmedEmail });
    if (resendError) {
      setError(resendError.message);
      return;
    }
    setNotice("Confirmation email resent — check your inbox.");
  }

  async function onGoogleSignIn() {
    if (isSubmitting) return;
    setError("");
    setIsSubmitting(true);
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}${target}` },
    });
    // On success the browser navigates away to Google immediately, so
    // there's no "success" branch here — only reset submitting state on
    // failure.
    if (oauthError) {
      setError(oauthError.message);
      setIsSubmitting(false);
    }
  }

  return (
    <AuthPageShell title="Sign in to your journal">
      <Button
        type="button"
        variant="outline"
        className="mb-5 w-full"
        onClick={() => void onGoogleSignIn()}
        disabled={isSubmitting}
      >
        Continue with Google
      </Button>
      <div className="mb-5 flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        or use email
        <span className="h-px flex-1 bg-border" />
      </div>

      <form onSubmit={onSubmit} className="space-y-5">
        <div>
          <label htmlFor="signin-email" className="field-label">
            Email
          </label>
          <Input
            id="signin-email"
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@email.com"
            autoComplete="email"
            autoFocus
          />
        </div>
        <div>
          <div className="flex items-center justify-between">
            <label htmlFor="signin-password" className="field-label mb-0">
              Password
            </label>
            <Link to="/reset-password" className="text-xs text-muted-foreground hover:text-foreground">
              Forgot password?
            </Link>
          </div>
          <Input
            id="signin-password"
            type="password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
          />
        </div>
        {error && (
          <div className="text-sm text-destructive">
            <p>{error}</p>
            {unconfirmedEmail && (
              <button
                type="button"
                className="mt-1 font-medium underline-offset-2 hover:underline"
                onClick={() => void onResendConfirmation()}
              >
                Resend confirmation email
              </button>
            )}
          </div>
        )}
        {notice && <p className="text-sm text-chart-2">{notice}</p>}
        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? "Please wait…" : "Sign in"}
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          New to Curated Trades?{" "}
          <Link to="/sign-up" className="font-semibold text-primary underline-offset-2 hover:underline">
            Create an account
          </Link>
        </p>
      </form>
    </AuthPageShell>
  );
}
