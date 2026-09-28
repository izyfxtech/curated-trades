-- Phase 2.1: playbooks and pre-trade planning.
--
-- The plan's "ordered playbook rules" and "checklist questions with
-- required/optional behavior" are unified into one ordered
-- playbook_checklist_items table. A rule that must hold is just a checklist
-- item with is_required = true; keeping one ordered list — instead of a
-- rules list plus a separate checklist — avoids ambiguity about which one
-- actually governs what gets snapshotted onto a trade.
--
-- Reference screenshots reuse the existing "trade-screenshots" bucket under
-- a "<user_id>/playbooks/<playbook_id>/<filename>" path, since that bucket's
-- storage policy already scopes access by the first path segment being the
-- caller's own auth.uid() — no new bucket or storage policy needed.

CREATE TABLE IF NOT EXISTS public.playbooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL,
  name TEXT NOT NULL,
  market TEXT NOT NULL DEFAULT 'forex',
  direction TEXT NOT NULL DEFAULT 'long',
  description TEXT,
  ideal_conditions TEXT,
  invalidation_rules TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.playbooks TO authenticated;
GRANT ALL ON public.playbooks TO service_role;
ALTER TABLE public.playbooks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage their own playbooks" ON public.playbooks;
CREATE POLICY "Users can manage their own playbooks" ON public.playbooks FOR ALL TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

