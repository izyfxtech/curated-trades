// Reads every row of a query, however many there are.
//
// Supabase (PostgREST) caps any single response at its `max-rows` setting
// (1,000 by default) and does so *silently* — there is no error and no flag,
// the extra rows simply aren't sent. A plain `await query` (or even
// `.limit(5000)`) on a large table therefore returns a truncated list that
// looks complete. This helper asks for fixed-size ranges until a short page
// says there is nothing left, so callers that need "all of them" (analytics,
// the equity curve, exports, tag/review/attachment link tables) really get
// all of them.
//
// Callers must order by something unique (or end with an `id` tiebreaker):
// range paging over a non-deterministic order can repeat or skip rows.

/** PostgREST's default max-rows; a page must not ask for more than this. */
export const SUPABASE_PAGE_SIZE = 1000;

/** Safety valve so a runaway table can't exhaust server memory. Far above any
 * realistic journal (25k trades ≈ a decade at 10 trades/day). */
export const FETCH_ALL_CEILING = 25_000;

type PageResult<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

export async function fetchAllRows<T>(fetchRange: (from: number, to: number) => PageResult<T>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; from < FETCH_ALL_CEILING; from += SUPABASE_PAGE_SIZE) {
    const { data, error } = await fetchRange(from, from + SUPABASE_PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < SUPABASE_PAGE_SIZE) return rows;
  }
  throw new Error(
    `This list has more than ${FETCH_ALL_CEILING.toLocaleString()} rows, which is more than the app loads at once. Narrow it with filters.`,
  );
}
