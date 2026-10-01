// The single modal used for both creating and editing a trade — "log a
// planned trade" and "record a manual fill" are the same form, distinguished
// only by isPlanned/status, so there's one code path for trade math instead
// of two that could drift apart. Owns the playbook picker + checklist +
// confidence score at log time; `buildTradeInput` (lib/trade-form.ts) freezes
// the selected playbook's checklist + answers into playbook_snapshot at
// submit time so a later edit to the playbook itself never rewrites this
// trade's history (see the migration comment in
// supabase/migrations/20260908120000_phase2_playbooks_and_ideas.sql).
//
// The form is a TanStack Form: values live in the form store (not in the
// parent), validation is the zod `tradeFormSchema`, and the parent only hears
// about a *valid* submit through `onSubmit(values)`. The risk preview below
// reads live values through `useStore`.
import { useStore } from "@tanstack/react-form";
import { Activity, ArrowDownRight, ArrowUpRight, ClipboardCheck, Plus, ShieldCheck, Tag as TagIcon, Target } from "lucide-react";
import { toast } from "sonner";

import { AttachmentsPanel, PendingScreenshotsPicker } from "@/components/journal/AttachmentsPanel";
import { InstrumentSelect } from "@/components/journal/InstrumentSelect";
import { PartialExitsPanel } from "@/components/journal/PartialExitsPanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Database } from "@/integrations/supabase/types";
import { FieldMessage, formProps, useAppForm } from "@/lib/form";
import {
  buildSizingContext,
  getInstrumentSpec,
  isLegacyUnitQuantity,
  needsQuoteRate,
  sizeLabel,
  type SizingContext,
} from "@/lib/instruments";
import { formatMoney } from "@/lib/money";
import type { PlaybookWithChecklist } from "@/lib/playbooks.functions";
import { calculateRiskPreview } from "@/lib/trade-calc";
import { emptyTradeForm, tradeFormSchema, tradeToFormValues, type TradeFormValues } from "@/lib/trade-form";

type TagRow = Database["public"]["Tables"]["tags"]["Row"];
type AccountRow = Database["public"]["Tables"]["accounts"]["Row"];
type TradeRow = Database["public"]["Tables"]["trades"]["Row"];

const STATUS_OPTIONS = [
  { value: "closed", label: "Closed" },
  { value: "open", label: "Open" },
  { value: "cancelled", label: "Cancelled" },
  { value: "incomplete", label: "Incomplete" },
] as const;

const DIRECTION_OPTIONS = [
  { value: "long", label: "Long", icon: <ArrowUpRight /> },
  { value: "short", label: "Short", icon: <ArrowDownRight /> },
] as const;

const LABEL_OPTIONS = [
  { value: true, label: "Curated", icon: <ShieldCheck /> },
  { value: false, label: "Impulse", icon: <Activity /> },
] as const;

