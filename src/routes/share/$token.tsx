// Public, unauthenticated report view behind a coach share link
// (Phase 2.5). No sidebar/app-shell — this renders standalone, the same as
// "/", "/sign-in", etc. Also doubles as the owner's own print preview (see
// the "Preview" button on /app/reports) so there's exactly one report view
// to keep polished, not two that can drift apart.
//
// The report is fetched by the route loader (client-side — each view bumps the
// link's view counter, so it must run exactly once per visit, not once on the
// server and again in the browser) and an invalid/expired/revoked link is the
// route's `errorComponent`. The comment box is a TanStack Form.
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Printer } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { formProps, useAppForm } from "@/lib/form";
import { formatMoney } from "@/lib/money";
import { addCoachComment } from "@/lib/public-share.functions";
import { sharedReportQueryOptions } from "@/lib/queries";

export const Route = createFileRoute("/share/$token")({
  head: () => ({
    meta: [
      { title: "Shared report — Curated Trades" },
      { name: "description", content: "A shared, read-only trading report." },
    ],
  }),
  ssr: false,
  loader: ({ context, params }) => context.queryClient.ensureQueryData(sharedReportQueryOptions(params.token)),
  // A broken link shouldn't be retried or offer a "try again".
  errorComponent: ({ error }) => (
    <div className="mx-auto max-w-md px-6 py-24 text-center">
      <p className="page-title mb-2">Link unavailable</p>
      <p className="text-sm text-muted-foreground">
        {error.message || "This link is invalid, expired, or has been revoked."}
      </p>
    </div>
  ),
  pendingComponent: () => <p className="py-20 text-center text-sm text-muted-foreground">Loading report…</p>,
  component: SharedReportPage,
});

const commentSchema = z.object({
  authorName: z.string().trim().min(1, "Enter your name"),
  body: z.string().trim().min(1, "Write a comment first"),
});

function CommentForm({ token }: { token: string }) {
  const queryClient = useQueryClient();
  const post = useMutation({
    mutationFn: addCoachComment,
    onSuccess: () => {
      form.setFieldValue("body", "");
      void queryClient.invalidateQueries({ queryKey: sharedReportQueryOptions(token).queryKey });
    },
    onError: (error) => toast.error(error.message || "Couldn't post comment"),
  });
  const form = useAppForm({
    defaultValues: { authorName: "", body: "" },
    validators: { onSubmit: commentSchema },
    onSubmit: ({ value }) => post.mutate({ data: { token, authorName: value.authorName.trim(), body: value.body.trim() } }),
  });
  return (
    <form {...formProps(form)} className="space-y-3">
      <form.AppField name="authorName">{(field) => <field.TextField placeholder="Your name" />}</form.AppField>
      <form.AppField name="body">{(field) => <field.TextareaField placeholder="Add a comment…" />}</form.AppField>
      <form.AppForm>
        <form.SubmitButton pendingLabel="Posting…" pending={post.isPending}>
          Post comment
        </form.SubmitButton>
      </form.AppForm>
    </form>
  );
}

function StatTile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="surface-panel p-4">
      <p className="eyebrow mb-2">{label}</p>
      <p className="metric-value">{value}</p>
      {detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}
    </div>
  );
}

