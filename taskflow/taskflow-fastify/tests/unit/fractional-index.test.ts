import { describe, expect, it } from 'vitest';
import { keyBetween } from '../../src/lib/fractional-index.js';

describe('keyBetween', () => {
  // The shared vectors from the TaskFlow README; all six backends must agree on them.
  it.each([
    [null, null, 'a0'],
    ['a0', null, 'a1'],
    [null, 'a0', 'Zz'],
    ['a0', 'a1', 'a0V'],
    ['a1', 'a2', 'a1V'],
    ['a0V', 'a1', 'a0l'],
    ['Zz', 'a0', 'ZzV'],
  ])('keyBetween(%s, %s) = %s', (a, b, expected) => {
    expect(keyBetween(a, b)).toBe(expected);
  });

  it('keeps byte order through 2,000 random insertions', () => {
    const keys: string[] = [];
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 2000; i++) {
      const at = Math.floor(random() * (keys.length + 1));
      keys.splice(at, 0, keyBetween(keys[at - 1] ?? null, keys[at] ?? null));
    }
    const sorted = [...keys].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
    expect(keys).toEqual(sorted);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('grows slowly when always inserting into the same gap', () => {
    let upper = 'a1';
    for (let i = 0; i < 50; i++) upper = keyBetween('a0', upper);
    expect(upper.length).toBeLessThanOrEqual(12);
  });

  it('rejects keys in the wrong order', () => {
    expect(() => keyBetween('a1', 'a0')).toThrow();
    expect(() => keyBetween('a1', 'a1')).toThrow();
  });
});
