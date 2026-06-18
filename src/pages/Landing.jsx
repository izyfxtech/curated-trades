import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { TrendingUp, BarChart3, BookOpen, Target, Share2, Calendar, ChevronRight, Check, ArrowRight, Star, Zap, Shield } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_LINKS = [
  { label: "Features", href: "#features" },
  { label: "How it works", href: "#how-it-works" },
  { label: "Pricing", href: "#pricing" },
];

const FEATURES = [
  {
    icon: BookOpen,
    title: "Trade Journal with Psychology",
    desc: "Log every trade with emotion tracking, execution quality scores, screenshots, and rich notes. Know not just what you traded — but why.",
    color: "text-blue-400",
    bg: "bg-blue-400/10",
  },
  {
    icon: BarChart3,
    title: "Deep Performance Analytics",
    desc: "Win rate, profit factor, expectancy, session analysis, strategy breakdown — all updated in real-time as you add trades.",
    color: "text-emerald-400",
    bg: "bg-emerald-400/10",
  },
  {
    icon: Target,
    title: "Strategy Library",
    desc: "Track each strategy separately. See your win rate, average R:R, and P&L per strategy to double down on what works.",
    color: "text-purple-400",
    bg: "bg-purple-400/10",
  },
  {
    icon: Calendar,
    title: "Profit Calendar",
    desc: "Visualize your monthly performance. Instantly spot your best days, worst weeks, and emerging patterns.",
    color: "text-amber-400",
    bg: "bg-amber-400/10",
  },
  {
    icon: Share2,
    title: "Shareable Performance Links",
    desc: "Share your results with mentors, communities, or prop firm evaluators. Toggle public or private with one click.",
    color: "text-pink-400",
    bg: "bg-pink-400/10",
  },
  {
    icon: Zap,
    title: "Multi-Account & Multi-Asset",
    desc: "Track forex, stocks, crypto, futures all in one place across multiple broker accounts — with a universal PnL engine.",
    color: "text-cyan-400",
    bg: "bg-cyan-400/10",
  },
];

const STEPS = [
  { step: "01", title: "Log your trades", desc: "Add trades manually or import from MT4/MT5 CSV. Attach screenshots, notes, and emotional state." },
  { step: "02", title: "Review your patterns", desc: "The analytics engine surfaces your edge — and your blind spots. See where you actually make and lose money." },
  { step: "03", title: "Fix what's broken", desc: "Filter by mistake tags, emotion, session, or strategy. Identify the exact habits costing you performance." },
  { step: "04", title: "Compound the edge", desc: "Track improvement over time. Watch your win rate climb, your losses shrink, and your discipline scores rise." },
];

const PLANS = [
  {
    name: "Free",
    price: "$0",
    period: "forever",
    desc: "For traders just getting started.",
    features: ["Up to 50 trades/month", "Basic analytics", "1 account", "Trade journal"],
    cta: "Start Free",
    highlight: false,
  },
  {
    name: "Pro",
    price: "$19",
    period: "per month",
    desc: "For serious traders who want the full picture.",
    features: [
      "Unlimited trades",
      "Advanced analytics & charts",
      "Unlimited accounts & strategies",
      "Shareable performance links",
      "CSV import / export",
      "Profit calendar",
      "Psychology scoring",
      "Priority support",
    ],
    cta: "Start 14-day free trial",
    highlight: true,
  },
  {
    name: "Team",
    price: "$49",
    period: "per month",
    desc: "For prop firm traders and small groups.",
    features: [
      "Everything in Pro",
      "Up to 5 members",
      "Shared strategy library",
      "Group performance dashboard",
      "Mentor review mode",
    ],
    cta: "Contact us",
    highlight: false,
  },
];

const TESTIMONIALS = [
  {
    name: "Marcus T.",
    role: "Forex trader · 4 years",
    quote: "I went from a 38% win rate to 61% in 3 months just by tracking what I was doing wrong. CuratedTrades made the patterns obvious.",
    stars: 5,
  },
  {
    name: "Priya S.",
    role: "Crypto & equities · prop trader",
    quote: "The strategy breakdown alone is worth it. I dropped two strategies that looked profitable but were actually eating my account.",
    stars: 5,
  },
  {
    name: "James K.",
    role: "Futures trader",
    quote: "Sharing my performance with my mentor changed everything. Real-time visibility means real-time feedback.",
    stars: 5,
  },
];

