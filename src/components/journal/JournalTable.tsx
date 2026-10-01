// The Journal's trade table, built on TanStack Table (v9).
//
// Everything that narrows or reorders the list happens on the server — the
// database filters, sorts and slices, and only one page crosses the wire (see
// listTradesPage in trades.functions.ts). So the table runs in "manual" mode:
//   * `manualSorting` / `manualPagination` — Table keeps the sort + page state
//     and renders the header controls, but never reorders or slices rows
//     itself (the rows it is given are already the right page, in order);
//   * `rowCount` — the total number of matching trades across all pages, so
//     it can work out how many pages exist;
//   * sorting and pagination are *controlled* by the caller (the route keeps
//     them in the URL search params), so a sorted/paged view is linkable and
//     survives refresh.
import {
  createColumnHelper,
  rowPaginationFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type PaginationState,
  type SortingState,
  type Updater,
} from "@tanstack/react-table";
import { ArrowDown, ArrowDownRight, ArrowUp, ArrowUpDown, ArrowUpRight, ChevronLeft, ChevronRight, MoreHorizontal, Paperclip, Pencil, Target, Trash2 } from "lucide-react";

import { formatDuration, formatTradeDate } from "@/components/journal/dashboard-widgets";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Database } from "@/integrations/supabase/types";
import { formatSignedMoney } from "@/lib/money";
import { calculateHoldingSeconds, detectSessionFallback } from "@/lib/trade-calc";
import { TRADE_PAGE_SIZES } from "@/lib/trade-filters";
import type { TradePageRow } from "@/lib/trades.functions";

type TagRowData = Database["public"]["Tables"]["tags"]["Row"];

const features = tableFeatures({ rowSortingFeature, rowPaginationFeature });
const helper = createColumnHelper<typeof features, TradePageRow>();

/** Everything the cells need that isn't on the trade row itself. */
export interface JournalTableMeta {
  tagsById: Map<string, TagRowData>;
  /** account_id → currency; rows can span accounts of different currencies. */
  currencyByAccountId: Map<string, string>;
  deletingTradeId: string | null;
  onOpen: (trade: TradePageRow) => void;
  onEdit: (trade: TradePageRow) => void;
  onDelete: (trade: TradePageRow) => void;
}

function metaOf(table: { options: { meta?: unknown } }): JournalTableMeta {
  return table.options.meta as JournalTableMeta;
}

function SortHeader({
  label,
  direction,
  onToggle,
  align = "left",
}: {
  label: string;
  direction: false | "asc" | "desc";
  onToggle: ((event: unknown) => void) | undefined;
  align?: "left" | "right";
}) {
  const Icon = direction === "asc" ? ArrowUp : direction === "desc" ? ArrowDown : ArrowUpDown;
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`inline-flex items-center gap-1 hover:text-foreground ${align === "right" ? "flex-row-reverse" : ""}`}
      aria-label={`Sort by ${label}${direction ? `, currently ${direction === "asc" ? "ascending" : "descending"}` : ""}`}
    >
      {label}
      <Icon className={`size-3 ${direction ? "text-foreground" : "text-muted-foreground/60"}`} />
    </button>
  );
}

