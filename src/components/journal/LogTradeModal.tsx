// The single modal used for both creating and editing a trade — "log a
// planned trade" and "record a manual fill" are the same form, distinguished
// only by isPlanned/status, so there's one code path for trade math instead
// of two that could drift apart. Owns the playbook picker + checklist +
// confidence score at log time; the parent (journal.tsx) freezes the
// selected playbook's checklist + answers into playbook_snapshot at submit
// time so a later edit to the playbook itself never rewrites this trade's
// history (see the migration comment in
// supabase/migrations/20260908120000_phase2_playbooks_and_ideas.sql).
import { Activity, ArrowDownRight, ArrowUpRight, ClipboardCheck, Plus, ShieldCheck, Tag as TagIcon, Target } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AttachmentsPanel, PendingScreenshotsPicker } from "@/components/journal/AttachmentsPanel";
import { PartialExitsPanel } from "@/components/journal/PartialExitsPanel";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { PlaybookWithChecklist } from "@/lib/playbooks.functions";
import {
  buildSizingContext,
  getInstrumentSpec,
  needsQuoteRate,
  sizeLabel,
  type SizingContext,
} from "@/lib/instruments";
import { calculateRiskPreview, type Direction, type TradeStatus } from "@/lib/trade-calc";
import type { Database } from "@/integrations/supabase/types";

type TagRow = Database["public"]["Tables"]["tags"]["Row"];
type AccountRow = Database["public"]["Tables"]["accounts"]["Row"];

export const emptyTradeForm = {
  accountId: null as string | null,
  symbol: "",
  direction: "long" as Direction,
  status: "closed" as TradeStatus,
  entryPrice: "",
  exitPrice: "",
  quantity: "",
  // Account-currency value of 1 unit of the quote currency; only asked for crosses (EURGBP, GBPJPY…).
  quoteRate: "",
  stopLoss: "",
  takeProfit: "",
  fees: "0",
  notes: "",
  isPlanned: true,
  disciplineScore: 3,
  confidence: 3,
  playbookId: null as string | null,
  checklistAnswers: {} as Record<string, boolean>,
  tagIds: [] as string[],
};

export type TradeForm = typeof emptyTradeForm;

/** Currency-formatted amount in the account's own currency (falls back to "1,234 CODE" for unknown codes). */
function formatMoney(amount: number, currency: string, fractionDigits = 0): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(amount);
  } catch {
    return `${amount.toLocaleString(undefined, { maximumFractionDigits: fractionDigits })} ${currency}`;
  }
}

const STATUS_OPTIONS: { value: TradeStatus; label: string }[] = [
  { value: "closed", label: "Closed" },
  { value: "open", label: "Open" },
  { value: "cancelled", label: "Cancelled" },
  { value: "incomplete", label: "Incomplete" },
];