export default function Landing() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handler);
    return () => window.removeEventListener("scroll", handler);
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <header className={cn(
        "fixed top-0 left-0 right-0 z-50 transition-all duration-300",
        scrolled ? "bg-background/90 backdrop-blur-md border-b border-border" : "bg-transparent"
      )}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <TrendingUp className="w-4 h-4 text-primary-foreground" />
            </div>
            <span className="font-heading font-bold text-lg text-foreground">CuratedTrades</span>
          </div>
          <nav className="hidden md:flex items-center gap-8">
            {NAV_LINKS.map(l => (
              <a key={l.href} href={l.href} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                {l.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <Link to="/login" className="text-sm text-muted-foreground hover:text-foreground transition-colors hidden sm:block">
              Sign in
            </Link>
            <Link
              to="/register"
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              Get Started <ChevronRight className="w-3.5 h-3.5" />
             </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative pt-32 pb-24 px-4 sm:px-6 overflow-hidden">
        {/* BG glow */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary/5 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute top-20 right-1/4 w-[300px] h-[300px] bg-emerald-400/5 rounded-full blur-3xl pointer-events-none" />

        <div className="relative max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-medium mb-6">
            <Zap className="w-3.5 h-3.5" />
            Built for traders who take performance seriously
          </div>

          <h1 className="text-4xl sm:text-5xl md:text-6xl font-heading font-extrabold text-foreground leading-tight tracking-tight mb-6">
            Stop trading blind.
            <br />
            <span className="text-primary">Start compounding your edge.</span>
          </h1>

          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed">
            CuratedTrades is the trading journal that actually tells you why you're losing — and exactly what to fix. Track trades, analyze patterns, and grow your edge with data instead of gut feeling.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              to="/register"
              className="flex items-center gap-2 px-6 py-3 rounded-xl bg-primary text-primary-foreground font-semibold text-base hover:bg-primary/90 transition-all hover:shadow-lg hover:shadow-primary/20"
            >
              Start journaling free <ArrowRight className="w-4 h-4" />
            </Link>
            <a href="#how-it-works" className="flex items-center gap-2 px-6 py-3 rounded-xl border border-border text-foreground font-medium text-base hover:bg-secondary/50 transition-all">
              See how it works
            </a>
          </div>

          <p className="text-xs text-muted-foreground mt-5">No credit card required · 14-day free trial on Pro</p>
        </div>

        {/* Mock dashboard preview */}
        <div className="relative max-w-5xl mx-auto mt-16">
          <div className="rounded-2xl border border-border bg-card/80 backdrop-blur overflow-hidden shadow-2xl shadow-black/30">
            {/* Fake browser chrome */}
            <div className="bg-secondary/50 border-b border-border px-4 py-2.5 flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-red-400/60" />
              <div className="w-3 h-3 rounded-full bg-amber-400/60" />
              <div className="w-3 h-3 rounded-full bg-emerald-400/60" />
              <div className="mx-auto flex-1 max-w-xs bg-background/40 rounded-md px-3 py-1 text-[11px] text-muted-foreground text-center">
                app.curatedtrades.com
              </div>
            </div>
            {/* Mock stats row */}
            <div className="p-6">
              <div className="grid grid-cols-3 md:grid-cols-6 gap-3 mb-4">
                {[
                  { l: "Net P&L", v: "+$4,280", c: "text-emerald-400" },
                  { l: "Win Rate", v: "64.2%", c: "text-foreground" },
                  { l: "Trades", v: "147", c: "text-foreground" },
                  { l: "Profit Factor", v: "2.31", c: "text-foreground" },
                  { l: "Avg Win", v: "+$312", c: "text-emerald-400" },
                  { l: "Avg Loss", v: "-$134", c: "text-red-400" },
                ].map(s => (
                  <div key={s.l} className="bg-secondary/30 rounded-xl p-3">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">{s.l}</p>
                    <p className={cn("text-base font-mono font-bold", s.c)}>{s.v}</p>
                  </div>
                ))}
              </div>
              {/* Mock chart bars */}
              <div className="bg-secondary/20 rounded-xl p-4 h-32 flex items-end gap-2">
                {[40, 65, 30, 80, 55, 90, 45, 70, 35, 85, 60, 75, 50, 95].map((h, i) => (
                  <div
                    key={i}
                    className={cn("flex-1 rounded-sm", i % 3 === 0 ? "bg-red-400/60" : "bg-emerald-400/60")}
                    style={{ height: `${h}%` }}
                  />
                ))}
              </div>
            </div>
          </div>
          {/* Subtle gradient fade */}
          <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-background to-transparent pointer-events-none" />
        </div>
      </section>

      {/* Social proof bar */}
      <section className="border-y border-border bg-secondary/20 py-8 px-4">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-center gap-8 text-center">
          {[
            { stat: "12,000+", label: "Trades logged" },
            { stat: "97%", label: "Of users improved win rate in 60 days" },
            { stat: "4.9★", label: "Average rating" },
            { stat: "40+", label: "Supported instruments" },
          ].map(s => (
            <div key={s.stat}>
              <p className="text-2xl font-mono font-bold text-primary">{s.stat}</p>
              <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-24 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-heading font-extrabold text-foreground mb-4">
              Everything a serious trader needs
            </h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              Not a glorified spreadsheet. A full performance system designed to build your edge systematically.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map((f, i) => (
              <div key={i} className="bg-card rounded-2xl border border-border p-6 hover:border-primary/30 transition-all group">
                <div className={cn("w-11 h-11 rounded-xl flex items-center justify-center mb-4", f.bg)}>
                  <f.icon className={cn("w-5 h-5", f.color)} />
                </div>
                <h3 className="font-heading font-semibold text-foreground mb-2">{f.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="py-24 px-4 sm:px-6 bg-secondary/10">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-heading font-extrabold text-foreground mb-4">
              The system behind consistent improvement
            </h2>
            <p className="text-muted-foreground text-lg">
              Four steps. Repeatable. Measurable. It works because the data doesn't lie.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {STEPS.map((s, i) => (
              <div key={i} className="flex gap-5 bg-card rounded-2xl border border-border p-6 hover:border-primary/20 transition-all">
                <div className="text-3xl font-mono font-extrabold text-primary/20 leading-none flex-shrink-0">{s.step}</div>
                <div>
                  <h3 className="font-heading font-semibold text-foreground mb-1.5">{s.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="py-24 px-4 sm:px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-heading font-extrabold text-foreground mb-4">
              Traders who stopped guessing
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {TESTIMONIALS.map((t, i) => (
              <div key={i} className="bg-card rounded-2xl border border-border p-6">
                <div className="flex gap-0.5 mb-4">
                  {Array(t.stars).fill(0).map((_, j) => (
                    <Star key={j} className="w-4 h-4 fill-amber-400 text-amber-400" />
                  ))}
                </div>
                <p className="text-sm text-foreground leading-relaxed mb-5 italic">"{t.quote}"</p>
                <div>
                  <p className="text-sm font-semibold text-foreground">{t.name}</p>
                  <p className="text-xs text-muted-foreground">{t.role}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-24 px-4 sm:px-6 bg-secondary/10">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-heading font-extrabold text-foreground mb-4">
              Simple pricing. No gotchas.
            </h2>
            <p className="text-muted-foreground text-lg">
              Start free. Upgrade when you're serious.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {PLANS.map((plan, i) => (
              <div key={i} className={cn(
                "rounded-2xl border p-7 flex flex-col",
                plan.highlight
                  ? "border-primary bg-primary/5 shadow-xl shadow-primary/10 relative"
                  : "border-border bg-card"
              )}>
                {plan.highlight && (
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-primary text-primary-foreground text-xs font-semibold">
                    Most popular
                  </div>
                )}
                <div className="mb-5">
                  <h3 className="font-heading font-bold text-foreground mb-1">{plan.name}</h3>
                  <p className="text-xs text-muted-foreground mb-4">{plan.desc}</p>
                  <div className="flex items-end gap-1.5">
                    <span className="text-4xl font-mono font-extrabold text-foreground">{plan.price}</span>
                    <span className="text-sm text-muted-foreground pb-1">/{plan.period}</span>
                  </div>
                </div>
                <ul className="space-y-2.5 flex-1 mb-7">
                  {plan.features.map((f, j) => (
                    <li key={j} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <Check className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />{f}
                    </li>
                  ))}
                </ul>
                <Link
                  to="/register"
                  className={cn(
                    "block text-center py-2.5 rounded-xl font-semibold text-sm transition-all",
                    plan.highlight
                      ? "bg-primary text-primary-foreground hover:bg-primary/90"
                      : "border border-border text-foreground hover:bg-secondary/50"
                  )}
                >
                  {plan.cta}
                </Link>
              </div>
            ))}
          </div>

          <p className="text-center text-xs text-muted-foreground mt-8">
            All plans include a 14-day free trial on paid features. Cancel anytime.
          </p>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-24 px-4 sm:px-6">
        <div className="max-w-3xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-400/10 border border-emerald-400/20 text-emerald-400 text-xs font-medium mb-6">
            <Shield className="w-3.5 h-3.5" />
            No card required to start
          </div>
          <h2 className="text-3xl md:text-4xl font-heading font-extrabold text-foreground mb-5">
            Your competition is already journaling.
            <br />
            <span className="text-primary">Are you?</span>
          </h2>
          <p className="text-muted-foreground text-lg mb-10 max-w-xl mx-auto">
            The traders who consistently grow their accounts all have one thing in common: they review their data. CuratedTrades makes it fast, clear, and actually useful.
          </p>
          <Link
            to="/register"
            className="inline-flex items-center gap-2 px-8 py-4 rounded-xl bg-primary text-primary-foreground font-bold text-lg hover:bg-primary/90 transition-all hover:shadow-lg hover:shadow-primary/20"
          >
            Get started for free <ArrowRight className="w-5 h-5" />
          </Link>
          <p className="text-xs text-muted-foreground mt-4">Join thousands of traders improving their edge with data</p>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-10 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center">
              <TrendingUp className="w-3.5 h-3.5 text-primary-foreground" />
            </div>
            <span className="font-heading font-semibold text-foreground text-sm">CuratedTrades</span>
          </div>
          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} CuratedTrades. Built for traders, by traders.
          </p>
          <div className="flex gap-5">
            <a href="#features" className="text-xs text-muted-foreground hover:text-foreground transition-colors">Features</a>
            <a href="#pricing" className="text-xs text-muted-foreground hover:text-foreground transition-colors">Pricing</a>
            <Link to="/login" className="text-xs text-muted-foreground hover:text-foreground transition-colors">Sign in</Link>
          </div>
        </div>
      </footer>
    </div>
    );
}
