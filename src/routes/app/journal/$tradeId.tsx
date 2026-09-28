// Trade detail/breakdown page — a real, bookmarkable URL for "everything
// about this one trade," separate from LogTradeModal (which exists to
// create/edit a trade, not to read it back). Reached by clicking a point
// on the equity curve, a row in the analytics breakdown explorer, a
// journal table row, or a screenshot-gallery card — all of those now link
// straight here instead of opening the edit modal, which stays a distinct
// action reachable from this page's own Edit button.
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowDownRight, ArrowLeft, ArrowUpRight, Pencil, Target, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getWorkspace } from "@/lib/portfolios.functions";
import { deleteTrade, getTrade } from "@/lib/trades.functions";
import { getTradeReview } from "@/lib/reviews.functions";
import { calculateHoldingSeconds, detectSessionFallback } from "@/lib/trade-calc";
import { formatDuration, formatTradeDate } from "@/components/journal/dashboard-widgets";
import { PartialExitsPanel } from "@/components/journal/PartialExitsPanel";
import { AttachmentsPanel } from "@/components/journal/AttachmentsPanel";
import { displaySize, formatSize } from "@/lib/instruments";
import { TradeReviewModal } from "@/components/reviews/TradeReviewModal";

export const Route = createFileRoute("/app/journal/$tradeId")({
  head: () => ({
    meta: [{ title: "Trade — Curated Trades" }],
  }),
  component: TradeDetailPage,
});

interface PlaybookChecklistSnapshotItem {
  prompt: string;
  isRequired: boolean;
  answered: boolean;
}

interface PlaybookSnapshot {
  name: string;
  checklist: PlaybookChecklistSnapshotItem[];
}

function money(value: number, currency: string): string {
  const sign = value >= 0 ? "+" : "−";
  const formatted = Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
  try {
    // Intl gives "$1,234" / "€1,234"; we only want the symbol/code, so pull it
    // via formatToParts rather than reformatting the (already-rounded) amount.
    const symbolPart = new Intl.NumberFormat(undefined, { style: "currency", currency })
      .formatToParts(0)
      .find((part) => part.type === "currency")?.value;
    return `${sign}${symbolPart ?? currency + " "}${formatted}`;
  } catch {
    return `${sign}${formatted} ${currency}`;
  }
}

