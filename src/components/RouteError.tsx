// Shared route-level error UI for pages whose loader can fail (a workspace
// fetch, most commonly). Used as a route's `errorComponent`: shows the
// message and a retry that re-runs the route's loader via router.invalidate()
// and resets the error boundary — the TanStack Router pattern, replacing the
// per-page `isError` / `refetch` branches that each page used to hand-write.
import { useRouter } from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";

export function RouteError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-4 text-center text-sm">
      <p className="text-muted-foreground">
        {error instanceof Error && error.message ? error.message : "Something went wrong loading this page."}
      </p>
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          void router.invalidate();
          reset();
        }}
      >
        Try again
      </Button>
    </div>
  );
}
