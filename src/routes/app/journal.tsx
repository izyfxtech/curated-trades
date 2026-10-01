// Trade log ("/app/journal"): the trade table, the log/edit modal (see
// components/journal/LogTradeModal.tsx), and CSV import. This is the one
// place that owns trade creation/editing — the playbook picker, checklist,
// and confidence score all funnel through here regardless of whether the
// trade started as a manual entry or a converted trade idea (see
// playbooks.tsx's "Convert to trade" action).
//
// All of this page's UI state lives in the URL, via the route's typed search
// params, rather than in component state:
//   ?q= &outcome= &label= &status= &tagIds= &screenshots= &reviewState= &from= &to= …
//                                      the filters (shareable, and what the
//                                      Analytics P&L calendar deep-links to)
//   ?sort=result&dir=asc  ?page=3&size=100   sort column and page
//   ?view=gallery                      table vs gallery
//   ?new=true                          the log-trade modal (the app bar's quick action)
//   ?edit=<id>                         that trade's edit modal (from the detail page)
//   ?import=true                       the CSV import modal
// so refresh, back/forward and copy-link all behave, and there is no
// "open the modal from an effect, then strip the param" dance.
//
// Scale: the list is NOT loaded into the browser and filtered there. The
// database filters, sorts and slices (listTradesPage), TanStack Table renders
// the page it is handed and owns the sort/page UI state, and TanStack Query
// caches each (filters, sort, page) combination — so the Journal is complete
// and fast whether it holds 50 trades or 50,000.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Outlet, redirect, useChildMatches } from "@tanstack/react-router";
import { functionalUpdate, type PaginationState, type SortingState, type Updater } from "@tanstack/react-table";
import { Download, Images, Plus, Table2, Upload } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { uploadTradeScreenshot } from "@/components/journal/AttachmentsPanel";
import { CsvImportModal } from "@/components/journal/CsvImportModal";
import { JournalFilters } from "@/components/journal/JournalFilters";
import { JournalPager, JournalTable, type JournalTableMeta } from "@/components/journal/JournalTable";
import { LogTradeModal } from "@/components/journal/LogTradeModal";
import { TradeGallery } from "@/components/journal/TradeGallery";
import { Button } from "@/components/ui/button";
import { downloadCsv } from "@/lib/csv";
import { displaySize } from "@/lib/instruments";
import { currencyByAccountId } from "@/lib/money";
import {
  attachmentsForTradesQueryOptions,
  playbooksQueryOptions,
  queryKeys,
  tagsQueryOptions,
  tradeDetailQueryOptions,
  tradesPageQueryOptions,
  workspaceQueryOptions,
} from "@/lib/queries";
import { createTag } from "@/lib/tags.functions";
import { buildTradeInput, type TradeFormValues } from "@/lib/trade-form";
import {
  DEFAULT_TRADE_PAGE_SIZE,
  TRADE_SORT_COLUMNS,
  tradeFilterSchema,
  tradeSortSchema,
  type TradeFilters,
  type TradeSortKey,
} from "@/lib/trade-filters";
import { createTrade, deleteTrade, listTradesPage, updateTrade, type TradePageRow } from "@/lib/trades.functions";

const journalSearchSchema = tradeFilterSchema.merge(tradeSortSchema).extend({
  /** 1-based, so the URL reads like the page the person is on. */
  page: z.number().int().min(1).optional(),
  size: z.union([z.literal(25), z.literal(50), z.literal(100), z.literal(200)]).optional(),
  view: z.enum(["table", "gallery"]).optional(),
  new: z.boolean().optional(),
  edit: z.string().uuid().optional(),
  import: z.boolean().optional(),
});

/** Every filter key set to "no filter", so applying a new set of filters also
 * removes the ones that were just cleared. */
const NO_FILTERS: Required<{ [K in keyof TradeFilters]: undefined }> = {
  q: undefined,
  status: undefined,
  outcome: undefined,
  label: undefined,
  direction: undefined,
  session: undefined,
  market: undefined,
  playbookId: undefined,
  tagIds: undefined,
  tagMode: undefined,
  screenshots: undefined,
  reviewState: undefined,
  from: undefined,
  to: undefined,
};

