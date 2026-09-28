-- Phase 2.4: prop-firm compliance.
--
-- One rule profile per portfolio (prop_firm_rules), plus an append-only,
-- idempotent audit trail (prop_firm_rule_events) of warnings/breaches the
-- compliance engine detects on read. Everything that *can* be derived from
-- trades — today's P&L, the running high-water mark, trading-day counts —
-- is derived at read time in application code (see prop-firm.functions.ts),
-- not stored here, for the same single-source-of-truth reason period_reviews
-- doesn't store stats.
--
-- Important, deliberate limitation: this app has no live price feed, so
-- "equity" here can only ever mean realized balance (starting_equity + net
-- P&L of closed trades) — never true floating mark-to-market P&L on open
-- positions. calculation_basis is named and documented around that
-- constraint rather than pretending to a precision the app doesn't have.

CREATE TABLE IF NOT EXISTS public.prop_firm_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL,
  portfolio_id UUID NOT NULL UNIQUE REFERENCES public.portfolios(id) ON DELETE CASCADE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  calculation_basis TEXT NOT NULL DEFAULT 'starting_balance',
  max_daily_loss_percent NUMERIC NOT NULL,
  max_total_drawdown_percent NUMERIC NOT NULL,
  profit_target_percent NUMERIC,
  min_trading_days SMALLINT,
  max_trading_days SMALLINT,
  consistency_percent NUMERIC,
  allow_weekend_holding BOOLEAN NOT NULL DEFAULT true,
  allow_news_trading BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.prop_firm_rules TO authenticated;
GRANT ALL ON public.prop_firm_rules TO service_role;
ALTER TABLE public.prop_firm_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage their own prop firm rules" ON public.prop_firm_rules;
CREATE POLICY "Users can manage their own prop firm rules" ON public.prop_firm_rules FOR ALL TO authenticated USING (auth.uid() = owner_id AND EXISTS (SELECT 1 FROM public.portfolios WHERE portfolios.id = prop_firm_rules.portfolio_id AND portfolios.owner_id = auth.uid())) WITH CHECK (auth.uid() = owner_id AND EXISTS (SELECT 1 FROM public.portfolios WHERE portfolios.id = prop_firm_rules.portfolio_id AND portfolios.owner_id = auth.uid()));

DO $$ BEGIN
  ALTER TABLE public.prop_firm_rules ADD CONSTRAINT prop_firm_rules_basis_check CHECK (calculation_basis IN ('starting_balance', 'current_balance', 'high_water_mark'));
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.prop_firm_rules ADD CONSTRAINT prop_firm_rules_daily_loss_check CHECK (max_daily_loss_percent > 0 AND max_daily_loss_percent <= 100);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.prop_firm_rules ADD CONSTRAINT prop_firm_rules_drawdown_check CHECK (max_total_drawdown_percent > 0 AND max_total_drawdown_percent <= 100);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.prop_firm_rules ADD CONSTRAINT prop_firm_rules_target_check CHECK (profit_target_percent IS NULL OR profit_target_percent > 0);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.prop_firm_rules ADD CONSTRAINT prop_firm_rules_consistency_check CHECK (consistency_percent IS NULL OR (consistency_percent > 0 AND consistency_percent <= 100));
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.prop_firm_rules ADD CONSTRAINT prop_firm_rules_min_days_check CHECK (min_trading_days IS NULL OR min_trading_days > 0);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.prop_firm_rules ADD CONSTRAINT prop_firm_rules_max_days_check CHECK (max_trading_days IS NULL OR max_trading_days > 0);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.prop_firm_rule_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL,
  portfolio_id UUID NOT NULL REFERENCES public.portfolios(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  message TEXT NOT NULL,
  occurred_on DATE NOT NULL,
  trade_id UUID REFERENCES public.trades(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.prop_firm_rule_events TO authenticated;
GRANT ALL ON public.prop_firm_rule_events TO service_role;
ALTER TABLE public.prop_firm_rule_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage their own prop firm rule events" ON public.prop_firm_rule_events;
CREATE POLICY "Users can manage their own prop firm rule events" ON public.prop_firm_rule_events FOR ALL TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

DO $$ BEGIN
  ALTER TABLE public.prop_firm_rule_events ADD CONSTRAINT prop_firm_rule_events_type_check CHECK (event_type IN ('daily_loss_warning', 'daily_loss_breach', 'drawdown_warning', 'drawdown_breach', 'profit_target_reached', 'consistency_flag', 'min_days_met', 'max_days_exceeded'));
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.prop_firm_rule_events ADD CONSTRAINT prop_firm_rule_events_severity_check CHECK (severity IN ('info', 'warning', 'breach'));
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
-- One event per (portfolio, type, day): recomputing compliance on every
-- dashboard load must not spam duplicate audit rows for the same breach.
DO $$ BEGIN
  ALTER TABLE public.prop_firm_rule_events ADD CONSTRAINT prop_firm_rule_events_unique_per_day UNIQUE (portfolio_id, event_type, occurred_on);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS prop_firm_rule_events_owner_portfolio_idx ON public.prop_firm_rule_events(owner_id, portfolio_id, occurred_on DESC);

DROP TRIGGER IF EXISTS prop_firm_rules_updated_at ON public.prop_firm_rules;
CREATE TRIGGER prop_firm_rules_updated_at BEFORE UPDATE ON public.prop_firm_rules FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