export function LogTradeModal({
  form,
  setForm,
  equity,
  riskPercent,
  isEditing,
  isSubmitting,
  allTags,
  onCreateTag,
  editingTradeId,
  portfolioId,
  accounts,
  userId,
  playbooks,
  pendingScreenshots,
  onPendingScreenshotsChange,
  isLegacyUnits = false,
  onClose,
  onSubmit,
}: {
  form: TradeForm;
  setForm: (value: TradeForm) => void;
  equity: number;
  riskPercent: number;
  isEditing: boolean;
  isSubmitting: boolean;
  allTags: TagRow[];
  onCreateTag: (name: string) => Promise<TagRow>;
  editingTradeId: string | null;
  portfolioId: string;
  accounts: AccountRow[];
  userId: string;
  playbooks: PlaybookWithChecklist[];
  /** Screenshots staged for a trade that isn't saved yet (new-trade flow only). */
  pendingScreenshots: File[];
  onPendingScreenshotsChange: (files: File[]) => void;
  /** Editing a pre-lots trade whose partial exits are still stored in raw units (they convert on save). */
  isLegacyUnits?: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const patch = (partial: Partial<TradeForm>) => setForm({ ...form, ...partial });
  const [newTagName, setNewTagName] = useState("");
  const [isCreatingTag, setIsCreatingTag] = useState(false);
  const selectedPlaybook = playbooks.find((p) => p.id === form.playbookId) ?? null;

  function toggleChecklistItem(itemId: string) {
    patch({ checklistAnswers: { ...form.checklistAnswers, [itemId]: !form.checklistAnswers[itemId] } });
  }

  function toggleTag(tagId: string) {
    patch({
      tagIds: form.tagIds.includes(tagId)
        ? form.tagIds.filter((id) => id !== tagId)
        : [...form.tagIds, tagId],
    });
  }

  async function handleCreateTag() {
    const name = newTagName.trim();
    if (!name) return;
    setIsCreatingTag(true);
    try {
      const tag = await onCreateTag(name);
      patch({ tagIds: [...form.tagIds, tag.id] });
      setNewTagName("");
    } finally {
      setIsCreatingTag(false);
    }
  }

  const entry = Number(form.entryPrice);
  const stop = Number(form.stopLoss);
  const exit = Number(form.exitPrice);
  const size = Number(form.quantity);
  const hasStop = form.stopLoss !== "" && Number.isFinite(stop);
  const hasEntry = form.entryPrice !== "" && Number.isFinite(entry);

  // What the symbol is (lots vs units, contract size, quote currency) drives
  // the size field, the risk preview and whether a conversion rate is needed.
  const spec = getInstrumentSpec(form.symbol);
  const selectedAccount = accounts.find((account) => account.id === form.accountId) ?? accounts[0];
  const accountCurrency = (selectedAccount?.base_currency ?? "USD").toUpperCase();
  const askForQuoteRate = form.symbol.trim() !== "" && needsQuoteRate(spec, accountCurrency);
  const quoteRate = form.quoteRate !== "" ? Number(form.quoteRate) : null;
  const sizeText = sizeLabel(spec);
  let sizing: SizingContext | undefined;
  if (spec.sizeUnit === "lots") {
    try {
      sizing = buildSizingContext({ symbol: form.symbol, accountCurrency, quoteRate });
    } catch {
      sizing = undefined; // cross pair, rate not entered yet — the field below asks for it
    }
  }
  const sizingReady = spec.sizeUnit !== "lots" || sizing != null;

  const preview =
    hasEntry && hasStop && sizingReady
      ? calculateRiskPreview({
          equity,
          riskPercent,
          entryPrice: entry,
          stopLoss: stop,
          ...(sizing ? { sizing } : {}),
        })
      : null;

  // Risk scales linearly with size, so "what your size risks" is the budget
  // scaled by your size over the suggested size — no second formula to drift.
  const yourRisk =
    preview && preview.suggestedQuantity && Number.isFinite(size) && size > 0
      ? (preview.riskAmount * size) / preview.suggestedQuantity
      : null;
  const suggestedSize = preview ? (preview.suggestedLotsRounded ?? preview.suggestedQuantity) : null;
  const plannedR =
    preview &&
    form.takeProfit !== "" &&
    Number.isFinite(Number(form.takeProfit)) &&
    preview.stopDistance > 0
      ? Math.abs(Number(form.takeProfit) - entry) / preview.stopDistance
      : null;
  const realizedR =
    preview &&
    form.status === "closed" &&
    Number.isFinite(exit) &&
    form.exitPrice !== "" &&
    preview.stopDistance > 0
      ? Math.abs(exit - entry) / preview.stopDistance
      : null;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <div>
            <p className="eyebrow mb-1">Journal entry</p>
            <DialogTitle id="log-trade-title">{isEditing ? "Edit trade" : "Log a trade"}</DialogTitle>
          </div>
        </DialogHeader>
        <form onSubmit={onSubmit} className="min-h-0 flex-1 space-y-5 overflow-y-auto p-6">
          {accounts.length > 1 && (
            <div>
              <span className="field-label">Account</span>
              <Select value={form.accountId ?? ""} onValueChange={(value) => patch({ accountId: value })}>
                <SelectTrigger>
                  <SelectValue placeholder="Which account is this for?" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="trade-symbol" className="field-label">
                Instrument
              </label>
              <Input
                id="trade-symbol"
                value={form.symbol}
                onChange={(event) => patch({ symbol: event.target.value })}
                placeholder="EURUSD"
                autoFocus
              />
            </div>
            <div>
              <span className="field-label">Status</span>
              <Select
                value={form.status}
                onValueChange={(value: TradeStatus) => patch({ status: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <span className="field-label">Direction</span>
            <div className="direction-toggle">
              {(
                [
                  { value: "long" as Direction, label: "Long" },
                  { value: "short" as Direction, label: "Short" },
                ] as const
              ).map((item) => (
                <Button
                  type="button"
                  key={item.value}
                  variant={form.direction === item.value ? "secondary" : "ghost"}
                  className="flex-1"
                  onClick={() => patch({ direction: item.value })}
                >
                  {item.value === "long" ? <ArrowUpRight /> : <ArrowDownRight />}
                  {item.label}
                </Button>
              ))}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="trade-entry" className="field-label">
                Entry price
              </label>
              <Input
                id="trade-entry"
                type="number"
                step="any"
                value={form.entryPrice}
                onChange={(event) => patch({ entryPrice: event.target.value })}
                placeholder="1.0850"
              />
            </div>
            {form.status === "closed" ? (
              <div>
                <label htmlFor="trade-exit" className="field-label">
                  Exit price
                </label>
                <Input
                  id="trade-exit"
                  type="number"
                  step="any"
                  value={form.exitPrice}
                  onChange={(event) => patch({ exitPrice: event.target.value })}
                  placeholder="1.0920"
                />
              </div>
            ) : (
              <div>
                <label htmlFor="trade-quantity-open" className="field-label">
                  {sizeText.noun}
                </label>
                <Input
                  id="trade-quantity-open"
                  type="number"
                  step={spec.sizeUnit === "lots" ? "0.01" : "any"}
                  min="0"
                  inputMode="decimal"
                  className="font-mono"
                  value={form.quantity}
                  onChange={(event) => patch({ quantity: event.target.value })}
                  placeholder={sizeText.placeholder}
                />
              </div>
            )}
            {form.status === "closed" && (
              <div>
                <label htmlFor="trade-quantity" className="field-label">
                  {sizeText.noun}
                </label>
                <Input
                  id="trade-quantity"
                  type="number"
                  step={spec.sizeUnit === "lots" ? "0.01" : "any"}
                  min="0"
                  inputMode="decimal"
                  className="font-mono"
                  value={form.quantity}
                  onChange={(event) => patch({ quantity: event.target.value })}
                  placeholder={sizeText.placeholder}
                />
              </div>
            )}
            <div>
              <label htmlFor="trade-fees" className="field-label">
                Fees ({accountCurrency})
              </label>
              <Input
                id="trade-fees"
                type="number"
                step="any"
                value={form.fees}
                onChange={(event) => patch({ fees: event.target.value })}
                placeholder="0"
              />
            </div>
            <div>
              <label htmlFor="trade-stop" className="field-label">
                Stop loss
              </label>
              <Input
                id="trade-stop"
                type="number"
                step="any"
                value={form.stopLoss}
                onChange={(event) => patch({ stopLoss: event.target.value })}
                placeholder="Optional"
              />
            </div>
            <div>
              <label htmlFor="trade-target" className="field-label">
                Take profit
              </label>
              <Input
                id="trade-target"
                type="number"
                step="any"
                value={form.takeProfit}
                onChange={(event) => patch({ takeProfit: event.target.value })}
                placeholder="Optional"
              />
            </div>
          </div>
          {askForQuoteRate && (
            <div>
              <label htmlFor="trade-quote-rate" className="field-label">
                {accountCurrency} value of 1 {spec.quote}
              </label>
              <Input
                id="trade-quote-rate"
                type="number"
                step="any"
                min="0"
                className="font-mono"
                value={form.quoteRate}
                onChange={(event) => patch({ quoteRate: event.target.value })}
                placeholder={spec.quote === "JPY" ? "0.0067" : "1.27"}
              />
              <p className="form-hint">
                {spec.symbol} is priced in {spec.quote}, not {accountCurrency}, so P&amp;L and risk need this rate to be
                converted. Use the current {spec.quote}/{accountCurrency} rate (for example, what 1 {spec.quote} buys in{" "}
                {accountCurrency}).
              </p>
            </div>
          )}
          {preview && (
            <div className="rounded-md border border-border bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">
              <Target className="mr-1 inline size-3 text-chart-2" /> Risk preview at {riskPercent}%
              of equity:{" "}
              <span className="font-mono font-semibold text-foreground">
                {formatMoney(preview.riskAmount, accountCurrency)}
              </span>{" "}
              risk, suggested size{" "}
              <span className="font-mono font-semibold text-foreground">
                {suggestedSize != null
                  ? suggestedSize.toLocaleString(undefined, {
                      minimumFractionDigits: spec.sizeUnit === "lots" ? 2 : 0,
                      maximumFractionDigits: spec.sizeUnit === "lots" ? 2 : 4,
                    })
                  : "—"}
              </span>{" "}
              {sizeText.unit}
              {preview.stopPips != null && preview.pipValuePerLot != null && (
                <span>
                  {" "}
                  ({preview.stopPips.toLocaleString(undefined, { maximumFractionDigits: 1 })} pip stop,{" "}
                  {formatMoney(preview.pipValuePerLot, accountCurrency, 2)}/pip per lot)
                </span>
              )}
              {plannedR != null && (
                <>
                  , planned{" "}
                  <span className="font-mono font-semibold text-foreground">{plannedR.toFixed(1)}R</span>
                </>
              )}
              {realizedR != null && (
                <>
                  , realized{" "}
                  <span className="font-mono font-semibold text-foreground">{realizedR.toFixed(1)}R</span>
                </>
              )}
              {yourRisk != null && (
                <>
                  , your size risks{" "}
                  <span className="font-mono font-semibold text-foreground">
                    {formatMoney(yourRisk, accountCurrency)}
                  </span>
                </>
              )}
            </div>
          )}
          <div>
            <label htmlFor="trade-notes" className="field-label">
              Notes
            </label>
            <Textarea
              id="trade-notes"
              rows={3}
              value={form.notes}
              onChange={(event) => patch({ notes: event.target.value })}
              placeholder="Setup, context, what you saw…"
            />
          </div>
          <div>
            <span className="field-label">Tags</span>
            <div className="flex flex-wrap gap-1.5">
              {allTags.map((tag) => {
                const selected = form.tagIds.includes(tag.id);
                return (
                  <button
                    type="button"
                    key={tag.id}
                    onClick={() => toggleTag(tag.id)}
                    aria-pressed={selected}
                  >
                    <Badge variant={selected ? "default" : "outline"} className="cursor-pointer">
                      <TagIcon className="size-3" /> {tag.name}
                    </Badge>
                  </button>
                );
              })}
            </div>
            <div className="mt-2 flex gap-2">
              <Input
                value={newTagName}
                onChange={(event) => setNewTagName(event.target.value)}
                placeholder="New tag name"
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void handleCreateTag();
                  }
                }}
              />
              <Button type="button" variant="outline" size="sm" disabled={isCreatingTag} onClick={() => void handleCreateTag()}>
                {isCreatingTag ? "Adding…" : "Add"}
              </Button>
            </div>
          </div>
          {editingTradeId && form.status === "open" && (
            <>
              <PartialExitsPanel
                tradeId={editingTradeId}
                portfolioId={portfolioId}
                totalQuantity={Number(form.quantity) || 0}
                unit={spec.sizeUnit}
              />
              {isLegacyUnits && (
                <p className="form-hint">
                  This trade was logged before position size was in lots. Saving it now converts its size and any
                  partial exits to lots automatically.
                </p>
              )}
            </>
          )}
          {editingTradeId ? (
            <AttachmentsPanel tradeId={editingTradeId} userId={userId} />
          ) : (
            <PendingScreenshotsPicker files={pendingScreenshots} onChange={onPendingScreenshotsChange} />
          )}
          <div className="direction-toggle">
            <Button
              type="button"
              variant={form.isPlanned ? "secondary" : "ghost"}
              className="flex-1"
              onClick={() => patch({ isPlanned: true })}
            >
              <ShieldCheck /> Curated
            </Button>
            <Button
              type="button"
              variant={!form.isPlanned ? "secondary" : "ghost"}
              className="flex-1"
              onClick={() => patch({ isPlanned: false })}
            >
              <Activity /> Impulse
            </Button>
          </div>
          <div>
            <span className="field-label">Playbook (optional)</span>
            <Select
              value={form.playbookId ?? "none"}
              onValueChange={(value) =>
                patch({ playbookId: value === "none" ? null : value, checklistAnswers: {} })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No playbook</SelectItem>
                {playbooks.map((playbook) => (
                  <SelectItem key={playbook.id} value={playbook.id}>
                    {playbook.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {selectedPlaybook && selectedPlaybook.checklistItems.length > 0 && (
            <div className="rounded-md border border-border p-3">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <ClipboardCheck className="size-3.5" /> Pre-trade checklist
              </p>
              <div className="space-y-2">
                {selectedPlaybook.checklistItems.map((item) => (
                  <label key={item.id} className="flex items-start gap-2 text-sm">
                    <Checkbox
                      className="mt-0.5"
                      checked={Boolean(form.checklistAnswers[item.id])}
                      onCheckedChange={() => toggleChecklistItem(item.id)}
                    />
                    <span>
                      {item.prompt}
                      {item.is_required && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="ml-1 cursor-help text-destructive">*</span>
                          </TooltipTrigger>
                          <TooltipContent>Marked as required in this playbook</TooltipContent>
                        </Tooltip>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}
          <div>
            <span className="field-label">Confidence — {form.confidence}/5</span>
            <input
              type="range"
              min={1}
              max={5}
              step={1}
              value={form.confidence}
              onChange={(event) => patch({ confidence: Number(event.target.value) })}
              className="w-full accent-current"
              aria-label="Confidence"
            />
          </div>
          <div>
            <span className="field-label">Discipline score — {form.disciplineScore}/5</span>
            <input
              type="range"
              min={1}
              max={5}
              step={1}
              value={form.disciplineScore}
              onChange={(event) => patch({ disciplineScore: Number(event.target.value) })}
              className="w-full accent-current"
              aria-label="Discipline score"
            />
          </div>
          <div className="sticky bottom-0 -mx-6 -mb-6 flex gap-3 border-t border-border bg-card p-6 pt-4">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1" disabled={isSubmitting}>
              <Plus /> {isSubmitting ? "Saving…" : isEditing ? "Save changes" : "Add trade"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
