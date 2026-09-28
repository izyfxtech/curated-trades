// Shared chrome for the three unauthenticated auth pages (sign in, sign up,
// reset password): centered logo link + a surface-panel card. Pulled out so
// the three pages can't drift out of visual sync with each other one at a
// time, and so a layout tweak (spacing, the logo mark) happens once.
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

export function AuthPageShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10 text-foreground">
      <div className="w-full max-w-sm">
        <Link to="/" className="mb-8 flex items-center justify-center gap-3">
          <span className="brand-mark" aria-hidden="true" />
          <span className="wordmark">Curated <em>Trades</em></span>
        </Link>
        <div className="surface-panel">
          <h1 className="mb-6 font-serif text-xl font-medium">{title}</h1>
          {children}
        </div>
      </div>
    </div>
  );
}
