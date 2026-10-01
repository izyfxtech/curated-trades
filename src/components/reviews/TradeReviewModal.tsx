// Post-trade review modal (quick or full mode). Mistake/behavior tags reuse
// the app's existing generic tags system (category = "mistake") instead of
// a dedicated table — see the migration comment in
// supabase/migrations/20260909090000_phase2_2_trade_reviews.sql for why.
// SUGGESTED_MISTAKE_TAGS below is the plan's controlled taxonomy (FOMO,
// revenge, boredom, etc.); clicking one that doesn't exist yet for this user
// calls createTag on the fly rather than requiring it to be pre-seeded.
//
// The existing review (if any) is loaded before the form mounts, so the
// TanStack Form's defaultValues are simply that data — no "loaded" flag and
// no copy-into-state effect.
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Suspense } from "react";
import { z } from "zod";

import { VoiceTextarea } from "@/components/journal/VoiceTextarea";
import { EmotionSelect } from "@/components/reviews/EmotionSelect";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Database } from "@/integrations/supabase/types";
import { formProps, useAppForm } from "@/lib/form";
import { tagsQueryOptions, tradeReviewQueryOptions } from "@/lib/queries";
import { saveTradeReview } from "@/lib/reviews.functions";
import { createTag } from "@/lib/tags.functions";

type TradeRow = Database["public"]["Tables"]["trades"]["Row"];

const SUGGESTED_MISTAKE_TAGS = [
  "FOMO",
  "Revenge",
  "Boredom",
  "Fear",
  "Overconfidence",
  "Patience",
  "Hesitation",
  "Late entry",
  "Moved stop",
  "Oversized position",
];

const MODE_OPTIONS = [
  { value: "quick", label: "Quick" },
  { value: "full", label: "Full" },
] as const;

const ADHERENCE_OPTIONS = [
  { value: "followed", label: <span className="capitalize">followed</span> },
  { value: "partial", label: <span className="capitalize">partial</span> },
  { value: "deviated", label: <span className="capitalize">deviated</span> },
] as const;

const reviewSchema = z.object({
  mode: z.enum(["quick", "full"]),
  planAdherence: z.enum(["", "followed", "partial", "deviated"]),
  disciplineScore: z.number().int().min(1).max(5),
  emotionBefore: z.string(),
  emotionDuring: z.string(),
  emotionAfter: z.string(),
  bestDecision: z.string(),
  worstDecision: z.string(),
  lessonLearned: z.string(),
  mistakeTagIds: z.array(z.string()),
});
type ReviewValues = z.infer<typeof reviewSchema>;

export function TradeReviewModal({ trade, onClose, onSaved }: { trade: TradeRow; onClose: () => void; onSaved: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <div>
            <p className="eyebrow mb-1">
              {trade.symbol}, {trade.direction}
            </p>
            <DialogTitle id="review-title">Review this trade</DialogTitle>
          </div>
        </DialogHeader>
        <Suspense fallback={<p className="p-6 text-sm text-muted-foreground">Loading review…</p>}>
          <ReviewForm trade={trade} onClose={onClose} onSaved={onSaved} />
        </Suspense>
      </DialogContent>
    </Dialog>
  );
}

