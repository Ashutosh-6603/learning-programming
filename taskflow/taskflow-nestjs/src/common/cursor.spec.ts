import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor, isIdCursor, isRankCursor, toPage } from './cursor.js';
import { ProblemError } from './problem.js';

const ID = '01a18b7e-951f-71f4-affb-2b64a14174e2';

describe('cursors', () => {
  it('round-trips through base64url JSON', () => {
    const cursor = encodeCursor({ id: ID });
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(cursor, isIdCursor)).toEqual({ id: ID });
  });

  it('keeps float ranks exact', () => {
    const rank = 0.9910322;
    expect(decodeCursor(encodeCursor({ rank, id: ID }), isRankCursor).rank).toBe(rank);
  });

  it.each(['not-base64-json', encodeCursor({ id: 'nope' }), encodeCursor({ other: 1 })])(
    'rejects %s with a 422 on query.cursor',
    (bad) => {
      const run = () => decodeCursor(bad, isIdCursor);
      expect(run).toThrow(ProblemError);
      try {
        run();
      } catch (err) {
        expect((err as ProblemError).status).toBe(422);
        expect((err as ProblemError).errors?.[0]?.field).toBe('query.cursor');
      }
    },
  );

  it('returns a cursor only when an extra row exists', () => {
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const page = toPage(
      rows,
      2,
      (r) => r.id,
      (r) => ({ id: r.id }),
    );
    expect(page.items).toEqual(['a', 'b']);
    expect(Buffer.from(page.nextCursor ?? '', 'base64url').toString()).toBe('{"id":"b"}');
    expect(
      toPage(
        rows,
        3,
        (r) => r.id,
        (r) => ({ id: r.id }),
      ).nextCursor,
    ).toBeNull();
  });
});
