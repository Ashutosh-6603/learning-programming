/**
 * Exponential backoff with "full jitter": a random delay between 0 and
 * min(cap, base × 2^attempt). README §9.1: base 500 ms, cap 30 s.
 */
export function backoffDelay(
  attempt: number,
  random: () => number = Math.random,
  base = 500,
  cap = 30_000,
): number {
  return Math.round(random() * Math.min(cap, base * 2 ** attempt));
}
