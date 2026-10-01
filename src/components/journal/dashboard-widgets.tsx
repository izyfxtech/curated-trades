// Small shared display components used across the dashboard and journal:
// MetricCard (the stat-card tiles), TradeRow (one row of the trade table,
// including its edit/delete menu), and ComparisonRow (used by the
// Curated-vs-Impulse panel). Kept in one file since they're all simple,
// presentation-only pieces with no data-fetching of their own.
import { ArrowDownRight, ArrowUpRight, MoreHorizontal, Paperclip, Pencil, Target, Trash2 } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { calculateHoldingSeconds, detectSessionFallback } from "@/lib/trade-calc";
import { formatSignedMoney } from "@/lib/money";
import type { Database } from "@/integrations/supabase/types";

type TradeRowData = Database["public"]["Tables"]["trades"]["Row"];
type TagRowData = Database["public"]["Tables"]["tags"]["Row"];

export function MetricCard({
  label,
  value,
  change,
  detail,
  positive,
  icon,
}: {
  label: string;
  value: string;
  change: string;
  detail: string;
  positive?: boolean;
  icon: ReactNode;
}) {
  return (
    <div className="surface-panel metric-card">
      <div className="mb-5 flex items-center justify-between">
        <p className="eyebrow">{label}</p>
        <span className="metric-icon">{icon}</span>
      </div>
      <p className="metric-value">{value}</p>
      <div className="mt-3 flex items-center gap-2 text-xs">
        <span className={positive ? "change-positive" : "change-neutral"}>
          {positive && <ArrowUpRight className="size-3" />}
          {change}
        </span>
        <span className="text-muted-foreground">{detail}</span>
      </div>
    </div>
  );
}

export function ComparisonRow({
  label,
  count,
  winRate,
  result,
  positive = false,
}: {
  label: string;
  count: number;
  winRate: number;
  result: string;
  positive?: boolean;
}) {
  return (
    <div className="comparison-row">
      <div className="flex items-center gap-3">
        <span className={`comparison-dot ${positive ? "dot-positive" : "dot-negative"}`} />
        <div>
          <p className="text-sm font-semibold">{label}</p>
          <p className="text-xs text-muted-foreground">
            {count} trades, {winRate}% win rate
          </p>
        </div>
      </div>
      <span className={`font-mono text-sm font-semibold ${positive ? "text-chart-2" : "text-destructive"}`}>
        {result}
      </span>
    </div>
  );
}

export function formatTradeDate(value: string) {
  const date = new Date(value);
  return (
    date.toLocaleDateString("en-US", { month: "short", day: "2-digit" }) +
    ", " +
    date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
  );
}

export function formatDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
}

export function TradeRow({
  trade,
  tags,
  attachmentCount,
  currency,
  isDeleting = false,
  onOpenDetail,
  onEdit,
  onDelete,
}: {
  trade: TradeRowData;
  tags: TagRowData[];
  attachmentCount: number;
  /** The trade's own account's currency — trades in the same table can belong to different accounts. */
  currency: string;
  isDeleting?: boolean;
  onOpenDetail: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const isLong = trade.direction === "long";
  const isCurated = trade.curated_label === "curated";
  const netPnl = trade.net_pnl ?? 0;
  const rMultiple = trade.realized_r_multiple ?? trade.planned_r_multiple ?? 0;
  const playbookName =
    trade.playbook_snapshot && typeof trade.playbook_snapshot === "object" && "name" in trade.playbook_snapshot
      ? String((trade.playbook_snapshot as { name?: unknown }).name ?? "")
      : null;

  return (
    <tr className="cursor-pointer" onClick={onOpenDetail}>
      <td>
        <div className="flex items-center gap-3">
          <span
            className={`instrument-icon ${trade.market === "crypto" ? "instrument-crypto" : "instrument-forex"}`}
          >
            {trade.symbol.slice(0, 2)}
          </span>
          <div>
            <p className="text-sm font-semibold">
              {trade.symbol}
              {trade.status !== "closed" && (
                <span className="ml-2 text-xs font-normal text-chart-2">{trade.status}</span>
              )}
              {playbookName && (
                <Target className="ml-1.5 inline size-3 text-muted-foreground" aria-label={`Played from "${playbookName}"`}>
                  <title>{`Played from "${playbookName}"`}</title>
                </Target>
              )}
            </p>
            <p className="text-xs text-muted-foreground">
              {trade.market === "crypto" ? "Crypto" : "Forex"}, {formatTradeDate(trade.opened_at)}
            </p>
          </div>
        </div>
      </td>
      <td>
        <span className={`direction ${isLong ? "direction-long" : "direction-short"}`}>
          {isLong ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
          {isLong ? "Long" : "Short"}
        </span>
      </td>
      <td className="text-sm text-muted-foreground">{trade.session ?? detectSessionFallback(trade.opened_at)}</td>
      <td className="font-mono text-sm text-muted-foreground">
        {formatDuration(calculateHoldingSeconds(trade.opened_at, trade.closed_at))}
      </td>
      <td>
        {trade.status === "closed" ? (
          <span className={`font-mono font-semibold ${netPnl > 0 ? "text-chart-2" : "text-destructive"}`}>
            {formatSignedMoney(netPnl, currency)}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>
      <td>
        <span
          className={`font-mono ${
            rMultiple > 0
              ? "text-chart-2"
              : rMultiple < 0
                ? "text-destructive"
                : "text-muted-foreground"
          }`}
        >
          {rMultiple > 0 ? "+" : ""}
          {Number(rMultiple.toFixed(2))}R
        </span>
      </td>
      <td>
        <div className="flex flex-wrap items-center gap-1">
          <Badge variant="outline" className={isCurated ? "tag-curated" : "tag-impulse"}>
            {isCurated ? "Curated" : "Impulse"}
          </Badge>
          {tags.slice(0, 2).map((tag) => (
            <Badge variant="outline" key={tag.id} className="text-[10px]">
              {tag.name}
            </Badge>
          ))}
          {tags.length > 2 && (
            <span className="text-[10px] text-muted-foreground">+{tags.length - 2}</span>
          )}
          {attachmentCount > 0 && (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground" title={`${attachmentCount} screenshot${attachmentCount === 1 ? "" : "s"}`}>
              <Paperclip className="size-3" />
              {attachmentCount}
            </span>
          )}
        </div>
      </td>
      <td className="relative" onClick={(event) => event.stopPropagation()}>
        <Button variant="ghost" size="icon" aria-label={`Edit ${trade.symbol} trade`} title="Edit trade" onClick={onEdit}>
          <Pencil />
        </Button>
        {/* modal={false}: opening the edit Dialog from a *modal* dropdown's onSelect
            leaves the page's pointer-events locked, so the form (and the rest of
            the page) stopped responding to clicks. */}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={`Actions for ${trade.symbol}`} title="Trade actions">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil className="size-3.5" /> Edit
            </DropdownMenuItem>
            <DropdownMenuItem className="text-destructive" disabled={isDeleting} onSelect={onDelete}>
              <Trash2 className="size-3.5" /> {isDeleting ? "Deleting…" : "Delete"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
}
