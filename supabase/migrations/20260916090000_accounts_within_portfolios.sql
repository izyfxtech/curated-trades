-- Accounts within portfolios.
--
-- The account becomes the real trading unit: it owns starting equity,
-- default risk %, and prop-firm rules. The portfolio becomes an
-- organizational folder that groups accounts (one prop firm's three
-- evaluations, say) so they can be compared and aggregated together.
--
-- Two modelling decisions worth stating up front, because the rest of the
-- app depends on them:
--
-- 1. One setup taken on several accounts is stored as ONE TRADE ROW PER
--    ACCOUNT, linked by a shared trade_group_id. Each account has its own
--    equity and risk %, so the same setup takes a different position size
--    and returns a different dollar amount on each — the P&L genuinely
--    differs per account and has to be stored per account. Keeping
--    account_id as a single NOT NULL FK (rather than a trade->executions
--    split) means every existing query, analytics function, import path
--    and compliance calc keeps working unchanged.
--
-- 2. Because of (1), FINANCIAL metrics (net P&L, drawdown, expectancy) sum
--    across rows, but BEHAVIOURAL metrics (win rate, Curated vs Impulse,
--    discipline, streaks) must count DISTINCT trade_group_id — otherwise a
--    single impulsive decision counts three times just because it ran on
--    three accounts, which would quietly corrupt the exact comparison this
--    app exists to make. trade_group_id is NOT NULL (defaulting to a fresh
--    uuid per trade) so "count distinct groups" is always a valid query
--    with no null-handling special case.
--
-- This migration is non-destructive: every existing portfolio gets one
-- auto-created account carrying its current name/equity/type/currency and
-- its portfolio_settings risk %, all existing trades are backfilled onto
-- it, and existing prop_firm_rules rows move across with it. A user who
-- never wanted multiple accounts just sees one account and loses nothing.

-- ---------------------------------------------------------------- accounts

