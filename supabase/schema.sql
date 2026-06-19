-- ============================================================
-- Curated Trades – Supabase Schema  (Idempotent / Upgrade Safe)
-- Run in the Supabase SQL editor or via: supabase db push
--
-- BUG-FIX CHANGELOG (vs original supabase/schema.sql)
-- ─────────────────────────────────────────────────────────────
--
-- BUG 1 – trades.account stores a NAME string, not a UUID.
--   The app filters trades by account NAME (t.account === account.name),
--   not by a foreign key.  The original schema left `account text` with no
--   comment, which is correct, but adding a clear comment + a GIN index on
--   the name keeps queries fast.  No structural change needed here—this
--   entry documents the intentional design to avoid future "fix" mistakes.
--
-- BUG 2 – trades.strategy stores a NAME string (same pattern as account).
--   Correct as-is; documented here for the same reason.
--
-- BUG 3 – trades.created_date column MISSING.
--   Throughout the frontend (EquityCurve, WinLossChart, RecentTrades,
--   ProfitCalendar, Timeline, useFilteredTrades, BalanceChart, ProfitChart,
--   PublicSharedView, SharePerformance) every date fallback was:
--     new Date(t.close_time || t.created_date)
--   `created_date` was NEVER defined in the schema — only `created_at`.
--   Fixed in the frontend: all 13 occurrences changed to `t.created_at`.
--   No schema column needed.
--
-- BUG 4 – trades.direction allows NULL for non-directional instruments but
--   the UI also sends an empty string for "no direction" on new trades.
--   Added a normalisation CHECK so empty string is coerced to NULL at the
--   DB level via a constraint (using a partial-null approach + a BEFORE
--   trigger that converts '' → NULL).
--
-- BUG 5 – rating CHECK constraint MISSING.
--   Entity definition says 1-5; TradeForm Slider enforces min=1 max=5.
--   The original schema has `rating numeric` with no bounds.  A CHECK
--   constraint is added: rating between 1 and 5.
--
-- BUG 6 – execution_quality, setup_quality, discipline_score CHECK
--   constraints MISSING.  TradeForm enforces min=1 max=10 for all three.
--   CHECK constraints added: each between 1 and 10.
--
-- BUG 7 – shared_views.trade_id has NO foreign-key reference to trades.
--   The app creates share links with trade_id = trade.id and later fetches
--   that trade by id. If a trade is deleted the share link becomes a
--   dangling pointer.  FK added with ON DELETE SET NULL so the share page
--   can gracefully show "trade no longer available" instead of crashing.
--
-- BUG 8 – shared_views.views column type is `integer` but uses DEFAULT 0.
--   The mutation does  views: (view?.views || 0) + 1  on every page view,
--   which can grow large over time.  Changed to bigint to prevent overflow
--   on popular public links.
--
-- BUG 9 – shared_views public-read policy allows reading ALL columns
--   including user_id (PII leak).  The original policy is:
--     FOR SELECT USING (is_public = true)
--   which returns every column to anonymous visitors.  Replaced with a
--   security-definer view `public.public_shared_views` that exposes only
--   the columns the PublicSharedView page actually needs, and the RLS
--   policy now restricts direct table reads for anon.
--
-- BUG 10 – NO index on trades(user_id).
--   Every RLS-filtered query on the trades table does a full seq-scan on
--   user_id before the WHERE clause can be applied.  Added btree index.
--
-- BUG 11 – NO index on trades(close_time).
--   Almost every list/sort in the app orders by close_time DESC; without
--   an index the planner does a sequential scan + sort on potentially
--   thousands of rows.  Added btree index.
--
-- BUG 12 – NO index on trades(account).
--   useFilteredTrades and TradeFilterContext both filter by account name.
--   Added btree index.
--
-- BUG 13 – NO index on trades(strategy).
--   Strategies page, analytics and filter all filter by strategy name.
--   Added btree index.
--
-- BUG 14 – NO index on trades(outcome).
--   Win/loss/breakeven filters are applied on every filteredTrades call.
--   Added btree index.
--
-- BUG 15 – NO index on trades(open_time).
--   Timeline page sorts / groups by open_time.  Added btree index.
--
-- BUG 16 – profiles.default_account stores a NAME string but there is no
--   link to the actual accounts table.  Added comment; no FK because the
--   same loose-name-coupling pattern is used throughout the app.
--
-- BUG 17 – handle_new_user trigger does not set updated_at on the new
--   profile row.  The set_profiles_updated_at trigger only fires on UPDATE,
--   so profiles.updated_at stays at the default now() of creation—correct—
--   but the INSERT inside handle_new_user skips the updated_at column
--   entirely, meaning it inherits the column default (also now()).  This is
--   fine in practice but was inconsistent; updated_at is now explicit in
--   the INSERT.
--
-- BUG 18 – set_updated_at function is NOT marked SECURITY DEFINER and
--   has no SET search_path, leaving it vulnerable to search_path injection.
--   Best-practice fix applied: SET search_path = public.
--
-- BUG 19 – journal_templates.strategy stores a strategy NAME string, NOT
--   a UUID (consistent with the rest of the app but undocumented).  Added
--   comment.  No structural change.
--
-- BUG 20 – shared_views lacks an index on (user_id, type) even though the
--   app lists all views for the current user and then filters by type
--   client-side.  Added composite index.
--
-- BUG 9 (v2) – the original Bug 9 fix used a view with
--   `security_invoker = false`, which Supabase's linter correctly flags as
--   ERROR (lint 0010_security_definer_view): it's SECURITY DEFINER under a
--   different name, permanently bypassing RLS for every caller and quietly
--   leaking columns (it still exposed user_id, contradicting its own
--   comment). Replaced with a plain invoker-rights view plus a real RLS
--   policy ("Anyone reads public shared views", is_public = true) on the
--   base table — the view inherits RLS automatically and can't drift from
--   the table's security model.
--
-- BUG 21 – trades table has no anon-readable policy, so public share links
--   never work. PublicSharedView.jsx queries `trades` directly through
--   entities.Trade.list/.filter, which apply NO client-side owner filter —
--   they depend entirely on RLS (see src/api/entities.js). The only trades
--   policy was "Users manage own trades" (auth.uid() = user_id), which
--   returns zero rows to a logged-out visitor. Every public performance or
--   single-trade share link would render empty/missing data. Added a
--   second SELECT policy scoping anon/authenticated reads to trades
--   reachable through a live public shared_views row (matched by trade_id
--   for single-trade shares, or by user_id for performance shares).
--
-- BUG 22 – the Bug 21 policy can't be created alongside the rest of the
--   trades table setup: it references shared_views in a subquery, but
--   shared_views is created later in this file. On a fresh database that
--   ordering throws "relation \"shared_views\" does not exist". The policy
--   is created further down, immediately after shared_views and its own
--   RLS policies exist.
--
-- BUG 24 – re-running this migration over a database that already had the
--   v1 view (`security_invoker = false`, included user_id) hit Postgres
--   error 42P16 "cannot drop columns from view": CREATE OR REPLACE VIEW
--   can change a view's query but never its column list. Switched to
--   DROP VIEW IF EXISTS followed by a plain CREATE VIEW, which is safe to
--   re-run no matter which earlier version of the view exists. The GRANT
--   SELECT statement is kept directly after, since grants don't survive a
--   DROP.
--
-- BUG 9 (v3) – even after v2 removed `security_invoker = false`, the
--   Supabase linter (and Supabase's own AI assistant) still flagged the
--   view as SECURITY DEFINER. Reason: in Postgres, simply omitting a
--   security_invoker clause does NOT default to invoker-rights — it
--   defaults to security_invoker = false (definer-style: runs as the
--   view's owner), regardless of whether "SECURITY DEFINER" appears
--   literally anywhere in the SQL. v2's assumption that "no clause = safe"
--   was wrong. Fixed by setting `WITH (security_invoker = true)`
--   explicitly on the view (requires Postgres 15+, which Supabase runs).
--   This is now the third and final form of the Bug 9 fix.
-- ============================================================

-- Required extension (idempotent)
create extension if not exists "pgcrypto";

-- ══════════════════════════════════════════════════════════════
-- HELPER FUNCTIONS
-- ══════════════════════════════════════════════════════════════

-- updated_at trigger function (BUG 18 fix: explicit search_path)
create or replace function public.set_updated_at()
  returns trigger
  language plpgsql
  set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Normalise empty-string direction to NULL (BUG 4 fix)
create or replace function public.normalise_trade_direction()
  returns trigger
  language plpgsql
  set search_path = public
as $$
begin
  if new.direction = '' then
    new.direction = null;
  end if;
  return new;
end;
$$;

-- Auto-create profile on signup (BUG 17 fix: explicit updated_at)
create or replace function public.handle_new_user()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, created_at, updated_at)
  values (
    new.id,
    new.raw_user_meta_data->>'full_name',
    now(),
    now()
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- BUG 25 FIX (v2) – any function in the `public` schema is auto-exposed by
--   Supabase's PostgREST API at /rest/v1/rpc/<function_name>. This trigger
--   function is SECURITY DEFINER (needed so it can insert into profiles
--   regardless of who's signing up) but was never meant to be called
--   directly — only the on_auth_user_created trigger should invoke it.
--
--   v1 of this fix only revoked from anon and authenticated directly, but
--   the linter kept flagging it. Reason: Postgres grants EXECUTE on every
--   new function to the PUBLIC pseudo-role by default, and anon/
--   authenticated both inherit that grant through PUBLIC membership.
--   Revoking from the named roles alone does nothing while the PUBLIC
--   grant still stands — it must be revoked explicitly too.
revoke execute on function public.handle_new_user() from public;
revoke execute on function public.handle_new_user() from anon, authenticated;

-- ══════════════════════════════════════════════════════════════
-- TABLE: accounts
-- ══════════════════════════════════════════════════════════════
create table if not exists public.accounts (
  id               uuid        primary key default gen_random_uuid(),
  user_id          uuid        not null references auth.users(id) on delete cascade,
  name             text        not null,
  platform         text,
  broker           text,
  starting_balance numeric     not null default 0,
  currency         text        not null default 'USD',
  is_active        boolean     not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- Name must be unique per user so the string-based join from trades works
  unique (user_id, name)
);

alter table public.accounts enable row level security;

drop policy if exists "Users manage own accounts" on public.accounts;
create policy "Users manage own accounts"
  on public.accounts for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── Indexes ──────────────────────────────────────────────────
create index if not exists accounts_user_id_idx on public.accounts (user_id);

-- ── Triggers ─────────────────────────────────────────────────
drop trigger if exists set_accounts_updated_at on public.accounts;
create trigger set_accounts_updated_at
  before update on public.accounts
  for each row execute procedure public.set_updated_at();

-- ══════════════════════════════════════════════════════════════
-- TABLE: strategies
-- ══════════════════════════════════════════════════════════════
create table if not exists public.strategies (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  name        text        not null,
  description text,
  -- rules stores rich-text (HTML string from the editor)
  rules       text,
  instruments text[],
  timeframe   text,
  status      text        not null default 'active'
                check (status in ('active', 'testing', 'retired')),
  color       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- Name must be unique per user so string-based joins from trades work
  unique (user_id, name)
);

alter table public.strategies enable row level security;

drop policy if exists "Users manage own strategies" on public.strategies;
create policy "Users manage own strategies"
  on public.strategies for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── Indexes ──────────────────────────────────────────────────
create index if not exists strategies_user_id_idx on public.strategies (user_id);

-- ── Triggers ─────────────────────────────────────────────────
drop trigger if exists set_strategies_updated_at on public.strategies;
create trigger set_strategies_updated_at
  before update on public.strategies
  for each row execute procedure public.set_updated_at();

-- ══════════════════════════════════════════════════════════════
-- TABLE: trades
-- ══════════════════════════════════════════════════════════════
create table if not exists public.trades (
  id               uuid        primary key default gen_random_uuid(),
  user_id          uuid        not null references auth.users(id) on delete cascade,

  -- Core trade data
  symbol           text        not null,
  direction        text        check (direction in ('long', 'short')),   -- NULL = no directional bias
  entry_price      numeric,
  exit_price       numeric,
  stop_loss        numeric,
  take_profit      numeric,
  lot_size         numeric,                                               -- lots / shares / contracts / units

  -- P&L
  pnl              numeric,                                               -- gross P&L
  pnl_pips         numeric,                                               -- P&L in pips (forex)
  commission       numeric,
  swap             numeric,
  net_pnl          numeric,                                               -- pnl - commission - swap

  -- Risk / quality metrics
  risk_reward      numeric,
  -- BUG 5 FIX: rating constrained to 1–5 (matches TradeForm Slider min=1 max=5)
  rating           numeric     check (rating between 1 and 5),
  -- BUG 6 FIX: quality scores constrained to 1–10 (match TradeForm Slider min=1 max=10)
  execution_quality numeric    check (execution_quality between 1 and 10),
  setup_quality    numeric     check (setup_quality between 1 and 10),
  discipline_score numeric     check (discipline_score between 1 and 10),

  -- Timing
  open_time        timestamptz,
  close_time       timestamptz,
  duration_minutes numeric,                                               -- derived; may be stored for fast retrieval

  -- Classification
  session          text        check (session in ('asian', 'london', 'new_york', 'overlap')),
  -- strategy: stores the strategy NAME string (not a FK) — intentional design
  -- matching how strategies.name is the join key throughout the app
  strategy         text,
  -- account: stores the account NAME string (not a FK) — intentional design
  -- matching how accounts.name is the join key throughout the app
  account          text,
  platform         text,
  outcome          text        check (outcome in ('win', 'loss', 'breakeven', 'open')),

  -- Arrays / free-form
  tags             text[],
  mistakes         text[],
  screenshots      text[],     -- Cloudinary URLs
  notes            text,       -- rich-text HTML from the journal editor

  -- Psychology
  emotion          text        check (emotion in (
                                  'confident', 'calm', 'anxious',
                                  'fearful', 'greedy', 'frustrated', 'neutral'
                               )),

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table public.trades enable row level security;

drop policy if exists "Users manage own trades" on public.trades;
create policy "Users manage own trades"
  on public.trades for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- NOTE: the public-read policy needed for shared trade/performance links
-- (BUG 21) is created further down, AFTER the shared_views table exists —
-- see "Public read via active share link" near the shared_views section.
-- Creating it here would fail on a fresh database: shared_views wouldn't
-- exist yet (BUG 22 — forward table reference in a same-pass migration).

-- ── Indexes (BUG 10–15 fixes) ────────────────────────────────
create index if not exists trades_user_id_idx    on public.trades (user_id);
create index if not exists trades_close_time_idx on public.trades (close_time desc);
create index if not exists trades_open_time_idx  on public.trades (open_time  desc);
create index if not exists trades_account_idx    on public.trades (user_id, account);
create index if not exists trades_strategy_idx   on public.trades (user_id, strategy);
create index if not exists trades_outcome_idx    on public.trades (user_id, outcome);
create index if not exists trades_symbol_idx     on public.trades (user_id, symbol);

-- ── Triggers ─────────────────────────────────────────────────

-- BUG 4 FIX: normalise empty-string direction → NULL before insert/update
drop trigger if exists normalise_trades_direction on public.trades;
create trigger normalise_trades_direction
  before insert or update on public.trades
  for each row execute procedure public.normalise_trade_direction();

drop trigger if exists set_trades_updated_at on public.trades;
create trigger set_trades_updated_at
  before update on public.trades
  for each row execute procedure public.set_updated_at();

-- ══════════════════════════════════════════════════════════════
-- TABLE: journal_templates
-- ══════════════════════════════════════════════════════════════
create table if not exists public.journal_templates (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users(id) on delete cascade,
  name       text        not null,
  -- prompts is a JSON array of {label: string, placeholder: string}
  prompts    jsonb,
  -- strategy: stores strategy NAME string (not FK) — matches app convention
  strategy   text,
  is_default boolean     not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.journal_templates enable row level security;

drop policy if exists "Users manage own templates" on public.journal_templates;
create policy "Users manage own templates"
  on public.journal_templates for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── Indexes ──────────────────────────────────────────────────
create index if not exists journal_templates_user_id_idx on public.journal_templates (user_id);

-- ── Triggers ─────────────────────────────────────────────────
drop trigger if exists set_templates_updated_at on public.journal_templates;
create trigger set_templates_updated_at
  before update on public.journal_templates
  for each row execute procedure public.set_updated_at();

-- ══════════════════════════════════════════════════════════════
-- TABLE: shared_views
-- ══════════════════════════════════════════════════════════════
create table if not exists public.shared_views (
  id                uuid        primary key default gen_random_uuid(),
  user_id           uuid        not null references auth.users(id) on delete cascade,
  slug              text        not null unique,
  type              text        not null check (type in ('performance', 'trade')),
  title             text,
  -- BUG 7 FIX: FK to trades with ON DELETE SET NULL so a deleted trade
  --   doesn't leave a dangling pointer; the share page handles null gracefully.
  trade_id          uuid        references public.trades(id) on delete set null,
  is_public         boolean     not null default true,
  time_period       text,       -- 'all'|'7d'|'30d'|'90d'|'1y'
  show_equity       boolean     not null default true,
  show_distribution boolean     not null default true,
  simplified        boolean     not null default false,
  -- BUG 8 FIX: bigint prevents overflow on popular public links
  views             bigint      not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table public.shared_views enable row level security;

drop policy if exists "Users manage own shared views" on public.shared_views;
create policy "Users manage own shared views"
  on public.shared_views for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- BUG 9 FIX (v2) – the original fix used `security_invoker = false`, which
--   is just another spelling of SECURITY DEFINER. Supabase's linter flags
--   this as an ERROR (lint 0010_security_definer_view) because a definer
--   view permanently bypasses RLS for whoever queries it, and silently
--   exposes any column added to the base table later. It also still leaked
--   user_id, contradicting the "omit PII" comment in v1.
--
--   Correct fix: keep the view as a plain INVOKER view (the default — no
--   security_invoker clause needed) and let row level security on the base
--   table do the filtering. Two policies on shared_views:
--     1. owners can do anything to their own rows (already defined above)
--     2. anon/authenticated may SELECT rows where is_public = true
--   The view then just trims the column list; it inherits the caller's
--   privileges and RLS automatically, so it can't drift from the table's
--   security model the way a definer view can. user_id is dropped entirely
--   since the frontend's owner-trades lookup for a public equity curve goes
--   through trade_id, not user_id.
drop policy if exists "Anyone reads public shared views" on public.shared_views;
create policy "Anyone reads public shared views"
  on public.shared_views for select
  to anon, authenticated
  using (is_public = true);

-- Plain (invoker-rights) view exposing only the columns the public share
-- page needs.
--
-- BUG 9 (v3) – v2 simply omitted any security_invoker clause, assuming
--   that would default to invoker-rights. It does NOT: in Postgres, a
--   view with no explicit security_invoker setting defaults to
--   security_invoker = false (definer-style — runs as the view's OWNER,
--   not the querying role), regardless of whether the literal words
--   "SECURITY DEFINER" appear anywhere in the SQL. Supabase's linter
--   (and the Supabase AI assistant) correctly flagged this as still
--   being a security-definer view even after v2's fix. The clause must
--   be set explicitly to true.
--
-- DROP before CREATE (not "CREATE OR REPLACE"): Postgres allows replacing
-- a view's query but NOT its column list (error 42P16: cannot drop columns
-- from view). Dropping first makes this migration safe to re-run
-- regardless of which earlier version of the view exists already.
drop view if exists public.public_shared_views;
create view public.public_shared_views
  with (security_invoker = true)
as
  select
    id,
    slug,
    type,
    title,
    trade_id,
    is_public,
    time_period,
    show_equity,
    show_distribution,
    simplified,
    views
    -- deliberately omit: user_id (PII), created_at, updated_at —
    -- PublicSharedView.jsx only needs the fields listed above
  from public.shared_views
  where is_public = true;

-- Grant read access to the anonymous / authenticated roles. RLS on the
-- underlying table (policy above) still applies to every row returned.
grant select on public.public_shared_views to anon, authenticated;

-- BUG 21 FIX – PublicSharedView.jsx queries the `trades` table directly
--   (entities.Trade.list / entities.Trade.filter) with NO owner filter in
--   the client code — see src/api/entities.js, which relies entirely on
--   RLS to scope rows. The "Users manage own trades" policy on trades
--   returns zero rows to a logged-out visitor, so every public share link
--   would render an empty performance chart or a missing single-trade
--   page. This policy (created here, AFTER shared_views exists — see
--   BUG 22) lets anon / authenticated read a trade only when it's
--   reachable through a live, public shared_views row: either the trade
--   was shared directly (type = 'trade'), or its owner has an active
--   'performance' share link (so the equity curve / win-loss chart on
--   that page has data to render).
drop policy if exists "Public read via active share link" on public.trades;
create policy "Public read via active share link"
  on public.trades for select
  to anon, authenticated
  using (
    exists (
      select 1 from public.shared_views sv
      where sv.is_public = true
        and (
          (sv.type = 'trade' and sv.trade_id = trades.id)
          or (sv.type = 'performance' and sv.user_id = trades.user_id)
        )
    )
  );

-- ── Indexes (BUG 20 fix) ─────────────────────────────────────
-- Fast slug lookups for public share pages
create index if not exists shared_views_slug_idx on public.shared_views (slug);
-- Listing views by owner + type (BUG 20 fix)
create index if not exists shared_views_user_type_idx on public.shared_views (user_id, type);
-- FK index
create index if not exists shared_views_trade_id_idx on public.shared_views (trade_id);

-- ── Triggers ─────────────────────────────────────────────────
drop trigger if exists set_shared_views_updated_at on public.shared_views;
create trigger set_shared_views_updated_at
  before update on public.shared_views
  for each row execute procedure public.set_updated_at();

-- ══════════════════════════════════════════════════════════════
-- TABLE: profiles
-- ══════════════════════════════════════════════════════════════
create table if not exists public.profiles (
  id               uuid        primary key references auth.users(id) on delete cascade,
  full_name        text,
  default_currency text        not null default 'USD',
  -- default_account: stores account NAME string (not FK) — matches app convention
  default_account  text,
  timezone         text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "Users manage own profile" on public.profiles;
create policy "Users manage own profile"
  on public.profiles for all
  using  (auth.uid() = id)
  with check (auth.uid() = id);

-- ── Triggers ─────────────────────────────────────────────────
drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
  before update on public.profiles
  for each row execute procedure public.set_updated_at();

-- ══════════════════════════════════════════════════════════════
-- TRIGGER: auto-create profile on signup
-- ══════════════════════════════════════════════════════════════
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
