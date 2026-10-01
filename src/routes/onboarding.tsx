// First-run setup, shown once per user (gated by profiles.onboarding_completed
// — see app.tsx's `beforeLoad`, which is the single source of truth for
// sending an unfinished user here). Collects timezone, trader type, and sets
// up the user's first portfolio together with that portfolio's first account
// (personal or prop, its own currency and starting equity).
//
// Portfolio and account are two different rows with two different names —
// getWorkspace's bootstrap defaults them to "Personal" and "Main"
// respectively (see ensureDefaultAccount in portfolios.functions.ts) — and
// account_type/base_currency/starting_equity all live on the ACCOUNT now
// (see the comment on updatePortfolio: "Account type/currency/equity all
// moved to the account level"). A portfolio can hold more than one account
// later (e.g. several prop-firm challenges); this form only ever edits the
// one portfolio + one account that already exist by the time it loads, so it
// keeps their fields — and their names — separate rather than collapsing
// them into a single input the way a single-account mental model would.
//
// The finish mutation's onSuccess AWAITS the workspace cache invalidation
// before navigating — do not change that back to fire-and-forget. See the
// comment on that line for why: app.tsx's loader reads the ["workspace"]
// cache and will bounce straight back here if it sees the stale pre-save copy.
//
// TanStack throughout: Router's `beforeLoad`/`loader` handle the sign-in and
// "already onboarded" redirects and preload the workspace (so the form's
// `defaultValues` come straight from loaded data instead of a
// setState-in-useEffect sync), Form owns fields + zod validation, and Query
// owns the save.
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { Briefcase, User } from "lucide-react";
import { z } from "zod";

import { RouteError } from "@/components/RouteError";
import { Button } from "@/components/ui/button";
import { updateAccount } from "@/lib/accounts.functions";
import { formProps, useAppForm } from "@/lib/form";
import { updatePortfolio } from "@/lib/portfolios.functions";
import { updateProfile } from "@/lib/profile.functions";
import { sessionQueryOptions, workspaceQueryOptions } from "@/lib/queries";

export const Route = createFileRoute("/onboarding")({
  head: () => ({
    meta: [{ title: "Set up your journal — Curated Trades" }],
  }),
  // Session lives in browser localStorage, so guards and loader run client-side.
  ssr: false,
  // First-run gate, not the security boundary — the real boundary is
  // requireSupabaseAuth on every server function below.
  beforeLoad: async ({ context }) => {
    const session = await context.queryClient.ensureQueryData(sessionQueryOptions);
    if (!session) throw redirect({ to: "/sign-in", search: { redirect: "/onboarding" } });
  },
  loader: async ({ context }) => {
    const workspace = await context.queryClient.ensureQueryData(workspaceQueryOptions);
    // Already onboarded (e.g. back-button after finishing) — nothing to do here.
    if (workspace.profile.onboarding_completed) throw redirect({ to: "/app" });
  },
  pendingComponent: () => (
    <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
      Setting things up…
    </div>
  ),
  errorComponent: RouteError,
  component: OnboardingPage,
});

const TRADER_TYPES = [
  { value: "day", label: "Day trader" },
  { value: "scalp", label: "Scalper" },
  { value: "swing", label: "Swing trader" },
  { value: "position", label: "Position trader" },
] as const;

const COMMON_TIMEZONES = [
  "UTC",
  "Africa/Lagos",
  "Europe/London",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Asia/Tokyo",
  "Asia/Singapore",
  "Australia/Sydney",
];

const onboardingSchema = z.object({
  displayName: z.string(),
  timezone: z.string().min(1),
  traderType: z.enum(["day", "scalp", "swing", "position"]),
  portfolioName: z.string(),
  accountType: z.enum(["personal", "prop"]),
  accountName: z.string(),
  baseCurrency: z.string().trim().min(1, "Enter a currency code."),
  startingEquity: z
    .string()
    .refine((value) => Number.isFinite(Number(value)) && Number(value) > 0, "Starting equity must be a positive number"),
});
type OnboardingValues = z.infer<typeof onboardingSchema>;

function guessTimezone(): string {
  try {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return COMMON_TIMEZONES.includes(detected) ? detected : "UTC";
  } catch {
    return "UTC";
  }
}