export const Route = createFileRoute("/app/journal")({
  head: () => ({
    meta: [
      { title: "Journal — Curated Trades" },
      { name: "description", content: "Every trade you've logged: filter, sort, tag, and review in one place." },
    ],
  }),
  validateSearch: journalSearchSchema,
  // `?edit=<id>` only makes sense for a trade in the *active* portfolio. If it
  // isn't (a stale link, a deleted trade, or the portfolio was switched), say
  // so and drop the param — decided here in the loader, once the trade is
  // loaded, instead of in a component effect.
  loaderDeps: ({ search }) => ({ edit: search.edit }),
  loader: async ({ context, deps }) => {
    if (!deps.edit) return;
    const [workspace, trade] = await Promise.all([
      context.queryClient.ensureQueryData(workspaceQueryOptions),
      context.queryClient.ensureQueryData(tradeDetailQueryOptions(deps.edit)).catch(() => null),
    ]);
    if (!trade || trade.portfolio_id !== workspace.activePortfolio.id) {
      toast("That trade isn't in the current portfolio");
      throw redirect({ to: "/app/journal", search: (prev) => ({ ...prev, edit: undefined }) });
    }
  },
  component: JournalLayout,
});

// "/app/journal/$tradeId" is a *child* of this route in the generated route
// tree, so this component has to render an <Outlet /> for the detail page to
// appear at all. The list lives in its own component so its queries only run
// while the list is actually on screen.
function JournalLayout() {
  const childMatches = useChildMatches();
  if (childMatches.length > 0) return <Outlet />;
  return <JournalListPage />;
}