function TradeDetailPage() {
  const { tradeId } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isReviewOpen, setIsReviewOpen] = useState(false);

  const workspaceQuery = useQuery({ queryKey: ["workspace"], queryFn: () => getWorkspace() });
  const workspace = workspaceQuery.data;

  const tradeQuery = useQuery({
    queryKey: ["trade-detail", tradeId],
    queryFn: () => getTrade({ data: { tradeId } }),
  });
  const trade = tradeQuery.data;

  const reviewQuery = useQuery({
    queryKey: ["trade-review", tradeId],
    queryFn: () => getTradeReview({ data: { tradeId } }),
    enabled: trade?.status === "closed",
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteTrade({ data: { tradeId } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["trades"] });
      void navigate({ to: "/app/journal" });
    },
  });

  if (workspaceQuery.isLoading || tradeQuery.isLoading) {
    return <p className="py-10 text-center text-sm text-muted-foreground">Loading trade…</p>;
  }

  if (tradeQuery.isError || !trade || !workspace) {
    return (
      <div className="surface-panel py-16 text-center">
        <p className="mb-3 text-sm text-muted-foreground">
          {tradeQuery.error instanceof Error ? tradeQuery.error.message : "Trade not found."}
        </p>
        <Link to="/app/journal" className="text-sm text-primary hover:underline">
          Back to Journal
        </Link>
      </div>
    );
  }

  const accountCurrency = (workspace.accounts.find((account) => account.id === trade.account_id)?.base_currency ?? "USD").toUpperCase();
  const size = displaySize(trade);
  const isLong = trade.direction === "long";
  const isCurated = trade.curated_label === "curated";
  const netPnl = trade.net_pnl ?? 0;
  const rMultiple = trade.realized_r_multiple ?? trade.planned_r_multiple ?? 0;
  const holdingSeconds = calculateHoldingSeconds(trade.opened_at, trade.closed_at);
  const playbookSnapshot =
    trade.playbook_snapshot && typeof trade.playbook_snapshot === "object" && "checklist" in trade.playbook_snapshot
      ? (trade.playbook_snapshot as unknown as PlaybookSnapshot)
      : null;
  const review = reviewQuery.data;

  return (
    <>
      <Link to="/app/journal" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> Back to Journal
      </Link>

      <section className="mb-6 flex flex-col justify-between gap-4 border-b border-border pb-5 sm:flex-row sm:items-start">
        <div>
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <h1 className="page-title">{trade.symbol}</h1>
            <span className={`direction ${isLong ? "direction-long" : "direction-short"}`}>
              {isLong ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
              {isLong ? "Long" : "Short"}
            </span>
            <Badge variant="outline" className={isCurated ? "tag-curated" : "tag-impulse"}>
              {isCurated ? "Curated" : "Impulse"}
            </Badge>
            {trade.status !== "closed" && <Badge variant="secondary">{trade.status}</Badge>}
          </div>
          <p className="text-xs text-muted-foreground">
            Opened {formatTradeDate(trade.opened_at)}
            {trade.closed_at && ` — Closed ${formatTradeDate(trade.closed_at)}`}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void navigate({ to: "/app/journal", search: { edit: tradeId } })}>
            <Pencil /> Edit
          </Button>
          <Button
            variant="outline"
            className="text-destructive"
            disabled={deleteMutation.isPending}
            onClick={() => {
              if (window.confirm(`Delete this ${trade.symbol} trade? This can't be undone.`)) {
                deleteMutation.mutate();
              }
            }}
          >
            <Trash2 /> {deleteMutation.isPending ? "Deleting…" : "Delete"}
          </Button>
        </div>
      </section>

      <div className="metric-grid mb-6">
        <div className="metric-card">
          <p className="eyebrow mb-2">Net P&amp;L</p>
          <p className={`metric-value ${netPnl >= 0 ? "text-chart-2" : "text-destructive"}`}>
            {trade.status === "closed" ? money(netPnl, accountCurrency) : "—"}
          </p>
        </div>
        <div className="metric-card">
          <p className="eyebrow mb-2">R multiple</p>
          <p className={`metric-value ${rMultiple > 0 ? "text-chart-2" : rMultiple < 0 ? "text-destructive" : ""}`}>
            {rMultiple > 0 ? "+" : ""}
            {Number(rMultiple.toFixed(2))}R
          </p>
        </div>
        <div className="metric-card">
          <p className="eyebrow mb-2">Session</p>
          <p className="metric-value">{trade.session ?? detectSessionFallback(trade.opened_at)}</p>
        </div>
        <div className="metric-card">
          <p className="eyebrow mb-2">Duration</p>
          <p className="metric-value">{formatDuration(holdingSeconds)}</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="surface-panel">
          <p className="panel-title mb-4">Trade facts</p>
          <dl className="space-y-2.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Entry price</dt>
              <dd className="font-mono">{trade.entry_price}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Exit price</dt>
              <dd className="font-mono">{trade.exit_price ?? "—"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Position size</dt>
              <dd className="font-mono">{formatSize(size)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Stop loss</dt>
              <dd className="font-mono">{trade.stop_loss ?? "—"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Take profit</dt>
              <dd className="font-mono">{trade.take_profit ?? "—"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Fees</dt>
              <dd className="font-mono">${trade.fees.toFixed(2)}</dd>
            </div>
            {trade.confidence != null && (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Confidence</dt>
                <dd className="font-mono">{trade.confidence}/5</dd>
              </div>
            )}
          </dl>

          {trade.notes && (
            <>
              <p className="field-label mb-1 mt-5">Notes</p>
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">{trade.notes}</p>
            </>
          )}

          {trade.tagNames.length > 0 && (
            <>
              <p className="field-label mb-1.5 mt-5">Tags</p>
              <div className="flex flex-wrap gap-1.5">
                {trade.tagNames.map((name) => (
                  <Badge variant="outline" key={name}>
                    {name}
                  </Badge>
                ))}
              </div>
            </>
          )}
        </section>

        {playbookSnapshot ? (
          <section className="surface-panel">
            <div className="mb-4 flex items-center gap-2">
              <Target className="size-4 text-muted-foreground" />
              <p className="panel-title">Played from "{playbookSnapshot.name}"</p>
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
              Snapshot from when this trade was logged — editing the playbook later doesn't change this.
            </p>
            <ul className="space-y-2">
              {playbookSnapshot.checklist.map((item, index) => (
                <li key={index} className="flex items-start gap-2 text-sm">
                  <span
                    className={`mt-0.5 inline-block size-3.5 shrink-0 rounded-sm border ${
                      item.answered ? "border-chart-2 bg-chart-2" : "border-border"
                    }`}
                  />
                  <span className={item.answered ? "" : "text-muted-foreground"}>
                    {item.prompt}
                    {item.isRequired && <span className="ml-1 text-destructive">*</span>}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <section className="surface-panel">
            <p className="panel-title mb-2">Review</p>
            {trade.status !== "closed" ? (
              <p className="text-sm text-muted-foreground">Reviews are available once a trade is closed.</p>
            ) : review ? (
              <div className="space-y-2.5 text-sm">
                {review.plan_adherence && (
                  <p>
                    <span className="text-muted-foreground">Plan adherence: </span>
                    <span className="capitalize">{review.plan_adherence}</span>
                  </p>
                )}
                {review.discipline_score != null && (
                  <p>
                    <span className="text-muted-foreground">Discipline: </span>
                    {review.discipline_score}/5
                  </p>
                )}
                {review.lesson_learned && (
                  <p>
                    <span className="text-muted-foreground">Lesson: </span>
                    {review.lesson_learned}
                  </p>
                )}
                <Button variant="outline" size="sm" onClick={() => setIsReviewOpen(true)}>
                  Edit review
                </Button>
              </div>
            ) : (
              <div>
                <p className="mb-3 text-sm text-muted-foreground">This trade hasn't been reviewed yet.</p>
                <Button variant="outline" size="sm" onClick={() => setIsReviewOpen(true)}>
                  Review this trade
                </Button>
              </div>
            )}
          </section>
        )}
      </div>

      <section className="surface-panel mt-6">
        <p className="panel-title mb-4">Partial exits</p>
        <PartialExitsPanel tradeId={tradeId} portfolioId={trade.portfolio_id} totalQuantity={size.value} unit={size.unit} />
      </section>

      <section className="surface-panel mt-6">
        <p className="panel-title mb-4">Screenshots</p>
        <AttachmentsPanel tradeId={tradeId} userId={workspace.profile.user_id} />
      </section>

      {isReviewOpen && (
        <TradeReviewModal
          trade={trade}
          onClose={() => setIsReviewOpen(false)}
          onSaved={() => {
            setIsReviewOpen(false);
            void queryClient.invalidateQueries({ queryKey: ["trade-review", tradeId] });
          }}
        />
      )}
    </>
  );
}
