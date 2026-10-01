// Everything about the shape of the "Log a trade" / "Edit trade" form that
// isn't rendering: the zod schema TanStack Form validates against, the blank
// defaults, the trade-row → form-values mapping used when editing, and the
// form-values → server payload conversion. It used to be split between
// journal.tsx (a hand-written `numbersValid` boolean plus the payload builder)
// and LogTradeModal.tsx (the defaults). Having it in one plain module means
// the validation rules and the payload they protect can't drift apart, and the
// modal component stays purely about layout.
//
// The form keeps every numeric input as a *string* (that's what an <input>
// holds, and it lets the person clear a field); the schema below validates
// those strings, and `buildTradePayload` converts them to numbers exactly once.
import { z } from "zod";

import type { Database } from "@/integrations/supabase/types";
import { displaySize } from "@/lib/instruments";
import type { PlaybookWithChecklist } from "@/lib/playbooks.functions";
import type { TradeInput } from "@/lib/trades.functions";

type TradeRow = Database["public"]["Tables"]["trades"]["Row"];

const isFiniteNumber = (value: string) => value.trim() !== "" && Number.isFinite(Number(value));
const requiredPositive = (message: string) =>
  z.string().refine((value) => isFiniteNumber(value) && Number(value) > 0, message);
const optionalNumber = (message: string) =>
  z.string().refine((value) => value.trim() === "" || Number.isFinite(Number(value)), message);

export const tradeFormSchema = z
  .object({
    accountId: z.string().nullable().refine((value) => value != null && value !== "", "Choose which account this trade belongs to"),
    symbol: z.string().trim().min(1, "Choose an instrument"),
    direction: z.enum(["long", "short"]),
    status: z.enum(["closed", "open", "cancelled", "incomplete"]),
    entryPrice: requiredPositive("Enter a valid entry price"),
    exitPrice: z.string(),
    quantity: requiredPositive("Enter a valid position size"),
    // Account-currency value of 1 unit of the quote currency; only asked for crosses (EURGBP, GBPJPY…).
    quoteRate: z.string(),
    stopLoss: optionalNumber("Stop loss must be a number"),
    takeProfit: optionalNumber("Take profit must be a number"),
    fees: z.string().refine((value) => value.trim() === "" || (Number.isFinite(Number(value)) && Number(value) >= 0), "Fees can't be negative"),
    notes: z.string(),
    isPlanned: z.boolean(),
    disciplineScore: z.number().int().min(1).max(5),
    confidence: z.number().int().min(1).max(5),
    playbookId: z.string().nullable(),
    checklistAnswers: z.record(z.string(), z.boolean()),
    tagIds: z.array(z.string()),
    /** Screenshots picked before the trade exists; uploaded once it is saved. */
    pendingScreenshots: z.array(z.instanceof(File)),
  })
  .superRefine((value, ctx) => {
    if (value.status === "closed" && !(isFiniteNumber(value.exitPrice) && Number(value.exitPrice) > 0)) {
      ctx.addIssue({ code: "custom", path: ["exitPrice"], message: "Enter a valid exit price for a closed trade" });
    }
  });

export type TradeFormValues = z.infer<typeof tradeFormSchema>;

export const emptyTradeForm: TradeFormValues = {
  accountId: null,
  symbol: "",
  direction: "long",
  status: "closed",
  entryPrice: "",
  exitPrice: "",
  quantity: "",
  quoteRate: "",
  stopLoss: "",
  takeProfit: "",
  fees: "0",
  notes: "",
  isPlanned: true,
  disciplineScore: 3,
  confidence: 3,
  playbookId: null,
  checklistAnswers: {},
  tagIds: [],
  pendingScreenshots: [],
};

/** Prefill for editing an existing trade. */
export function tradeToFormValues(trade: TradeRow, tagIds: string[]): TradeFormValues {
  return {
    accountId: trade.account_id,
    symbol: trade.symbol,
    direction: trade.direction === "short" ? "short" : "long",
    status:
      trade.status === "open" || trade.status === "cancelled" || trade.status === "incomplete" ? trade.status : "closed",
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
    tagIds,
    pendingScreenshots: [],
  };
}

/** Validated form values → the payload `createTrade` / `updateTrade` expect. */
export function buildTradeInput(
  values: TradeFormValues,
  context: { portfolioId: string; editingTrade: TradeRow | null; playbooks: PlaybookWithChecklist[] },
): TradeInput {
  const isClosed = values.status === "closed";
  const selectedPlaybook = values.playbookId
    ? (context.playbooks.find((playbook) => playbook.id === values.playbookId) ?? null)
    : null;

  // The playbook's checklist + the answers given are frozen into the trade so
  // a later edit to the playbook itself never rewrites this trade's history.
  const playbookSnapshot = selectedPlaybook
    ? {
        playbookId: selectedPlaybook.id,
        name: selectedPlaybook.name,
        checklist: selectedPlaybook.checklistItems.map((item) => ({
          prompt: item.prompt,
          isRequired: item.is_required,
          answered: Boolean(values.checklistAnswers[item.id]),
        })),
        answers: values.checklistAnswers,
      }
    : null;

  const now = new Date().toISOString();
  return {
    portfolioId: context.portfolioId,
    accountId: values.accountId as string,
    symbol: values.symbol.trim().toUpperCase(),
    direction: values.direction,
    status: values.status,
    openedAt: context.editingTrade ? context.editingTrade.opened_at : now,
    closedAt: isClosed ? (context.editingTrade?.closed_at ?? now) : null,
    entryPrice: Number(values.entryPrice),
    exitPrice: isClosed && values.exitPrice !== "" ? Number(values.exitPrice) : null,
    quantity: Number(values.quantity),
    quoteRate: values.quoteRate !== "" && Number.isFinite(Number(values.quoteRate)) ? Number(values.quoteRate) : null,
    stopLoss: values.stopLoss !== "" ? Number(values.stopLoss) : null,
    takeProfit: values.takeProfit !== "" ? Number(values.takeProfit) : null,
    fees: Number(values.fees || 0),
    spreadCost: 0,
    swapFunding: 0,
    isPlanned: values.isPlanned,
    disciplineScore: values.disciplineScore,
    confidence: values.confidence,
    playbookId: values.playbookId,
    playbookSnapshot,
    notes: values.notes.trim() || null,
    tagIds: values.tagIds,
  };
}
