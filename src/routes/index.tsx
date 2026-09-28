// Public marketing landing page at "/". Signed-in visitors are bounced
// straight to /app on mount (see the effect below) — this route is never the
// dashboard itself, unlike the pre-restructure version of this app where "/"
// and the dashboard were the same route.
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { ArrowRight, Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth/session-context";
import { useTheme } from "@/lib/theme";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Curated Trades — A journal that tells you which of your trades were actually good" },
      {
        name: "description",
        content:
          "Log forex and crypto trades, separate Curated setups from Impulse entries, and see which behaviors actually make you money.",
      },
    ],
  }),
  component: LandingPage,
});

const STEPS = [
  { label: "Plan", detail: "Set entry, stop, target, and size before you're in the trade." },
  { label: "Log", detail: "Record what happened — price, fees, notes, screenshots." },
  { label: "Curate", detail: "Mark it Curated or Impulse based on whether you followed your plan." },
  { label: "Review", detail: "See which one actually makes you money, with real R and expectancy." },
];

// Illustrative numbers only — labelled as an example on the page so it never
// reads as a claim about real performance.
const EXAMPLE_ROWS = [
  { label: "Curated", count: "31 trades", winRate: "58%", r: "+0.62R", tone: "text-chart-2" },
  { label: "Impulse", count: "19 trades", winRate: "37%", r: "−0.41R", tone: "text-destructive" },
];

function LandingPage() {
  const navigate = useNavigate();
  const { status } = useAuth();
  const { theme, toggleTheme } = useTheme();

  // Show the marketing content immediately (it should be crawlable and
  // visible without JS); only redirect signed-in visitors once the shared
  // auth check (session-context.tsx) knows for sure.
  useEffect(() => {
    if (status === "authed") void navigate({ to: "/app" });
  }, [status, navigate]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <div className="brand px-0!">
          <span className="brand-mark" aria-hidden="true" />
          <span className="wordmark">
            Curated <em>Trades</em>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            {theme === "dark" ? <Sun /> : <Moon />}
          </Button>
          <Link to="/sign-in" className="px-2 text-sm text-muted-foreground hover:text-foreground">
            Sign in
          </Link>
          <Link to="/sign-in" search={{ redirect: "/app" }}>
            <Button size="sm">Start journaling</Button>
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6">
        <section className="grid items-center gap-12 py-14 sm:py-20 lg:grid-cols-[1.15fr_1fr]">
          <div>
            <p className="eyebrow mb-5">A trading journal, kept honestly</p>
            <h1 className="font-serif text-5xl font-normal leading-[1.02] tracking-[-0.035em] sm:text-6xl">
              Most of your trades don't matter.{" "}
              <em className="font-normal text-muted-foreground">This shows you which ones do.</em>
            </h1>
            <p className="mt-7 max-w-lg text-lg leading-8 text-muted-foreground">
              Curated Trades separates the setups you actually planned from the ones you took on impulse — so your
              win rate stops lying to you and your journal starts telling you the truth about your edge.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link to="/sign-in" search={{ redirect: "/app" }}>
                <Button size="lg">
                  Start journaling free <ArrowRight />
                </Button>
              </Link>
              <Link to="/sign-in">
                <Button size="lg" variant="outline">
                  I already have an account
                </Button>
              </Link>
            </div>
          </div>

          <div className="hero-figure p-6" aria-label="Example comparison of Curated and Impulse trades">
            <div className="mb-5 flex items-center justify-between">
              <p className="panel-title">Curated vs. Impulse</p>
              <span className="eyebrow">Example</span>
            </div>
            <div className="flex flex-col gap-3">
              {EXAMPLE_ROWS.map((row) => (
                <div key={row.label} className="rounded-xl border border-border bg-background p-4">
                  <div className="flex items-baseline justify-between">
                    <p className="font-serif text-lg">{row.label}</p>
                    <p className="text-xs text-muted-foreground">{row.count}</p>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-4">
                    <div>
                      <p className="eyebrow">Win rate</p>
                      <p className="mt-1 font-mono text-2xl tracking-tight">{row.winRate}</p>
                    </div>
                    <div>
                      <p className="eyebrow">Avg R</p>
                      <p className={`mt-1 font-mono text-2xl tracking-tight ${row.tone}`}>{row.r}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs leading-5 text-muted-foreground">
              Illustrative numbers. Yours come from the trades you log.
            </p>
          </div>
        </section>

        <div className="hero-rule" />

        <section className="grid gap-10 py-16 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, index) => (
            <div key={step.label}>
              <p className="font-mono text-xs text-chart-1">{String(index + 1).padStart(2, "0")}</p>
              <h2 className="mt-3 font-serif text-2xl font-normal tracking-tight">{step.label}</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{step.detail}</p>
            </div>
          ))}
        </section>

        <section className="pb-16">
          <div className="surface-panel p-8! sm:p-10!">
            <h2 className="font-serif text-3xl font-normal tracking-tight">Curated vs. Impulse</h2>
            <p className="mt-4 max-w-2xl text-[15px] leading-7 text-muted-foreground">
              A trade that hit your target and one that got lucky look identical on a P&L statement. Curated Trades
              tags every trade by whether it followed your plan, then compares win rate, expectancy, and R-multiple
              between the two groups — so you can see whether your process is actually working, separate from
              whether the market happened to cooperate.
            </p>
          </div>
        </section>

        <footer className="border-t border-border py-10 text-sm text-muted-foreground">Curated Trades</footer>
      </main>
    </div>
  );
}
