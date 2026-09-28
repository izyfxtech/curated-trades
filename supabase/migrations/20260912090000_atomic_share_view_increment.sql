-- Fixes a real race condition in public-share.functions.ts: the previous
-- code read coach_shares.view_count in one query, then wrote back
-- `share.view_count + 1` in a second, separate query. Two views arriving
-- close together (two tabs, a bot and a real viewer, simple bad luck) could
-- both read the same starting count and both write the same incremented
-- value — one view is silently lost. A single UPDATE statement doing the
-- arithmetic in SQL is atomic with respect to concurrent transactions, so
-- moving the increment into a function and calling it via .rpc() instead of
-- read-then-write in application code closes the gap entirely.
CREATE OR REPLACE FUNCTION public.increment_share_view_count(p_share_id UUID)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.coach_shares
  SET view_count = view_count + 1, last_viewed_at = now()
  WHERE id = p_share_id;
$$;

-- SECURITY DEFINER means this runs with the function owner's privileges
-- regardless of caller — necessary since the public share-viewing path has
-- no authenticated user at all, only the service-role client (which could
-- also just UPDATE directly, but funneling through one narrow function
-- keeps the "what can the public path touch" surface small and explicit).
REVOKE ALL ON FUNCTION public.increment_share_view_count(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_share_view_count(UUID) TO service_role;
