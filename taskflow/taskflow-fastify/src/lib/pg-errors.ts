/** Postgres SQLSTATE codes we turn into API errors. */
const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';

/**
 * Drizzle wraps driver errors in a DrizzleQueryError whose `cause` is the pg DatabaseError,
 * so walk the cause chain to find the SQLSTATE.
 */
export function pgErrorCode(err: unknown): string | undefined {
  for (let e: unknown = err; typeof e === 'object' && e !== null; e = (e as Error).cause) {
    if ('code' in e && typeof e.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code)) return e.code;
  }
  return undefined;
}

export const isUniqueViolation = (err: unknown) => pgErrorCode(err) === UNIQUE_VIOLATION;
export const isForeignKeyViolation = (err: unknown) => pgErrorCode(err) === FOREIGN_KEY_VIOLATION;

/**
 * Two users dropping into the same gap at once compute the same position key; the
 * UNIQUE (parent, position) index rejects the second. Re-reading neighbours and retrying fixes it.
 */
export async function retryOnPositionConflict<T>(
  attempt: () => Promise<T>,
  maxAttempts = 3,
): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await attempt();
    } catch (err) {
      if (!isUniqueViolation(err) || i >= maxAttempts) throw err;
    }
  }
}