export function LogTradeModal({
  trade,
  initialTagIds,
  defaultAccountId,
  equity,
  riskPercent,
  isSubmitting,
  allTags,
  onCreateTag,
  portfolioId,
  accounts,
  userId,
  playbooks,
  onClose,
  onSubmit,
}: {
  /** The trade being edited, or null when logging a new one. */
  trade: TradeRow | null;
  /** Tags already linked to `trade` (ignored for a new trade). */
  initialTagIds: string[];
  /** Pre-selected account for a new trade. */
  defaultAccountId: string | null;
  equity: number;
  riskPercent: number;
  isSubmitting: boolean;
  allTags: TagRow[];
  onCreateTag: (name: string) => Promise<TagRow>;
  portfolioId: string;
  accounts: AccountRow[];
  userId: string;
  playbooks: PlaybookWithChecklist[];
  onClose: () => void;
  onSubmit: (values: TradeFormValues) => void;
}) {
  const isEditing = trade != null;
  const editingTradeId = trade?.id ?? null;
  // Editing a pre-lots trade whose partial exits are still stored in raw units (they convert on save).
  const isLegacyUnits = trade
    ? isLegacyUnitQuantity({ symbol: trade.symbol, quantity: trade.quantity, calculationVersion: trade.calculation_version })
    : false;

  const form = useAppForm({
    defaultValues: trade ? tradeToFormValues(trade, initialTagIds) : { ...emptyTradeForm, accountId: defaultAccountId },
    validators: { onSubmit: tradeFormSchema },
    onSubmit: ({ value }) => onSubmit(value),
    onSubmitInvalid: () => toast.error("Check the trade fields — something's missing or invalid"),
  });
  const values = useStore(form.store, (state) => state.values);

  // Inline "add a tag" mini-form. Not a <form> element (it sits inside the
  // trade form), so Enter is wired to its handleSubmit explicitly.
  const tagForm = useAppForm({
    defaultValues: { name: "" },
    onSubmit: async ({ value, formApi }) => {
      const name = value.name.trim();
      if (!name) return;
      const tag = await onCreateTag(name);
      form.setFieldValue("tagIds", (ids) => [...ids, tag.id]);
      formApi.reset();
    },
  });

  const selectedPlaybook = playbooks.find((p) => p.id === values.playbookId) ?? null;

  const entry = Number(values.entryPrice);
  const stop = Number(values.stopLoss);
  const exit = Number(values.exitPrice);
  const size = Number(values.quantity);
  const hasStop = values.stopLoss !== "" && Number.isFinite(stop);
  const hasEntry = values.entryPrice !== "" && Number.isFinite(entry);

  // What the symbol is (lots vs units, contract size, quote currency) drives
  // the size field, the risk preview and whether a conversion rate is needed.
  const spec = getInstrumentSpec(values.symbol);
  const selectedAccount = accounts.find((account) => account.id === values.accountId) ?? accounts[0];
  const accountCurrency = (selectedAccount?.base_currency ?? "USD").toUpperCase();
  const askForQuoteRate = values.symbol.trim() !== "" && needsQuoteRate(spec, accountCurrency);
  const quoteRate = values.quoteRate !== "" ? Number(values.quoteRate) : null;
  const sizeText = sizeLabel(spec);
  let sizing: SizingContext | undefined;
  if (spec.sizeUnit === "lots") {
    try {
      sizing = buildSizingContext({ symbol: values.symbol, accountCurrency, quoteRate });
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
    preview && values.takeProfit !== "" && Number.isFinite(Number(values.takeProfit)) && preview.stopDistance > 0
      ? Math.abs(Number(values.takeProfit) - entry) / preview.stopDistance
      : null;
  const realizedR =
    preview && values.status === "closed" && Number.isFinite(exit) && values.exitPrice !== "" && preview.stopDistance > 0
      ? Math.abs(exit - entry) / preview.stopDistance
      : null;

  const quantityField = (
    <form.AppField name="quantity">
      {(field) => (
        <field.TextField
          label={sizeText.noun}
          type="number"
          step={spec.sizeUnit === "lots" ? "0.01" : "any"}
          min="0"
          inputMode="decimal"
          className="font-mono"
          placeholder={sizeText.placeholder}
        />
      )}
    </form.AppField>
  );

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <div>
            <p className="eyebrow mb-1">Journal entry</p>
            <DialogTitle id="log-trade-title">{isEditing ? "Edit trade" : "Log a trade"}</DialogTitle>
          </div>
        </DialogHeader>
        <form {...formProps(form)} className="min-h-0 flex-1 space-y-5 overflow-y-auto p-6">
          {accounts.length > 1 && (
            <form.AppField name="accountId">
              {(field) => (
                <field.SelectField
                  label="Account"
                  placeholder="Which account is this for?"
                  options={accounts.map((account) => ({ value: account.id, label: account.name }))}
                />
              )}
            </form.AppField>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <form.AppField name="symbol">
              {(field) => (
                <div>
                  <label htmlFor="trade-symbol" className="field-label">
                    Instrument
                  </label>
                  <InstrumentSelect id="trade-symbol" value={field.state.value} onChange={field.handleChange} autoFocus />
                  <FieldMessage />
                </div>
              )}
            </form.AppField>
            <form.AppField name="status">
              {(field) => <field.SelectField label="Status" options={STATUS_OPTIONS} />}
            </form.AppField>
          </div>
          <form.AppField name="direction">
            {(field) => <field.SegmentedField label="Direction" options={DIRECTION_OPTIONS} />}
          </form.AppField>
          <div className="grid gap-4 sm:grid-cols-2">
            <form.AppField name="entryPrice">
              {(field) => <field.TextField label="Entry price" type="number" step="any" placeholder="1.0850" />}
            </form.AppField>
            {values.status === "closed" ? (
              <form.AppField name="exitPrice">
                {(field) => <field.TextField label="Exit price" type="number" step="any" placeholder="1.0920" />}
              </form.AppField>
            ) : (
              quantityField
            )}
            {values.status === "closed" && quantityField}
            <form.AppField name="fees">
              {(field) => <field.TextField label={`Fees (${accountCurrency})`} type="number" step="any" placeholder="0" />}
            </form.AppField>
            <form.AppField name="stopLoss">
              {(field) => <field.TextField label="Stop loss" type="number" step="any" placeholder="Optional" />}
            </form.AppField>
            <form.AppField name="takeProfit">
              {(field) => <field.TextField label="Take profit" type="number" step="any" placeholder="Optional" />}
            </form.AppField>
          </div>
          {askForQuoteRate && (
            <form.AppField name="quoteRate">
              {(field) => (
                <field.TextField
                  label={`${accountCurrency} value of 1 ${spec.quote}`}
                  type="number"
                  step="any"
                  min="0"
                  className="font-mono"
                  placeholder={spec.quote === "JPY" ? "0.0067" : "1.27"}
                  hint={
                    <>
                      {spec.symbol} is priced in {spec.quote}, not {accountCurrency}, so P&amp;L and risk need this rate
                      to be converted. Use the current {spec.quote}/{accountCurrency} rate (for example, what 1{" "}
                      {spec.quote} buys in {accountCurrency}).
                    </>
                  }
                />
              )}
            </form.AppField>
          )}
          {preview && (
            <div className="rounded-md border border-border bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">
              <Target className="mr-1 inline size-3 text-chart-2" /> Risk preview at {riskPercent}% of equity:{" "}
              <span className="font-mono font-semibold text-foreground">{formatMoney(preview.riskAmount, accountCurrency)}</span>{" "}
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
                  , planned <span className="font-mono font-semibold text-foreground">{plannedR.toFixed(1)}R</span>
                </>
              )}
              {realizedR != null && (
                <>
                  , realized <span className="font-mono font-semibold text-foreground">{realizedR.toFixed(1)}R</span>
                </>
              )}
              {yourRisk != null && (
                <>
                  , your size risks{" "}
                  <span className="font-mono font-semibold text-foreground">{formatMoney(yourRisk, accountCurrency)}</span>
                </>
              )}
            </div>
          )}
          <form.AppField name="notes">
            {(field) => <field.TextareaField label="Notes" rows={3} placeholder="Setup, context, what you saw…" />}
          </form.AppField>
          <div>
            <span className="field-label">Tags</span>
            <div className="flex flex-wrap gap-1.5">
              {allTags.map((tag) => {
                const selected = values.tagIds.includes(tag.id);
                return (
                  <button
                    type="button"
                    key={tag.id}
                    onClick={() =>
                      form.setFieldValue("tagIds", (ids) => (ids.includes(tag.id) ? ids.filter((id) => id !== tag.id) : [...ids, tag.id]))
                    }
                    aria-pressed={selected}
                  >
                    <Badge variant={selected ? "default" : "outline"} className="cursor-pointer">
                      <TagIcon className="size-3" /> {tag.name}
                    </Badge>
                  </button>
                );
              })}
            </div>
            <div className="mt-2 flex items-start gap-2">
              <div className="flex-1">
                <tagForm.AppField name="name">
                  {(field) => (
                    <field.TextField
                      placeholder="New tag name"
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void tagForm.handleSubmit();
                        }
                      }}
                    />
                  )}
                </tagForm.AppField>
              </div>
              <tagForm.Subscribe selector={(state) => state.isSubmitting}>
                {(isCreatingTag) => (
                  <Button type="button" variant="outline" size="sm" disabled={isCreatingTag} onClick={() => void tagForm.handleSubmit()}>
                    {isCreatingTag ? "Adding…" : "Add"}
                  </Button>
                )}
              </tagForm.Subscribe>
            </div>
          </div>
          {editingTradeId && values.status === "open" && (
            <>
              <PartialExitsPanel
                tradeId={editingTradeId}
                portfolioId={portfolioId}
                totalQuantity={Number(values.quantity) || 0}
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
            <form.AppField name="pendingScreenshots">
              {(field) => <PendingScreenshotsPicker files={field.state.value} onChange={field.handleChange} />}
            </form.AppField>
          )}
          <form.AppField name="isPlanned">
            {(field) => <field.SegmentedField options={LABEL_OPTIONS} />}
          </form.AppField>
          <form.AppField
            name="playbookId"
            listeners={{ onChange: () => form.setFieldValue("checklistAnswers", {}) }}
          >
            {(field) => (
              <div>
                <span className="field-label">Playbook (optional)</span>
                <Select
                  value={field.state.value ?? "none"}
                  onValueChange={(value) => field.handleChange(value === "none" ? null : value)}
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
            )}
          </form.AppField>
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
                      checked={Boolean(values.checklistAnswers[item.id])}
                      onCheckedChange={() =>
                        form.setFieldValue("checklistAnswers", (answers) => ({ ...answers, [item.id]: !answers[item.id] }))
                      }
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
          <form.AppField name="confidence">{(field) => <field.RangeField label="Confidence" />}</form.AppField>
          <form.AppField name="disciplineScore">{(field) => <field.RangeField label="Discipline score" />}</form.AppField>
          <div className="sticky bottom-0 -mx-6 -mb-6 flex gap-3 border-t border-border bg-card p-6 pt-4">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <form.AppForm>
              <form.SubmitButton className="flex-1" pendingLabel="Saving…" pending={isSubmitting}>
                <Plus /> {isEditing ? "Save changes" : "Add trade"}
              </form.SubmitButton>
            </form.AppForm>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
