// "Forgot password" request page: asks Supabase to email a reset link that
// lands on /app. Deliberately has NO signed-in redirect guard (unlike sign-in
// and sign-up) — someone arriving from a recovery email already holds a
// session, and bouncing them away from here would be wrong.
//
// TanStack Form owns the email field + zod validation; a Query mutation owns
// the request's pending/error/success state, so there are no hand-rolled
// `sent` / `error` / `isSubmitting` flags.
import { useMutation } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";

import { supabase } from "@/integrations/supabase/client";
import { formProps, useAppForm } from "@/lib/form";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [{ title: "Reset your password — Curated Trades" }],
  }),
  component: ResetPasswordPage,
});

const resetSchema = z.object({
  email: z.string().trim().pipe(z.email("Enter a valid email address.")),
});

function ResetPasswordPage() {
  const reset = useMutation({
    mutationFn: async ({ email }: z.infer<typeof resetSchema>) => {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/app`,
      });
      if (error) throw error;
    },
  });

  const form = useAppForm({
    defaultValues: { email: "" },
    validators: { onSubmit: resetSchema },
    onSubmit: ({ value }) => reset.mutate(value),
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10 text-foreground">
      <div className="w-full max-w-sm">
        <Link to="/" className="mb-8 flex items-center justify-center gap-3">
          <span className="brand-mark" aria-hidden="true" />
          <span className="wordmark">
            Curated <em>Trades</em>
          </span>
        </Link>

        <div className="surface-panel">
          <h1 className="mb-6 font-serif text-xl font-medium">Reset your password</h1>

          {reset.isSuccess ? (
            <p className="text-sm text-chart-2">
              If an account exists for that email, a reset link is on its way. Check your inbox.
            </p>
          ) : (
            <form {...formProps(form)} className="space-y-5">
              <form.AppField name="email">
                {(field) => (
                  <field.TextField label="Email" type="email" placeholder="you@email.com" autoComplete="email" autoFocus />
                )}
              </form.AppField>
              {reset.error && <p className="text-sm text-destructive">{reset.error.message}</p>}
              <form.AppForm>
                <form.SubmitButton className="w-full" pendingLabel="Sending…" pending={reset.isPending}>
                  Send reset link
                </form.SubmitButton>
              </form.AppForm>
            </form>
          )}

          <p className="mt-5 text-center text-xs text-muted-foreground">
            <Link to="/sign-in" className="font-semibold text-primary underline-offset-2 hover:underline">
              Back to sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
