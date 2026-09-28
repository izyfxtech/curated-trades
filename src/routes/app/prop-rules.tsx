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
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { AlertTriangle, CheckCircle2, Pencil, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getWorkspace } from "@/lib/portfolios.functions";
import { getComplianceOverview, upsertPropFirmRules } from "@/lib/prop-firm.functions";
import type { ComplianceStatus } from "@/lib/prop-firm-calc";
import type { Database } from "@/integrations/supabase/types";

type PropFirmRulesRow = Database["public"]["Tables"]["prop_firm_rules"]["Row"];

export const Route = createFileRoute("/app/prop-rules")({
  head: () => ({
    meta: [
      { title: "Prop rules — Curated Trades" },
      { name: "description", content: "Track daily loss, drawdown, and profit-target compliance against a prop firm's rules." },
    ],
  }),
  component: PropRulesPage,
});

interface RuleForm {
  isActive: boolean;
  timezone: string;
  calculationBasis: "starting_balance" | "current_balance" | "high_water_mark";
  maxDailyLossPercent: string;
  maxTotalDrawdownPercent: string;
  profitTargetPercent: string;
  minTradingDays: string;
  maxTradingDays: string;
  consistencyPercent: string;
  allowWeekendHolding: boolean;
  allowNewsTrading: boolean;
  notes: string;
}

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

