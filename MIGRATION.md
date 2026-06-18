# Base44 → Supabase Migration Guide

## What changed

| Area | Before (Base44) | After (Supabase) |
|---|---|---|
| Auth | `base44.auth.*` | `@supabase/supabase-js` auth |
| Database | `base44.entities.*` | Supabase Postgres via `src/api/entities.js` |
| File uploads | `base44.integrations.Core.UploadFile` | Cloudinary (unsigned upload preset) |
| Trade CSV import | Base44 AI extraction | Client-side CSV/JSON parser |
| Vite plugin | `@base44/vite-plugin` | Removed; `@` alias handled by vite resolve |

## One-time Supabase setup

1. **Create project** at [supabase.com](https://supabase.com) (already done — credentials in `.env.local`)

2. **Run the schema** — paste `supabase/schema.sql` into the Supabase **SQL Editor** and run it.
   This creates: `trades`, `accounts`, `strategies`, `journal_templates`, `shared_views`, `profiles`
   and sets up Row Level Security so users only see their own data.

3. **Enable Google OAuth** (optional) — Supabase Dashboard → Authentication → Providers → Google.
   Add your Google Client ID & Secret.

4. **Email confirmation** — by default Supabase sends a confirmation email on signup.
   To disable for local dev: Authentication → Email → uncheck "Enable email confirmations".

## Cloudinary setup

Screenshots are uploaded to Cloudinary using an **unsigned upload preset**.
- Cloud name: `df5e29hmo`
- Upload preset: `curated-trades-uploads`

No API keys needed on the frontend — the preset is public.
In Cloudinary dashboard you can restrict allowed file types and set folder to `trade-screenshots/`.

## Local development

```bash
cp .env.example .env.local   # already done — .env.local has real values
npm install
npm run dev
```

## Auth flows

| Flow | How it works |
|---|---|
| Email/password login | `supabase.auth.signInWithPassword` |
| Register | `supabase.auth.signUp` → user gets confirmation email |
| Google OAuth | `supabase.auth.signInWithOAuth({ provider: 'google' })` |
| Forgot password | `supabase.auth.resetPasswordForEmail` → email with link |
| Reset password | Link lands on `/reset-password` → `supabase.auth.updateUser` |
| Sign out | `supabase.auth.signOut` |

## Import trades (CSV/JSON)

The import dialog now parses files client-side. Supported column names are
auto-mapped — common exports from MetaTrader, TradingView, and most brokers work out of the box.
Required column: `symbol`. Everything else is optional.

## Files removed

- `src/api/base44Client.js` → replaced by `src/api/supabaseClient.js`
- `src/lib/app-params.js` → no longer needed
- `src/components/UserNotRegisteredError.jsx` → Supabase has no equivalent concept

## Files added

- `src/api/supabaseClient.js` — Supabase client singleton
- `src/api/entities.js` — CRUD helpers (drop-in for `base44.entities.*`)
- `supabase/schema.sql` — full Postgres schema with RLS
- `.env.local` — real credentials
- `.env.example` — template

## Package.json version notes

Several versions in the provided `package.json` were corrected before use:

| Package | Provided | Used | Reason |
|---|---|---|---|
| `lucide-react` | `^1.20.0` | `^0.511.0` | v1.x doesn't exist; 0.5xx is latest |
| `recharts` | `^3.8.1` | `^2.15.3` | v3 has breaking Tooltip/Legend API changes incompatible with existing chart components |
| `zod` | `^4.4.3` | `^3.24.4` | Zod v4 has breaking changes; `@hookform/resolvers` 3.x targets Zod v3 |
| `@vitejs/plugin-react` | `^6.0.2` | `^4.5.1` | v6 doesn't exist |
| `eslint` | `^10.5.0` | `^9.27.0` | v10 doesn't exist |
| `@eslint/js` | `^10.5.0` | `^9.27.0` | matches eslint version |
| `globals` | `^17.6.0` | `^16.2.0` | v17 doesn't exist |
| `vite` | `^8.0.16` | `^6.3.5` | v8 doesn't exist |
| `tailwindcss-animate` | (present) | removed | Inlined into CSS; incompatible with Tailwind v4 plugin system |
| `@tailwindcss/postcss` | (missing) | `^4.3.0` | **Required** for Tailwind v4 to work with PostCSS |

## Tailwind v4 migration

Tailwind v4 is a complete rethink of the config system:

- `tailwind.config.js` → **deleted** (not used in v4)
- `@tailwind base/components/utilities` → replaced with `@import "tailwindcss"`
- Theme config → moved into `@theme inline {}` block in `src/index.css`
- Colors registered as `--color-*` variables → auto-generates all bg/text/border utilities including opacity modifiers (`bg-primary/10`)
- `tailwindcss-animate` plugin → accordion animations inlined in `@theme` keyframes
- PostCSS plugin → changed from `tailwindcss: {}` to `'@tailwindcss/postcss': {}`
