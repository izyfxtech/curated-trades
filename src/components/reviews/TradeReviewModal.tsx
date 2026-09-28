// Post-trade review modal (quick or full mode). Mistake/behavior tags reuse
// the app's existing generic tags system (category = "mistake") instead of
// a dedicated table — see the migration comment in
// supabase/migrations/20260909090000_phase2_2_trade_reviews.sql for why.
// SUGGESTED_MISTAKE_TAGS below is the plan's controlled taxonomy (FOMO,
// revenge, boredom, etc.); clicking one that doesn't exist yet for this user
// calls createTag on the fly rather than requiring it to be pre-seeded.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { EmotionSelect } from "@/components/reviews/EmotionSelect";
import { VoiceTextarea } from "@/components/journal/VoiceTextarea";
import { createTag, listTags } from "@/lib/tags.functions";
import { getTradeReview, saveTradeReview } from "@/lib/reviews.functions";
import type { Database } from "@/integrations/supabase/types";

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

export function TradeReviewModal({ trade, onClose, onSaved }: { trade: TradeRow; onClose: () => void; onSaved: () => void }) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"quick" | "full">("quick");
  const [planAdherence, setPlanAdherence] = useState<"followed" | "partial" | "deviated" | "">("");
  const [disciplineScore, setDisciplineScore] = useState(3);
  const [emotionBefore, setEmotionBefore] = useState("");
  const [emotionDuring, setEmotionDuring] = useState("");
  const [emotionAfter, setEmotionAfter] = useState("");
  const [bestDecision, setBestDecision] = useState("");
  const [worstDecision, setWorstDecision] = useState("");
  const [lessonLearned, setLessonLearned] = useState("");
  const [mistakeTagIds, setMistakeTagIds] = useState<string[]>([]);
  const [customMistakeName, setCustomMistakeName] = useState("");
  const [loaded, setLoaded] = useState(false);

  const existingReviewQuery = useQuery({
    queryKey: ["trade-review", trade.id],
    queryFn: () => getTradeReview({ data: { tradeId: trade.id } }),
  });
  const mistakeTagsQuery = useQuery({ queryKey: ["tags"], queryFn: () => listTags() });
  const mistakeTags = (mistakeTagsQuery.data ?? []).filter((t) => t.category === "mistake");

  useEffect(() => {
    if (loaded || !existingReviewQuery.isFetched) return;
    const review = existingReviewQuery.data;
    if (review) {
      setMode(review.mode === "full" ? "full" : "quick");
      setPlanAdherence((review.plan_adherence as typeof planAdherence) ?? "");
      setDisciplineScore(review.discipline_score ?? 3);
      setEmotionBefore(review.emotional_state_before ?? "");
      setEmotionDuring(review.emotional_state_during ?? "");
      setEmotionAfter(review.emotional_state_after ?? "");
      setBestDecision(review.best_decision ?? "");
      setWorstDecision(review.worst_decision ?? "");
      setLessonLearned(review.lesson_learned ?? "");
      setMistakeTagIds(review.mistakeTagIds);
    }
    setLoaded(true);
  }, [loaded, existingReviewQuery.isFetched, existingReviewQuery.data]);

  const createTagMutation = useMutation({ mutationFn: createTag });

  async function toggleMistakeTag(name: string) {
    const existing = mistakeTags.find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      setMistakeTagIds((ids) => (ids.includes(existing.id) ? ids.filter((id) => id !== existing.id) : [...ids, existing.id]));
      return;
    }
    const created = await createTagMutation.mutateAsync({ data: { name, category: "mistake" } });
    void queryClient.invalidateQueries({ queryKey: ["tags"] });
    setMistakeTagIds((ids) => [...ids, created.id]);
  }

  async function addCustomMistakeTag() {
    const name = customMistakeName.trim();
    if (!name) return;
    await toggleMistakeTag(name);
    setCustomMistakeName("");
  }

  const saveMutation = useMutation({
    mutationFn: () =>
      saveTradeReview({
        data: {
          tradeId: trade.id,
          mode,
          planAdherence: planAdherence || null,
          disciplineScore,
          emotionalStateBefore: mode === "full" ? emotionBefore || null : null,
          emotionalStateDuring: mode === "full" ? emotionDuring || null : null,
          emotionalStateAfter: mode === "full" ? emotionAfter || null : null,
          bestDecision: mode === "full" ? bestDecision || null : null,
          worstDecision: mode === "full" ? worstDecision || null : null,
          lessonLearned: mode === "full" ? lessonLearned || null : null,
          mistakeTagIds,
        },
      }),
    onSuccess: onSaved,
  });

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

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-6">
          <div className="direction-toggle">
            <Button type="button" variant={mode === "quick" ? "secondary" : "ghost"} className="flex-1" onClick={() => setMode("quick")}>
              Quick
            </Button>
            <Button type="button" variant={mode === "full" ? "secondary" : "ghost"} className="flex-1" onClick={() => setMode("full")}>
              Full
            </Button>
          </div>

          <div>
            <span className="field-label">Plan adherence</span>
            <div className="direction-toggle">
              {(["followed", "partial", "deviated"] as const).map((option) => (
                <Button
                  key={option}
                  type="button"
                  variant={planAdherence === option ? "secondary" : "ghost"}
                  className="flex-1 capitalize"
                  onClick={() => setPlanAdherence(option)}
                >
                  {option}
                </Button>
              ))}
            </div>
          </div>

          <div>
            <span className="field-label">Discipline score — {disciplineScore}/5</span>
            <input
              type="range"
              min={1}
              max={5}
              step={1}
              value={disciplineScore}
              onChange={(e) => setDisciplineScore(Number(e.target.value))}
              className="w-full accent-current"
              aria-label="Discipline score"
            />
          </div>

          <div>
            <span className="field-label mb-2">Mistakes / behaviors</span>
            <div className="flex flex-wrap gap-1.5">
              {[
                ...SUGGESTED_MISTAKE_TAGS,
                ...mistakeTags.map((t) => t.name).filter((name) => !SUGGESTED_MISTAKE_TAGS.some((s) => s.toLowerCase() === name.toLowerCase())),
              ].map((name) => {
                const existing = mistakeTags.find((t) => t.name.toLowerCase() === name.toLowerCase());
                const active = existing ? mistakeTagIds.includes(existing.id) : false;
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => toggleMistakeTag(name)}
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
              <Input
                value={customMistakeName}
                onChange={(e) => setCustomMistakeName(e.target.value)}
                placeholder="Add a custom tag…"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void addCustomMistakeTag();
                  }
                }}
              />
              <Button type="button" variant="outline" onClick={() => void addCustomMistakeTag()}>
                Add
              </Button>
            </div>
          </div>

          {mode === "full" && (
            <>
              <div className="grid grid-cols-3 gap-3">
                <EmotionSelect label="Before" value={emotionBefore} onChange={setEmotionBefore} />
                <EmotionSelect label="During" value={emotionDuring} onChange={setEmotionDuring} />
                <EmotionSelect label="After" value={emotionAfter} onChange={setEmotionAfter} />
              </div>
              <div>
                <span className="field-label">Best decision</span>
                <VoiceTextarea value={bestDecision} onChange={setBestDecision} rows={2} placeholder="What did you get right?" />
              </div>
              <div>
                <span className="field-label">Worst decision</span>
                <VoiceTextarea value={worstDecision} onChange={setWorstDecision} rows={2} placeholder="What would you do differently?" />
              </div>
              <div>
                <span className="field-label">Lesson learned</span>
                <VoiceTextarea value={lessonLearned} onChange={setLessonLearned} rows={2} placeholder="The one thing to remember next time" />
              </div>
            </>
          )}

          <div className="sticky bottom-0 -mx-6 -mb-6 flex gap-3 border-t border-border bg-card p-6 pt-4">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" className="flex-1" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
              {saveMutation.isPending ? "Saving…" : "Save review"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
