// Sign-in page. Split out from what used to be a single combined
// sign-in/sign-up component — two flows sharing one pile of `error`/
// `notice`/`unconfirmedEmail` state made it easy for a message meant for one
// mode to leak into the other when someone toggled between them. Separate
// routes means separate state by construction, a bookmarkable/shareable
// `/sign-up` URL, and sign-up's account-already-exists handling (see that
// file) doesn't have to live here at all.
//
// Built on TanStack: Form owns the field state and zod validation, Query's
// `useMutation` owns the in-flight/error state of each Supabase call (so
// there are no hand-written `error` / `isSubmitting` flags), and the Router
// owns the "already signed in? go to the app" check in `beforeLoad`.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { toast } from "sonner";
import { z } from "zod";

import { AuthPageShell } from "@/components/auth/AuthPageShell";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { authSearchSchema } from "@/lib/auth/redirect";
import { formProps, useAppForm } from "@/lib/form";
import { sessionQueryOptions, workspaceQueryOptions } from "@/lib/queries";

export const Route = createFileRoute("/sign-in")({
  head: () => ({
    meta: [
      { title: "Sign in — Curated Trades" },
      { name: "description", content: "Sign in to your Curated Trades journal." },
    ],
  }),
  validateSearch: authSearchSchema,
  // The session lives in browser localStorage, so the "already signed in?"
  // check can only be answered on the client — render this route client-side.
  ssr: false,
  // Already signed in (back button, a stale tab, a link opened twice): skip
  // the form entirely. Replaces a mount-time useEffect + navigate.
  beforeLoad: async ({ context, search }) => {
    const session = await context.queryClient.ensureQueryData(sessionQueryOptions);
    if (session) throw redirect({ href: search.redirect ?? "/app" });
  },
  component: SignInPage,
});

const signInSchema = z.object({
  email: z.string().trim().pipe(z.email("Enter a valid email address.")),
  password: z.string().min(1, "Enter your password."),
});

function SignInPage() {
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();
  const search = Route.useSearch();
  const target = search.redirect ?? "/app";

  const signIn = useMutation({
    mutationFn: async (values: z.infer<typeof signInSchema>) => {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: values.email.trim(),
        password: values.password,
      });
      if (error) throw error;
      if (!data.session) throw new Error("Something went wrong signing you in. Please try again.");
    },
    onSuccess: () => {
      // Fire the workspace fetch now, in parallel with the route transition,
      // instead of waiting for /app to mount and request it: that's the
      // difference between "sign-in round trip, then a second, separate
      // workspace round trip" and "both in flight together". Deliberately not
      // awaited — the point is to overlap it with navigation, not delay it.
      void queryClient.prefetchQuery(workspaceQueryOptions);
      void navigate({ to: target });
    },
  });

  const google = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}${target}` },
      });
      if (error) throw error;
      // On success the browser navigates away to Google immediately.
    },
  });

  const resend = useMutation({
    mutationFn: async (email: string) => {
      const { error } = await supabase.auth.resend({ type: "signup", email });
      if (error) throw error;
    },
    onSuccess: () => toast.success("Confirmation email resent — check your inbox."),
    onError: (error) => toast.error(error.message),
  });

  const form = useAppForm({
    defaultValues: { email: "", password: "" },
    validators: { onSubmit: signInSchema },
    onSubmit: ({ value }) => signIn.mutate(value),
  });

  const error = signIn.error ?? google.error;
  const isUnconfirmed = signIn.error?.message.toLowerCase().includes("email not confirmed") ?? false;
  const errorMessage = isUnconfirmed ? "Your email hasn't been confirmed yet." : error?.message;
  const isBusy = signIn.isPending || google.isPending;

  return (
    <AuthPageShell title="Sign in to your journal">
      <Button
        type="button"
        variant="outline"
        className="mb-5 w-full"
        onClick={() => google.mutate()}
        disabled={isBusy}
      >
        Continue with Google
      </Button>
      <div className="mb-5 flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        or use email
        <span className="h-px flex-1 bg-border" />
      </div>

      <form {...formProps(form)} className="space-y-5">
        <form.AppField name="email">
          {(field) => (
            <field.TextField label="Email" type="email" placeholder="you@email.com" autoComplete="email" autoFocus />
          )}
        </form.AppField>
        <form.AppField name="password">
          {(field) => (
            <field.TextField
              label="Password"
              type="password"
              placeholder="••••••••"
              autoComplete="current-password"
              labelAction={
                <Link to="/reset-password" className="text-xs text-muted-foreground hover:text-foreground">
                  Forgot password?
                </Link>
              }
            />
          )}
        </form.AppField>
        {errorMessage && (
          <div className="text-sm text-destructive">
            <p>{errorMessage}</p>
            {isUnconfirmed && (
              <button
                type="button"
                className="mt-1 font-medium underline-offset-2 hover:underline"
                onClick={() => resend.mutate(form.state.values.email.trim())}
              >
                Resend confirmation email
              </button>
            )}
          </div>
        )}
        <form.AppForm>
          <form.SubmitButton className="w-full" pending={isBusy}>
            Sign in
          </form.SubmitButton>
        </form.AppForm>
        <p className="text-center text-xs text-muted-foreground">
          New to Curated Trades?{" "}
          <Link
            to="/sign-up"
            search={search.redirect ? { redirect: search.redirect } : {}}
            className="font-semibold text-primary underline-offset-2 hover:underline"
          >
            Create an account
          </Link>
        </p>
      </form>
    </AuthPageShell>
  );
}
