-- Idempotency note (applies to every migration in this folder): CREATE TABLE,
-- CREATE INDEX, and ALTER TABLE ADD COLUMN use IF NOT EXISTS directly.
-- Policies and triggers are dropped-then-recreated rather than skipped when
-- present, so re-running a migration after editing a policy/trigger's
-- definition actually converges to what the file currently says instead of
-- silently keeping a stale version. Postgres has no ADD CONSTRAINT IF NOT
-- EXISTS, so constraints are wrapped in a DO block that swallows only the
-- "already exists" errors (42710/duplicate_object for CHECK and FOREIGN KEY
-- constraints; 42P07/duplicate_table for UNIQUE and PRIMARY KEY constraints,
-- which are backed by an implicitly-named index) and re-raises anything else.

CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  display_name TEXT,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  base_currency TEXT NOT NULL DEFAULT 'USD',
  trader_type TEXT NOT NULL DEFAULT 'swing',
  onboarding_completed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage their own profile" ON public.profiles;
CREATE POLICY "Users can manage their own profile" ON public.profiles FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.portfolios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL,
  name TEXT NOT NULL,
  account_type TEXT NOT NULL DEFAULT 'personal',
  base_currency TEXT NOT NULL DEFAULT 'USD',
  starting_equity NUMERIC(20,8) NOT NULL DEFAULT 0,
  current_equity NUMERIC(20,8) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.portfolios TO authenticated;
GRANT ALL ON public.portfolios TO service_role;
ALTER TABLE public.portfolios ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage their own portfolios" ON public.portfolios;
CREATE POLICY "Users can manage their own portfolios" ON public.portfolios FOR ALL TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

CREATE TABLE IF NOT EXISTS public.portfolio_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id UUID NOT NULL UNIQUE REFERENCES public.portfolios(id) ON DELETE CASCADE,
  default_risk_percent NUMERIC(8,4) NOT NULL DEFAULT 1,
  preferred_sessions TEXT[] NOT NULL DEFAULT '{}',
  preferred_symbols TEXT[] NOT NULL DEFAULT '{}',
  display_preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.portfolio_settings TO authenticated;
GRANT ALL ON public.portfolio_settings TO service_role;
ALTER TABLE public.portfolio_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage settings for their own portfolios" ON public.portfolio_settings;
CREATE POLICY "Users can manage settings for their own portfolios" ON public.portfolio_settings FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.portfolios WHERE portfolios.id = portfolio_settings.portfolio_id AND portfolios.owner_id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM public.portfolios WHERE portfolios.id = portfolio_settings.portfolio_id AND portfolios.owner_id = auth.uid()));

CREATE TABLE IF NOT EXISTS public.trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL,
  portfolio_id UUID NOT NULL REFERENCES public.portfolios(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  market TEXT NOT NULL DEFAULT 'forex',
  direction TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'closed',
  source TEXT NOT NULL DEFAULT 'manual',
  source_trade_id TEXT,
  opened_at TIMESTAMPTZ NOT NULL,
  closed_at TIMESTAMPTZ,
  entry_price NUMERIC(30,12) NOT NULL,
  exit_price NUMERIC(30,12),
  quantity NUMERIC(30,12) NOT NULL,
  stop_loss NUMERIC(30,12),
  take_profit NUMERIC(30,12),
  fees NUMERIC(20,8) NOT NULL DEFAULT 0,
  spread_cost NUMERIC(20,8) NOT NULL DEFAULT 0,
  swap_funding NUMERIC(20,8) NOT NULL DEFAULT 0,
  gross_pnl NUMERIC(20,8),
  net_pnl NUMERIC(20,8),
  initial_risk NUMERIC(20,8),
  planned_r_multiple NUMERIC(20,8),
  realized_r_multiple NUMERIC(20,8),
  move_percent NUMERIC(20,8),
  holding_seconds INTEGER,
  outcome TEXT,
  is_planned BOOLEAN NOT NULL DEFAULT false,
  discipline_score SMALLINT,
  curated_label TEXT NOT NULL DEFAULT 'impulse',
  session TEXT,
  notes TEXT,
  calculation_version TEXT NOT NULL DEFAULT 'v1',
  import_batch_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trades TO authenticated;
GRANT ALL ON public.trades TO service_role;
ALTER TABLE public.trades ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage their own trades" ON public.trades;
CREATE POLICY "Users can manage their own trades" ON public.trades FOR ALL TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id AND EXISTS (SELECT 1 FROM public.portfolios WHERE portfolios.id = trades.portfolio_id AND portfolios.owner_id = auth.uid()));

