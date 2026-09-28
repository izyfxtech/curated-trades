// Playbooks + trade ideas ("/app/playbooks", Phase 2.1): playbook CRUD with
// an ordered pre-trade checklist (see components/playbooks/PlaybookEditorModal.tsx),
// and a second tab for tracking trade ideas before they become trades. The
// "taken vs. missed" comparison further down deliberately compares *planned*
// R:R only — an idea that was never taken has no realized outcome, and this
// page never invents one for it. A checklist "rule" and a "checklist
// question" from the plan are the same thing here (playbook_checklist_items,
// with is_required distinguishing the two) — see the migration comment in
// supabase/migrations/20260908120000_phase2_playbooks_and_ideas.sql for why
// that unification was chosen over two separate lists.
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type FormEvent } from "react";
import { BookOpen, Check, Lightbulb, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { PlaybookEditorModal, type PlaybookFormValues } from "@/components/playbooks/PlaybookEditorModal";
import { getWorkspace } from "@/lib/portfolios.functions";
import {
  deletePlaybook,
  listPlaybooks,
  savePlaybook,
  setPlaybookStatus,
  type PlaybookWithChecklist,
} from "@/lib/playbooks.functions";
import {
  createTradeIdea,
  deleteTradeIdea,
  listTradeIdeas,
  setTradeIdeaStatus,
} from "@/lib/trade-ideas.functions";
import { createTrade } from "@/lib/trades.functions";
import { getInstrumentSpec, sizeLabel } from "@/lib/instruments";
import type { Database } from "@/integrations/supabase/types";

type TradeIdeaRow = Database["public"]["Tables"]["trade_ideas"]["Row"];

export const Route = createFileRoute("/app/playbooks")({
  head: () => ({
    meta: [
      { title: "Playbooks — Curated Trades" },
      { name: "description", content: "Define your setups and pre-trade checklists, and track ideas before they become trades." },
    ],
  }),
  component: PlaybooksPage,
});

const emptyIdeaForm = {
  symbol: "",
  market: "forex" as "forex" | "crypto",
  direction: "long" as "long" | "short",
  playbookId: "none",
  plannedEntry: "",
  plannedStop: "",
  plannedTarget: "",
  notes: "",
};

function plannedR(idea: TradeIdeaRow): number | null {
  if (idea.planned_entry == null || idea.planned_stop == null || idea.planned_target == null) return null;
  const risk = Math.abs(idea.planned_entry - idea.planned_stop);
  if (risk === 0) return null;
  return Math.abs(idea.planned_target - idea.planned_entry) / risk;
}

function PlaybooksPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"playbooks" | "ideas">("playbooks");
  const [notice, setNotice] = useState("");

  function showNotice(message: string, ms = 3000) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), ms);
  }

  const workspaceQuery = useQuery({ queryKey: ["workspace"], queryFn: () => getWorkspace() });
  const workspace = workspaceQuery.data;
  const activePortfolioId = workspace?.activePortfolio.id;

  const playbooksQuery = useQuery({ queryKey: ["playbooks"], queryFn: () => listPlaybooks() });
  const playbooks = playbooksQuery.data ?? [];
  const activePlaybooks = useMemo(() => playbooks.filter((p) => p.status === "active"), [playbooks]);

  const ideasQuery = useQuery({
    queryKey: ["trade-ideas", activePortfolioId],
    queryFn: () => listTradeIdeas({ data: { portfolioId: activePortfolioId as string } }),
    enabled: activePortfolioId != null,
  });
  const ideas = ideasQuery.data ?? [];

  function invalidatePlaybooks() {
    void queryClient.invalidateQueries({ queryKey: ["playbooks"] });
  }
  function invalidateIdeas() {
    void queryClient.invalidateQueries({ queryKey: ["trade-ideas", activePortfolioId] });
  }

  // --- Playbooks ---
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingPlaybook, setEditingPlaybook] = useState<PlaybookWithChecklist | null>(null);

  const saveMutation = useMutation({
    mutationFn: (values: PlaybookFormValues) =>
      savePlaybook({
        data: {
          playbookId: editingPlaybook?.id,
          name: values.name,
          market: values.market,
          direction: values.direction,
          description: values.description || null,
          idealConditions: values.idealConditions || null,
          invalidationRules: values.invalidationRules || null,
          checklistItems: values.checklistItems,
        },
      }),
    onSuccess: () => {
      invalidatePlaybooks();
      showNotice(editingPlaybook ? "Playbook updated" : "Playbook created");
      setIsEditorOpen(false);
      setEditingPlaybook(null);
    },
    onError: () => showNotice("Couldn't save playbook"),
  });

  const statusMutation = useMutation({
    mutationFn: (input: { playbookId: string; status: "active" | "archived" }) => setPlaybookStatus({ data: input }),
    onSuccess: invalidatePlaybooks,
  });

  const deleteMutation = useMutation({
    mutationFn: (playbookId: string) => deletePlaybook({ data: { playbookId } }),
    onSuccess: () => {
      invalidatePlaybooks();
      showNotice("Playbook deleted");
    },
  });

  // --- Ideas ---
  const [ideaForm, setIdeaForm] = useState(emptyIdeaForm);
  const [convertingIdea, setConvertingIdea] = useState<TradeIdeaRow | null>(null);
  const [convertQuantity, setConvertQuantity] = useState("");

  const createIdeaMutation = useMutation({
    mutationFn: () => {
      if (!activePortfolioId) throw new Error("No active portfolio");
      const entry = ideaForm.plannedEntry === "" ? null : Number(ideaForm.plannedEntry);
      const stop = ideaForm.plannedStop === "" ? null : Number(ideaForm.plannedStop);
      const target = ideaForm.plannedTarget === "" ? null : Number(ideaForm.plannedTarget);
      return createTradeIdea({
        data: {
          portfolioId: activePortfolioId,
          playbookId: ideaForm.playbookId === "none" ? null : ideaForm.playbookId,
          symbol: ideaForm.symbol.trim().toUpperCase(),
          market: ideaForm.market,
          direction: ideaForm.direction,
          plannedEntry: entry,
          plannedStop: stop,
          plannedTarget: target,
          notes: ideaForm.notes.trim() || null,
        },
      });
    },
    onSuccess: () => {
      invalidateIdeas();
      setIdeaForm(emptyIdeaForm);
      showNotice("Idea logged");
    },
    onError: () => showNotice("Check the idea fields — something's missing or invalid"),
  });

  const ideaStatusMutation = useMutation({
    mutationFn: (input: { ideaId: string; status: "pending" | "taken" | "missed" | "invalidated" }) =>
      setTradeIdeaStatus({ data: input }),
    onSuccess: invalidateIdeas,
  });

  const deleteIdeaMutation = useMutation({
    mutationFn: (ideaId: string) => deleteTradeIdea({ data: { ideaId } }),
    onSuccess: invalidateIdeas,
  });

  const convertMutation = useMutation({
    mutationFn: async () => {
      if (!convertingIdea || !activePortfolioId) throw new Error("Nothing to convert");
      const accountId = workspace?.activeAccount?.id ?? workspace?.accounts[0]?.id;
      if (!accountId) throw new Error("No account to log this trade against");
      const quantity = Number(convertQuantity);
      if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Enter a valid quantity");
      if (convertingIdea.planned_entry == null) throw new Error("This idea has no planned entry price");

      const [trade] = await createTrade({
        data: {
          portfolioId: activePortfolioId,
          accountIds: [accountId],
          symbol: convertingIdea.symbol,
          direction: convertingIdea.direction === "short" ? "short" : "long",
          status: "open",
          openedAt: new Date().toISOString(),
          entryPrice: convertingIdea.planned_entry,
          quantity,
          stopLoss: convertingIdea.planned_stop ?? null,
          takeProfit: convertingIdea.planned_target ?? null,
          fees: 0,
          spreadCost: 0,
          swapFunding: 0,
          isPlanned: true,
          playbookId: convertingIdea.playbook_id,
          notes: convertingIdea.notes,
          tagIds: [],
        },
      });

      await setTradeIdeaStatus({ data: { ideaId: convertingIdea.id, status: "taken", takenTradeId: trade!.id } });
    },
    onSuccess: () => {
      invalidateIdeas();
      void queryClient.invalidateQueries({ queryKey: ["trades", activePortfolioId] });
      setConvertingIdea(null);
      setConvertQuantity("");
      showNotice("Trade logged from idea");
    },
    onError: (error: Error) => showNotice(error.message || "Couldn't convert idea to a trade"),
  });

  function submitIdea(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ideaForm.symbol.trim()) {
      showNotice("Enter a symbol first");
      return;
    }
    createIdeaMutation.mutate();
  }

  const pendingIdeas = ideas.filter((i) => i.status === "pending");
  const takenIdeas = ideas.filter((i) => i.status === "taken");
  const missedIdeas = ideas.filter((i) => i.status === "missed" || i.status === "invalidated");

  const takenPlannedRs = takenIdeas.map(plannedR).filter((r): r is number => r != null);
  const missedPlannedRs = missedIdeas.map(plannedR).filter((r): r is number => r != null);
  const avg = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
  const showMissedComparison = takenPlannedRs.length >= 3 && missedPlannedRs.length >= 3;

  if (workspaceQuery.isLoading || !workspace) {
    return <p className="py-10 text-center text-sm text-muted-foreground">Loading playbooks…</p>;
  }

  return (
    <>
      <section className="mb-6 flex flex-col justify-between gap-4 border-b border-border pb-5 sm:flex-row sm:items-center">
        <h1 className="page-title">Playbooks</h1>
        <div className="direction-toggle">
          <Button type="button" variant={tab === "playbooks" ? "secondary" : "ghost"} onClick={() => setTab("playbooks")}>
            <BookOpen /> Playbooks
          </Button>
          <Button type="button" variant={tab === "ideas" ? "secondary" : "ghost"} onClick={() => setTab("ideas")}>
            <Lightbulb /> Trade ideas
          </Button>
        </div>
      </section>

      {tab === "playbooks" && (
        <>
          <div className="mb-4 flex justify-end">
            <Button
              onClick={() => {
                setEditingPlaybook(null);
                setIsEditorOpen(true);
              }}
            >
              <Plus /> New playbook
            </Button>
          </div>

          {playbooks.length === 0 ? (
            <div className="surface-panel py-10 text-center text-sm text-muted-foreground">
              No playbooks yet. Define your first setup and its pre-trade checklist.
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {playbooks.map((playbook) => (
                <div key={playbook.id} className="surface-panel flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold">{playbook.name}</h3>
                    <Badge variant={playbook.status === "active" ? "default" : "outline"}>{playbook.status}</Badge>
                  </div>
                  <div className="flex flex-wrap gap-1.5 text-xs">
                    <Badge variant="outline">{playbook.market}</Badge>
                    <Badge variant="outline">{playbook.direction}</Badge>
                    <Badge variant="outline">{playbook.checklistItems.length} checklist item{playbook.checklistItems.length === 1 ? "" : "s"}</Badge>
                  </div>
                  {playbook.description && <p className="text-sm text-muted-foreground">{playbook.description}</p>}
                  <div className="mt-auto flex flex-wrap gap-2 pt-2 text-xs">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setEditingPlaybook(playbook);
                        setIsEditorOpen(true);
                      }}
                    >
                      Edit
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        statusMutation.mutate({
                          playbookId: playbook.id,
                          status: playbook.status === "active" ? "archived" : "active",
                        })
                      }
                    >
                      {playbook.status === "active" ? "Archive" : "Unarchive"}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Delete playbook"
                      onClick={() => {
                        if (window.confirm(`Delete "${playbook.name}"? This can't be undone.`)) {
                          deleteMutation.mutate(playbook.id);
                        }
                      }}
                    >
                      <Trash2 className="size-3.5 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === "ideas" && (
        <div className="space-y-6">
          <form onSubmit={submitIdea} className="surface-panel grid gap-3 sm:grid-cols-6">
            <div className="sm:col-span-1">
              <label htmlFor="idea-symbol" className="field-label">
                Symbol
              </label>
              <Input
                id="idea-symbol"
                value={ideaForm.symbol}
                onChange={(e) => setIdeaForm({ ...ideaForm, symbol: e.target.value })}
                placeholder="EURUSD"
              />
            </div>
            <div className="sm:col-span-1">
              <span className="field-label">Direction</span>
              <Select value={ideaForm.direction} onValueChange={(v: "long" | "short") => setIdeaForm({ ...ideaForm, direction: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="long">Long</SelectItem>
                  <SelectItem value="short">Short</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <span className="field-label">Playbook</span>
              <Select value={ideaForm.playbookId} onValueChange={(v) => setIdeaForm({ ...ideaForm, playbookId: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No playbook</SelectItem>
                  {activePlaybooks.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-1">
              <label htmlFor="idea-entry" className="field-label">
                Entry
              </label>
              <Input
                id="idea-entry"
                type="number"
                step="any"
                className="font-mono"
                value={ideaForm.plannedEntry}
                onChange={(e) => setIdeaForm({ ...ideaForm, plannedEntry: e.target.value })}
              />
            </div>
            <div className="sm:col-span-1">
              <label htmlFor="idea-stop" className="field-label">
                Stop
              </label>
              <Input
                id="idea-stop"
                type="number"
                step="any"
                className="font-mono"
                value={ideaForm.plannedStop}
                onChange={(e) => setIdeaForm({ ...ideaForm, plannedStop: e.target.value })}
              />
            </div>
            <div className="sm:col-span-1">
              <label htmlFor="idea-target" className="field-label">
                Target
              </label>
              <Input
                id="idea-target"
                type="number"
                step="any"
                className="font-mono"
                value={ideaForm.plannedTarget}
                onChange={(e) => setIdeaForm({ ...ideaForm, plannedTarget: e.target.value })}
              />
            </div>
            <div className="sm:col-span-5">
              <label htmlFor="idea-notes" className="field-label">
                Notes
              </label>
              <Textarea
                id="idea-notes"
                rows={1}
                value={ideaForm.notes}
                onChange={(e) => setIdeaForm({ ...ideaForm, notes: e.target.value })}
                placeholder="Why this setup, what you're waiting for"
              />
            </div>
            <div className="flex items-end sm:col-span-1">
              <Button type="submit" className="w-full" disabled={createIdeaMutation.isPending}>
                <Plus /> Log idea
              </Button>
            </div>
          </form>

          {showMissedComparison && (
            <div className="surface-panel">
              <p className="eyebrow mb-1">Planned quality, not realized P&L</p>
              <h2 className="panel-title mb-3">Taken vs. missed setups</h2>
              <p className="mb-3 text-xs text-muted-foreground">
                Average planned R:R at the time each idea was logged — this compares setup quality on paper, not what
                actually happened to the ones you didn't take.
              </p>
              <div className="flex gap-8 text-sm">
                <div>
                  <p className="text-muted-foreground">Taken ({takenPlannedRs.length})</p>
                  <p className="font-mono text-lg font-semibold text-chart-2">{avg(takenPlannedRs)?.toFixed(2)}R</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Missed / invalidated ({missedPlannedRs.length})</p>
                  <p className="font-mono text-lg font-semibold">{avg(missedPlannedRs)?.toFixed(2)}R</p>
                </div>
              </div>
            </div>
          )}

          {(["pending", "taken", "missed", "invalidated"] as const).map((status) => {
            const group = ideas.filter((i) => i.status === status);
            if (group.length === 0) return null;
            return (
              <div key={status}>
                <h3 className="mb-2 text-xs font-medium capitalize text-muted-foreground">
                  {status} ({group.length})
                </h3>
                <div className="surface-panel overflow-hidden p-0">
                  <div className="trade-table-wrap">
                    <table className="trade-table">
                      <thead>
                        <tr>
                          <th>Symbol</th>
                          <th>Direction</th>
                          <th>Entry / Stop / Target</th>
                          <th>Planned R:R</th>
                          <th>
                            <span className="sr-only">Actions</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.map((idea) => {
                          const r = plannedR(idea);
                          return (
                            <tr key={idea.id}>
                              <td className="font-medium">{idea.symbol}</td>
                              <td className="capitalize">{idea.direction}</td>
                              <td className="font-mono text-xs text-muted-foreground">
                                {idea.planned_entry ?? "—"} / {idea.planned_stop ?? "—"} / {idea.planned_target ?? "—"}
                              </td>
                              <td className="font-mono">{r != null ? `${r.toFixed(2)}R` : "—"}</td>
                              <td>
                                <div className="flex justify-end gap-1.5 text-xs">
                                  {status === "pending" && (
                                    <>
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => {
                                          setConvertingIdea(idea);
                                          setConvertQuantity("");
                                        }}
                                      >
                                        Convert to trade
                                      </Button>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => ideaStatusMutation.mutate({ ideaId: idea.id, status: "missed" })}
                                      >
                                        Missed
                                      </Button>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => ideaStatusMutation.mutate({ ideaId: idea.id, status: "invalidated" })}
                                      >
                                        Invalidated
                                      </Button>
                                    </>
                                  )}
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    aria-label="Delete idea"
                                    onClick={() => {
                                      if (window.confirm(`Delete this ${idea.symbol} idea? This can't be undone.`)) {
                                        deleteIdeaMutation.mutate(idea.id);
                                      }
                                    }}
                                  >
                                    <Trash2 className="size-3.5 text-destructive" />
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            );
          })}

          {ideas.length === 0 && (
            <p className="surface-panel py-10 text-center text-sm text-muted-foreground">
              No ideas logged yet. Track a setup above before you take it.
            </p>
          )}
        </div>
      )}

      {notice && (
        <div className="toast-message">
          <Check className="size-4 text-chart-2" />
          {notice}
        </div>
      )}

      {isEditorOpen && (
        <PlaybookEditorModal
          playbook={editingPlaybook}
          userId={workspace.profile.user_id}
          isSubmitting={saveMutation.isPending}
          onClose={() => {
            setIsEditorOpen(false);
            setEditingPlaybook(null);
          }}
          onSave={(values) => saveMutation.mutate(values)}
        />
      )}

      {convertingIdea && (
        <Dialog open onOpenChange={(open) => { if (!open) setConvertingIdea(null); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle id="convert-idea-title">Convert to trade</DialogTitle>
            </DialogHeader>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-6">
              <p className="text-sm text-muted-foreground">
                Opens a trade for <span className="font-medium text-foreground">{convertingIdea.symbol}</span> at
                the idea's planned entry, stop, and target. You can edit everything else afterward in the Journal.
              </p>
              <div>
                <label htmlFor="convert-quantity" className="field-label">
                  {sizeLabel(getInstrumentSpec(convertingIdea.symbol)).noun}
                </label>
                <Input
                  id="convert-quantity"
                  type="number"
                  step={getInstrumentSpec(convertingIdea.symbol).sizeUnit === "lots" ? "0.01" : "any"}
                  min="0"
                  className="font-mono"
                  value={convertQuantity}
                  onChange={(e) => setConvertQuantity(e.target.value)}
                  placeholder={sizeLabel(getInstrumentSpec(convertingIdea.symbol)).placeholder}
                  autoFocus
                />
              </div>
              <div className="flex gap-3 pt-2">
                <Button type="button" variant="outline" className="flex-1" onClick={() => setConvertingIdea(null)}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  className="flex-1"
                  disabled={convertMutation.isPending}
                  onClick={() => convertMutation.mutate()}
                >
                  {convertMutation.isPending ? "Creating…" : "Create trade"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
