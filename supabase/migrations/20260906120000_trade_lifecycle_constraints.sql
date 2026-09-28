-- Constrain the free-text "enum" columns on trades to the values the app,
-- server functions, and calculation layer actually support. The original
-- migration left these as unconstrained TEXT, so a bad write (manual SQL,
-- a future import path, a bug) could insert a status/direction/label the
-- UI and analytics don't know how to interpret.
--
-- Existing rows are expected to already conform (the only writer so far is
-- the manual trade form, which only ever sends these values). If this
-- fails to apply, inspect and fix any non-conforming rows first:
--   SELECT DISTINCT status FROM public.trades WHERE status NOT IN ('open','closed','cancelled','incomplete');
--
-- Each ADD CONSTRAINT is wrapped in a DO block since Postgres has no ADD
-- CONSTRAINT IF NOT EXISTS — this swallows only the "already exists" error
-- (42710/duplicate_object for CHECK constraints; 42P07/duplicate_table for
-- UNIQUE/PRIMARY KEY constraints, which are backed by an implicitly-named
-- index) and re-raises anything else, so re-running this
-- file is safe.

DO $$ BEGIN
  ALTER TABLE public.trades ADD CONSTRAINT trades_status_check
    CHECK (status IN ('open', 'closed', 'cancelled', 'incomplete'));
EXCEPTION
  WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.trades ADD CONSTRAINT trades_direction_check
    CHECK (direction IN ('long', 'short'));
EXCEPTION
  WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.trades ADD CONSTRAINT trades_market_check
    CHECK (market IN ('forex', 'crypto'));
EXCEPTION
  WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.trades ADD CONSTRAINT trades_curated_label_check
    CHECK (curated_label IN ('curated', 'impulse'));
EXCEPTION
  WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.trades ADD CONSTRAINT trades_outcome_check
    CHECK (outcome IS NULL OR outcome IN ('win', 'loss', 'breakeven'));
EXCEPTION
  WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.trades ADD CONSTRAINT trades_source_check
    CHECK (source IN ('manual', 'import', 'sync'));
EXCEPTION
  WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.portfolios ADD CONSTRAINT portfolios_account_type_check
    CHECK (account_type IN ('personal', 'prop'));
EXCEPTION
  WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;