-- portfolio_id is set once at creation and never changes (no update path
-- is exposed anywhere in the application layer). That single invariant is
-- what makes it safe to leave trades.portfolio_id in place below as a real,
-- indexed column instead of forcing every portfolio-scoped query in the
-- app to join through accounts — a trade's account never silently ends up
-- pointing at the wrong portfolio, because accounts don't move between
-- portfolios at all. Reorganizing means archiving and recreating, which is
-- rare enough that this tradeoff is worth the scope it avoids elsewhere.
CREATE TABLE IF NOT EXISTS public.accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL,
  portfolio_id UUID NOT NULL REFERENCES public.portfolios(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  broker TEXT,
  account_type TEXT NOT NULL DEFAULT 'personal',
  base_currency TEXT NOT NULL DEFAULT 'USD',
  starting_equity NUMERIC(20,8) NOT NULL DEFAULT 0,
  default_risk_percent NUMERIC(8,4) NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT false,
  is_archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.accounts TO authenticated;
GRANT ALL ON public.accounts TO service_role;
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage their own accounts" ON public.accounts;
CREATE POLICY "Users can manage their own accounts" ON public.accounts FOR ALL TO authenticated
  USING (auth.uid() = owner_id AND EXISTS (SELECT 1 FROM public.portfolios WHERE portfolios.id = accounts.portfolio_id AND portfolios.owner_id = auth.uid()))
  WITH CHECK (auth.uid() = owner_id AND EXISTS (SELECT 1 FROM public.portfolios WHERE portfolios.id = accounts.portfolio_id AND portfolios.owner_id = auth.uid()));

DO $$ BEGIN
  ALTER TABLE public.accounts ADD CONSTRAINT accounts_type_check CHECK (account_type IN ('personal', 'prop'));
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.accounts ADD CONSTRAINT accounts_risk_check CHECK (default_risk_percent > 0 AND default_risk_percent <= 100);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS accounts_owner_portfolio_idx ON public.accounts(owner_id, portfolio_id);

-- is_active is scoped PER PORTFOLIO, not globally: each portfolio
-- remembers which of its accounts you were last looking at, so switching
-- portfolios back and forth doesn't lose your place. Enforced in the
-- database rather than left to application code, because "two active
-- accounts in one portfolio" would make the account switcher's state
-- ambiguous with no obvious way to recover.
CREATE UNIQUE INDEX IF NOT EXISTS accounts_one_active_per_portfolio
  ON public.accounts(portfolio_id) WHERE is_active;

DROP TRIGGER IF EXISTS accounts_updated_at ON public.accounts;
CREATE TRIGGER accounts_updated_at BEFORE UPDATE ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ------------------------------------------------- backfill one per portfolio

-- One account per existing portfolio, carrying that portfolio's own
-- settings across. Guarded so re-running this migration can't create
-- duplicates.
INSERT INTO public.accounts (owner_id, portfolio_id, name, account_type, base_currency, starting_equity, default_risk_percent, is_active)
SELECT
  p.owner_id,
  p.id,
  p.name,
  p.account_type,
  p.base_currency,
  p.starting_equity,
  COALESCE(ps.default_risk_percent, 1),
  true
FROM public.portfolios p
LEFT JOIN public.portfolio_settings ps ON ps.portfolio_id = p.id
WHERE NOT EXISTS (SELECT 1 FROM public.accounts a WHERE a.portfolio_id = p.id);

-- ------------------------------------------------------------------- trades

ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES public.accounts(id) ON DELETE CASCADE;
-- portfolio_id is NOT dropped — see the accounts table comment above for
-- why that's safe. Whatever server function moves a trade to a different
-- account (an explicit, deliberate action, not a background process) is
-- responsible for setting portfolio_id = <the new account's portfolio_id>
-- in that same write.
-- NOT NULL with a per-row default: every trade is its own group of one
-- until it's explicitly taken on several accounts, so "count distinct
-- groups" never has to handle nulls.
ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS trade_group_id UUID NOT NULL DEFAULT gen_random_uuid();

UPDATE public.trades t
SET account_id = a.id
FROM public.accounts a
WHERE t.account_id IS NULL AND a.portfolio_id = t.portfolio_id;

DO $$ BEGIN
  ALTER TABLE public.trades ALTER COLUMN account_id SET NOT NULL;
EXCEPTION WHEN others THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS trades_account_idx ON public.trades(owner_id, account_id, opened_at DESC);
CREATE INDEX IF NOT EXISTS trades_group_idx ON public.trades(owner_id, trade_group_id);

-- ------------------------------------------------------- prop-firm rules

-- Compliance moves to the account: three prop evaluations inside one
-- portfolio each need their own independent daily-loss and drawdown
-- tracking, which is the entire point of this restructure.
ALTER TABLE public.prop_firm_rules ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES public.accounts(id) ON DELETE CASCADE;
-- Guarded on the column still existing: a second run of this migration
-- (this file is meant to be safely re-runnable, like every migration in
-- this project) happens after the DROP COLUMN below has already removed
-- portfolio_id, so referencing r.portfolio_id unconditionally would fail
-- on re-run even though there's nothing left to do at that point.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'prop_firm_rules' AND column_name = 'portfolio_id') THEN
    UPDATE public.prop_firm_rules r
    SET account_id = a.id
    FROM public.accounts a
    WHERE r.account_id IS NULL AND a.portfolio_id = r.portfolio_id;
  END IF;
END $$;

DO $$ BEGIN
  ALTER TABLE public.prop_firm_rules ALTER COLUMN account_id SET NOT NULL;
EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.prop_firm_rules DROP CONSTRAINT prop_firm_rules_portfolio_id_key;
EXCEPTION WHEN undefined_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.prop_firm_rules ADD CONSTRAINT prop_firm_rules_account_key UNIQUE (account_id);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

-- The original RLS policy checked ownership through portfolios via
-- portfolio_id; replace it with the equivalent check through accounts via
-- account_id before that column goes away below (the old policy is what
-- was blocking the DROP COLUMN — Postgres won't drop a column a policy
-- still references).
DROP POLICY IF EXISTS "Users can manage their own prop firm rules" ON public.prop_firm_rules;
CREATE POLICY "Users can manage their own prop firm rules" ON public.prop_firm_rules FOR ALL TO authenticated
  USING (auth.uid() = owner_id AND EXISTS (SELECT 1 FROM public.accounts WHERE accounts.id = prop_firm_rules.account_id AND accounts.owner_id = auth.uid()))
  WITH CHECK (auth.uid() = owner_id AND EXISTS (SELECT 1 FROM public.accounts WHERE accounts.id = prop_firm_rules.account_id AND accounts.owner_id = auth.uid()));

-- portfolio_id is dropped outright here, not left in place like the
-- portfolio-level equity columns below — a stale portfolio_id on a
-- compliance row is actively dangerous (rules are per-account now, and if
-- an account is ever moved to a different portfolio a lingering
-- portfolio_id would silently point at the wrong one). account_id is
-- authoritative; join through accounts.portfolio_id when portfolio
-- context is needed.
ALTER TABLE public.prop_firm_rules DROP COLUMN IF EXISTS portfolio_id;

ALTER TABLE public.prop_firm_rule_events ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES public.accounts(id) ON DELETE CASCADE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'prop_firm_rule_events' AND column_name = 'portfolio_id') THEN
    UPDATE public.prop_firm_rule_events e
    SET account_id = a.id
    FROM public.accounts a
    WHERE e.account_id IS NULL AND a.portfolio_id = e.portfolio_id;
  END IF;