CREATE TABLE IF NOT EXISTS public.trade_exits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id UUID NOT NULL REFERENCES public.trades(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL,
  exited_at TIMESTAMPTZ NOT NULL,
  exit_price NUMERIC(30,12) NOT NULL,
  quantity NUMERIC(30,12) NOT NULL,
  fees NUMERIC(20,8) NOT NULL DEFAULT 0,
  gross_pnl NUMERIC(20,8),
  net_pnl NUMERIC(20,8),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trade_exits TO authenticated;
GRANT ALL ON public.trade_exits TO service_role;
ALTER TABLE public.trade_exits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage exits for their own trades" ON public.trade_exits;
CREATE POLICY "Users can manage exits for their own trades" ON public.trade_exits FOR ALL TO authenticated USING (auth.uid() = owner_id AND EXISTS (SELECT 1 FROM public.trades WHERE trades.id = trade_exits.trade_id AND trades.owner_id = auth.uid())) WITH CHECK (auth.uid() = owner_id AND EXISTS (SELECT 1 FROM public.trades WHERE trades.id = trade_exits.trade_id AND trades.owner_id = auth.uid()));

CREATE TABLE IF NOT EXISTS public.tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, slug)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tags TO authenticated;
GRANT ALL ON public.tags TO service_role;
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage their own tags" ON public.tags;
CREATE POLICY "Users can manage their own tags" ON public.tags FOR ALL TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

