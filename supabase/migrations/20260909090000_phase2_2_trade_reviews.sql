-- Phase 2.2: post-trade review and psychology.
--
-- Mistake/behavior tags reuse the existing generic tags + trade_tags system
-- (tags.category = 'mistake') instead of a new tag table — the taxonomy the
-- plan asks for ("FOMO, revenge, boredom, ...", plus custom tags) is exactly
-- what tags.category already models, and trade_tags already links tags to
-- trades. A review-scoped sync function (added in application code) only
-- touches mistake-category links so it never clobbers a trade's other tags.
--
-- period_reviews only stores what can't be computed from trades/trade_reviews
-- — the trader's written commitment for the period. Stats, top setups,
-- emotional patterns, and mistakes are all derived at read time from
-- existing data so there's exactly one source of truth for them.

CREATE TABLE IF NOT EXISTS public.trade_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL,
  trade_id UUID NOT NULL UNIQUE REFERENCES public.trades(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'full',
  plan_adherence TEXT,
  discipline_score SMALLINT,
  emotional_state_before TEXT,
  emotional_state_during TEXT,
  emotional_state_after TEXT,
  best_decision TEXT,
  worst_decision TEXT,
  lesson_learned TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trade_reviews TO authenticated;
GRANT ALL ON public.trade_reviews TO service_role;
ALTER TABLE public.trade_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage their own trade reviews" ON public.trade_reviews;
CREATE POLICY "Users can manage their own trade reviews" ON public.trade_reviews FOR ALL TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

DO $$ BEGIN
  ALTER TABLE public.trade_reviews ADD CONSTRAINT trade_reviews_mode_check CHECK (mode IN ('quick', 'full'));
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.trade_reviews ADD CONSTRAINT trade_reviews_plan_adherence_check CHECK (plan_adherence IS NULL OR plan_adherence IN ('followed', 'partial', 'deviated'));
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.trade_reviews ADD CONSTRAINT trade_reviews_discipline_score_check CHECK (discipline_score IS NULL OR discipline_score BETWEEN 1 AND 5);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.period_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL,
  portfolio_id UUID NOT NULL REFERENCES public.portfolios(id) ON DELETE CASCADE,
  period_type TEXT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  commitment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.period_reviews TO authenticated;
GRANT ALL ON public.period_reviews TO service_role;
ALTER TABLE public.period_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage their own period reviews" ON public.period_reviews;
CREATE POLICY "Users can manage their own period reviews" ON public.period_reviews FOR ALL TO authenticated USING (auth.uid() = owner_id AND EXISTS (SELECT 1 FROM public.portfolios WHERE portfolios.id = period_reviews.portfolio_id AND portfolios.owner_id = auth.uid())) WITH CHECK (auth.uid() = owner_id AND EXISTS (SELECT 1 FROM public.portfolios WHERE portfolios.id = period_reviews.portfolio_id AND portfolios.owner_id = auth.uid()));

DO $$ BEGIN
  ALTER TABLE public.period_reviews ADD CONSTRAINT period_reviews_type_check CHECK (period_type IN ('weekly', 'monthly'));
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.period_reviews ADD CONSTRAINT period_reviews_unique_period UNIQUE (owner_id, portfolio_id, period_type, period_start);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS trade_reviews_owner_id_idx ON public.trade_reviews(owner_id);
CREATE INDEX IF NOT EXISTS period_reviews_owner_portfolio_idx ON public.period_reviews(owner_id, portfolio_id, period_type);

DROP TRIGGER IF EXISTS trade_reviews_updated_at ON public.trade_reviews;
CREATE TRIGGER trade_reviews_updated_at BEFORE UPDATE ON public.trade_reviews FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS period_reviews_updated_at ON public.period_reviews;
CREATE TRIGGER period_reviews_updated_at BEFORE UPDATE ON public.period_reviews FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