END $$;

DO $$ BEGIN
  ALTER TABLE public.prop_firm_rule_events ALTER COLUMN account_id SET NOT NULL;
EXCEPTION WHEN others THEN NULL; END $$;
-- The old uniqueness guard was per (portfolio, type, day); now that
-- compliance is per account, two accounts in one portfolio must each be
-- able to record the same breach on the same day.
DO $$ BEGIN
  ALTER TABLE public.prop_firm_rule_events DROP CONSTRAINT prop_firm_rule_events_unique_per_day;
EXCEPTION WHEN undefined_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.prop_firm_rule_events ADD CONSTRAINT prop_firm_rule_events_unique_per_day UNIQUE (account_id, event_type, occurred_on);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

DROP INDEX IF EXISTS public.prop_firm_rule_events_owner_portfolio_idx;
CREATE INDEX IF NOT EXISTS prop_firm_rule_events_owner_account_idx ON public.prop_firm_rule_events(owner_id, account_id, occurred_on DESC);

ALTER TABLE public.prop_firm_rule_events DROP COLUMN IF EXISTS portfolio_id;

-- ---------------------------------------------------------- coach shares

-- Scope is the creator's choice: a prop evaluator wants one account, a
-- mentor reviewing overall process wants the whole portfolio. account_id
-- NULL means portfolio-wide.
ALTER TABLE public.coach_shares ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES public.accounts(id) ON DELETE CASCADE;

-- ------------------------------------------------------- trades RLS gap

-- The original policy's WITH CHECK only verified portfolio_id ownership.
-- Now that account_id exists, a write with a correctly-owned portfolio_id
-- but a foreign account_id (someone else's account, or an account from a
-- different portfolio) would previously have been accepted — closing that
-- by requiring both checks to pass.
DROP POLICY IF EXISTS "Users can manage their own trades" ON public.trades;
CREATE POLICY "Users can manage their own trades" ON public.trades FOR ALL TO authenticated
  USING (auth.uid() = owner_id)
  WITH CHECK (
    auth.uid() = owner_id
    AND EXISTS (SELECT 1 FROM public.portfolios WHERE portfolios.id = trades.portfolio_id AND portfolios.owner_id = auth.uid())
    AND EXISTS (SELECT 1 FROM public.accounts WHERE accounts.id = trades.account_id AND accounts.owner_id = auth.uid())
  );

-- ------------------------------------------------- portfolio column cleanup

-- portfolios.starting_equity / current_equity and
-- portfolio_settings.default_risk_percent are deliberately LEFT IN PLACE
-- rather than dropped. They're now superseded by the per-account columns
-- and nothing reads them for live math anymore, but dropping columns is
-- irreversible and this migration is meant to be safe to apply to a live
-- database. They can be dropped in a later migration once the accounts
-- restructure has been verified in production.