function EquitySparkline({ points }: { points: { index: number; value: number }[] }) {
  if (points.length < 2) return null;
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const width = 640;
  const height = 160;
  const step = width / (points.length - 1);
  const path = points
    .map((p, i) => `${(i * step).toFixed(1)},${(height - 12 - ((p.value - min) / range) * (height - 24)).toFixed(1)}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-40 w-full" preserveAspectRatio="none">
      <polyline points={path} fill="none" stroke="var(--color-chart-2)" strokeWidth="2" />
    </svg>
  );
}

function SharedReportPage() {
  const { token } = Route.useParams();
  const { data: report } = useSuspenseQuery(sharedReportQueryOptions(token));
  const { stats } = report;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="no-print mx-auto flex max-w-4xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-3">
          <span className="brand-mark" aria-hidden="true" />
          <span className="wordmark">Curated <em>Trades</em></span>
        </div>
        <Button variant="outline" size="sm" onClick={() => window.print()}>
          <Printer /> Print / Save as PDF
        </Button>
      </header>

      <main className="mx-auto max-w-4xl px-6 pb-24">
        <section className="mb-8">
          <p className="eyebrow mb-1">{report.portfolioName}</p>
          <h1 className="page-title">{report.label}</h1>
          {(report.periodStart || report.periodEnd) && (
            <p className="mt-1 text-sm text-muted-foreground">
              {report.periodStart ?? "Account start"} – {report.periodEnd ?? "present"}
            </p>
          )}
          {report.hideDollarPnl && (
            <p className="mt-2 text-xs text-muted-foreground">Dollar P&amp;L is hidden on this link — figures below are win rate, R multiples, and ratios only.</p>
          )}
        </section>

        <div className="metric-grid mb-8">
          <StatTile label="Trades" value={String(stats.tradeCount)} />
          <StatTile label="Win rate" value={stats.winRate != null ? `${stats.winRate}%` : "—"} />
          <StatTile
            label="Profit factor"
            value={stats.profitFactor == null ? "—" : stats.profitFactor === Infinity ? "∞" : stats.profitFactor.toFixed(2)}
          />
          <StatTile label="Avg R multiple" value={stats.averageRMultiple != null ? `${stats.averageRMultiple.toFixed(2)}R` : "—"} />
          <StatTile
            label="Max drawdown"
            value={stats.maxDrawdownPercent != null ? `${stats.maxDrawdownPercent.toFixed(1)}%` : "Not enough data"}
          />
          {!report.hideDollarPnl && <StatTile label="Net P&L" value={formatMoney(stats.netPnl, report.currency)} />}
          {stats.currentStreak && (
            <StatTile
              label="Current streak"
              value={`${stats.currentStreak.count} ${stats.currentStreak.type}${stats.currentStreak.count > 1 ? "s" : ""}`}
            />
          )}
        </div>

        <section className="surface-panel mb-8 p-5">
          <p className="panel-title mb-3">{report.hideDollarPnl ? "Cumulative R multiple" : "Equity curve"}</p>
          <EquitySparkline points={report.equityCurve} />
        </section>

        <section className="surface-panel mb-8 overflow-hidden p-0">
          <div className="p-5 pb-0">
            <p className="panel-title">Trades</p>
          </div>
          <div className="trade-table-wrap">
            <table className="trade-table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Direction</th>
                  <th>Closed</th>
                  <th>R multiple</th>
                  {!report.hideDollarPnl && <th>Net P&amp;L</th>}
                </tr>
              </thead>
              <tbody>
                {report.trades.map((trade) => (
                  <tr key={trade.id}>
                    <td>{trade.symbol}</td>
                    <td className="capitalize">{trade.direction}</td>
                    <td className="font-mono text-xs text-muted-foreground">
                      {trade.closedAt ? new Date(trade.closedAt).toLocaleDateString() : "—"}
                    </td>
                    <td className="font-mono">{trade.realizedRMultiple != null ? `${trade.realizedRMultiple.toFixed(2)}R` : "—"}</td>
                    {!report.hideDollarPnl && (
                      <td className={`font-mono ${(trade.netPnl ?? 0) >= 0 ? "text-chart-2" : "text-destructive"}`}>
                        {trade.netPnl != null ? formatMoney(trade.netPnl, report.currency) : "—"}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {report.trades.length === 0 && (
              <p className="px-6 py-8 text-center text-sm text-muted-foreground">No closed trades in this period.</p>
            )}
          </div>
        </section>

        <section className="no-print surface-panel p-5">
          <p className="panel-title mb-3">Comments</p>
          <ul className="mb-4 space-y-3">
            {report.comments.map((comment) => (
              <li key={comment.id} className="text-sm">
                <span className="font-medium">{comment.authorName}</span>{" "}
                <span className="text-xs text-muted-foreground">{new Date(comment.createdAt).toLocaleString()}</span>
                <p className="text-muted-foreground">{comment.body}</p>
              </li>
            ))}
            {report.comments.length === 0 && <p className="text-sm text-muted-foreground">No comments yet.</p>}
          </ul>

          {report.permission === "comment" ? (
            <CommentForm token={token} />
          ) : (
            <p className="text-xs text-muted-foreground">Comments are disabled on this link.</p>
          )}
        </section>
      </main>
    </div>
  );
}
