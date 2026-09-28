// Shared helper for the "no separate ownership pre-check" pattern used
// across the server functions: an update/select that targets a row the
// caller doesn't own comes back as either Postgrest's "no rows" error
// (PGRST116, from .single()/.maybeSingle() matching zero rows) or Postgres'
// permission-denied error (42501, from an RLS WITH CHECK rejection). Both
// mean the same thing to the caller — "that record isn't yours or doesn't
// exist" — so both get mapped to the same friendly message. Anything else
// is a real error and is rethrown as-is rather than getting mislabeled.
const NOT_FOUND_CODES = new Set(["PGRST116", "42501"]);

interface PostgrestLikeError {
  code?: string;
  message: string;
}

export function friendlyNotFoundError(error: PostgrestLikeError, fallbackMessage: string): Error {
  if (error.code && NOT_FOUND_CODES.has(error.code)) {
    return new Error(fallbackMessage);
  }
  return new Error(error.message);
}