const columns = helper.columns([
  helper.accessor("opened_at", {
    id: "opened",
    header: ({ column }) => <SortHeader label="Instrument" direction={column.getIsSorted()} onToggle={column.getToggleSortingHandler()} />,
    cell: ({ row }) => {
      const trade = row.original;
      const playbookName =
        trade.playbook_snapshot && typeof trade.playbook_snapshot === "object" && "name" in trade.playbook_snapshot
          ? String((trade.playbook_snapshot as { name?: unknown }).name ?? "")
          : null;
      return (
        <div className="flex items-center gap-3">
          <span className={`instrument-icon ${trade.market === "crypto" ? "instrument-crypto" : "instrument-forex"}`}>
            {trade.symbol.slice(0, 2)}
          </span>
          <div>
            <p className="text-sm font-semibold">
              {trade.symbol}
              {trade.status !== "closed" && <span className="ml-2 text-xs font-normal text-chart-2">{trade.status}</span>}
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
      );
    },
  }),
  helper.accessor("direction", {
    id: "direction",
    header: ({ column }) => <SortHeader label="Direction" direction={column.getIsSorted()} onToggle={column.getToggleSortingHandler()} />,
    cell: ({ row }) => {
      const isLong = row.original.direction === "long";
      return (
        <span className={`direction ${isLong ? "direction-long" : "direction-short"}`}>
          {isLong ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
          {isLong ? "Long" : "Short"}
        </span>
      );
    },
  }),
  helper.accessor("session", {
    id: "session",
    header: ({ column }) => <SortHeader label="Session" direction={column.getIsSorted()} onToggle={column.getToggleSortingHandler()} />,
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground">{row.original.session ?? detectSessionFallback(row.original.opened_at)}</span>
    ),
  }),
  helper.display({
    id: "duration",
    header: "Duration",
    enableSorting: false,
    cell: ({ row }) => (
      <span className="font-mono text-sm text-muted-foreground">
        {formatDuration(calculateHoldingSeconds(row.original.opened_at, row.original.closed_at))}
      </span>
    ),
  }),
  helper.accessor("net_pnl", {
    id: "result",
    header: ({ column }) => <SortHeader label="Result" direction={column.getIsSorted()} onToggle={column.getToggleSortingHandler()} />,
    cell: ({ row, table }) => {
      const trade = row.original;
      if (trade.status !== "closed") return <span className="text-xs text-muted-foreground">—</span>;
      const netPnl = trade.net_pnl ?? 0;
      const currency = metaOf(table).currencyByAccountId.get(trade.account_id) ?? "USD";
      return (
        <span className={`font-mono font-semibold ${netPnl > 0 ? "text-chart-2" : "text-destructive"}`}>
          {formatSignedMoney(netPnl, currency)}
        </span>
      );
    },
  }),
  helper.accessor("realized_r_multiple", {
    id: "r",
    header: ({ column }) => <SortHeader label="R multiple" direction={column.getIsSorted()} onToggle={column.getToggleSortingHandler()} />,
    cell: ({ row }) => {
      const r = row.original.realized_r_multiple ?? row.original.planned_r_multiple ?? 0;
      return (
        <span className={`font-mono ${r > 0 ? "text-chart-2" : r < 0 ? "text-destructive" : "text-muted-foreground"}`}>
          {r > 0 ? "+" : ""}
          {Number(r.toFixed(2))}R
        </span>
      );
    },
  }),
  helper.accessor("curated_label", {
    id: "label",
    header: ({ column }) => <SortHeader label="Label" direction={column.getIsSorted()} onToggle={column.getToggleSortingHandler()} />,
    cell: ({ row, table }) => {
      const trade = row.original;
      const isCurated = trade.curated_label === "curated";
      const { tagsById } = metaOf(table);
      const tags = trade.tagIds.flatMap((id) => {
        const tag = tagsById.get(id);
        return tag ? [tag] : [];
      });
      return (
        <div className="flex flex-wrap items-center gap-1">
          <Badge variant="outline" className={isCurated ? "tag-curated" : "tag-impulse"}>
            {isCurated ? "Curated" : "Impulse"}
          </Badge>
          {tags.slice(0, 2).map((tag) => (
            <Badge variant="outline" key={tag.id} className="text-[10px]">
              {tag.name}
            </Badge>
          ))}
          {tags.length > 2 && <span className="text-[10px] text-muted-foreground">+{tags.length - 2}</span>}
          {trade.attachmentCount > 0 && (
            <span
              className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground"
              title={`${trade.attachmentCount} screenshot${trade.attachmentCount === 1 ? "" : "s"}`}
            >
              <Paperclip className="size-3" />
              {trade.attachmentCount}
            </span>
          )}
        </div>
      );
    },
  }),
  helper.display({
    id: "actions",
    header: () => <span className="sr-only">Actions</span>,
    enableSorting: false,
    cell: ({ row, table }) => {
      const trade = row.original;
      const meta = metaOf(table);
      const isDeleting = meta.deletingTradeId === trade.id;
      return (
        <div className="relative" onClick={(event) => event.stopPropagation()}>
          <Button variant="ghost" size="icon" aria-label={`Edit ${trade.symbol} trade`} title="Edit trade" onClick={() => meta.onEdit(trade)}>
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
              <DropdownMenuItem onSelect={() => meta.onEdit(trade)}>
                <Pencil className="size-3.5" /> Edit
              </DropdownMenuItem>
              <DropdownMenuItem className="text-destructive" disabled={isDeleting} onSelect={() => meta.onDelete(trade)}>
                <Trash2 className="size-3.5" /> {isDeleting ? "Deleting…" : "Delete"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      );
    },
  }),
]);

/** "1–50 of 1,234 trades", rows-per-page, and prev/next. Props-driven so the
 * table view (via Table's own pagination API) and the gallery view share it. */
export function JournalPager({
  total,
  pageIndex,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: {
  total: number;
  pageIndex: number;
  pageSize: number;
  onPageChange: (index: number) => void;
  onPageSizeChange: (size: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const firstShown = total === 0 ? 0 : pageIndex * pageSize + 1;
  const lastShown = Math.min(total, (pageIndex + 1) * pageSize);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-xs text-muted-foreground">
      <p aria-live="polite">
        {total === 0 ? "No trades" : `${firstShown.toLocaleString()}–${lastShown.toLocaleString()} of ${total.toLocaleString()} trades`}
      </p>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2">
          Rows
          <Select value={String(pageSize)} onValueChange={(value) => onPageSizeChange(Number(value))}>
            <SelectTrigger className="h-8 w-20">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TRADE_PAGE_SIZES.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <span>
          Page {pageIndex + 1} of {pageCount.toLocaleString()}
        </span>
        <div className="flex gap-1">
          <Button type="button" variant="outline" size="icon" className="size-8" aria-label="Previous page" disabled={pageIndex === 0} onClick={() => onPageChange(pageIndex - 1)}>
            <ChevronLeft />
          </Button>
          <Button type="button" variant="outline" size="icon" className="size-8" aria-label="Next page" disabled={pageIndex + 1 >= pageCount} onClick={() => onPageChange(pageIndex + 1)}>
            <ChevronRight />
          </Button>
        </div>
      </div>
    </div>
  );
}

const EMPTY_ROWS: TradePageRow[] = [];

export function JournalTable({
  rows,
  total,
  sorting,
  onSortingChange,
  pagination,
  onPaginationChange,
  isFetching,
  emptyState,
  meta,
}: {
  rows: TradePageRow[] | undefined;
  /** Trades matching the current filters across ALL pages. */
  total: number;
  sorting: SortingState;
  onSortingChange: (updater: Updater<SortingState>) => void;
  pagination: PaginationState;
  onPaginationChange: (updater: Updater<PaginationState>) => void;
  /** A new page/sort/filter is loading (the previous rows stay on screen meanwhile). */
  isFetching: boolean;
  emptyState: React.ReactNode;
  meta: JournalTableMeta;
}) {
  const table = useTable({
    features,
    columns,
    data: rows ?? EMPTY_ROWS,
    rowCount: total,
    manualSorting: true,
    manualPagination: true,
    enableMultiSort: false,
    state: { sorting, pagination },
    onSortingChange,
    onPaginationChange,
    meta,
    getRowId: (trade) => trade.id,
  });

  return (
    <div className="surface-panel overflow-hidden p-0">
      <div className={`trade-table-wrap transition-opacity ${isFetching ? "opacity-60" : ""}`} aria-busy={isFetching}>
        <table className="trade-table">
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => (
                  <th key={header.id}>{header.isPlaceholder ? null : <table.FlexRender header={header} />}</th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="cursor-pointer" onClick={() => meta.onOpen(row.original)}>
                {row.getAllCells().map((cell) => (
                  <td key={cell.id}>
                    <table.FlexRender cell={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {rows !== undefined && rows.length === 0 && emptyState}
      </div>

      <JournalPager
        total={total}
        pageIndex={pagination.pageIndex}
        pageSize={pagination.pageSize}
        onPageChange={(index) => table.setPageIndex(index)}
        onPageSizeChange={(size) => table.setPageSize(size)}
      />
    </div>
  );
}
