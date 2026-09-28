// Sign-up page — see sign-in.tsx's header comment for why this is a
// separate route rather than a mode toggle on one shared component.
//
// Two real edge cases this handles, both specific to sign-up (not sign-in),
// worth understanding before touching this file:
//  1. With email confirmation OFF (this project's current setting), signing
//     up with an email that's already registered comes back as a normal
//     error immediately — no masking. Showing the error and stopping there
//     isn't enough on its own: leaving the person on the sign-up form with
//     their *new* password still in the field, when what they need is
//     their *original* password, reads as "it says I have an account but I
//     can't log in". So this also switches them to a sign-in link and
//     clears the password field.
//  2. Supabase returns a *masked* success (no error, no session, an empty
//     `identities` array) for one specific case: someone who already has an
//     account via a different provider (e.g. Google) trying to sign up
//     again with email/password using the same address. That has to be
//     detected explicitly — it isn't shaped like an error.
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

export const Route = createFileRoute("/sign-up")({
  head: () => ({
    meta: [
      { title: "Create your account — Curated Trades" },
      { name: "description", content: "Start journaling your trades with Curated Trades." },
    ],
  }),
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => {
    if (typeof search["redirect"] !== "string") return {};
    return { redirect: sanitizeRedirect(search["redirect"]) };
  },
  component: SignUpPage,
});

function SignUpPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { status } = useAuth();
  const search = Route.useSearch();
  const target = search.redirect ?? "/app";

  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [redirectToSignIn, setRedirectToSignIn] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (status === "authed") void navigate({ to: target });
  }, [status, navigate, target]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;
    setError("");
    setNotice("");
    setRedirectToSignIn(false);
    setIsSubmitting(true);

    const { data, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { display_name: displayName.trim() } },
    });

    setIsSubmitting(false);

    if (signUpError) {
      const message = signUpError.message.toLowerCase();
      if (message.includes("already registered") || message.includes("already exists")) {
        setError("An account with this email already exists. Sign in below, or reset your password if you don't remember it.");
        setRedirectToSignIn(true);
        setPassword("");
        return;
      }
      setError(signUpError.message);
      return;
    }

    if (!data.session) {
      // Masked cross-provider case (see file header) vs. the ordinary
      // "check your email to confirm" case — both have no session, only the
      // masked one has an empty identities array.
      const alreadyRegistered = (data.user?.identities?.length ?? 0) === 0;
      if (alreadyRegistered) {
        setError('An account with this email already exists — try "Continue with Google" or reset your password.');
        setRedirectToSignIn(true);
        setPassword("");
        return;
      }
      setNotice("Check your email to confirm your account, then sign in.");
      setRedirectToSignIn(true);
      setPassword("");
      return;
    }

    void queryClient.prefetchQuery({ queryKey: ["workspace"], queryFn: () => getWorkspace() });
    void navigate({ to: target });
  }

  async function onGoogleSignUp() {
    if (isSubmitting) return;
    setError("");
    setIsSubmitting(true);
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}${target}` },
    });
    if (oauthError) {
      setError(oauthError.message);
      setIsSubmitting(false);
    }
  }

  return (
    <AuthPageShell title="Start journaling with intent">
      <Button
        type="button"
        variant="outline"
        className="mb-5 w-full"
        onClick={() => void onGoogleSignUp()}
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
          <label htmlFor="signup-name" className="field-label">
            Display name
          </label>
          <Input
            id="signup-name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="Izy Eberendu"
            autoComplete="name"
          />
        </div>
        <div>
          <label htmlFor="signup-email" className="field-label">
            Email
          </label>
          <Input
            id="signup-email"
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
          <label htmlFor="signup-password" className="field-label">
            Password
          </label>
          <Input
            id="signup-password"
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="••••••••"
            autoComplete="new-password"
          />
        </div>
        {error && (
          <div className="text-sm text-destructive">
            <p>{error}</p>
            {redirectToSignIn && (
              <Link
                to="/sign-in"
                search={search.redirect ? { redirect: search.redirect } : {}}
                className="mt-1 inline-block font-medium underline-offset-2 hover:underline"
              >
                Go to sign in
              </Link>
            )}
          </div>
        )}
        {notice && <p className="text-sm text-chart-2">{notice}</p>}
        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? "Please wait…" : "Create account"}
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          Already journaling?{" "}
          <Link to="/sign-in" className="font-semibold text-primary underline-offset-2 hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </AuthPageShell>
  );
}
