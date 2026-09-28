// Trade log ("/app/journal"): the trade table, the log/edit modal (see
// components/journal/LogTradeModal.tsx), and CSV import. This is the one
// place that owns trade creation/editing — the playbook picker, checklist,
// and confidence score all funnel through here regardless of whether the
// trade started as a manual entry or a converted trade idea (see
// playbooks.tsx's "Convert to trade" action).
import { createFileRoute, Outlet, useChildMatches, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Check, Download, Images, Plus, Search, Table2, Upload, X } from "lucide-react";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getWorkspace } from "@/lib/portfolios.functions";
import {
  createTrade,
  deleteTrade,
  listTradeTagLinks,
  listTrades,
  TRADES_LIST_DEFAULT_LIMIT,
  updateTrade,
  type TradeInput,
} from "@/lib/trades.functions";
import { createTag, listTags } from "@/lib/tags.functions";
import { listAttachmentsForPortfolio, listAttachmentTradeIds } from "@/lib/attachments.functions";
import { listPlaybooks } from "@/lib/playbooks.functions";
import { emptyTradeForm, LogTradeModal, type TradeForm } from "@/components/journal/LogTradeModal";
import { uploadTradeScreenshot } from "@/components/journal/AttachmentsPanel";
import { displaySize, isLegacyUnitQuantity } from "@/lib/instruments";
import { CsvImportModal } from "@/components/journal/CsvImportModal";
import { TradeGallery } from "@/components/journal/TradeGallery";
import { TradeRow } from "@/components/journal/dashboard-widgets";
import type { Database } from "@/integrations/supabase/types";

type TradeRowData = Database["public"]["Tables"]["trades"]["Row"];
type TagRowData = Database["public"]["Tables"]["tags"]["Row"];

export const Route = createFileRoute("/app/journal")({
  head: () => ({
    meta: [
      { title: "Journal — Curated Trades" },
      { name: "description", content: "Every trade you've logged: add, edit, tag, and review in one place." },
    ],
  }),
  // `?new=true` opens a blank entry (the app bar's global quick action).
  // `?edit=<id>` opens that trade's edit modal directly — used by the
  // trade detail page's Edit button ("/app/journal/$tradeId"), since that
  // page is read-focused and doesn't duplicate this modal's form/mutation
  // logic itself. `?from=`/`?to=` seed the date filter — used by the P&L
  // heatmap so clicking a day lands here already filtered to it. All three
  // are one-shot: consumed on mount, then stripped from the URL.
  validateSearch: z.object({
    new: z.boolean().optional(),
    edit: z.string().uuid().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
  }),
  component: JournalLayout,
});

// "/app/journal/$tradeId" is a *child* of this route in the generated route
// tree, so this component has to render an <Outlet /> for the detail page to
// appear at all — before this wrapper existed the URL changed on a row click
// but the list kept rendering, which read as "the trade detail page doesn't
// show up". The list lives in its own component so its hooks/queries only run
// while the list is actually on screen.
function JournalLayout() {
  const childMatches = useChildMatches();
  if (childMatches.length > 0) return <Outlet />;
  return <JournalListPage />;
}

function JournalListPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const search = Route.useSearch();

  const workspaceQuery = useQuery({ queryKey: ["workspace"], queryFn: () => getWorkspace() });
  const workspace = workspaceQuery.data;
  const activePortfolioId = workspace?.activePortfolio.id;
  const [viewMode, setViewMode] = useState<"table" | "gallery">("table");

  const tradesQuery = useQuery({
    queryKey: ["trades", activePortfolioId, workspace?.activeAccount?.id, TRADES_LIST_DEFAULT_LIMIT],
    queryFn: () =>
      listTrades({
        data: {
          portfolioId: activePortfolioId as string,
          accountId: workspace?.activeAccount?.id,
          limit: TRADES_LIST_DEFAULT_LIMIT,
        },
      }),
    enabled: activePortfolioId != null,
  });
  const trades = useMemo(() => tradesQuery.data ?? [], [tradesQuery.data]);

  const tagsQuery = useQuery({ queryKey: ["tags"], queryFn: () => listTags() });
  const allTags = tagsQuery.data ?? [];

  const playbooksQuery = useQuery({ queryKey: ["playbooks"], queryFn: () => listPlaybooks() });
  const activePlaybooks = useMemo(
    () => (playbooksQuery.data ?? []).filter((playbook) => playbook.status === "active"),
    [playbooksQuery.data],
  );

  const tradeTagLinksQuery = useQuery({
    queryKey: ["trade-tag-links", activePortfolioId],
    queryFn: () => listTradeTagLinks({ data: { portfolioId: activePortfolioId as string } }),
    enabled: activePortfolioId != null,
  });
  const attachmentTradeIdsQuery = useQuery({
    queryKey: ["attachment-counts", activePortfolioId],
    queryFn: () => listAttachmentTradeIds({ data: { portfolioId: activePortfolioId as string } }),
    enabled: activePortfolioId != null,
  });

  // Only fetched in gallery mode — the full attachment rows (with signed
  // URLs) are heavier than the count-only query above, which table mode
  // already covers via attachmentTradeIdsQuery.
  const galleryAttachmentsQuery = useQuery({
    queryKey: ["attachments-gallery", activePortfolioId],
    queryFn: () => listAttachmentsForPortfolio({ data: { portfolioId: activePortfolioId as string } }),
    enabled: activePortfolioId != null && viewMode === "gallery",
  });

  const tagsById = useMemo(() => new Map(allTags.map((tag) => [tag.id, tag])), [allTags]);
  const tagsByTradeId = useMemo(() => {
    const map = new Map<string, TagRowData[]>();
    for (const link of tradeTagLinksQuery.data ?? []) {
      const tag = tagsById.get(link.tag_id);
      if (!tag) continue;
      const existing = map.get(link.trade_id) ?? [];
      existing.push(tag);
      map.set(link.trade_id, existing);
    }
    return map;
  }, [tradeTagLinksQuery.data, tagsById]);
  const attachmentCountByTradeId = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of attachmentTradeIdsQuery.data ?? []) {
      map.set(row.trade_id, (map.get(row.trade_id) ?? 0) + 1);
    }
    return map;
  }, [attachmentTradeIdsQuery.data]);

  const createTagMutation = useMutation({
    mutationFn: createTag,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["tags"] }),
  });
  async function onCreateTag(name: string): Promise<TagRowData> {
    return createTagMutation.mutateAsync({ data: { name } });
  }

  const [isLogOpen, setIsLogOpen] = useState(false);
  // Screenshots picked in the "Log a trade" form before the trade exists; uploaded once it is saved.
  const [pendingScreenshots, setPendingScreenshots] = useState<File[]>([]);
  const [editingIsLegacyUnits, setEditingIsLegacyUnits] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [editingTrade, setEditingTrade] = useState<TradeRowData | null>(null);
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState<TradeForm>(emptyTradeForm);

  // Filters: client-side over the already-fetched (up to 500) trades. Every
  // list, count, and export below reads `filteredTrades`, never `trades`
  // directly, so "what you see is what you export" always holds — a
  // filtered CSV export is part of Phase 2.5's plan requirement, not just a
  // UI nicety.
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | TradeRowData["status"]>("all");
  const [labelFilter, setLabelFilter] = useState<"all" | "curated" | "impulse">("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const filtersActive =
    searchQuery.trim() !== "" || statusFilter !== "all" || labelFilter !== "all" || dateFrom !== "" || dateTo !== "";

  function clearFilters() {
    setSearchQuery("");
    setStatusFilter("all");
    setLabelFilter("all");
    setDateFrom("");
    setDateTo("");
  }

  const filteredTrades = useMemo(() => {
    const query = searchQuery.trim().toUpperCase();
    const fromTime = dateFrom ? new Date(dateFrom).getTime() : null;
    // Include the entire "to" day rather than cutting off at midnight.
    const toTime = dateTo ? new Date(dateTo).getTime() + 24 * 60 * 60 * 1000 - 1 : null;

    return trades.filter((trade) => {
      if (query && !trade.symbol.toUpperCase().includes(query)) return false;
      if (statusFilter !== "all" && trade.status !== statusFilter) return false;
      if (labelFilter !== "all" && trade.curated_label !== labelFilter) return false;
      const openedTime = new Date(trade.opened_at).getTime();
      if (fromTime != null && openedTime < fromTime) return false;
      if (toTime != null && openedTime > toTime) return false;
      return true;
    });
  }, [trades, searchQuery, statusFilter, labelFilter, dateFrom, dateTo]);

  function showNotice(message: string, ms = 3000) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), ms);
  }

  function invalidateTrades() {
    void queryClient.invalidateQueries({ queryKey: ["trades", activePortfolioId] });
    void queryClient.invalidateQueries({ queryKey: ["trade-tag-links"] });
  }

  const saveTradeMutation = useMutation({
    mutationFn: async (input: { tradeId?: string; payload: TradeInput }): Promise<TradeRowData[]> => {
      if (input.tradeId) {
        const updated = await updateTrade({ data: { ...input.payload, tradeId: input.tradeId } });
        return [updated];
      }
      // Single-account entry today (LogTradeModal has one account field);
      // createTrade itself supports several accounts sharing one setup —
      // see its own comment for why — this just isn't wired to a multi-
      // select in the UI yet.
      const { accountId, ...rest } = input.payload;
      const created = await createTrade({ data: { ...rest, accountIds: [accountId] } });
      // Attach staged screenshots to every trade row the create produced. A
      // failed upload must not lose the trade itself, so it's reported
      // separately below instead of failing the whole save.
      const userId = workspace?.profile.user_id;
      if (userId && pendingScreenshots.length > 0) {
        const results = await Promise.allSettled(
          created.flatMap((trade) =>
            pendingScreenshots.map((file) => uploadTradeScreenshot({ tradeId: trade.id, userId, file })),
          ),
        );
        if (results.some((result) => result.status === "rejected")) {
          window.setTimeout(() => showNotice("Trade saved, but some screenshots failed to upload — open it to retry", 6000), 0);
        }
        void queryClient.invalidateQueries({ queryKey: ["attachment-counts"] });
        void queryClient.invalidateQueries({ queryKey: ["attachments"] });
      }
      return created;
    },
    onSuccess: (_result, variables) => {
      invalidateTrades();
      showNotice(variables.tradeId ? "Trade updated" : "Trade saved to your journal");
      setIsLogOpen(false);
      setEditingTrade(null);
      setPendingScreenshots([]);
      setForm(emptyTradeForm);
    },
    onError: (error) =>
      showNotice(
        error instanceof Error && error.message ? `Trade could not be saved: ${error.message}` : "Trade could not be saved",
        6000,
      ),
  });

  const deleteTradeMutation = useMutation({
    mutationFn: (tradeId: string) => deleteTrade({ data: { tradeId } }),
    onSuccess: () => {
      invalidateTrades();
      showNotice("Trade deleted");
    },
    onError: () => showNotice("Trade could not be deleted"),
  });

  function openNewTrade() {
    setEditingTrade(null);
    setPendingScreenshots([]);
    setEditingIsLegacyUnits(false);
    setForm({ ...emptyTradeForm, accountId: workspace?.activeAccount?.id ?? workspace?.accounts[0]?.id ?? null });
    setIsLogOpen(true);
  }

  // Opened via the "Log trade" quick action in the app bar (see app.tsx),
  // which links here with ?new=true rather than duplicating this modal's
  // form/mutation logic at the shell level. Clears the param right after so
  // refreshing the page, or coming back via browser history, doesn't
  // silently reopen the modal.
  useEffect(() => {
    if (!search.new) return;
    openNewTrade();
    void navigate({ to: "/app/journal", search: {}, replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.new]);

  // ?edit=<id> — waits for this portfolio's trades to load before looking
  // the id up. If it's not found (e.g. it belongs to a different
  // portfolio than the one currently active), says so rather than
  // silently doing nothing.
  useEffect(() => {
    if (!search.edit || trades.length === 0) return;
    const target = trades.find((trade) => trade.id === search.edit);
    if (target) {
      openEditTrade(target);
    } else {
      showNotice("That trade isn't in the current portfolio");
    }
    void navigate({ to: "/app/journal", search: {}, replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.edit, trades]);

  // ?from=/?to= — seeds the date filter (used by the Analytics P&L
  // calendar so clicking a day lands here already filtered to it), then
  // clears from the URL like the other one-shot params above.
  useEffect(() => {
    if (!search.from && !search.to) return;
    if (search.from) setDateFrom(search.from);
    if (search.to) setDateTo(search.to);
    void navigate({ to: "/app/journal", search: {}, replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.from, search.to]);

  function openEditTrade(trade: TradeRowData) {
    setEditingTrade(trade);
    setForm({
      accountId: trade.account_id,
      symbol: trade.symbol,
      direction: trade.direction === "short" ? "short" : "long",
      status:
        trade.status === "open" || trade.status === "cancelled" || trade.status === "incomplete"
          ? trade.status
          : "closed",
      entryPrice: String(trade.entry_price),
      exitPrice: trade.exit_price == null ? "" : String(trade.exit_price),
      // Show lots (converting pre-lots "units" rows) so the edit form matches the new size field.
      quantity: String(displaySize(trade).value),
      quoteRate: trade.quote_rate != null ? String(trade.quote_rate) : "",
      stopLoss: trade.stop_loss == null ? "" : String(trade.stop_loss),
      takeProfit: trade.take_profit == null ? "" : String(trade.take_profit),
      fees: String(trade.fees),
      notes: trade.notes ?? "",
      isPlanned: trade.curated_label === "curated",
      disciplineScore: trade.discipline_score ?? 3,
      confidence: trade.confidence ?? 3,
      playbookId: trade.playbook_id,
      checklistAnswers:
        trade.playbook_snapshot && typeof trade.playbook_snapshot === "object" && "answers" in trade.playbook_snapshot
          ? ((trade.playbook_snapshot as { answers?: Record<string, boolean> }).answers ?? {})
          : {},
      tagIds: (tagsByTradeId.get(trade.id) ?? []).map((tag) => tag.id),
    });
    setEditingIsLegacyUnits(
      isLegacyUnitQuantity({ symbol: trade.symbol, quantity: trade.quantity, calculationVersion: trade.calculation_version }),
    );
    setIsLogOpen(true);
  }

  function submitTrade(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activePortfolioId) return;

    if (!form.accountId) {
      showNotice("Choose which account this trade belongs to");
      return;
    }

    const normalizedSymbol = form.symbol.trim().toUpperCase();
    const entry = Number(form.entryPrice);
    const isClosed = form.status === "closed";
    const exit = isClosed && form.exitPrice !== "" ? Number(form.exitPrice) : null;
    const size = Number(form.quantity);
    const fees = Number(form.fees || 0);
    const stop = form.stopLoss !== "" ? Number(form.stopLoss) : null;
    const target = form.takeProfit !== "" ? Number(form.takeProfit) : null;

    const numbersValid =
      normalizedSymbol.length > 0 &&
      Number.isFinite(entry) &&
      entry > 0 &&
      Number.isFinite(size) &&
      size > 0 &&
      Number.isFinite(fees) &&
      fees >= 0 &&
      (!isClosed || (exit != null && Number.isFinite(exit) && exit > 0)) &&
      (stop == null || Number.isFinite(stop)) &&
      (target == null || Number.isFinite(target));

    if (!numbersValid) {
      showNotice("Check the trade fields — something's missing or invalid");
      return;
    }

    const openedAt = editingTrade ? editingTrade.opened_at : new Date().toISOString();
    const closedAt = isClosed ? (editingTrade?.closed_at ?? new Date().toISOString()) : null;

    const selectedPlaybook = form.playbookId ? activePlaybooks.find((p) => p.id === form.playbookId) : null;
    const playbookSnapshot = selectedPlaybook
      ? {
          playbookId: selectedPlaybook.id,
          name: selectedPlaybook.name,
          checklist: selectedPlaybook.checklistItems.map((item) => ({
            prompt: item.prompt,
            isRequired: item.is_required,
            answered: Boolean(form.checklistAnswers[item.id]),
          })),
          answers: form.checklistAnswers,
        }
      : null;

    const payload: TradeInput = {
      portfolioId: activePortfolioId,
      accountId: form.accountId,
      symbol: normalizedSymbol,
      direction: form.direction,
      status: form.status,
      openedAt,
      closedAt,
      entryPrice: entry,
      exitPrice: exit,
      quantity: size,
      quoteRate: form.quoteRate !== "" && Number.isFinite(Number(form.quoteRate)) ? Number(form.quoteRate) : null,
      stopLoss: stop,
      takeProfit: target,
      fees,
      spreadCost: 0,
      swapFunding: 0,
      isPlanned: form.isPlanned,
      disciplineScore: form.disciplineScore,
      confidence: form.confidence,
      playbookId: form.playbookId,
      playbookSnapshot,
      notes: form.notes.trim() || null,
      tagIds: form.tagIds,
    };

    if (editingTrade) {
      saveTradeMutation.mutate({ tradeId: editingTrade.id, payload });
    } else {
      saveTradeMutation.mutate({ payload });
    }
  }

  function exportCsv() {
    const header = [
      "symbol", "market", "direction", "status", "opened_at", "closed_at", "entry_price", "exit_price",
      "quantity", "size_unit", "stop_loss", "take_profit", "fees", "net_pnl", "r_multiple", "curated_label", "session", "notes",
    ];
    const rows = filteredTrades.map((trade) => [
      trade.symbol, trade.market, trade.direction, trade.status, trade.opened_at, trade.closed_at ?? "",
      trade.entry_price, trade.exit_price ?? "", displaySize(trade).value, displaySize(trade).unit, trade.stop_loss ?? "", trade.take_profit ?? "",
      trade.fees, trade.net_pnl ?? "", trade.realized_r_multiple ?? trade.planned_r_multiple ?? "",
      trade.curated_label, trade.session ?? "", (trade.notes ?? "").replaceAll('"', '""'),
    ]);
    const csv = [header, ...rows].map((row) => row.map((cell) => `"${String(cell)}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `curated-trades-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    showNotice(filtersActive ? `Exported ${filteredTrades.length} filtered trades as CSV` : "Journal exported as CSV");
  }

  if (workspaceQuery.isLoading || !workspace) {
    return <p className="py-10 text-center text-sm text-muted-foreground">Loading journal…</p>;
  }

  return (
    <>
      <section className="mb-6 flex flex-col justify-between gap-4 border-b border-border pb-5 sm:flex-row sm:items-center">
        <h1 className="page-title">Journal</h1>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setIsImportOpen(true)}>
            <Upload /> Import CSV
          </Button>
          <Button variant="outline" onClick={exportCsv}>
            <Download /> Export {filtersActive ? "filtered" : ""} CSV
          </Button>
          <Button onClick={openNewTrade}>
            <Plus /> Log trade
          </Button>
        </div>
      </section>

      <section className="surface-panel mb-4 flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-[160px] flex-1">
          <label className="field-label" htmlFor="journal-search">
            Symbol
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="journal-search"
              placeholder="Search e.g. GBPUSD"
              className="pl-9"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </div>
        </div>
        <div className="w-[150px]">
          <label className="field-label">Status</label>
          <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as typeof statusFilter)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
              <SelectItem value="incomplete">Incomplete</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="w-[150px]">
          <label className="field-label">Label</label>
          <Select value={labelFilter} onValueChange={(value) => setLabelFilter(value as typeof labelFilter)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Curated + impulse</SelectItem>
              <SelectItem value="curated">Curated only</SelectItem>
              <SelectItem value="impulse">Impulse only</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="w-[260px]">
          <span className="field-label">Date range</span>
          <DateRangePicker from={dateFrom} to={dateTo} onChange={({ from, to }) => { setDateFrom(from); setDateTo(to); }} />
        </div>
        {filtersActive && (
          <Button variant="ghost" onClick={clearFilters} className="mb-0.5">
            <X /> Clear filters
          </Button>
        )}
        <div className="ml-auto flex items-center gap-3">
          <p className="mb-1.5 text-xs text-muted-foreground">
            {filteredTrades.length} of {trades.length} trades
          </p>
          <div className="direction-toggle mb-0.5" role="tablist" aria-label="View">
            <Button
              type="button"
              variant={viewMode === "table" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setViewMode("table")}
              aria-pressed={viewMode === "table"}
            >
              <Table2 /> Table
            </Button>
            <Button
              type="button"
              variant={viewMode === "gallery" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setViewMode("gallery")}
              aria-pressed={viewMode === "gallery"}
            >
              <Images /> Gallery
            </Button>
          </div>
        </div>
      </section>

      {viewMode === "gallery" ? (
        <TradeGallery
          trades={filteredTrades}
          attachments={galleryAttachmentsQuery.data ?? []}
          isLoading={galleryAttachmentsQuery.isLoading}
        />
      ) : (
      <div className="surface-panel overflow-hidden p-0">
        <div className="trade-table-wrap">
          <table className="trade-table">
            <thead>
              <tr>
                <th>Instrument</th>
                <th>Direction</th>
                <th>Session</th>
                <th>Duration</th>
                <th>Result</th>
                <th>R multiple</th>
                <th>Label</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredTrades.map((trade) => (
                <TradeRow
                  trade={trade}
                  tags={tagsByTradeId.get(trade.id) ?? []}
                  attachmentCount={attachmentCountByTradeId.get(trade.id) ?? 0}
                  key={trade.id}
                  isDeleting={deleteTradeMutation.isPending && deleteTradeMutation.variables === trade.id}
                  onOpenDetail={() => void navigate({ to: "/app/journal/$tradeId", params: { tradeId: trade.id } })}
                  onEdit={() => openEditTrade(trade)}
                  onDelete={() => {
                    if (window.confirm(`Delete this ${trade.symbol} trade? This can't be undone.`)) {
                      deleteTradeMutation.mutate(trade.id);
                    }
                  }}
                />
              ))}
            </tbody>
          </table>
          {trades.length === 0 && (
            <p className="px-6 py-8 text-center text-sm text-muted-foreground">
              No trades yet. Log your first trade or import a CSV to get started.
            </p>
          )}
          {trades.length > 0 && filteredTrades.length === 0 && (
            <p className="px-6 py-8 text-center text-sm text-muted-foreground">
              No trades match these filters.{" "}
              <button type="button" className="underline underline-offset-2" onClick={clearFilters}>
                Clear filters
              </button>
              .
            </p>
          )}
        </div>
      </div>
      )}

      {notice && (
        <div className="toast-message">
          <Check className="size-4 text-chart-2" />
          {notice}
        </div>
      )}
      {isLogOpen && (
        <LogTradeModal
          form={form}
          setForm={setForm}
          equity={workspace.liveEquity}
          riskPercent={workspace.activeAccount?.default_risk_percent ?? workspace.accounts[0]?.default_risk_percent ?? 1}
          isEditing={editingTrade != null}
          isSubmitting={saveTradeMutation.isPending}
          allTags={allTags}
          onCreateTag={onCreateTag}
          editingTradeId={editingTrade?.id ?? null}
          portfolioId={workspace.activePortfolio.id}
          accounts={workspace.accounts}
          userId={workspace.profile.user_id}
          playbooks={activePlaybooks}
          pendingScreenshots={pendingScreenshots}
          onPendingScreenshotsChange={setPendingScreenshots}
          isLegacyUnits={editingIsLegacyUnits}
          onClose={() => {
            setIsLogOpen(false);
            setEditingTrade(null);
            setPendingScreenshots([]);
            setEditingIsLegacyUnits(false);
          }}
          onSubmit={submitTrade}
        />
      )}
      {isImportOpen && (
        <CsvImportModal
          portfolioId={workspace.activePortfolio.id}
          // Falls back to the first account when scope is "All accounts" —
          // bulk import needs one definite target account, and there's no
          // account picker in this modal yet. Worth a proper selector if
          // multi-account CSV import turns out to be common.
          accountId={workspace.activeAccount?.id ?? workspace.accounts[0]!.id}
          onClose={() => setIsImportOpen(false)}
          onImported={invalidateTrades}
        />
      )}
    </>
  );
}