function JournalListPage() {
  const queryClient = useQueryClient();
  const navigate = Route.useNavigate();
  const search = Route.useSearch();
  const viewMode = search.view ?? "table";
  const pageIndex = (search.page ?? 1) - 1;
  const pageSize = search.size ?? DEFAULT_TRADE_PAGE_SIZE;

  const { data: workspace } = useQuery(workspaceQueryOptions);
  const activePortfolioId = workspace?.activePortfolio.id;
  const { data: allTags = [] } = useQuery(tagsQueryOptions);
  const { data: activePlaybooks = [] } = useQuery({
    ...playbooksQueryOptions,
    select: (playbooks) => playbooks.filter((playbook) => playbook.status === "active"),
  });

  // ── What the URL says to show ───────────────────────────────────────────
  const filters: TradeFilters = {
    q: search.q,
    status: search.status,
    outcome: search.outcome,
    label: search.label,
    direction: search.direction,
    session: search.session,
    market: search.market,
    playbookId: search.playbookId,
    tagIds: search.tagIds,
    tagMode: search.tagMode,
    screenshots: search.screenshots,
    reviewState: search.reviewState,
    from: search.from,
    to: search.to,
  };
  const sortKey: TradeSortKey = search.sort ?? "opened";
  const sorting: SortingState = [{ id: sortKey, desc: search.dir !== "asc" }];
  const pagination: PaginationState = { pageIndex, pageSize };

  const baseParams = workspace
    ? {
        portfolioId: workspace.activePortfolio.id,
        accountId: workspace.activeAccount?.id,
        ...filters,
        sort: search.sort,
        dir: search.dir,
      }
    : undefined;

  // The gallery is, by definition, trades that have screenshots — so ask the
  // database for exactly those, and every page is full of them.
  const pageQuery = useQuery(
    tradesPageQueryOptions(
      baseParams && {
        ...baseParams,
        screenshots: viewMode === "gallery" ? "with" : filters.screenshots,
        page: pageIndex,
        pageSize,
      },
    ),
  );
  const rows = pageQuery.data?.rows;
  const total = pageQuery.data?.total ?? 0;

  const galleryTradeIds = viewMode === "gallery" && rows ? rows.map((trade) => trade.id) : [];
  const galleryQuery = useQuery(attachmentsForTradesQueryOptions(galleryTradeIds));

  const tagsById = new Map(allTags.map((tag) => [tag.id, tag]));
  const currencyMap = currencyByAccountId(workspace?.accounts ?? []);

  const setSearch = (patch: Partial<z.input<typeof journalSearchSchema>>) =>
    void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });

  const setFilters = (next: TradeFilters) => setSearch({ ...NO_FILTERS, ...next, page: undefined });

  function onSortingChange(updater: Updater<SortingState>) {
    const next = functionalUpdate(updater, sorting)[0];
    const isDefault = !next || (next.id === "opened" && next.desc);
    setSearch({
      sort: isDefault ? undefined : (next.id as TradeSortKey),
      dir: isDefault || next.desc ? undefined : "asc",
      page: undefined,
    });
  }

  function onPaginationChange(updater: Updater<PaginationState>) {
    const next = functionalUpdate(updater, pagination);
    const sizeChanged = next.pageSize !== pageSize;
    setSearch({
      size: next.pageSize === DEFAULT_TRADE_PAGE_SIZE ? undefined : (next.pageSize as 25 | 50 | 100 | 200),
      page: sizeChanged || next.pageIndex === 0 ? undefined : next.pageIndex + 1,
    });
  }

  // ── Modals (URL-driven) ─────────────────────────────────────────────────
  // The edit modal's trade is fetched by id (the loader already warmed it),
  // not looked up in a list — the trade may not be on the page being shown.
  const { data: editingTrade = null } = useQuery({ ...tradeDetailQueryOptions(search.edit ?? ""), enabled: Boolean(search.edit) });
  const isLogOpen = Boolean(search.new) || (Boolean(search.edit) && editingTrade != null);

  const closeModals = () => setSearch({ new: undefined, edit: undefined, import: undefined });

  function invalidateTrades() {
    // Prefix match: refreshes the open Journal page, the all-trades list the
    // other screens use, and anything else keyed under this portfolio's trades.
    void queryClient.invalidateQueries({ queryKey: queryKeys.trades(activePortfolioId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.tradeTagLinks() });
  }

  const createTagMutation = useMutation({
    mutationFn: createTag,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.tags }),
  });

  const saveTradeMutation = useMutation({
    mutationFn: async ({ values, tradeId }: { values: TradeFormValues; tradeId?: string }): Promise<void> => {
      if (!workspace) throw new Error("Workspace not loaded yet");
      const payload = buildTradeInput(values, {
        portfolioId: workspace.activePortfolio.id,
        editingTrade,
        playbooks: activePlaybooks,
      });
      if (tradeId) {
        await updateTrade({ data: { ...payload, tradeId } });
        void queryClient.invalidateQueries({ queryKey: tradeDetailQueryOptions(tradeId).queryKey });
        return;
      }
      // Single-account entry today (LogTradeModal has one account field);
      // createTrade itself supports several accounts sharing one setup —
      // see its own comment for why — this just isn't wired to a multi-
      // select in the UI yet.
      const { accountId, ...rest } = payload;
      const created = await createTrade({ data: { ...rest, accountIds: [accountId] } });
      // Attach staged screenshots to every trade row the create produced. A
      // failed upload must not lose the trade itself, so it's reported
      // separately instead of failing the whole save.
      const userId = workspace.profile.user_id;
      if (values.pendingScreenshots.length > 0) {
        const results = await Promise.allSettled(
          created.flatMap((trade) =>
            values.pendingScreenshots.map((file) => uploadTradeScreenshot({ tradeId: trade.id, userId, file })),
          ),
        );
        if (results.some((result) => result.status === "rejected")) {
          toast.warning("Trade saved, but some screenshots failed to upload — open it to retry", { duration: 6000 });
        }
        void queryClient.invalidateQueries({ queryKey: queryKeys.attachments() });
      }
    },
    onSuccess: (_result, variables) => {
      invalidateTrades();
      toast.success(variables.tradeId ? "Trade updated" : "Trade saved to your journal");
      closeModals();
    },
    onError: (error) =>
      toast.error(error.message ? `Trade could not be saved: ${error.message}` : "Trade could not be saved", {
        duration: 6000,
      }),
  });

  const deleteTradeMutation = useMutation({
    mutationFn: (tradeId: string) => deleteTrade({ data: { tradeId } }),
    onSuccess: () => {
      invalidateTrades();
      toast.success("Trade deleted");
    },
    onError: () => toast.error("Trade could not be deleted"),
  });

  // Exports EVERYTHING that matches the current filters and sort, not just the
  // page on screen: it walks the server's pages (1,000 at a time) until done.
  const exportMutation = useMutation({
    mutationFn: async () => {
      if (!baseParams) throw new Error("Workspace not loaded yet");
      const all: TradePageRow[] = [];
      for (let page = 0; ; page++) {
        const result = await listTradesPage({ data: { ...baseParams, page, pageSize: 1000 } });
        all.push(...result.rows);
        if (result.rows.length === 0 || all.length >= result.total) break;
      }
      downloadCsv(
        `curated-trades-${new Date().toISOString().slice(0, 10)}.csv`,
        [
          "symbol", "market", "direction", "status", "opened_at", "closed_at", "entry_price", "exit_price",
          "quantity", "size_unit", "stop_loss", "take_profit", "fees", "net_pnl", "r_multiple", "curated_label", "session", "notes",
        ],
        all.map((trade) => [
          trade.symbol, trade.market, trade.direction, trade.status, trade.opened_at, trade.closed_at,
          trade.entry_price, trade.exit_price, displaySize(trade).value, displaySize(trade).unit, trade.stop_loss, trade.take_profit,
          trade.fees, trade.net_pnl, trade.realized_r_multiple ?? trade.planned_r_multiple, trade.curated_label, trade.session, trade.notes,
        ]),
      );
      return all.length;
    },
    onSuccess: (count) => toast.success(`Exported ${count.toLocaleString()} trade${count === 1 ? "" : "s"} as CSV`),
    onError: (error) => toast.error(error.message || "Export failed"),
  });

  const filtersActive = Object.values(filters).some((value) => (Array.isArray(value) ? value.length > 0 : Boolean(value)));

  const tableMeta: JournalTableMeta = {
    tagsById,
    currencyByAccountId: currencyMap,
    deletingTradeId: deleteTradeMutation.isPending ? (deleteTradeMutation.variables ?? null) : null,
    onOpen: (trade) => void navigate({ to: "/app/journal/$tradeId", params: { tradeId: trade.id } }),
    onEdit: (trade) => setSearch({ edit: trade.id }),
    onDelete: (trade) => {
      if (window.confirm(`Delete this ${trade.symbol} trade? This can't be undone.`)) deleteTradeMutation.mutate(trade.id);
    },
  };

  if (!workspace) {
    return <p className="py-10 text-center text-sm text-muted-foreground">Loading journal…</p>;
  }

  // Past the last page (e.g. the final trade on it was just deleted, or a
  // filter shrank the list): offer a way back instead of a blank table.
  const pastLastPage = rows !== undefined && rows.length === 0 && total > 0;
  const emptyState = pastLastPage ? (
    <p className="px-6 py-8 text-center text-sm text-muted-foreground">
      There's nothing on this page.{" "}
      <button type="button" className="underline underline-offset-2" onClick={() => setSearch({ page: undefined })}>
        Go to the first page
      </button>
      .
    </p>
  ) : filtersActive ? (
    <p className="px-6 py-8 text-center text-sm text-muted-foreground">No trades match these filters. Adjust or clear them above.</p>
  ) : (
    <p className="px-6 py-8 text-center text-sm text-muted-foreground">
      No trades yet. Log your first trade or import a CSV to get started.
    </p>
  );

  return (
    <>
      <section className="mb-6 flex flex-col justify-between gap-4 border-b border-border pb-5 sm:flex-row sm:items-center">
        <h1 className="page-title">Journal</h1>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setSearch({ import: true })}>
            <Upload /> Import CSV
          </Button>
          <Button variant="outline" onClick={() => exportMutation.mutate()} disabled={exportMutation.isPending}>
            <Download /> {exportMutation.isPending ? "Exporting…" : `Export ${filtersActive ? "filtered " : ""}CSV`}
          </Button>
          <Button onClick={() => setSearch({ new: true })}>
            <Plus /> Log trade
          </Button>
        </div>
      </section>

      <JournalFilters
        filters={filters}
        tags={allTags}
        playbooks={activePlaybooks}
        screenshotsLocked={viewMode === "gallery"}
        onChange={setFilters}
      />

      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {pageQuery.data ? `${total.toLocaleString()} trade${total === 1 ? "" : "s"}${filtersActive ? " match" : ""}` : "Loading…"}
        </p>
        <div className="direction-toggle" role="tablist" aria-label="View">
          <Button
            type="button"
            variant={viewMode === "table" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setSearch({ view: undefined, page: undefined })}
            aria-pressed={viewMode === "table"}
          >
            <Table2 /> Table
          </Button>
          <Button
            type="button"
            variant={viewMode === "gallery" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setSearch({ view: "gallery", page: undefined })}
            aria-pressed={viewMode === "gallery"}
          >
            <Images /> Gallery
          </Button>
        </div>
      </div>

      {pageQuery.isError && (
        <p className="surface-panel mb-4 p-4 text-sm text-destructive">
          Couldn't load trades: {pageQuery.error.message}{" "}
          <button type="button" className="underline underline-offset-2" onClick={() => void pageQuery.refetch()}>
            Retry
          </button>
        </p>
      )}

      {viewMode === "gallery" ? (
        <div>
          <TradeGallery
            trades={rows ?? []}
            attachments={galleryQuery.data ?? []}
            isLoading={pageQuery.isPending || galleryQuery.isLoading}
            currencyByAccountId={currencyMap}
          />
          <div className="surface-panel mt-4 overflow-hidden p-0">
            <JournalPager
              total={total}
              pageIndex={pageIndex}
              pageSize={pageSize}
              onPageChange={(index) => setSearch({ page: index === 0 ? undefined : index + 1 })}
              onPageSizeChange={(size) =>
                setSearch({ size: size === DEFAULT_TRADE_PAGE_SIZE ? undefined : (size as 25 | 50 | 100 | 200), page: undefined })
              }
            />
          </div>
        </div>
      ) : (
        <JournalTable
          rows={rows}
          total={total}
          sorting={sorting}
          onSortingChange={onSortingChange}
          pagination={pagination}
          onPaginationChange={onPaginationChange}
          isFetching={pageQuery.isFetching}
          emptyState={emptyState}
          meta={tableMeta}
        />
      )}

      {isLogOpen && (
        <LogTradeModal
          // A fresh form for each distinct trade (or for "new").
          key={editingTrade?.id ?? "new"}
          trade={search.edit ? editingTrade : null}
          initialTagIds={search.edit ? (editingTrade?.tagIds ?? []) : []}
          defaultAccountId={workspace.activeAccount?.id ?? workspace.accounts[0]?.id ?? null}
          equity={workspace.liveEquity}
          riskPercent={workspace.activeAccount?.default_risk_percent ?? workspace.accounts[0]?.default_risk_percent ?? 1}
          isSubmitting={saveTradeMutation.isPending}
          allTags={allTags}
          onCreateTag={(name) => createTagMutation.mutateAsync({ data: { name } })}
          portfolioId={workspace.activePortfolio.id}
          accounts={workspace.accounts}
          userId={workspace.profile.user_id}
          playbooks={activePlaybooks}
          onClose={closeModals}
          onSubmit={(values) =>
            saveTradeMutation.mutate(search.edit && editingTrade ? { values, tradeId: editingTrade.id } : { values })
          }
        />
      )}
      {search.import && (
        <CsvImportModal
          portfolioId={workspace.activePortfolio.id}
          // Falls back to the first account when scope is "All accounts" —
          // bulk import needs one definite target account, and there's no
          // account picker in this modal yet.
          accountId={workspace.activeAccount?.id ?? workspace.accounts[0]!.id}
          onClose={closeModals}
          onImported={invalidateTrades}
        />
      )}
    </>
  );
}