CREATE TABLE IF NOT EXISTS public.trade_tags (
  trade_id UUID NOT NULL REFERENCES public.trades(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (trade_id, tag_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trade_tags TO authenticated;
GRANT ALL ON public.trade_tags TO service_role;
ALTER TABLE public.trade_tags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage tags on their own trades" ON public.trade_tags;
CREATE POLICY "Users can manage tags on their own trades" ON public.trade_tags FOR ALL TO authenticated USING (auth.uid() = owner_id AND EXISTS (SELECT 1 FROM public.trades WHERE trades.id = trade_tags.trade_id AND trades.owner_id = auth.uid()) AND EXISTS (SELECT 1 FROM public.tags WHERE tags.id = trade_tags.tag_id AND tags.owner_id = auth.uid())) WITH CHECK (auth.uid() = owner_id AND EXISTS (SELECT 1 FROM public.trades WHERE trades.id = trade_tags.trade_id AND trades.owner_id = auth.uid()) AND EXISTS (SELECT 1 FROM public.tags WHERE tags.id = trade_tags.tag_id AND tags.owner_id = auth.uid()));

CREATE TABLE IF NOT EXISTS public.trade_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id UUID NOT NULL REFERENCES public.trades(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL,
  storage_path TEXT NOT NULL,
  content_type TEXT,
  file_name TEXT,
  caption TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trade_attachments TO authenticated;
GRANT ALL ON public.trade_attachments TO service_role;
ALTER TABLE public.trade_attachments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage attachments for their own trades" ON public.trade_attachments;
CREATE POLICY "Users can manage attachments for their own trades" ON public.trade_attachments FOR ALL TO authenticated USING (auth.uid() = owner_id AND EXISTS (SELECT 1 FROM public.trades WHERE trades.id = trade_attachments.trade_id AND trades.owner_id = auth.uid())) WITH CHECK (auth.uid() = owner_id AND EXISTS (SELECT 1 FROM public.trades WHERE trades.id = trade_attachments.trade_id AND trades.owner_id = auth.uid()));

CREATE TABLE IF NOT EXISTS public.import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL,
  portfolio_id UUID NOT NULL REFERENCES public.portfolios(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  file_name TEXT,
  status TEXT NOT NULL DEFAULT 'staged',
  total_rows INTEGER NOT NULL DEFAULT 0,
  valid_rows INTEGER NOT NULL DEFAULT 0,
  invalid_rows INTEGER NOT NULL DEFAULT 0,
  imported_rows INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_batches TO authenticated;
GRANT ALL ON public.import_batches TO service_role;
ALTER TABLE public.import_batches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage their own import batches" ON public.import_batches;
CREATE POLICY "Users can manage their own import batches" ON public.import_batches FOR ALL TO authenticated USING (auth.uid() = owner_id AND EXISTS (SELECT 1 FROM public.portfolios WHERE portfolios.id = import_batches.portfolio_id AND portfolios.owner_id = auth.uid())) WITH CHECK (auth.uid() = owner_id AND EXISTS (SELECT 1 FROM public.portfolios WHERE portfolios.id = import_batches.portfolio_id AND portfolios.owner_id = auth.uid()));

CREATE TABLE IF NOT EXISTS public.import_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES public.import_batches(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL,
  row_number INTEGER NOT NULL,
  raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  normalized_data JSONB,
  status TEXT NOT NULL DEFAULT 'pending',
  validation_errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_trade_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_rows TO authenticated;
GRANT ALL ON public.import_rows TO service_role;
ALTER TABLE public.import_rows ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage rows in their own import batches" ON public.import_rows;
CREATE POLICY "Users can manage rows in their own import batches" ON public.import_rows FOR ALL TO authenticated USING (auth.uid() = owner_id AND EXISTS (SELECT 1 FROM public.import_batches WHERE import_batches.id = import_rows.batch_id AND import_batches.owner_id = auth.uid())) WITH CHECK (auth.uid() = owner_id AND EXISTS (SELECT 1 FROM public.import_batches WHERE import_batches.id = import_rows.batch_id AND import_batches.owner_id = auth.uid()));

DO $$ BEGIN
  ALTER TABLE public.trades ADD CONSTRAINT trades_import_batch_fk FOREIGN KEY (import_batch_id) REFERENCES public.import_batches(id) ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS profiles_user_id_idx ON public.profiles(user_id);
CREATE INDEX IF NOT EXISTS portfolios_owner_id_idx ON public.portfolios(owner_id);
CREATE INDEX IF NOT EXISTS trades_owner_portfolio_idx ON public.trades(owner_id, portfolio_id);
CREATE INDEX IF NOT EXISTS trades_opened_at_idx ON public.trades(owner_id, opened_at DESC);
CREATE INDEX IF NOT EXISTS trades_symbol_status_idx ON public.trades(owner_id, symbol, status);
CREATE INDEX IF NOT EXISTS trades_source_idx ON public.trades(owner_id, source, source_trade_id);
CREATE INDEX IF NOT EXISTS trade_exits_trade_id_idx ON public.trade_exits(trade_id);
CREATE INDEX IF NOT EXISTS trade_attachments_trade_id_idx ON public.trade_attachments(trade_id);
CREATE INDEX IF NOT EXISTS import_rows_batch_id_idx ON public.import_rows(batch_id);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_updated_at ON public.profiles;
CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS portfolios_updated_at ON public.portfolios;
CREATE TRIGGER portfolios_updated_at BEFORE UPDATE ON public.portfolios FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS portfolio_settings_updated_at ON public.portfolio_settings;
CREATE TRIGGER portfolio_settings_updated_at BEFORE UPDATE ON public.portfolio_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS trades_updated_at ON public.trades;
CREATE TRIGGER trades_updated_at BEFORE UPDATE ON public.trades FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS trade_exits_updated_at ON public.trade_exits;
CREATE TRIGGER trade_exits_updated_at BEFORE UPDATE ON public.trade_exits FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS tags_updated_at ON public.tags;
CREATE TRIGGER tags_updated_at BEFORE UPDATE ON public.tags FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS trade_attachments_updated_at ON public.trade_attachments;
CREATE TRIGGER trade_attachments_updated_at BEFORE UPDATE ON public.trade_attachments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS import_batches_updated_at ON public.import_batches;
CREATE TRIGGER import_batches_updated_at BEFORE UPDATE ON public.import_batches FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS import_rows_updated_at ON public.import_rows;
CREATE TRIGGER import_rows_updated_at BEFORE UPDATE ON public.import_rows FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
