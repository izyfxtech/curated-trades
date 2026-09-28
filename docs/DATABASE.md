# Database

Postgres via Supabase. All access from application code goes through
`src/lib/*.functions.ts` server functions using a request-scoped Supabase
client that carries the caller's own JWT — see
[`ARCHITECTURE.md`](./ARCHITECTURE.md) for how that client is constructed
and why. This document covers the schema itself and how migrations in this
repo are written.

## Applying migrations — read this first
<a id="applying-migrations"></a>

**Nothing in this repo has write access to the actual Supabase project.**
Every migration under `supabase/migrations/` was written and idempotency-
tested against a disposable local Postgres instance (see "Testing
migrations" below) — never against the live database this app actually
runs on. Before any phase's feature code will work against the real
project, its migration has to be applied there by whoever holds those
credentials:

```sh
# If the Supabase CLI is linked to the project:
supabase db push

# Otherwise: open the Supabase Studio SQL editor for the project and paste
# in the contents of the new migration file(s), in filename (timestamp) order.
```

Migrations are safe to re-run (see "Idempotency" below), so re-applying one
that already ran is harmless — but skipping one that hasn't run yet will
surface as missing-table/missing-column errors from the application, not as
a clear "run this migration" message.

## Schema overview

| Table | Purpose | Key relationships |
|---|---|---|
| `profiles` | One row per user — timezone, currency, trader type, onboarding state | `user_id` → `auth.users` (1:1) |
| `portfolios` | One or more accounts per user (personal or prop) | `owner_id` → user |
| `portfolio_settings` | Per-portfolio config (default risk %, preferred sessions/symbols) | `portfolio_id` → `portfolios` (1:1) |
| `trades` | The core trade record — entry/exit, calculated P&L/R, planning fields | `portfolio_id` → `portfolios`; `playbook_id` → `playbooks` (nullable) |
| `trade_exits` | Partial-exit fills for a single trade (scale-outs) | `trade_id` → `trades` |
| `trade_attachments` | Screenshot metadata for a trade (files live in Storage) | `trade_id` → `trades` |
| `tags` | Generic labels, `category` distinguishes setup/mistake/general/etc. | owner-scoped, no parent |
| `trade_tags` | Many-to-many join between trades and tags | `trade_id` → `trades`, `tag_id` → `tags` |
| `import_batches` / `import_rows` | CSV import staging — one batch per upload, one row per staged trade | `batch_id` → `import_batches`; `portfolio_id` → `portfolios` |
| `playbooks` | A trading setup definition | owner-scoped |
| `playbook_checklist_items` | Ordered pre-trade checklist for a playbook (see [`DECISIONS.md` #7](./DECISIONS.md#d7)) | `playbook_id` → `playbooks` |
| `playbook_attachments` | Reference screenshots for a playbook (see [`DECISIONS.md` #8](./DECISIONS.md#d8)) | `playbook_id` → `playbooks` |
| `trade_ideas` | Pre-trade setups tracked independent of whether they became a trade | `portfolio_id` → `portfolios`; `playbook_id` (nullable); `taken_trade_id` → `trades` (nullable) |
| `trade_reviews` | Post-trade reflection — one per trade | `trade_id` → `trades` (1:1, UNIQUE) |
| `period_reviews` | Weekly/monthly written commitment only (see [`DECISIONS.md` #13](./DECISIONS.md#d13)) | `portfolio_id` → `portfolios` |

Storage: one bucket, `trade-screenshots`, holding both trade and playbook
attachments under `<user_id>/...` and `<user_id>/playbooks/<playbook_id>/...`
paths respectively (see [`DECISIONS.md` #8](./DECISIONS.md#d8)).

## RLS pattern

Every table has RLS enabled with a single `FOR ALL` policy, generally one of
two shapes:

**Directly owned** (the table has its own `owner_id` column):
```sql
CREATE POLICY "..." ON public.some_table
  FOR ALL TO authenticated
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);
```

**Owned via a parent** (the table references a portfolio/trade/playbook that
itself has an owner):
```sql
CREATE POLICY "..." ON public.child_table
  FOR ALL TO authenticated
  USING (auth.uid() = owner_id AND EXISTS (
    SELECT 1 FROM public.parent_table
    WHERE parent_table.id = child_table.parent_id
      AND parent_table.owner_id = auth.uid()
  ))
  WITH CHECK (/* same */);
```

This second shape is why several server functions can skip an app-level
"does the caller own this?" pre-check and just attempt the write directly —
the database rejects it if not, and the resulting error is translated into
a friendly message by `src/lib/db-errors.ts`. See
[`DECISIONS.md` #27](./DECISIONS.md#d27) for which functions do this and why
it's safe. **If you add a new table, decide which shape applies and use the
matching `WITH CHECK` — a missing `EXISTS` check on a child table is exactly
the kind of gap that pre-check-removal relies on not existing.**

## Idempotency

Every migration can be re-run any number of times against the same database
with no errors. This matters because "run this migration" is a manual step
(see above) — someone re-running one that already applied, or a `supabase
db reset` replaying the whole history, should never fail.

- `CREATE TABLE` / `CREATE INDEX` / `ALTER TABLE ... ADD COLUMN` → use
  `IF NOT EXISTS` directly.
- `CREATE POLICY` / `CREATE TRIGGER` → `DROP ... IF EXISTS` immediately
  before creating. This is deliberately drop-then-recreate rather than
  "skip if exists" — if you edit a policy or trigger's definition and
  re-run the migration, drop-then-recreate means the database actually ends
  up matching what the file currently says. A "skip if exists" approach
  would silently leave the old definition in place.
- `ALTER TABLE ... ADD CONSTRAINT` → Postgres has no `IF NOT EXISTS` for
  this. Wrap it:
  ```sql
  DO $$ BEGIN
    ALTER TABLE public.some_table ADD CONSTRAINT some_check CHECK (...);
  EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
  ```
  **Both exceptions are required.** A plain `CHECK` or `FOREIGN KEY`
  constraint raises `duplicate_object` (42710) if it already exists. A
  `UNIQUE` or `PRIMARY KEY` constraint raises `duplicate_table` (42P07)
  instead, because it's backed by an implicitly-named index under the hood
  — catching only `duplicate_object` will work fine until the first UNIQUE
  constraint you add this way, then fail confusingly on the second run. See
  [`DECISIONS.md` #28](./DECISIONS.md#d28) — this was caught by actually
  testing, not by reasoning about it.
- Storage bucket inserts → `ON CONFLICT (id) DO NOTHING`.
- `CREATE OR REPLACE FUNCTION` → already idempotent.
- `GRANT` and `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` → already
  idempotent (re-running either is a safe no-op).

## Testing migrations

There's no CI wired up to test migrations automatically. To verify a new
migration is both syntactically correct and idempotent before committing
it, the fastest path is a disposable local Postgres with a couple of stubs
for the Supabase-specific pieces migrations reference:

```sh
# Once: install Postgres and start it
sudo apt-get install -y postgresql postgresql-contrib
sudo service postgresql start

# Once: create a scratch database and stub auth.uid() / storage.*, since
# plain Postgres doesn't have Supabase's platform schema
sudo -u postgres psql -c "CREATE DATABASE scratch;"
sudo -u postgres psql -d scratch <<'SQL'
CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE IF NOT EXISTS storage.buckets (id TEXT PRIMARY KEY, name TEXT NOT NULL, public BOOLEAN NOT NULL DEFAULT false, file_size_limit BIGINT, allowed_mime_types TEXT[]);
CREATE TABLE IF NOT EXISTS storage.objects (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id TEXT, name TEXT);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION storage.foldername(name TEXT) RETURNS TEXT[] LANGUAGE sql STABLE AS $$ SELECT string_to_array(name, '/') $$;
SQL

# Apply every migration, in order, TWICE — the second pass is the actual
# idempotency test. -v ON_ERROR_STOP=1 makes it fail loudly instead of
# continuing past a broken statement.
for f in supabase/migrations/*.sql; do
  sudo -u postgres psql -d scratch -v ON_ERROR_STOP=1 -f "$f"
done
# ...then run that same loop again. If pass 2 errors, something in the new
# migration isn't idempotent yet.
```

Worth spot-checking the resulting schema after a successful two-pass run
too — "didn't error" isn't the same as "produced the right schema" (e.g.
confirm a constraint wasn't silently duplicated: `SELECT conname FROM
pg_constraint WHERE conname = 'your_constraint_name'` should return exactly
one row).