function PropRulesPage() {
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState<RuleForm | null>(null);
  // Tracks which account `form` currently holds data for. Without this,
  // switching accounts (the tab row below, or the sidebar's own switcher)
  // would leave `form` holding the *previous* account's rules — and since
  // handleSubmit saves using the current accountId, hitting Save after
  // switching would silently write one account's rule profile onto
  // another one's. See DECISIONS.md.
  const [formAccountId, setFormAccountId] = useState<string | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);

  const workspaceQuery = useQuery({ queryKey: ["workspace"], queryFn: () => getWorkspace() });
  const workspace = workspaceQuery.data;
  const accounts = workspace?.accounts ?? [];
  // Defaults to the sidebar's active account, but stays independently
  // switchable here via the tab row — the whole point of a per-account
  // page is being able to check on one account without changing what the
  // rest of the app (Journal, Analytics) is scoped to.
  const accountId = selectedAccountId ?? workspace?.activeAccount?.id ?? accounts[0]?.id ?? null;

  const overviewQuery = useQuery({
    queryKey: ["prop-firm-overview", accountId],
    queryFn: () => getComplianceOverview({ data: { accountId: accountId as string } }),
    enabled: accountId != null,
  });
  const overview = overviewQuery.data;

  useEffect(() => {
    if (!workspace || !accountId || overview === undefined) return;
    if (formAccountId === accountId) return; // already loaded for the currently-selected account
    if (overview.rules) {
      setForm(formFromRow(overview.rules));
      setIsEditing(false);
    } else {
      setForm(defaultForm(workspace.profile.timezone));
      setIsEditing(true);
    }
    setFormAccountId(accountId);
  }, [workspace, overview, accountId, formAccountId]);

  const saveMutation = useMutation({
    mutationFn: upsertPropFirmRules,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["prop-firm-overview", accountId] });
      setIsEditing(false);
    },
  });

  function startEdit() {
    if (overview?.rules) setForm(formFromRow(overview.rules));
    setIsEditing(true);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saveMutation.isPending) return;
    if (!form || !accountId) return;
    saveMutation.mutate({
      data: {
        accountId,
        isActive: form.isActive,
        timezone: form.timezone.trim() || "UTC",
        calculationBasis: form.calculationBasis,
        maxDailyLossPercent: Number(form.maxDailyLossPercent),
        maxTotalDrawdownPercent: Number(form.maxTotalDrawdownPercent),
        profitTargetPercent: form.profitTargetPercent.trim() === "" ? null : Number(form.profitTargetPercent),
        minTradingDays: form.minTradingDays.trim() === "" ? null : Number(form.minTradingDays),
        maxTradingDays: form.maxTradingDays.trim() === "" ? null : Number(form.maxTradingDays),
        consistencyPercent: form.consistencyPercent.trim() === "" ? null : Number(form.consistencyPercent),
        allowWeekendHolding: form.allowWeekendHolding,
        allowNewsTrading: form.allowNewsTrading,
        notes: form.notes.trim() === "" ? null : form.notes.trim(),
      },
    });
  }

  if (workspaceQuery.isLoading || !workspace) {
    return <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>;
  }

  const status: ComplianceStatus | null = overview?.status ?? null;

  return (
    <>
      <section className="mb-6 flex flex-col justify-between gap-4 border-b border-border pb-5 sm:flex-row sm:items-center">
        <h1 className="page-title">Prop-firm rules</h1>
        {overview?.rules && !isEditing && (
          <Button variant="outline" onClick={startEdit}>
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
              onClick={() => setSelectedAccountId(account.id)}
            >
              {account.name}
            </Button>
          ))}
        </div>
      )}

      {!overview?.rules && !isEditing && (
        <div className="surface-panel p-6 text-center">
          <ShieldCheck className="mx-auto mb-3 size-8 text-muted-foreground" />
          <p className="panel-title mb-1">No rule profile set up yet</p>
          <p className="mb-4 text-sm text-muted-foreground">
            Add this prop firm's daily loss, drawdown, and profit-target rules to track compliance against this account.
          </p>
          <Button onClick={() => setIsEditing(true)}>Set up rule profile</Button>
        </div>
      )}

      {isEditing && form && (
        <form onSubmit={handleSubmit} className="surface-panel mb-6 p-6">
          <p className="panel-heading mb-4">Rule profile</p>
          <div className="metric-grid mb-4">
            <div>
              <label className="field-label">Calculation basis</label>
              <Select
                value={form.calculationBasis}
                onValueChange={(value) => setForm({ ...form, calculationBasis: value as RuleForm["calculationBasis"] })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="starting_balance">{BASIS_LABEL.starting_balance}</SelectItem>
                  <SelectItem value="current_balance">{BASIS_LABEL.current_balance}</SelectItem>
                  <SelectItem value="high_water_mark">{BASIS_LABEL.high_water_mark}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="field-label" htmlFor="rule-timezone">
                Prop firm timezone (IANA)
              </label>
              <Input
                id="rule-timezone"
                placeholder="e.g. America/New_York"
                value={form.timezone}
                onChange={(event) => setForm({ ...form, timezone: event.target.value })}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="rule-daily-loss">
                Max daily loss %
              </label>
              <Input
                id="rule-daily-loss"
                type="number"
                step="0.1"
                min="0"
                required
                className="font-mono"
                value={form.maxDailyLossPercent}
                onChange={(event) => setForm({ ...form, maxDailyLossPercent: event.target.value })}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="rule-drawdown">
                Max total drawdown %
              </label>
              <Input
                id="rule-drawdown"
                type="number"
                step="0.1"
                min="0"
                required
                className="font-mono"
                value={form.maxTotalDrawdownPercent}
                onChange={(event) => setForm({ ...form, maxTotalDrawdownPercent: event.target.value })}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="rule-target">
                Profit target % (optional)
              </label>
              <Input
                id="rule-target"
                type="number"
                step="0.1"
                min="0"
                placeholder="Optional"
                className="font-mono"
                value={form.profitTargetPercent}
                onChange={(event) => setForm({ ...form, profitTargetPercent: event.target.value })}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="rule-consistency">
                Consistency rule % (optional)
              </label>
              <Input
                id="rule-consistency"
                type="number"
                step="1"
                min="0"
                max="100"
                placeholder="Max % of profit from one day"
                className="font-mono"
                value={form.consistencyPercent}
                onChange={(event) => setForm({ ...form, consistencyPercent: event.target.value })}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="rule-min-days">
                Min trading days (optional)
              </label>
              <Input
                id="rule-min-days"
                type="number"
                step="1"
                min="0"
                placeholder="Optional"
                className="font-mono"
                value={form.minTradingDays}
                onChange={(event) => setForm({ ...form, minTradingDays: event.target.value })}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="rule-max-days">
                Max trading days (optional)
              </label>
              <Input
                id="rule-max-days"
                type="number"
                step="1"
                min="0"
                placeholder="Optional"
                className="font-mono"
                value={form.maxTradingDays}
                onChange={(event) => setForm({ ...form, maxTradingDays: event.target.value })}
              />
            </div>
          </div>

          <div className="mb-4 flex flex-wrap gap-6 text-sm">
            <label className="flex items-center gap-2">
              <Checkbox
                checked={form.allowWeekendHolding}
                onCheckedChange={(checked) => setForm({ ...form, allowWeekendHolding: checked === true })}
              />
              Weekend holding allowed
            </label>
            <label className="flex items-center gap-2">
              <Checkbox
                checked={form.allowNewsTrading}
                onCheckedChange={(checked) => setForm({ ...form, allowNewsTrading: checked === true })}
              />
              News-event trading allowed
            </label>
            <label className="flex items-center gap-2">
              <Checkbox
                checked={form.isActive}
                onCheckedChange={(checked) => setForm({ ...form, isActive: checked === true })}
              />
              Rules currently apply to this account
            </label>
          </div>

          <label className="field-label" htmlFor="rule-notes">
            Notes (optional)
          </label>
          <Textarea
            id="rule-notes"
            className="mb-4"
            placeholder="Anything else about this firm's rules worth remembering"
            value={form.notes}
            onChange={(event) => setForm({ ...form, notes: event.target.value })}
          />

          <div className="flex gap-2">
            <Button type="submit" disabled={saveMutation.isPending}>
              {saveMutation.isPending ? "Saving…" : "Save rule profile"}
            </Button>
            {overview?.rules && (
              <Button type="button" variant="ghost" onClick={() => setIsEditing(false)}>
                Cancel
              </Button>
            )}
          </div>
        </form>
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
