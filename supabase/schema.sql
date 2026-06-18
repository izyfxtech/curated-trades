-- ============================================================
-- Curated Trades – Supabase Schema (Idempotent / Upgrade Safe)
-- Run this in the Supabase SQL editor (or supabase db push)
-- ============================================================

create extension if not exists "pgcrypto";

-- accounts
create table if not exists public.accounts (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  name             text not null,
  platform         text,
  broker           text,
  starting_balance numeric default 0,
  currency         text default 'USD',
  is_active        boolean default true,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);
alter table public.accounts enable row level security;
-- Drop before create to prevent error 42710
drop policy if exists "Users manage own accounts" on public.accounts;
create policy "Users manage own accounts" on public.accounts for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- strategies
create table if not exists public.strategies (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  description text,
  rules       text,
  instruments text[],
  timeframe   text,
  status      text default 'active' check (status in ('active','testing','retired')),
  color       text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
alter table public.strategies enable row level security;
-- Drop before create to prevent error 42710
drop policy if exists "Users manage own strategies" on public.strategies;
create policy "Users manage own strategies" on public.strategies for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- trades
create table if not exists public.trades (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  symbol            text not null,
  direction         text check (direction in ('long','short')),
  entry_price       numeric,
  exit_price        numeric,
  stop_loss         numeric,
  take_profit       numeric,
  lot_size          numeric,
  pnl               numeric,
  pnl_pips          numeric,
  commission        numeric,
  swap              numeric,
  net_pnl           numeric,
  risk_reward       numeric,
  open_time         timestamptz,
  close_time        timestamptz,
  duration_minutes  numeric,
  session           text check (session in ('asian','london','new_york','overlap')),
  strategy          text,
  tags              text[],
  mistakes          text[],
  emotion           text check (emotion in ('confident','calm','anxious','fearful','greedy','frustrated','neutral')),
  rating            numeric,
  execution_quality numeric,
  setup_quality     numeric,
  discipline_score  numeric,
  notes             text,
  screenshots       text[],
  account           text,
  platform          text,
  outcome           text check (outcome in ('win','loss','breakeven','open')),
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);
alter table public.trades enable row level security;
-- Drop before create to prevent error 42710
drop policy if exists "Users manage own trades" on public.trades;
create policy "Users manage own trades" on public.trades for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- journal_templates
create table if not exists public.journal_templates (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  prompts    jsonb,
  strategy   text,
  is_default boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.journal_templates enable row level security;
-- Drop before create to prevent error 42710
drop policy if exists "Users manage own templates" on public.journal_templates;
create policy "Users manage own templates" on public.journal_templates for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- shared_views
create table if not exists public.shared_views (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  slug              text not null unique,
  type              text not null check (type in ('performance','trade')),
  title             text,
  trade_id          uuid,
  is_public         boolean default true,
  time_period       text,
  show_equity       boolean default true,
  show_distribution boolean default true,
  simplified        boolean default false,
  views             integer default 0,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);
alter table public.shared_views enable row level security;
-- Drop before create to prevent error 42710
drop policy if exists "Users manage own shared views" on public.shared_views;
create policy "Users manage own shared views" on public.shared_views for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Anyone reads public shared views" on public.shared_views;
create policy "Anyone reads public shared views" on public.shared_views for select using (is_public = true);

-- profiles
create table if not exists public.profiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  full_name        text,
  default_currency text default 'USD',
  default_account  text,
  timezone         text,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);
alter table public.profiles enable row level security;
-- Drop before create to prevent error 42710
drop policy if exists "Users manage own profile" on public.profiles;
create policy "Users manage own profile" on public.profiles for all using (auth.uid() = id) with check (auth.uid() = id);

-- Index for fast slug lookups on public share pages
create index if not exists shared_views_slug_idx on public.shared_views (slug);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data->>'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

-- updated_at helper
create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

-- Drop and recreate triggers to avoid duplicates/errors
drop trigger if exists set_accounts_updated_at on public.accounts;
create trigger set_accounts_updated_at before update on public.accounts for each row execute procedure public.set_updated_at();

drop trigger if exists set_strategies_updated_at on public.strategies;
create trigger set_strategies_updated_at before update on public.strategies for each row execute procedure public.set_updated_at();

drop trigger if exists set_trades_updated_at on public.trades;
create trigger set_trades_updated_at before update on public.trades for each row execute procedure public.set_updated_at();

drop trigger if exists set_templates_updated_at on public.journal_templates;
create trigger set_templates_updated_at before update on public.journal_templates for each row execute procedure public.set_updated_at();

drop trigger if exists set_shared_views_updated_at on public.shared_views;
create trigger set_shared_views_updated_at before update on public.shared_views for each row execute procedure public.set_updated_at();

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at before update on public.profiles for each row execute procedure public.set_updated_at();

