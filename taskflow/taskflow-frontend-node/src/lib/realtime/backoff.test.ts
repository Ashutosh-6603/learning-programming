import { describe, expect, it } from 'vitest';
import { backoffDelay } from './backoff';

describe('backoffDelay', () => {
  it('doubles the ceiling each attempt', () => {
    const max = () => 1;
    expect([0, 1, 2, 3].map((a) => backoffDelay(a, max))).toEqual([500, 1000, 2000, 4000]);
  });

  it('never exceeds the 30 s cap', () => {
    expect(backoffDelay(20, () => 1)).toBe(30_000);
  });

  it('picks uniformly below the ceiling (full jitter)', () => {
    expect(backoffDelay(3, () => 0)).toBe(0);
    expect(backoffDelay(3, () => 0.5)).toBe(2000);
  });
});
