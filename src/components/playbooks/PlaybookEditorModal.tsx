// Create/edit modal for a single playbook, including its ordered pre-trade
// checklist. The checklist is edited as a whole list (add/remove/reorder,
// then save everything at once) rather than per-item CRUD — matches how
// savePlaybook() on the server actually works (delete-all-then-reinsert for
// an edit), which is simpler and correct here because checklist items have
// no independent identity worth preserving across an edit.
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PlaybookAttachmentsPanel } from "@/components/playbooks/PlaybookAttachmentsPanel";
import type { PlaybookWithChecklist } from "@/lib/playbooks.functions";

export interface ChecklistDraftItem {
  prompt: string;
  isRequired: boolean;
}

export interface PlaybookFormValues {
  name: string;
  market: "forex" | "crypto";
  direction: "long" | "short" | "both";
  description: string;
  idealConditions: string;
  invalidationRules: string;
  checklistItems: ChecklistDraftItem[];
}

function toFormValues(playbook: PlaybookWithChecklist | null): PlaybookFormValues {
  if (!playbook) {
    return {
      name: "",
      market: "forex",
      direction: "long",
      description: "",
      idealConditions: "",
      invalidationRules: "",
      checklistItems: [],
    };
  }
  return {
    name: playbook.name,
    market: playbook.market === "crypto" ? "crypto" : "forex",
    direction: playbook.direction === "short" ? "short" : playbook.direction === "both" ? "both" : "long",
    description: playbook.description ?? "",
    idealConditions: playbook.ideal_conditions ?? "",
    invalidationRules: playbook.invalidation_rules ?? "",
    checklistItems: playbook.checklistItems.map((item) => ({ prompt: item.prompt, isRequired: item.is_required })),
  };
}

export function PlaybookEditorModal({
  playbook,
  userId,
  isSubmitting,
  onClose,
  onSave,
}: {
  playbook: PlaybookWithChecklist | null;
  userId: string;
  isSubmitting: boolean;
  onClose: () => void;
  onSave: (values: PlaybookFormValues) => void;
}) {
  const [values, setValues] = useState<PlaybookFormValues>(() => toFormValues(playbook));
  const patch = (partial: Partial<PlaybookFormValues>) => setValues({ ...values, ...partial });

  function addChecklistItem() {
    patch({ checklistItems: [...values.checklistItems, { prompt: "", isRequired: true }] });
  }

  function updateChecklistItem(index: number, partial: Partial<ChecklistDraftItem>) {
    patch({
      checklistItems: values.checklistItems.map((item, i) => (i === index ? { ...item, ...partial } : item)),
    });
  }

  function removeChecklistItem(index: number) {
    patch({ checklistItems: values.checklistItems.filter((_, i) => i !== index) });
  }

  function moveChecklistItem(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= values.checklistItems.length) return;
    const next = [...values.checklistItems];
    const [moved] = next.splice(index, 1);
    if (!moved) return;
    next.splice(target, 0, moved);
    patch({ checklistItems: next });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!values.name.trim()) return;
    onSave({
      ...values,
      name: values.name.trim(),
      checklistItems: values.checklistItems
        .map((item) => ({ ...item, prompt: item.prompt.trim() }))
        .filter((item) => item.prompt.length > 0),
    });
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle id="playbook-editor-title">{playbook ? "Edit playbook" : "New playbook"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-6">
          <div>
            <label htmlFor="playbook-name" className="field-label">
              Name
            </label>
            <Input
              id="playbook-name"
              value={values.name}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder="e.g. London breakout retest"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className="field-label">Market</span>
              <Select value={values.market} onValueChange={(v: "forex" | "crypto") => patch({ market: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="forex">Forex</SelectItem>
                  <SelectItem value="crypto">Crypto</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <span className="field-label">Direction</span>
              <Select
                value={values.direction}
                onValueChange={(v: "long" | "short" | "both") => patch({ direction: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="long">Long</SelectItem>
                  <SelectItem value="short">Short</SelectItem>
                  <SelectItem value="both">Both</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <label htmlFor="playbook-description" className="field-label">
              Description
            </label>
            <Textarea
              id="playbook-description"
              value={values.description}
              onChange={(e) => patch({ description: e.target.value })}
              rows={2}
              placeholder="What is this setup, in a sentence or two?"
            />
          </div>

          <div>
            <label htmlFor="playbook-ideal" className="field-label">
              Ideal conditions
            </label>
            <Textarea
              id="playbook-ideal"
              value={values.idealConditions}
              onChange={(e) => patch({ idealConditions: e.target.value })}
              rows={2}
              placeholder="Session, volatility, structure — what has to be true for this to be a good example?"
            />
          </div>

          <div>
            <label htmlFor="playbook-invalidation" className="field-label">
              Invalidation rules
            </label>
            <Textarea
              id="playbook-invalidation"
              value={values.invalidationRules}
              onChange={(e) => patch({ invalidationRules: e.target.value })}
              rows={2}
              placeholder="What proves this setup is no longer valid?"
            />
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="field-label mb-0">Pre-trade checklist</span>
              <Button type="button" variant="ghost" size="sm" onClick={addChecklistItem}>
                <Plus className="size-3.5" /> Add item
              </Button>
            </div>
            {values.checklistItems.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No checklist items yet. Add the questions you want to answer before every trade using this playbook.
              </p>
            )}
            <div className="space-y-2">
              {values.checklistItems.map((item, index) => (
                <div key={index} className="flex items-start gap-2">
                  <Input
                    value={item.prompt}
                    onChange={(e) => updateChecklistItem(index, { prompt: e.target.value })}
                    placeholder="e.g. Is price above the 50 EMA on the 4H?"
                  />
                  <label className="flex items-center gap-1 whitespace-nowrap pt-2 text-xs text-muted-foreground">
                    <Checkbox
                      checked={item.isRequired}
                      onCheckedChange={(checked) => updateChecklistItem(index, { isRequired: checked === true })}
                    />
                    Required
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Move up"
                    onClick={() => moveChecklistItem(index, -1)}
                    disabled={index === 0}
                  >
                    <ArrowUp className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Move down"
                    onClick={() => moveChecklistItem(index, 1)}
                    disabled={index === values.checklistItems.length - 1}
                  >
                    <ArrowDown className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Remove item"
                    onClick={() => removeChecklistItem(index)}
                  >
                    <Trash2 className="size-3.5 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          {playbook && <PlaybookAttachmentsPanel playbookId={playbook.id} userId={userId} />}

          <div className="sticky bottom-0 -mx-6 -mb-6 flex gap-3 border-t border-border bg-card p-6 pt-4">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1" disabled={isSubmitting || !values.name.trim()}>
              {isSubmitting ? "Saving…" : playbook ? "Save changes" : "Create playbook"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
