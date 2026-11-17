import { describe, expect, it } from 'vitest';
import { emptyProgress } from './game';
import { isProgressShape } from './progress-shape';

describe('isProgressShape', () => {
  it('accepts a real save', () => expect(isProgressShape(emptyProgress())).toBe(true));

  it.each([[null], [[]], ['text'], [{ version: 1 }], [{ ...emptyProgress(), version: 2 }], [{ ...emptyProgress(), ticks: null }]])(
    'rejects %j',
    (value) => expect(isProgressShape(value)).toBe(false),
  );
});
