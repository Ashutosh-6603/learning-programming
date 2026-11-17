import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiError } from '@/lib/api/client';

/**
 * Puts a failed request onto a react-hook-form form: each 422 `errors[].field` goes under its
 * input, everything else becomes the form-level message. Returns that message (or null).
 */
export function applyProblem<T extends FieldValues>(
  err: unknown,
  fields: readonly Path<T>[],
  setError: UseFormSetError<T>,
): string | null {
  if (!(err instanceof ApiError)) return 'The server could not be reached. Is the backend running?';
  let unplaced = false;
  for (const { field, message } of err.problem.errors ?? []) {
    const match = fields.find((f) => f === field);
    if (match) setError(match, { message });
    else unplaced = true;
  }
  if (err.status === 422 && !unplaced) return null;
  if (err.status === 429) return 'Too many attempts. Wait a minute and try again.';
  return err.problem.detail ?? err.problem.title;
}