function ReviewForm({ trade, onClose, onSaved }: { trade: TradeRow; onClose: () => void; onSaved: () => void }) {
  const queryClient = useQueryClient();
  const { data: review } = useSuspenseQuery(tradeReviewQueryOptions(trade.id));
  const { data: allTags } = useSuspenseQuery(tagsQueryOptions);
  const mistakeTags = allTags.filter((t) => t.category === "mistake");

  const createTagMutation = useMutation({
    mutationFn: createTag,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: tagsQueryOptions.queryKey }),
  });

  const saveMutation = useMutation({
    mutationFn: (values: ReviewValues) =>
      saveTradeReview({
        data: {
          tradeId: trade.id,
          mode: values.mode,
          planAdherence: values.planAdherence || null,
          disciplineScore: values.disciplineScore,
          emotionalStateBefore: values.mode === "full" ? values.emotionBefore || null : null,
          emotionalStateDuring: values.mode === "full" ? values.emotionDuring || null : null,
          emotionalStateAfter: values.mode === "full" ? values.emotionAfter || null : null,
          bestDecision: values.mode === "full" ? values.bestDecision || null : null,
          worstDecision: values.mode === "full" ? values.worstDecision || null : null,
          lessonLearned: values.mode === "full" ? values.lessonLearned || null : null,
          mistakeTagIds: values.mistakeTagIds,
        },
      }),
    onSuccess: onSaved,
  });

  const form = useAppForm({
    defaultValues: {
      mode: review?.mode === "full" ? "full" : "quick",
      planAdherence: (review?.plan_adherence as ReviewValues["planAdherence"] | null) ?? "",
      disciplineScore: review?.discipline_score ?? 3,
      emotionBefore: review?.emotional_state_before ?? "",
      emotionDuring: review?.emotional_state_during ?? "",
      emotionAfter: review?.emotional_state_after ?? "",
      bestDecision: review?.best_decision ?? "",
      worstDecision: review?.worst_decision ?? "",
      lessonLearned: review?.lesson_learned ?? "",
      mistakeTagIds: review?.mistakeTagIds ?? [],
    } as ReviewValues,
    validators: { onSubmit: reviewSchema },
    onSubmit: ({ value }) => saveMutation.mutate(value),
  });

  // Clicking a suggested tag that doesn't exist yet creates it on the fly.
  async function toggleMistakeTag(name: string) {
    const existing = mistakeTags.find((t) => t.name.toLowerCase() === name.toLowerCase());
    const tagId = existing?.id ?? (await createTagMutation.mutateAsync({ data: { name, category: "mistake" } })).id;
    form.setFieldValue("mistakeTagIds", (ids) => (ids.includes(tagId) ? ids.filter((id) => id !== tagId) : [...ids, tagId]));
  }

  const customTagForm = useAppForm({
    defaultValues: { name: "" },
    onSubmit: async ({ value, formApi }) => {
      const name = value.name.trim();
      if (!name) return;
      await toggleMistakeTag(name);
      formApi.reset();
    },
  });

  return (
    <form {...formProps(form)} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-6">
      <form.AppField name="mode">{(field) => <field.SegmentedField options={MODE_OPTIONS} />}</form.AppField>

      <form.AppField name="planAdherence">
        {(field) => <field.SegmentedField label="Plan adherence" options={ADHERENCE_OPTIONS} />}
      </form.AppField>

      <form.AppField name="disciplineScore">{(field) => <field.RangeField label="Discipline score" />}</form.AppField>

      <form.Field name="mistakeTagIds">
        {(field) => (
          <div>
            <span className="field-label mb-2">Mistakes / behaviors</span>
            <div className="flex flex-wrap gap-1.5">
              {[
                ...SUGGESTED_MISTAKE_TAGS,
                ...mistakeTags.map((t) => t.name).filter((name) => !SUGGESTED_MISTAKE_TAGS.some((s) => s.toLowerCase() === name.toLowerCase())),
              ].map((name) => {
                const existing = mistakeTags.find((t) => t.name.toLowerCase() === name.toLowerCase());
                const active = existing ? field.state.value.includes(existing.id) : false;
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => void toggleMistakeTag(name)}
                    className={`rounded-sm border px-2.5 py-1 text-xs ${
                      active ? "border-chart-2 bg-chart-2/15 text-chart-2" : "border-border text-muted-foreground"
                    }`}
                  >
                    {name}
                  </button>
                );
              })}
            </div>
            <div className="mt-2 flex gap-2">
              <div className="flex-1">
                <customTagForm.AppField name="name">
                  {(tagField) => (
                    <tagField.TextField
                      placeholder="Add a custom tag…"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void customTagForm.handleSubmit();
                        }
                      }}
                    />
                  )}
                </customTagForm.AppField>
              </div>
              <Button type="button" variant="outline" onClick={() => void customTagForm.handleSubmit()}>
                Add
              </Button>
            </div>
          </div>
        )}
      </form.Field>

      <form.Subscribe selector={(state) => state.values.mode}>
        {(mode) =>
          mode === "full" && (
            <>
              <div className="grid grid-cols-3 gap-3">
                <form.Field name="emotionBefore">
                  {(field) => <EmotionSelect label="Before" value={field.state.value} onChange={field.handleChange} />}
                </form.Field>
                <form.Field name="emotionDuring">
                  {(field) => <EmotionSelect label="During" value={field.state.value} onChange={field.handleChange} />}
                </form.Field>
                <form.Field name="emotionAfter">
                  {(field) => <EmotionSelect label="After" value={field.state.value} onChange={field.handleChange} />}
                </form.Field>
              </div>
              <form.Field name="bestDecision">
                {(field) => (
                  <div>
                    <span className="field-label">Best decision</span>
                    <VoiceTextarea value={field.state.value} onChange={field.handleChange} rows={2} placeholder="What did you get right?" />
                  </div>
                )}
              </form.Field>
              <form.Field name="worstDecision">
                {(field) => (
                  <div>
                    <span className="field-label">Worst decision</span>
                    <VoiceTextarea value={field.state.value} onChange={field.handleChange} rows={2} placeholder="What would you do differently?" />
                  </div>
                )}
              </form.Field>
              <form.Field name="lessonLearned">
                {(field) => (
                  <div>
                    <span className="field-label">Lesson learned</span>
                    <VoiceTextarea value={field.state.value} onChange={field.handleChange} rows={2} placeholder="The one thing to remember next time" />
                  </div>
                )}
              </form.Field>
            </>
          )
        }
      </form.Subscribe>

      <div className="sticky bottom-0 -mx-6 -mb-6 flex gap-3 border-t border-border bg-card p-6 pt-4">
        <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
          Cancel
        </Button>
        <form.AppForm>
          <form.SubmitButton className="flex-1" pendingLabel="Saving…" pending={saveMutation.isPending}>
            Save review
          </form.SubmitButton>
        </form.AppForm>
      </div>
    </form>
  );
}
