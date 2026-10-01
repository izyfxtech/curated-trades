// Sign-up page. Kept separate from /sign-in so each flow owns its own
// messages, and so the account-already-exists handling below — Supabase can
// signal it two different ways depending on whether email confirmation is on
// (an explicit error, or a "success" with an empty identities list) — lives
// in exactly one place. Built on TanStack Form (fields + zod validation),
// Query mutations (in-flight/error state for each Supabase call) and Router
// (`beforeLoad` skips the page for someone already signed in).
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { z } from "zod";

import { AuthPageShell } from "@/components/auth/AuthPageShell";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { authSearchSchema } from "@/lib/auth/redirect";
import { formProps, useAppForm } from "@/lib/form";
import { sessionQueryOptions, workspaceQueryOptions } from "@/lib/queries";

export const Route = createFileRoute("/sign-up")({
  head: () => ({
    meta: [
      { title: "Create your account — Curated Trades" },
      { name: "description", content: "Start journaling your trades with Curated Trades." },
    ],
  }),
  validateSearch: authSearchSchema,
  // Session lives in browser localStorage: client-side guard only.
  ssr: false,
  beforeLoad: async ({ context, search }) => {
    const session = await context.queryClient.ensureQueryData(sessionQueryOptions);
    if (session) throw redirect({ href: search.redirect ?? "/app" });
  },
  component: SignUpPage,
});

const signUpSchema = z.object({
  displayName: z.string(),
  email: z.string().trim().pipe(z.email("Enter a valid email address.")),
  password: z.string().min(6, "Use at least 6 characters."),
});

type SignUpOutcome =
  | { kind: "signed-in" }
  | { kind: "exists"; message: string }
  | { kind: "confirm-email" };

const ALREADY_EXISTS_EMAIL = "An account with this email already exists. Sign in below, or reset your password if you don't remember it.";
const ALREADY_EXISTS_IDENTITY = 'An account with this email already exists — try "Continue with Google" or reset your password.';

function SignUpPage() {
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();
  const search = Route.useSearch();
  const target = search.redirect ?? "/app";

  const signUp = useMutation({
    mutationFn: async (values: z.infer<typeof signUpSchema>): Promise<SignUpOutcome> => {
      const { data, error } = await supabase.auth.signUp({
        email: values.email.trim(),
        password: values.password,
        options: { data: { display_name: values.displayName.trim() } },
      });
      if (error) {
        const message = error.message.toLowerCase();
        if (message.includes("already registered") || message.includes("already exists")) {
          return { kind: "exists", message: ALREADY_EXISTS_EMAIL };
        }
        throw error;
      }
      if (!data.session) {
        // Supabase's "success" for an address that's already registered: no
        // session, and a user object with zero identities.
        const alreadyRegistered = (data.user?.identities?.length ?? 0) === 0;
        return alreadyRegistered ? { kind: "exists", message: ALREADY_EXISTS_IDENTITY } : { kind: "confirm-email" };
      }
      return { kind: "signed-in" };
    },
    onSuccess: (outcome) => {
      if (outcome.kind === "signed-in") {
        // Overlap the workspace fetch with the route transition — see sign-in.tsx.
        void queryClient.prefetchQuery(workspaceQueryOptions);
        void navigate({ to: target });
      } else {
        form.setFieldValue("password", "");
      }
    },
  });

  const google = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}${target}` },
      });
      if (error) throw error;
    },
  });

  const form = useAppForm({
    defaultValues: { displayName: "", email: "", password: "" },
    validators: { onSubmit: signUpSchema },
    onSubmit: ({ value }) => signUp.mutate(value),
  });

  const outcome = signUp.data;
  const errorMessage = signUp.error?.message ?? google.error?.message ?? (outcome?.kind === "exists" ? outcome.message : undefined);
  const showSignInLink = outcome?.kind === "exists" || outcome?.kind === "confirm-email";
  const isBusy = signUp.isPending || google.isPending;

  return (
    <AuthPageShell title="Start journaling with intent">
      <Button type="button" variant="outline" className="mb-5 w-full" onClick={() => google.mutate()} disabled={isBusy}>
        Continue with Google
      </Button>
      <div className="mb-5 flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        or use email
        <span className="h-px flex-1 bg-border" />
      </div>

      <form {...formProps(form)} className="space-y-5">
        <form.AppField name="displayName">
          {(field) => <field.TextField label="Display name" placeholder="Izy Eberendu" autoComplete="name" />}
        </form.AppField>
        <form.AppField name="email">
          {(field) => (
            <field.TextField label="Email" type="email" placeholder="you@email.com" autoComplete="email" autoFocus />
          )}
        </form.AppField>
        <form.AppField name="password">
          {(field) => (
            <field.TextField label="Password" type="password" placeholder="••••••••" autoComplete="new-password" />
          )}
        </form.AppField>
        {errorMessage && (
          <div className="text-sm text-destructive">
            <p>{errorMessage}</p>
            {showSignInLink && (
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
        {outcome?.kind === "confirm-email" && (
          <div className="text-sm text-chart-2">
            <p>Check your email to confirm your account, then sign in.</p>
            <Link
              to="/sign-in"
              search={search.redirect ? { redirect: search.redirect } : {}}
              className="mt-1 inline-block font-medium underline-offset-2 hover:underline"
            >
              Go to sign in
            </Link>
          </div>
        )}
        <form.AppForm>
          <form.SubmitButton className="w-full" pending={isBusy}>
            Create account
          </form.SubmitButton>
        </form.AppForm>
        <p className="text-center text-xs text-muted-foreground">
          Already journaling?{" "}
          <Link
            to="/sign-in"
            search={search.redirect ? { redirect: search.redirect } : {}}
            className="font-semibold text-primary underline-offset-2 hover:underline"
          >
            Sign in
          </Link>
        </p>
      </form>
    </AuthPageShell>
  );
}
