// Layout shell for every authenticated page (/app, /app/journal, etc.):
// left sidebar (slide-over drawer on small screens), the app bar with the portfolio/account
// context, theme toggle, sign-out, and — importantly — the only
// two gates that decide whether a visitor sees the dashboard at all:
//   1. Auth check (below): redirects to /sign-in if there's no session.
//   2. Onboarding check (below): redirects to /onboarding if the workspace
//      loaded successfully but the profile hasn't completed setup yet.
// If workspace loading fails outright, this shows a real error with a retry
// button rather than hanging on a loading spinner forever — that silent-hang
// behavior was a real bug (see the workspaceQuery.isError branch below).
import { createFileRoute, Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  BarChart3,
  BookOpen,
  Calculator,
  ChevronsUpDown,
  ClipboardList,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Plus,
  Settings2,
  ShieldCheck,
  Sun,
  Target,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth/session-context";
import { getWorkspace, setActivePortfolio } from "@/lib/portfolios.functions";
import { setActiveAccount } from "@/lib/accounts.functions";
import { useTheme } from "@/lib/theme";

// NOTE on SSR: Supabase's session lives in browser localStorage, which
// doesn't exist during server rendering, so `useAuth()` (session-context.tsx)
// only knows the real answer after its effect runs on the client — there's
// no way to know "signed in or not" from a `beforeLoad` on the server here.
// The real data boundary is `requireSupabaseAuth` on every server function
// in src/lib/*.functions.ts — this layout's redirect is UX only.
export const Route = createFileRoute("/app")({
  component: AuthenticatedLayout,
  // Primes the "workspace" query cache the moment the router starts loading
  // this route — which, combined with defaultPreload: "intent" in
  // router.tsx, means as soon as someone hovers or focuses a link into the
  // app (the sidebar, "Log trade", the landing page's CTA), this fetch is
  // already in flight before they click. By the time AuthenticatedLayout's
  // own `useQuery(["workspace"])` below actually mounts, it usually finds
  // the answer already sitting in cache instead of starting a fresh
  // request — this is what used to make every first navigation into the
  // app (very much including right after signing in) show its own
  // "Loading your journal…" gate on top of whatever the sign-in request
  // itself had already taken.
  //
  // Swallowing the error deliberately: a signed-out visitor hovering a
  // protected link would otherwise have this loader throw an Unauthorized
  // error the moment they merely hover — with no session yet to make the
  // call meaningful, and the actual "redirect to /sign-in" decision already
  // handled by useAuth() below. A prefetch that can't succeed should just
  // do nothing, not surface as a broken page.
  loader: async ({ context }) => {
    try {
      await context.queryClient.ensureQueryData({ queryKey: ["workspace"], queryFn: () => getWorkspace() });
    } catch {
      // Not signed in, or a real fetch failure — either way, the component
      // below still runs its own checks and renders the right thing.
    }
  },
});

// Sidebar navigation, grouped by where each page sits in the daily loop:
// look at the numbers, do the work, then set up the guard-rails.
const NAV_GROUPS = [
  {
    label: "Workspace",
    items: [
      { to: "/app", label: "Overview", icon: LayoutDashboard, exact: true },
      { to: "/app/journal", label: "Journal", icon: BookOpen, exact: false },
      { to: "/app/analytics", label: "Analytics", icon: BarChart3, exact: false },
    ],
  },
  {
    label: "Practice",
    items: [
      { to: "/app/playbooks", label: "Playbooks", icon: Target, exact: false },
      { to: "/app/reviews", label: "Reviews", icon: ClipboardList, exact: false },
      { to: "/app/reports", label: "Reports", icon: FileText, exact: false },
    ],
  },
  {
    label: "Tools",
    items: [
      { to: "/app/prop-rules", label: "Prop rules", icon: ShieldCheck, exact: false },
      { to: "/app/risk-calculator", label: "Risk calculator", icon: Calculator, exact: false },
    ],
  },
] as const;

// Radix Select requires non-empty string values, so "All accounts" (which
// is really "no account selected" — activeAccount === null) needs a
// stand-in sentinel that gets translated back to null before calling
// setActiveAccount.
const ALL_ACCOUNTS_VALUE = "__all__";

function AuthenticatedLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { status } = useAuth();
  const [isNavOpen, setIsNavOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    if (status === "anon") {
      void navigate({ to: "/sign-in", search: { redirect: location.pathname } });
    }
  }, [status, navigate, location.pathname]);

  const workspaceQuery = useQuery({
    queryKey: ["workspace"],
    queryFn: () => getWorkspace(),
    enabled: status === "authed",
  });
  const workspace = workspaceQuery.data;

  useEffect(() => {
    if (workspace && !workspace.profile.onboarding_completed) {
      void navigate({ to: "/onboarding" });
    }
  }, [workspace, navigate]);

  const switchPortfolioMutation = useMutation({
    mutationFn: (portfolioId: string) => setActivePortfolio({ data: { portfolioId } }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["workspace"] }),
  });

  const switchAccountMutation = useMutation({
    mutationFn: (accountId: string | null) =>
      setActiveAccount({ data: { portfolioId: workspace!.activePortfolio.id, accountId } }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["workspace"] }),
  });

  async function signOut() {
    await supabase.auth.signOut();
  }

  if (status !== "authed") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Loading your journal…
      </div>
    );
  }

  if (workspaceQuery.isError) {
    // Previously there was no error branch at all here — any failure (a
    // transient network error, an RLS misconfiguration, the profile-creation
    // race above before it was fixed) fell through to the loading state below
    // forever, with isLoading already false and workspace still undefined.
    // That's indistinguishable from a hang to the person looking at it.
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-4 text-center text-sm">
        <p className="text-muted-foreground">
          {workspaceQuery.error instanceof Error
            ? workspaceQuery.error.message
            : "Something went wrong loading your journal."}
        </p>
        <Button type="button" variant="outline" onClick={() => void workspaceQuery.refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  if (workspaceQuery.isLoading || !workspace || !workspace.profile.onboarding_completed) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Loading your journal…
      </div>
    );
  }

  const profileName = workspace.profile.display_name || "Trader";
  const scopeLabel = workspace.activeAccount?.name ?? "All accounts";

  // Rendered twice — as the fixed sidebar on desktop and inside the drawer on
  // small screens — so both always list the same pages.
  const sidebarContent = (
    <>
      <Link to="/app" className="brand" aria-label="Curated Trades overview" onClick={() => setIsNavOpen(false)}>
        <span className="brand-mark" aria-hidden="true" />
        <span className="wordmark">
          Curated <em>Trades</em>
        </span>
      </Link>

      <nav className="flex flex-col gap-5" aria-label="Main navigation">
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            <p className="nav-group-label">{group.label}</p>
            <div className="nav-list">
              {group.items.map((item) => (
                <Link key={item.to} to={item.to} activeOptions={{ exact: item.exact }} onClick={() => setIsNavOpen(false)}>
                  {({ isActive }: { isActive: boolean }) => (
                    <span className={`nav-link ${isActive ? "nav-link-active" : ""}`}>
                      <item.icon />
                      {item.label}
                    </span>
                  )}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        <button type="button" className="nav-link" onClick={toggleTheme}>
          {theme === "dark" ? <Sun /> : <Moon />}
          {theme === "dark" ? "Light mode" : "Dark mode"}
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg p-1.5 text-left hover:bg-sidebar-accent"
              aria-label="Account menu"
            >
              <span className="avatar">{profileName.slice(0, 2).toUpperCase()}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold text-sidebar-accent-foreground">{profileName}</span>
                <span className="block truncate text-xs text-muted-foreground">{workspace.activePortfolio.name}</span>
              </span>
              <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="min-w-[13rem]">
            <DropdownMenuItem
              onSelect={() => {
                setIsNavOpen(false);
                void navigate({ to: "/app/settings" });
              }}
            >
              <Settings2 className="size-4 text-muted-foreground" />
              Settings
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void signOut()}>
              <LogOut className="size-4 text-muted-foreground" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  );

  return (
    <div className="app-shell bg-background text-foreground">
      <aside className="sidebar" aria-label="Sidebar">
        {sidebarContent}
      </aside>

      {isNavOpen && (
        <div className="drawer-backdrop lg:hidden" onClick={() => setIsNavOpen(false)}>
          <aside className="drawer" aria-label="Sidebar" onClick={(event) => event.stopPropagation()}>
            {sidebarContent}
          </aside>
        </div>
      )}

      <div className="min-w-0 flex-1">
        <header className="appbar">
          <div className="appbar-inner">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              onClick={() => setIsNavOpen(true)}
              aria-label="Open navigation"
            >
              <Menu />
            </Button>

            <div className="contextbar-group">
              <span className="contextbar-label">Portfolio</span>
              {workspace.portfolios.length > 1 ? (
                <Select value={workspace.activePortfolio.id} onValueChange={(value) => switchPortfolioMutation.mutate(value)}>
                  <SelectTrigger className="h-8 w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {workspace.portfolios.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <span className="text-[13px] font-medium">{workspace.activePortfolio.name}</span>
              )}
            </div>
            <div className="contextbar-group">
              <span className="contextbar-label">Account</span>
              <Select
                value={workspace.activeAccount?.id ?? ALL_ACCOUNTS_VALUE}
                onValueChange={(value) => switchAccountMutation.mutate(value === ALL_ACCOUNTS_VALUE ? null : value)}
              >
                <SelectTrigger className="h-8 w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_ACCOUNTS_VALUE}>All accounts</SelectItem>
                  {workspace.accounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="ml-auto flex items-center gap-3">
              <span className="equity-chip hidden sm:inline-flex">
                {scopeLabel} equity
                <strong>${workspace.liveEquity.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong>
              </span>
              <Link to="/app/journal" search={{ new: true }}>
                <Button size="sm">
                  <Plus /> Log trade
                </Button>
              </Link>
            </div>
          </div>
        </header>

        <main className="content-wrap">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