DO $$ BEGIN
  ALTER TABLE public.playbooks ADD CONSTRAINT playbooks_market_check CHECK (market IN ('forex', 'crypto'));
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.playbooks ADD CONSTRAINT playbooks_direction_check CHECK (direction IN ('long', 'short', 'both'));
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.playbooks ADD CONSTRAINT playbooks_status_check CHECK (status IN ('active', 'archived'));
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.playbook_checklist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  playbook_id UUID NOT NULL REFERENCES public.playbooks(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0,
  prompt TEXT NOT NULL,
  is_required BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.playbook_checklist_items TO authenticated;
GRANT ALL ON public.playbook_checklist_items TO service_role;
ALTER TABLE public.playbook_checklist_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage checklist items on their own playbooks" ON public.playbook_checklist_items;
CREATE POLICY "Users can manage checklist items on their own playbooks" ON public.playbook_checklist_items FOR ALL TO authenticated USING (auth.uid() = owner_id AND EXISTS (SELECT 1 FROM public.playbooks WHERE playbooks.id = playbook_checklist_items.playbook_id AND playbooks.owner_id = auth.uid())) WITH CHECK (auth.uid() = owner_id AND EXISTS (SELECT 1 FROM public.playbooks WHERE playbooks.id = playbook_checklist_items.playbook_id AND playbooks.owner_id = auth.uid()));

CREATE TABLE IF NOT EXISTS public.playbook_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  playbook_id UUID NOT NULL REFERENCES public.playbooks(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL,
  storage_path TEXT NOT NULL,
  content_type TEXT,
  file_name TEXT,
  caption TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.playbook_attachments TO authenticated;
GRANT ALL ON public.playbook_attachments TO service_role;
ALTER TABLE public.playbook_attachments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage attachments for their own playbooks" ON public.playbook_attachments;
CREATE POLICY "Users can manage attachments for their own playbooks" ON public.playbook_attachments FOR ALL TO authenticated USING (auth.uid() = owner_id AND EXISTS (SELECT 1 FROM public.playbooks WHERE playbooks.id = playbook_attachments.playbook_id AND playbooks.owner_id = auth.uid())) WITH CHECK (auth.uid() = owner_id AND EXISTS (SELECT 1 FROM public.playbooks WHERE playbooks.id = playbook_attachments.playbook_id AND playbooks.owner_id = auth.uid()));

-- Pending / taken / missed / invalidated setups, tracked independently of
-- whether they ever became a logged trade — this is what "missed
-- opportunity" analytics reads from later, comparing *planned* R:R across
-- groups rather than inventing a realized outcome for a trade that never
-- happened.
CREATE TABLE IF NOT EXISTS public.trade_ideas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL,
  portfolio_id UUID NOT NULL REFERENCES public.portfolios(id) ON DELETE CASCADE,
  playbook_id UUID REFERENCES public.playbooks(id) ON DELETE SET NULL,
  symbol TEXT NOT NULL,
  market TEXT NOT NULL DEFAULT 'forex',
  direction TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  planned_entry NUMERIC(30,12),
  planned_stop NUMERIC(30,12),
  planned_target NUMERIC(30,12),
  notes TEXT,
  taken_trade_id UUID REFERENCES public.trades(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trade_ideas TO authenticated;
GRANT ALL ON public.trade_ideas TO service_role;
ALTER TABLE public.trade_ideas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage their own trade ideas" ON public.trade_ideas;
CREATE POLICY "Users can manage their own trade ideas" ON public.trade_ideas FOR ALL TO authenticated USING (auth.uid() = owner_id AND EXISTS (SELECT 1 FROM public.portfolios WHERE portfolios.id = trade_ideas.portfolio_id AND portfolios.owner_id = auth.uid())) WITH CHECK (auth.uid() = owner_id AND EXISTS (SELECT 1 FROM public.portfolios WHERE portfolios.id = trade_ideas.portfolio_id AND portfolios.owner_id = auth.uid()));

DO $$ BEGIN
  ALTER TABLE public.trade_ideas ADD CONSTRAINT trade_ideas_market_check CHECK (market IN ('forex', 'crypto'));
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.trade_ideas ADD CONSTRAINT trade_ideas_direction_check CHECK (direction IN ('long', 'short'));
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.trade_ideas ADD CONSTRAINT trade_ideas_status_check CHECK (status IN ('pending', 'taken', 'missed', 'invalidated'));
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

-- playbook_snapshot freezes the playbook name + checklist prompts/answers at
-- the moment the trade was logged, so editing or archiving the playbook
-- later never rewrites what a past trade's plan actually said.
ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS playbook_id UUID REFERENCES public.playbooks(id) ON DELETE SET NULL;
ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS playbook_snapshot JSONB;
ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS confidence SMALLINT;
DO $$ BEGIN
  ALTER TABLE public.trades ADD CONSTRAINT trades_confidence_check CHECK (confidence IS NULL OR confidence BETWEEN 1 AND 5);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS playbooks_owner_id_idx ON public.playbooks(owner_id);
CREATE INDEX IF NOT EXISTS playbook_checklist_items_playbook_id_idx ON public.playbook_checklist_items(playbook_id, order_index);
CREATE INDEX IF NOT EXISTS playbook_attachments_playbook_id_idx ON public.playbook_attachments(playbook_id);
CREATE INDEX IF NOT EXISTS trade_ideas_owner_portfolio_idx ON public.trade_ideas(owner_id, portfolio_id);
CREATE INDEX IF NOT EXISTS trade_ideas_status_idx ON public.trade_ideas(owner_id, status);
CREATE INDEX IF NOT EXISTS trades_playbook_id_idx ON public.trades(playbook_id);

DROP TRIGGER IF EXISTS playbooks_updated_at ON public.playbooks;
CREATE TRIGGER playbooks_updated_at BEFORE UPDATE ON public.playbooks FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS playbook_checklist_items_updated_at ON public.playbook_checklist_items;
CREATE TRIGGER playbook_checklist_items_updated_at BEFORE UPDATE ON public.playbook_checklist_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS playbook_attachments_updated_at ON public.playbook_attachments;
CREATE TRIGGER playbook_attachments_updated_at BEFORE UPDATE ON public.playbook_attachments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS trade_ideas_updated_at ON public.trade_ideas;
CREATE TRIGGER trade_ideas_updated_at BEFORE UPDATE ON public.trade_ideas FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
