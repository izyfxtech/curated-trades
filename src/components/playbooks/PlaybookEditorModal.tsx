// Create/edit modal for a single playbook, including its ordered pre-trade
// checklist. The checklist is edited as a whole list (add/remove/reorder,
// then save everything at once) rather than per-item CRUD — matches how
// savePlaybook() on the server actually works (delete-all-then-reinsert for
// an edit), which is simpler and correct here because checklist items have
// no independent identity worth preserving across an edit.
//
// A TanStack Form: the checklist is an array field, so add / remove / reorder
// are the form's own pushValue / removeValue / moveValue rather than
// hand-written splice helpers.
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { z } from "zod";

import { PlaybookAttachmentsPanel } from "@/components/playbooks/PlaybookAttachmentsPanel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formProps, useAppForm } from "@/lib/form";
import type { PlaybookWithChecklist } from "@/lib/playbooks.functions";

const playbookSchema = z.object({
  name: z.string().trim().min(1, "Give the playbook a name"),
  market: z.enum(["forex", "crypto"]),
  direction: z.enum(["long", "short", "both"]),
  description: z.string(),
  idealConditions: z.string(),
  invalidationRules: z.string(),
  checklistItems: z.array(z.object({ prompt: z.string(), isRequired: z.boolean() })),
});

export type PlaybookFormValues = z.infer<typeof playbookSchema>;
export type ChecklistDraftItem = PlaybookFormValues["checklistItems"][number];

const MARKET_OPTIONS = [
  { value: "forex", label: "Forex" },
  { value: "crypto", label: "Crypto" },
] as const;

const DIRECTION_OPTIONS = [
  { value: "long", label: "Long" },
  { value: "short", label: "Short" },
  { value: "both", label: "Both" },
] as const;

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
  const form = useAppForm({
    defaultValues: toFormValues(playbook),
    validators: { onSubmit: playbookSchema },
    onSubmit: ({ value }) =>
      onSave({
        ...value,
        name: value.name.trim(),
        // Blank checklist rows are dropped rather than saved as empty prompts.
        checklistItems: value.checklistItems
          .map((item) => ({ ...item, prompt: item.prompt.trim() }))
          .filter((item) => item.prompt.length > 0),
      }),
  });

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle id="playbook-editor-title">{playbook ? "Edit playbook" : "New playbook"}</DialogTitle>
        </DialogHeader>
        <form {...formProps(form)} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-6">
          <form.AppField name="name">
            {(field) => <field.TextField label="Name" placeholder="e.g. London breakout retest" />}
          </form.AppField>

          <div className="grid grid-cols-2 gap-4">
            <form.AppField name="market">
              {(field) => <field.SelectField label="Market" options={MARKET_OPTIONS} />}
            </form.AppField>
            <form.AppField name="direction">
              {(field) => <field.SelectField label="Direction" options={DIRECTION_OPTIONS} />}
            </form.AppField>
          </div>

          <form.AppField name="description">
            {(field) => <field.TextareaField label="Description" rows={2} placeholder="What is this setup, in a sentence or two?" />}
          </form.AppField>
          <form.AppField name="idealConditions">
            {(field) => (
              <field.TextareaField
                label="Ideal conditions"
                rows={2}
                placeholder="Session, volatility, structure — what has to be true for this to be a good example?"
              />
            )}
          </form.AppField>
          <form.AppField name="invalidationRules">
            {(field) => (
              <field.TextareaField label="Invalidation rules" rows={2} placeholder="What proves this setup is no longer valid?" />
            )}
          </form.AppField>

          <form.Field name="checklistItems" mode="array">
            {(items) => (
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="field-label mb-0">Pre-trade checklist</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => items.pushValue({ prompt: "", isRequired: true })}
                  >
                    <Plus className="size-3.5" /> Add item
                  </Button>
                </div>
                {items.state.value.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No checklist items yet. Add the questions you want to answer before every trade using this playbook.
                  </p>
                )}
                <div className="space-y-2">
                  {items.state.value.map((_, index) => (
                    <div key={index} className="flex items-start gap-2">
                      <div className="flex-1">
                        <form.AppField name={`checklistItems[${index}].prompt`}>
                          {(field) => <field.TextField placeholder="e.g. Is price above the 50 EMA on the 4H?" />}
                        </form.AppField>
                      </div>
                      <form.AppField name={`checklistItems[${index}].isRequired`}>
                        {(field) => (
                          <div className="pt-2 text-xs text-muted-foreground">
                            <field.CheckboxField label="Required" />
                          </div>
                        )}
                      </form.AppField>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Move up"
                        onClick={() => items.moveValue(index, index - 1)}
                        disabled={index === 0}
                      >
                        <ArrowUp className="size-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Move down"
                        onClick={() => items.moveValue(index, index + 1)}
                        disabled={index === items.state.value.length - 1}
                      >
                        <ArrowDown className="size-3.5" />
                      </Button>
                      <Button type="button" variant="ghost" size="icon" aria-label="Remove item" onClick={() => items.removeValue(index)}>
                        <Trash2 className="size-3.5 text-destructive" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </form.Field>

          {playbook && <PlaybookAttachmentsPanel playbookId={playbook.id} userId={userId} />}

          <div className="sticky bottom-0 -mx-6 -mb-6 flex gap-3 border-t border-border bg-card p-6 pt-4">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <form.AppForm>
              <form.SubmitButton className="flex-1" pendingLabel="Saving…" pending={isSubmitting}>
                {playbook ? "Save changes" : "Create playbook"}
              </form.SubmitButton>
            </form.AppForm>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
