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
//
// Page state is in the URL: ?tab=ideas, ?edit=new|<playbookId> (the editor
// modal) and ?convert=<ideaId> (the convert-to-trade dialog). The idea form
// and the convert dialog are TanStack Forms; confirmations are toasts.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { BookOpen, Lightbulb, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { InstrumentSelect } from "@/components/journal/InstrumentSelect";
import { PlaybookEditorModal, type PlaybookFormValues } from "@/components/playbooks/PlaybookEditorModal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Database } from "@/integrations/supabase/types";
import { FieldMessage, formProps, useAppForm } from "@/lib/form";
import { getInstrumentSpec, sizeLabel } from "@/lib/instruments";
import { deletePlaybook, savePlaybook, setPlaybookStatus } from "@/lib/playbooks.functions";
import {
  playbooksQueryOptions,
  queryKeys,
  tradeIdeasQueryOptions,
  workspaceQueryOptions,
} from "@/lib/queries";
import { createTradeIdea, deleteTradeIdea, setTradeIdeaStatus } from "@/lib/trade-ideas.functions";
import { createTrade } from "@/lib/trades.functions";

type TradeIdeaRow = Database["public"]["Tables"]["trade_ideas"]["Row"];

export const Route = createFileRoute("/app/playbooks")({
  head: () => ({
    meta: [
      { title: "Playbooks — Curated Trades" },
      { name: "description", content: "Define your setups and pre-trade checklists, and track ideas before they become trades." },
    ],
  }),
  validateSearch: z.object({
    tab: z.enum(["playbooks", "ideas"]).optional(),
    /** "new", or the id of the playbook open in the editor. */
    edit: z.string().optional(),
    /** Id of the idea open in the convert-to-trade dialog. */
    convert: z.string().optional(),
  }),
  component: PlaybooksPage,
});

const DIRECTION_OPTIONS = [
  { value: "long", label: "Long" },
  { value: "short", label: "Short" },
] as const;

