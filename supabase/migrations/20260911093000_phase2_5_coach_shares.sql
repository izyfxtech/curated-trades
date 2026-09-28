-- Phase 2.5: sharing and export (coach/mentor read-only report links).
--
-- Deliberately NO anon-facing RLS policy on either table. A token-gated
-- "anyone with this link can read" policy is exactly the kind of thing RLS
-- is bad at doing safely: it can't cheaply express "and it hasn't expired"
-- + "and it hasn't been revoked" + "don't leak whether a token exists at
-- all on a miss" without either a security hole or a footgun. Instead, the
-- public share view and the coach's comment box are both served by
-- TanStack Start server functions with NO auth middleware that reach the
-- database through the existing service-role client
-- (src/integrations/supabase/client.server.ts, already set up for exactly
-- this "privileged, server-only" purpose) after validating the token,
-- expiry, and revocation themselves. See src/lib/shares.server.ts.
--
-- That means these two tables are only ever touched by the owner (via
-- normal authenticated RLS below) or by the service role (which bypasses
-- RLS by design) — never by an anonymous key.

CREATE TABLE IF NOT EXISTS public.coach_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL,
  portfolio_id UUID NOT NULL REFERENCES public.portfolios(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL DEFAULT 'Shared report',
  permission TEXT NOT NULL DEFAULT 'read',
  hide_dollar_pnl BOOLEAN NOT NULL DEFAULT true,
  period_start DATE,
  period_end DATE,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  last_viewed_at TIMESTAMPTZ,
  view_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.coach_shares TO authenticated;
GRANT ALL ON public.coach_shares TO service_role;
ALTER TABLE public.coach_shares ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage their own coach shares" ON public.coach_shares;
CREATE POLICY "Users can manage their own coach shares" ON public.coach_shares FOR ALL TO authenticated USING (auth.uid() = owner_id AND EXISTS (SELECT 1 FROM public.portfolios WHERE portfolios.id = coach_shares.portfolio_id AND portfolios.owner_id = auth.uid())) WITH CHECK (auth.uid() = owner_id AND EXISTS (SELECT 1 FROM public.portfolios WHERE portfolios.id = coach_shares.portfolio_id AND portfolios.owner_id = auth.uid()));

DO $$ BEGIN
  ALTER TABLE public.coach_shares ADD CONSTRAINT coach_shares_permission_check CHECK (permission IN ('read', 'comment'));
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.coach_shares ADD CONSTRAINT coach_shares_period_check CHECK (period_start IS NULL OR period_end IS NULL OR period_end >= period_start);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.coach_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL,
  share_id UUID NOT NULL REFERENCES public.coach_shares(id) ON DELETE CASCADE,
  trade_id UUID REFERENCES public.trades(id) ON DELETE SET NULL,
  author_name TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.coach_comments TO authenticated;
GRANT ALL ON public.coach_comments TO service_role;
ALTER TABLE public.coach_comments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage comments on their own shares" ON public.coach_comments;
CREATE POLICY "Users can manage comments on their own shares" ON public.coach_comments FOR ALL TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

CREATE INDEX IF NOT EXISTS coach_shares_owner_portfolio_idx ON public.coach_shares(owner_id, portfolio_id);
CREATE INDEX IF NOT EXISTS coach_comments_share_idx ON public.coach_comments(share_id, created_at);

DROP TRIGGER IF EXISTS coach_shares_updated_at ON public.coach_shares;
CREATE TRIGGER coach_shares_updated_at BEFORE UPDATE ON public.coach_shares FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
