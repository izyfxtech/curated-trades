// First-run setup, shown once per account (gated by profiles.onboarding_completed
// — see app.tsx's redirect effect, which is the single source of truth for
// sending an unfinished account here). Collects timezone, currency, trader
// type, and whether the first portfolio is personal or a prop-firm account.
// The finishMutation's onSuccess AWAITS the workspace cache invalidation
// before navigating — do not change that back to fire-and-forget. See the
// comment on that line for why: app.tsx has its own ["workspace"] query and
// will bounce straight back here if it mounts with the stale pre-save cache.
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Briefcase, User } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/lib/auth/session-context";
import { updateAccount } from "@/lib/accounts.functions";
import { getWorkspace, updatePortfolio } from "@/lib/portfolios.functions";
import { updateProfile } from "@/lib/profile.functions";

export const Route = createFileRoute("/onboarding")({
  head: () => ({
    meta: [{ title: "Set up your journal — Curated Trades" }],
  }),
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

type AccountType = "personal" | "prop";

function guessTimezone(): string {
  try {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return COMMON_TIMEZONES.includes(detected) ? detected : "UTC";
  } catch {
    return "UTC";
  }
}

function OnboardingPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { status } = useAuth();

  // This is a first-run gate, not the security boundary — same rationale as
  // the authenticated layout (app.tsx): `useAuth()` only knows the real
  // answer once its effect has run on the client. The real boundary is
  // requireSupabaseAuth on every call below.
  useEffect(() => {
    if (status === "anon") {
      void navigate({ to: "/sign-in", search: { redirect: "/onboarding" } });
    }
  }, [status, navigate]);

  const workspaceQuery = useQuery({
    queryKey: ["workspace"],
    queryFn: () => getWorkspace(),
    enabled: status === "authed",
  });
  const workspace = workspaceQuery.data;

  const [displayName, setDisplayName] = useState("");
  const [timezone, setTimezone] = useState(guessTimezone());
  const [baseCurrency, setBaseCurrency] = useState("USD");
  const [traderType, setTraderType] = useState<(typeof TRADER_TYPES)[number]["value"]>("swing");
  const [accountType, setAccountType] = useState<AccountType>("personal");
  const [portfolioName, setPortfolioName] = useState("Personal account");
  const [startingEquity, setStartingEquity] = useState("50000");
  const [error, setError] = useState("");
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (!workspace || initialized) return;
    // Already onboarded (e.g. back-button after finishing) — nothing to do here.
    if (workspace.profile.onboarding_completed) {
      void navigate({ to: "/app" });
      return;
    }
    setDisplayName(workspace.profile.display_name ?? "");
    if (workspace.profile.timezone) setTimezone(workspace.profile.timezone);
    if (workspace.profile.base_currency) setBaseCurrency(workspace.profile.base_currency);
    setPortfolioName(workspace.activePortfolio.name);
    setStartingEquity(String(workspace.accounts[0]?.starting_equity ?? workspace.activePortfolio.starting_equity));
    setInitialized(true);
  }, [workspace, initialized, navigate]);

  const finishMutation = useMutation({
    mutationFn: async (input: { skip: boolean }) => {
      if (!workspace) throw new Error("Workspace not loaded yet");

      if (input.skip) {
        await updateProfile({ data: { onboardingCompleted: true } });
        return;
      }

      const equity = Number(startingEquity);
      if (!Number.isFinite(equity) || equity <= 0) {
        throw new Error("Starting equity must be a positive number");
      }

      await Promise.all([
        updateProfile({
          data: {
            displayName: displayName.trim() || undefined,
            timezone,
            baseCurrency: baseCurrency.trim().toUpperCase(),
            traderType,
            onboardingCompleted: true,
          },
        }),
        updatePortfolio({
          data: {
            portfolioId: workspace.activePortfolio.id,
            name: portfolioName.trim() || (accountType === "prop" ? "Prop challenge" : "Personal account"),
          },
        }),
        ...(workspace.accounts[0]
          ? [
              updateAccount({
                data: {
                  accountId: workspace.accounts[0].id,
                  name: portfolioName.trim() || (accountType === "prop" ? "Prop challenge" : "Personal account"),
                  accountType,
                  baseCurrency: baseCurrency.trim().toUpperCase(),
                  startingEquity: equity,
                },
              }),
            ]
          : []),
      ]);
    },
    onSuccess: async () => {
      // Must AWAIT this, not fire-and-forget: /app's layout has its own
      // ["workspace"] query and immediately redirects back here if
      // onboarding_completed is false. Navigating before the invalidated
      // query actually refetches means /app mounts with the stale
      // pre-save cache, bounces back to /onboarding, and the whole save
      // looks like it silently failed — hence needing a second click.
      await queryClient.invalidateQueries({ queryKey: ["workspace"] });
      void navigate({ to: "/app" });
    },
    onError: (mutationError: Error) => setError(mutationError.message || "Couldn't save your setup — try again."),
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    finishMutation.mutate({ skip: false });
  }

  if (workspaceQuery.isError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-4 text-center text-sm">
        <p className="text-muted-foreground">
          {workspaceQuery.error instanceof Error
            ? workspaceQuery.error.message
            : "Something went wrong setting up your journal."}
        </p>
        <Button type="button" variant="outline" onClick={() => void workspaceQuery.refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  if (status !== "authed" || workspaceQuery.isLoading || !workspace) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Setting things up…
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10 text-foreground">
      <div className="w-full max-w-lg">
        <div className="mb-8 flex items-center justify-center gap-3">
          <span className="brand-mark" aria-hidden="true" />
          <span className="wordmark">Curated <em>Trades</em></span>
        </div>

        <form onSubmit={onSubmit} className="surface-panel space-y-6">
          <div>
            <h1 className="font-serif text-xl font-medium">A few details before you start logging</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              This tunes session times, currency formatting, and your risk baseline. You can change any of it later
              in Settings.
            </p>
          </div>

          <div>
            <label htmlFor="onboarding-name" className="field-label">
              Display name
            </label>
            <Input id="onboarding-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className="field-label">Timezone</span>
              <Select value={timezone} onValueChange={setTimezone}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COMMON_TIMEZONES.map((tz) => (
                    <SelectItem key={tz} value={tz}>
                      {tz}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <span className="field-label">Trader type</span>
              <Select value={traderType} onValueChange={(v: (typeof TRADER_TYPES)[number]["value"]) => setTraderType(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TRADER_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <span className="field-label">This portfolio is</span>
            <div className="direction-toggle">
              <Button
                type="button"
                variant={accountType === "personal" ? "secondary" : "ghost"}
                className="flex-1"
                onClick={() => setAccountType("personal")}
              >
                <User /> Personal
              </Button>
              <Button
                type="button"
                variant={accountType === "prop" ? "secondary" : "ghost"}
                className="flex-1"
                onClick={() => setAccountType("prop")}
              >
                <Briefcase /> Prop firm
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <label htmlFor="onboarding-portfolio-name" className="field-label">
                Portfolio name
              </label>
              <Input
                id="onboarding-portfolio-name"
                value={portfolioName}
                onChange={(e) => setPortfolioName(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="onboarding-currency" className="field-label">
                Currency
              </label>
              <Input
                id="onboarding-currency"
                value={baseCurrency}
                maxLength={3}
                onChange={(e) => setBaseCurrency(e.target.value.toUpperCase())}
              />
            </div>
          </div>

          <div>
            <label htmlFor="onboarding-equity" className="field-label">
              Starting equity
            </label>
            <Input
              id="onboarding-equity"
              type="number"
              step="any"
              min="1"
              value={startingEquity}
              onChange={(e) => setStartingEquity(e.target.value)}
              className="font-mono"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {accountType === "prop"
                ? "The evaluation or funded account size — used to calculate drawdown and risk."
                : "Your account balance today — used as the starting point for the equity curve."}
            </p>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex items-center justify-between gap-3 border-t border-border pt-5">
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => {
                setError("");
                finishMutation.mutate({ skip: true });
              }}
              disabled={finishMutation.isPending}
            >
              Skip for now
            </button>
            <Button type="submit" disabled={finishMutation.isPending}>
              {finishMutation.isPending ? "Saving…" : "Start journaling"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