const optionalNumber = z.string().refine((value) => value === "" || Number.isFinite(Number(value)), "Enter a number");
const ideaSchema = z.object({
  symbol: z.string().trim().min(1, "Enter a symbol first"),
  market: z.enum(["forex", "crypto"]),
  direction: z.enum(["long", "short"]),
  playbookId: z.string(),
  plannedEntry: optionalNumber,
  plannedStop: optionalNumber,
  plannedTarget: optionalNumber,
  notes: z.string(),
});
const emptyIdeaForm: z.infer<typeof ideaSchema> = {
  symbol: "",
  market: "forex",
  direction: "long",
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


const convertSchema = z.object({
  quantity: z.string().refine((value) => Number.isFinite(Number(value)) && Number(value) > 0, "Enter a valid quantity"),
});

function ConvertIdeaDialog({
  idea,
  isPending,
  onClose,
  onConvert,
}: {
  idea: TradeIdeaRow;
  isPending: boolean;
  onClose: () => void;
  onConvert: (quantity: number) => void;
}) {
  const spec = getInstrumentSpec(idea.symbol);
  const form = useAppForm({
    defaultValues: { quantity: "" },
    validators: { onSubmit: convertSchema },
    onSubmit: ({ value }) => onConvert(Number(value.quantity)),
  });
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle id="convert-idea-title">Convert to trade</DialogTitle>
        </DialogHeader>
        <form {...formProps(form)} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-6">
          <p className="text-sm text-muted-foreground">
            Opens a trade for <span className="font-medium text-foreground">{idea.symbol}</span> at the idea's planned entry,
            stop, and target. You can edit everything else afterward in the Journal.
          </p>
          <form.AppField name="quantity">
            {(field) => (
              <field.TextField
                label={sizeLabel(spec).noun}
                type="number"
                step={spec.sizeUnit === "lots" ? "0.01" : "any"}
                min="0"
                className="font-mono"
                placeholder={sizeLabel(spec).placeholder}
                autoFocus
              />
            )}
          </form.AppField>
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <form.AppForm>
              <form.SubmitButton className="flex-1" pendingLabel="Creating…" pending={isPending}>
                Create trade
              </form.SubmitButton>
            </form.AppForm>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PlaybooksPage() {
  const queryClient = useQueryClient();
  const navigate = Route.useNavigate();
  const search = Route.useSearch();
  const tab = search.tab ?? "playbooks";
  const setSearch = (patch: { tab?: "playbooks" | "ideas" | undefined; edit?: string | undefined; convert?: string | undefined }) =>
    void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });

  const { data: workspace } = useQuery(workspaceQueryOptions);
  const activePortfolioId = workspace?.activePortfolio.id;

  const { data: playbooks = [] } = useQuery(playbooksQueryOptions);
  const activePlaybooks = playbooks.filter((p) => p.status === "active");
  const { data: ideas = [] } = useQuery(tradeIdeasQueryOptions(activePortfolioId));

  const invalidatePlaybooks = () => queryClient.invalidateQueries({ queryKey: queryKeys.playbooks });
  const invalidateIdeas = () => queryClient.invalidateQueries({ queryKey: tradeIdeasQueryOptions(activePortfolioId).queryKey });

  // --- Playbooks ---
  const editingPlaybook = search.edit && search.edit !== "new" ? (playbooks.find((p) => p.id === search.edit) ?? null) : null;
  const isEditorOpen = search.edit === "new" || editingPlaybook != null;

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
      void invalidatePlaybooks();
      toast.success(editingPlaybook ? "Playbook updated" : "Playbook created");
      setSearch({ edit: undefined });
    },
    onError: () => toast.error("Couldn't save playbook"),
  });

  const statusMutation = useMutation({
    mutationFn: (input: { playbookId: string; status: "active" | "archived" }) => setPlaybookStatus({ data: input }),
    onSuccess: invalidatePlaybooks,
  });

  const deleteMutation = useMutation({
    mutationFn: (playbookId: string) => deletePlaybook({ data: { playbookId } }),
    onSuccess: () => {
      void invalidatePlaybooks();
      toast.success("Playbook deleted");
    },
  });

  // --- Ideas ---
  const createIdeaMutation = useMutation({
    mutationFn: (values: z.infer<typeof ideaSchema>) => {
      if (!activePortfolioId) throw new Error("No active portfolio");
      const num = (value: string) => (value === "" ? null : Number(value));
      return createTradeIdea({
        data: {
          portfolioId: activePortfolioId,
          playbookId: values.playbookId === "none" ? null : values.playbookId,
          symbol: values.symbol.trim().toUpperCase(),
          market: values.market,
          direction: values.direction,
          plannedEntry: num(values.plannedEntry),
          plannedStop: num(values.plannedStop),
          plannedTarget: num(values.plannedTarget),
          notes: values.notes.trim() || null,
        },
      });
    },
    onSuccess: () => {
      void invalidateIdeas();
      ideaForm.reset();
      toast.success("Idea logged");
    },
    onError: () => toast.error("Check the idea fields — something's missing or invalid"),
  });

  const ideaForm = useAppForm({
    defaultValues: emptyIdeaForm,
    validators: { onSubmit: ideaSchema },
    onSubmit: ({ value }) => createIdeaMutation.mutate(value),
    onSubmitInvalid: () => toast.error("Check the idea fields — something's missing or invalid"),
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

  const convertingIdea = search.convert ? (ideas.find((idea) => idea.id === search.convert) ?? null) : null;

  const convertMutation = useMutation({
    mutationFn: async ({ idea, quantity }: { idea: TradeIdeaRow; quantity: number }) => {
      if (!activePortfolioId) throw new Error("Nothing to convert");
      const accountId = workspace?.activeAccount?.id ?? workspace?.accounts[0]?.id;
      if (!accountId) throw new Error("No account to log this trade against");
      if (idea.planned_entry == null) throw new Error("This idea has no planned entry price");

      const [trade] = await createTrade({
        data: {
          portfolioId: activePortfolioId,
          accountIds: [accountId],
          symbol: idea.symbol,
          direction: idea.direction === "short" ? "short" : "long",
          status: "open",
          openedAt: new Date().toISOString(),
          entryPrice: idea.planned_entry,
          quantity,
          stopLoss: idea.planned_stop ?? null,
          takeProfit: idea.planned_target ?? null,
          fees: 0,
          spreadCost: 0,
          swapFunding: 0,
          isPlanned: true,
          playbookId: idea.playbook_id,
          notes: idea.notes,
          tagIds: [],
        },
      });

      await setTradeIdeaStatus({ data: { ideaId: idea.id, status: "taken", takenTradeId: trade!.id } });
    },
    onSuccess: () => {
      void invalidateIdeas();
      void queryClient.invalidateQueries({ queryKey: queryKeys.trades(activePortfolioId) });
      setSearch({ convert: undefined });
      toast.success("Trade logged from idea");
    },
    onError: (error) => toast.error(error.message || "Couldn't convert idea to a trade"),
  });

  const pendingIdeas = ideas.filter((i) => i.status === "pending");
  const takenIdeas = ideas.filter((i) => i.status === "taken");
  const missedIdeas = ideas.filter((i) => i.status === "missed" || i.status === "invalidated");

  const takenPlannedRs = takenIdeas.map(plannedR).filter((r): r is number => r != null);
  const missedPlannedRs = missedIdeas.map(plannedR).filter((r): r is number => r != null);
  const avg = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
  const showMissedComparison = takenPlannedRs.length >= 3 && missedPlannedRs.length >= 3;

  if (!workspace) {
    return <p className="py-10 text-center text-sm text-muted-foreground">Loading playbooks…</p>;
  }

  return (
    <>
      <section className="mb-6 flex flex-col justify-between gap-4 border-b border-border pb-5 sm:flex-row sm:items-center">
        <h1 className="page-title">Playbooks</h1>
        <div className="direction-toggle">
          <Button type="button" variant={tab === "playbooks" ? "secondary" : "ghost"} onClick={() => setSearch({ tab: undefined })}>
            <BookOpen /> Playbooks
          </Button>
          <Button type="button" variant={tab === "ideas" ? "secondary" : "ghost"} onClick={() => setSearch({ tab: "ideas" })}>
            <Lightbulb /> Trade ideas
          </Button>
        </div>
      </section>

      {tab === "playbooks" && (
        <>
          <div className="mb-4 flex justify-end">
            <Button onClick={() => setSearch({ edit: "new" })}>
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
                      onClick={() => setSearch({ edit: playbook.id })}
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
          <form {...formProps(ideaForm)} className="surface-panel grid items-start gap-3 sm:grid-cols-6">
            <div className="sm:col-span-1">
              <ideaForm.AppField name="symbol">
                {(field) => (
                  <div>
                    <label htmlFor="idea-symbol" className="field-label">
                      Symbol
                    </label>
                    <InstrumentSelect id="idea-symbol" value={field.state.value} onChange={field.handleChange} />
                    <FieldMessage />
                  </div>
                )}
              </ideaForm.AppField>
            </div>
            <div className="sm:col-span-1">
              <ideaForm.AppField name="direction">
                {(field) => <field.SelectField label="Direction" options={DIRECTION_OPTIONS} />}
              </ideaForm.AppField>
            </div>
            <div className="sm:col-span-2">
              <ideaForm.AppField name="playbookId">
                {(field) => (
                  <field.SelectField
                    label="Playbook"
                    options={[{ value: "none", label: "No playbook" }, ...activePlaybooks.map((p) => ({ value: p.id, label: p.name }))]}
                  />
                )}
              </ideaForm.AppField>
            </div>
            <div className="sm:col-span-1">
              <ideaForm.AppField name="plannedEntry">
                {(field) => <field.TextField label="Entry" type="number" step="any" className="font-mono" />}
              </ideaForm.AppField>
            </div>
            <div className="sm:col-span-1">
              <ideaForm.AppField name="plannedStop">
                {(field) => <field.TextField label="Stop" type="number" step="any" className="font-mono" />}
              </ideaForm.AppField>
            </div>
            <div className="sm:col-span-1">
              <ideaForm.AppField name="plannedTarget">
                {(field) => <field.TextField label="Target" type="number" step="any" className="font-mono" />}
              </ideaForm.AppField>
            </div>
            <div className="sm:col-span-5">
              <ideaForm.AppField name="notes">
                {(field) => <field.TextareaField label="Notes" rows={1} placeholder="Why this setup, what you're waiting for" />}
              </ideaForm.AppField>
            </div>
            <div className="flex items-end sm:col-span-1">
              <ideaForm.AppForm>
                <ideaForm.SubmitButton className="w-full" pending={createIdeaMutation.isPending}>
                  <Plus /> Log idea
                </ideaForm.SubmitButton>
              </ideaForm.AppForm>
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
                                        onClick={() => setSearch({ convert: idea.id })}
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

      {isEditorOpen && (
        <PlaybookEditorModal
          key={editingPlaybook?.id ?? "new"}
          playbook={editingPlaybook}
          userId={workspace.profile.user_id}
          isSubmitting={saveMutation.isPending}
          onClose={() => setSearch({ edit: undefined })}
          onSave={(values) => saveMutation.mutate(values)}
        />
      )}

      {convertingIdea && (
        <ConvertIdeaDialog
          idea={convertingIdea}
          isPending={convertMutation.isPending}
          onClose={() => setSearch({ convert: undefined })}
          onConvert={(quantity) => convertMutation.mutate({ idea: convertingIdea, quantity })}
        />
      )}
    </>
  );
}
