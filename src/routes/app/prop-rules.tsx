// Prop-firm compliance ("/app/prop-rules", Phase 2.4). One rule profile per
// portfolio (prop_firm_rules); every number on this page other than the
// profile itself — today's loss used, drawdown used, trading-day count — is
// derived live from closed trades by computeComplianceStatus
// (lib/prop-firm-calc.ts), never stored, so there's exactly one place that
// knows what "80% of the daily loss limit" means. Warnings/breaches are
// recorded as an append-only audit trail (prop_firm_rule_events) purely for
// history — this page never blocks trade entry; see the note in the banner
// below for why a client-side lockout wouldn't be a real security boundary
// anyway.
//
// Which account is shown (?account=) and whether the rule editor is open
// (?edit=true) are URL search params; the editor is a TanStack Form mounted
// per account, so switching accounts can never carry one account's unsaved
// rules over to another (the old page needed a `formAccountId` bookkeeping
// state and a sync effect to guard against exactly that — see DECISIONS.md).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, Pencil, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Database } from "@/integrations/supabase/types";
import { formProps, useAppForm } from "@/lib/form";
import { upsertPropFirmRules } from "@/lib/prop-firm.functions";
import type { ComplianceStatus } from "@/lib/prop-firm-calc";
import { propFirmOverviewQueryOptions, workspaceQueryOptions } from "@/lib/queries";

type PropFirmRulesRow = Database["public"]["Tables"]["prop_firm_rules"]["Row"];

export const Route = createFileRoute("/app/prop-rules")({
  head: () => ({
    meta: [
      { title: "Prop rules — Curated Trades" },
      { name: "description", content: "Track daily loss, drawdown, and profit-target compliance against a prop firm's rules." },
    ],
  }),
  validateSearch: z.object({
    /** Account whose rules are shown; defaults to the sidebar's active account. */
    account: z.string().optional(),
    edit: z.boolean().optional(),
  }),
  component: PropRulesPage,
});

const optionalNumber = (label: string, { integer = false, max }: { integer?: boolean; max?: number } = {}) =>
  z.string().refine((value) => {
    if (value.trim() === "") return true;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 && (!integer || Number.isInteger(n)) && (max == null || n <= max);
  }, `${label} must be a valid number`);

const ruleSchema = z.object({
  isActive: z.boolean(),
  timezone: z.string(),
  calculationBasis: z.enum(["starting_balance", "current_balance", "high_water_mark"]),
  maxDailyLossPercent: z.string().refine((v) => Number.isFinite(Number(v)) && v.trim() !== "" && Number(v) >= 0, "Enter the max daily loss %"),
  maxTotalDrawdownPercent: z.string().refine((v) => Number.isFinite(Number(v)) && v.trim() !== "" && Number(v) >= 0, "Enter the max total drawdown %"),
  profitTargetPercent: optionalNumber("Profit target"),
  minTradingDays: optionalNumber("Min trading days", { integer: true }),
  maxTradingDays: optionalNumber("Max trading days", { integer: true }),
  consistencyPercent: optionalNumber("Consistency rule", { max: 100 }),
  allowWeekendHolding: z.boolean(),
  allowNewsTrading: z.boolean(),
  notes: z.string(),
});
type RuleForm = z.infer<typeof ruleSchema>;

function defaultForm(timezone: string): RuleForm {
  return {
    isActive: true,
    timezone,
    calculationBasis: "starting_balance",
    maxDailyLossPercent: "5",
    maxTotalDrawdownPercent: "10",
    profitTargetPercent: "",
    minTradingDays: "",
    maxTradingDays: "",
    consistencyPercent: "",
    allowWeekendHolding: true,
    allowNewsTrading: true,
    notes: "",
  };
}

function formFromRow(row: PropFirmRulesRow): RuleForm {
  return {
    isActive: row.is_active,
    timezone: row.timezone,
    calculationBasis: row.calculation_basis as RuleForm["calculationBasis"],
    maxDailyLossPercent: String(row.max_daily_loss_percent),
    maxTotalDrawdownPercent: String(row.max_total_drawdown_percent),
    profitTargetPercent: row.profit_target_percent != null ? String(row.profit_target_percent) : "",
    minTradingDays: row.min_trading_days != null ? String(row.min_trading_days) : "",
    maxTradingDays: row.max_trading_days != null ? String(row.max_trading_days) : "",
    consistencyPercent: row.consistency_percent != null ? String(row.consistency_percent) : "",
    allowWeekendHolding: row.allow_weekend_holding,
    allowNewsTrading: row.allow_news_trading,
    notes: row.notes ?? "",
  };
}

