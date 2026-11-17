import { QueryFailedError } from 'typeorm';

/** Postgres SQLSTATE codes we turn into API errors. */
const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';

/** TypeORM wraps the driver's error in a QueryFailedError; the SQLSTATE is on `driverError`. */
export function pgErrorCode(err: unknown): string | undefined {
  if (!(err instanceof QueryFailedError)) return undefined;
  const { code } = err.driverError as { code?: unknown };
  return typeof code === 'string' ? code : undefined;
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