function OnboardingPage() {
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();
  // Already in cache — the route loader awaited it before this rendered.
  const { data: workspace } = useSuspenseQuery(workspaceQueryOptions);
  const firstAccount = workspace.accounts[0];

  const finish = useMutation({
    mutationFn: async (input: { skip: true } | { skip: false; values: OnboardingValues }) => {
      if (input.skip) {
        await updateProfile({ data: { onboardingCompleted: true } });
        return;
      }
      const { values } = input;
      const currency = values.baseCurrency.trim().toUpperCase();

      await Promise.all([
        updateProfile({
          data: {
            displayName: values.displayName.trim() || undefined,
            timezone: values.timezone,
            baseCurrency: currency,
            traderType: values.traderType,
            onboardingCompleted: true,
          },
        }),
        updatePortfolio({
          data: {
            portfolioId: workspace.activePortfolio.id,
            name: values.portfolioName.trim() || "Personal",
          },
        }),
        ...(firstAccount
          ? [
              updateAccount({
                data: {
                  accountId: firstAccount.id,
                  name: values.accountName.trim() || (values.accountType === "prop" ? "Prop challenge" : "Main"),
                  accountType: values.accountType,
                  baseCurrency: currency,
                  startingEquity: Number(values.startingEquity),
                },
              }),
            ]
          : []),
      ]);
    },
    onSuccess: async () => {
      // Must AWAIT this, not fire-and-forget: /app's loader reads the
      // ["workspace"] cache and immediately redirects back here if
      // onboarding_completed is false. Navigating before the invalidated
      // query actually refetches means /app sees the stale pre-save cache,
      // bounces back to /onboarding, and the whole save looks like it
      // silently failed — hence needing a second click.
      await queryClient.invalidateQueries(workspaceQueryOptions);
      void navigate({ to: "/app" });
    },
  });

  const form = useAppForm({
    // Prefilled straight from the loaded workspace — no sync effect needed.
    defaultValues: {
      displayName: workspace.profile.display_name ?? "",
      timezone: workspace.profile.timezone ?? guessTimezone(),
      traderType: "swing",
      portfolioName: workspace.activePortfolio.name,
      // Separate from portfolioName on purpose — portfolios.name and
      // accounts.name are different columns (defaulted to "Personal" and
      // "Main"), and reusing one input for both would silently overwrite the
      // account's own name with the portfolio's the moment this form saves.
      accountName: firstAccount?.name ?? "Main",
      accountType: firstAccount?.account_type === "prop" ? "prop" : "personal",
      baseCurrency: workspace.profile.base_currency ?? "USD",
      startingEquity: String(firstAccount?.starting_equity ?? workspace.activePortfolio.starting_equity),
    } as OnboardingValues,
    validators: { onSubmit: onboardingSchema },
    onSubmit: ({ value }) => finish.mutate({ skip: false, values: value }),
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10 text-foreground">
      <div className="w-full max-w-lg">
        <div className="mb-8 flex items-center justify-center gap-3">
          <span className="brand-mark" aria-hidden="true" />
          <span className="wordmark">
            Curated <em>Trades</em>
          </span>
        </div>

        <form {...formProps(form)} className="surface-panel space-y-6">
          <div>
            <h1 className="font-serif text-xl font-medium">A few details before you start logging</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              This tunes session times and your risk baseline, and sets up your portfolio's first trading account.
              A portfolio can hold more than one account later — separate prop-firm challenges, say — each with its
              own type, currency and equity. You can change any of it, or add more accounts, later in Settings.
            </p>
          </div>

          <form.AppField name="displayName">{(field) => <field.TextField label="Display name" />}</form.AppField>

          <div className="grid grid-cols-2 gap-4">
            <form.AppField name="timezone">
              {(field) => (
                <field.SelectField
                  label="Timezone"
                  options={COMMON_TIMEZONES.map((tz) => ({ value: tz, label: tz }))}
                />
              )}
            </form.AppField>
            <form.AppField name="traderType">
              {(field) => <field.SelectField label="Trader type" options={TRADER_TYPES} />}
            </form.AppField>
          </div>

          <form.AppField name="portfolioName">
            {(field) => (
              <field.TextField
                label="Portfolio name"
                hint={'The umbrella your accounts sit under — most people just call it "Personal".'}
              />
            )}
          </form.AppField>

          <div className="space-y-4 rounded-lg border border-border p-4">
            <p className="eyebrow">First account in this portfolio</p>

            <form.AppField name="accountType">
              {(field) => (
                <div>
                  <span className="field-label">This account is</span>
                  <div className="direction-toggle">
                    <Button
                      type="button"
                      variant={field.state.value === "personal" ? "secondary" : "ghost"}
                      className="flex-1"
                      onClick={() => field.handleChange("personal")}
                    >
                      <User /> Personal
                    </Button>
                    <Button
                      type="button"
                      variant={field.state.value === "prop" ? "secondary" : "ghost"}
                      className="flex-1"
                      onClick={() => field.handleChange("prop")}
                    >
                      <Briefcase /> Prop firm
                    </Button>
                  </div>
                </div>
              )}
            </form.AppField>

            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-2">
                <form.AppField name="accountName">{(field) => <field.TextField label="Account name" />}</form.AppField>
              </div>
              <form.AppField
                name="baseCurrency"
                listeners={{ onChange: ({ value, fieldApi }) => fieldApi.setValue(value.toUpperCase(), { dontUpdateMeta: true }) }}
              >
                {(field) => <field.TextField label="Currency" maxLength={3} />}
              </form.AppField>
            </div>

            <form.AppField name="startingEquity">
              {(field) => (
                <form.Subscribe selector={(state) => state.values.accountType}>
                  {(accountType) => (
                    <field.TextField
                      label="Starting equity"
                      type="number"
                      step="any"
                      min="1"
                      className="font-mono"
                      hint={
                        accountType === "prop"
                          ? "The evaluation or funded account size — used to calculate drawdown and risk."
                          : "Your account balance today — used as the starting point for the equity curve."
                      }
                    />
                  )}
                </form.Subscribe>
              )}
            </form.AppField>
          </div>

          {finish.error && (
            <p className="text-sm text-destructive">{finish.error.message || "Couldn't save your setup — try again."}</p>
          )}

          <div className="flex items-center justify-between gap-3 border-t border-border pt-5">
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => finish.mutate({ skip: true })}
              disabled={finish.isPending}
            >
              Skip for now
            </button>
            <form.AppForm>
              <form.SubmitButton pendingLabel="Saving…" pending={finish.isPending}>
                Start journaling
              </form.SubmitButton>
            </form.AppForm>
          </div>
        </form>
      </div>
    </div>
  );
}