const BASIS_LABEL: Record<RuleForm["calculationBasis"], string> = {
  starting_balance: "Starting balance (fixed)",
  current_balance: "Previous day's balance",
  high_water_mark: "High-water mark (trailing peak)",
};

const BASIS_OPTIONS = (Object.keys(BASIS_LABEL) as RuleForm["calculationBasis"][]).map((value) => ({
  value,
  label: BASIS_LABEL[value],
}));

const EVENT_LABEL: Record<string, string> = {
  daily_loss_warning: "Daily loss warning",
  daily_loss_breach: "Daily loss breach",
  drawdown_warning: "Drawdown warning",
  drawdown_breach: "Drawdown breach",
  profit_target_reached: "Profit target reached",
  consistency_flag: "Consistency rule flagged",
  min_days_met: "Minimum trading days met",
  max_days_exceeded: "Maximum trading days exceeded",
};

function money(value: number): string {
  return value.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function AllowanceBar({ label, usedLabel, limitLabel, percent }: { label: string; usedLabel: string; limitLabel: string; percent: number }) {
  const clamped = Math.min(100, Math.max(0, percent));
  const fillClass = percent >= 100 ? "progress-danger" : percent >= 80 ? "progress-warm" : "";
  return (
    <div className="risk-item">
      <div className="flex items-center justify-between text-sm">
        <span className="field-label mb-0">{label}</span>
        <span className={`font-mono ${percent >= 100 ? "font-semibold text-destructive" : percent >= 80 ? "font-semibold" : "text-muted-foreground"}`}>
          {percent.toFixed(0)}%
        </span>
      </div>
      <div className="progress-track">
        <span className={`progress-fill ${fillClass}`} style={{ width: `${clamped}%` }} />
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        <span className="font-mono">{usedLabel}</span> of <span className="font-mono">{limitLabel}</span> allowance used
      </p>
    </div>
  );
}

function RuleProfileForm({
  accountId,
  initial,
  hasSavedRules,
  onSaved,
  onCancel,
}: {
  accountId: string;
  initial: RuleForm;
  hasSavedRules: boolean;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const save = useMutation({
    mutationFn: upsertPropFirmRules,
    onSuccess: () => {
      toast.success("Rule profile saved");
      onSaved();
    },
    onError: (error) => toast.error(error.message || "Couldn't save rule profile"),
  });

  const form = useAppForm({
    defaultValues: initial,
    validators: { onSubmit: ruleSchema },
    onSubmit: ({ value }) => {
      const num = (v: string) => (v.trim() === "" ? null : Number(v));
      save.mutate({
        data: {
          accountId,
          isActive: value.isActive,
          timezone: value.timezone.trim() || "UTC",
          calculationBasis: value.calculationBasis,
          maxDailyLossPercent: Number(value.maxDailyLossPercent),
          maxTotalDrawdownPercent: Number(value.maxTotalDrawdownPercent),
          profitTargetPercent: num(value.profitTargetPercent),
          minTradingDays: num(value.minTradingDays),
          maxTradingDays: num(value.maxTradingDays),
          consistencyPercent: num(value.consistencyPercent),
          allowWeekendHolding: value.allowWeekendHolding,
          allowNewsTrading: value.allowNewsTrading,
          notes: value.notes.trim() === "" ? null : value.notes.trim(),
        },
      });
    },
  });

  return (
    <form {...formProps(form)} className="surface-panel mb-6 p-6">
      <p className="panel-heading mb-4">Rule profile</p>
      <div className="metric-grid mb-4 items-start">
        <form.AppField name="calculationBasis">
          {(field) => <field.SelectField label="Calculation basis" options={BASIS_OPTIONS} />}
        </form.AppField>
        <form.AppField name="timezone">
          {(field) => <field.TextField label="Prop firm timezone (IANA)" placeholder="e.g. America/New_York" />}
        </form.AppField>
        <form.AppField name="maxDailyLossPercent">
          {(field) => <field.TextField label="Max daily loss %" type="number" step="0.1" min="0" className="font-mono" />}
        </form.AppField>
        <form.AppField name="maxTotalDrawdownPercent">
          {(field) => <field.TextField label="Max total drawdown %" type="number" step="0.1" min="0" className="font-mono" />}
        </form.AppField>
        <form.AppField name="profitTargetPercent">
          {(field) => <field.TextField label="Profit target % (optional)" type="number" step="0.1" min="0" placeholder="Optional" className="font-mono" />}
        </form.AppField>
        <form.AppField name="consistencyPercent">
          {(field) => (
            <field.TextField
              label="Consistency rule % (optional)"
              type="number"
              step="1"
              min="0"
              max="100"
              placeholder="Max % of profit from one day"
              className="font-mono"
            />
          )}
        </form.AppField>
        <form.AppField name="minTradingDays">
          {(field) => <field.TextField label="Min trading days (optional)" type="number" step="1" min="0" placeholder="Optional" className="font-mono" />}
        </form.AppField>
        <form.AppField name="maxTradingDays">
          {(field) => <field.TextField label="Max trading days (optional)" type="number" step="1" min="0" placeholder="Optional" className="font-mono" />}
        </form.AppField>
      </div>

      <div className="mb-4 flex flex-wrap gap-6 text-sm">
        <form.AppField name="allowWeekendHolding">{(field) => <field.CheckboxField label="Weekend holding allowed" />}</form.AppField>
        <form.AppField name="allowNewsTrading">{(field) => <field.CheckboxField label="News-event trading allowed" />}</form.AppField>
        <form.AppField name="isActive">{(field) => <field.CheckboxField label="Rules currently apply to this account" />}</form.AppField>
      </div>

      <div className="mb-4">
        <form.AppField name="notes">
          {(field) => <field.TextareaField label="Notes (optional)" placeholder="Anything else about this firm's rules worth remembering" />}
        </form.AppField>
      </div>

      <div className="flex gap-2">
        <form.AppForm>
          <form.SubmitButton pendingLabel="Saving…" pending={save.isPending}>
            Save rule profile
          </form.SubmitButton>
        </form.AppForm>
        {hasSavedRules && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

function PropRulesPage() {
  const queryClient = useQueryClient();
  const navigate = Route.useNavigate();
  const search = Route.useSearch();
  const { data: workspace } = useQuery(workspaceQueryOptions);
  const accounts = workspace?.accounts ?? [];
  // Defaults to the sidebar's active account, but stays independently
  // switchable here via the tab row — the whole point of a per-account
  // page is being able to check on one account without changing what the
  // rest of the app (Journal, Analytics) is scoped to.
  const accountId = search.account ?? workspace?.activeAccount?.id ?? accounts[0]?.id ?? null;

  const overviewQuery = useQuery(propFirmOverviewQueryOptions(accountId ?? undefined));
  const overview = overviewQuery.data;

  const setSearch = (patch: { account?: string | undefined; edit?: boolean | undefined }) =>
    void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });

  if (!workspace) {
    return <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>;
  }

  const status: ComplianceStatus | null = overview?.status ?? null;
  // With no saved rules the editor is the page; otherwise it opens on demand.
  const isEditing = overview !== undefined && (search.edit === true || !overview.rules);

  return (
    <>
      <section className="mb-6 flex flex-col justify-between gap-4 border-b border-border pb-5 sm:flex-row sm:items-center">
        <h1 className="page-title">Prop-firm rules</h1>
        {overview?.rules && !isEditing && (
          <Button variant="outline" onClick={() => setSearch({ edit: true })}>
            <Pencil /> Edit rule profile
          </Button>
        )}
      </section>

      {accounts.length > 1 && (
        <div className="mb-6 flex flex-wrap gap-2">
          {accounts.map((account) => (
            <Button
              key={account.id}
              type="button"
              variant={account.id === accountId ? "secondary" : "outline"}
              size="sm"
              onClick={() => setSearch({ account: account.id, edit: undefined })}
            >
              {account.name}
            </Button>
          ))}
        </div>
      )}

      {accountId && overview && isEditing && (
        <RuleProfileForm
          // Fresh form per account, so one account's draft can never be saved onto another.
          key={accountId}
          accountId={accountId}
          initial={overview.rules ? formFromRow(overview.rules) : defaultForm(workspace.profile.timezone)}
          hasSavedRules={Boolean(overview.rules)}
          onSaved={() => {
            void queryClient.invalidateQueries({ queryKey: propFirmOverviewQueryOptions(accountId).queryKey });
            setSearch({ edit: undefined });
          }}
          onCancel={() => setSearch({ edit: undefined })}
        />
      )}

      {overview?.rules && !isEditing && status && (
        <>
          {!overview.rules.is_active && (
            <div className="insight-banner mb-4">
              <AlertTriangle className="size-4" />
              <span>This rule profile is saved but marked inactive, so it's for reference only right now.</span>
            </div>
          )}

          <div className="insight-banner mb-6">
            <ShieldCheck className="size-4" />
            <span>
              Figures below use realized balance only (starting equity + closed-trade P&amp;L) — there's no live price feed, so
              floating P&amp;L on any open position isn't reflected yet. This is informational, not an enforced lockout: nothing
              here blocks you from logging a trade.
            </span>
          </div>

          <div className="metric-grid mb-6">
            <div className="surface-panel p-5">
              <p className="panel-title mb-3">Daily loss allowance ({BASIS_LABEL[status.basis]})</p>
              <AllowanceBar
                label={`Today (${status.today.dateKey})`}
                usedLabel={money(status.today.lossUsed)}
                limitLabel={money(status.today.lossLimit)}
                percent={status.today.lossUsedPercent}
              />
              <p className="mt-3 text-xs text-muted-foreground">
                Today's realized P&amp;L:{" "}
                <span className="font-mono">
                  {status.today.pnl >= 0 ? "+" : ""}
                  {money(status.today.pnl)}
                </span>
              </p>
            </div>

            <div className="surface-panel p-5">
              <p className="panel-title mb-3">Total drawdown allowance</p>
              <AllowanceBar
                label="Since account start"
                usedLabel={money(status.drawdown.used)}
                limitLabel={money(status.drawdown.limit)}
                percent={status.drawdown.usedPercent}
              />
              <p className="mt-3 text-xs text-muted-foreground">
                Current balance <span className="font-mono">{money(status.currentBalance)}</span>, peak{" "}
                <span className="font-mono">{money(status.peakBalance)}</span>
              </p>
            </div>

            {status.profitTarget && (
              <div className="surface-panel p-5">
                <p className="panel-title mb-3">Profit target</p>
                <AllowanceBar
                  label={`Target: ${status.profitTarget.targetPercent}%`}
                  usedLabel={money(Math.max(0, status.profitTarget.progressAmount))}
                  limitLabel={money(status.profitTarget.targetAmount)}
                  percent={status.profitTarget.progressPercent}
                />
              </div>
            )}

            <div className="surface-panel p-5">
              <p className="panel-title mb-3">Trading days</p>
              <p className="metric-value">{status.tradingDays.count}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                {status.tradingDays.min != null && `Min required: ${status.tradingDays.min}. `}
                {status.tradingDays.max != null && `Max allowed: ${status.tradingDays.max}.`}
                {status.tradingDays.min == null && status.tradingDays.max == null && "No day-count limits set."}
              </p>
            </div>

            {status.consistency && (
              <div className="surface-panel p-5">
                <p className="panel-title mb-3">Consistency rule</p>
                <div className="flex items-center gap-2">
                  {status.consistency.flagged ? (
                    <AlertTriangle className="size-4 text-destructive" />
                  ) : (
                    <CheckCircle2 className="size-4 text-muted-foreground" />
                  )}
                  <p className="metric-value">{status.consistency.bestDayShare.toFixed(0)}%</p>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Best single day's share of total profit (limit {status.consistency.percentLimit}%).
                </p>
              </div>
            )}
          </div>

          <div className="surface-panel p-0">
            <div className="p-5 pb-0">
              <p className="panel-title">Audit trail</p>
            </div>
            <div className="p-5">
              {overview.events.length === 0 && (
                <p className="text-sm text-muted-foreground">No warnings or breaches recorded yet.</p>
              )}
              <ul className="space-y-3">
                {overview.events.map((event) => (
                  <li key={event.id} className="flex items-start justify-between gap-3 text-sm">
                    <div>
                      <p className="font-medium">{EVENT_LABEL[event.event_type] ?? event.event_type}</p>
                      <p className="text-xs text-muted-foreground">{event.message}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">{event.occurred_on}</span>
                      <Badge variant={event.severity === "breach" ? "destructive" : event.severity === "warning" ? "secondary" : "outline"}>
                        {event.severity}
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </>
      )}
    </>
  );
}
