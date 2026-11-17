import type { ObjectLiteral, SelectQueryBuilder } from 'typeorm';

/**
 * Finishes a list query with keyset pagination: only rows past the cursor, ordered by the
 * same column, one row more than the page (the extra row tells toPage() whether to mint a cursor).
 *
 * `.limit()`, not `.take()` or `find({ take })`: when a query has joins, `take` makes TypeORM
 * run a SELECT DISTINCT over a subquery first, in case a join multiplied the rows. Our joins
 * are all many-to-one, so they can't, and a plain SQL LIMIT is correct and index-friendly.
 */
export function keyset<Entity extends ObjectLiteral>(
  query: SelectQueryBuilder<Entity>,
  column: string,
  direction: 'ASC' | 'DESC',
  limit: number,
  after: string | undefined,
): Promise<Entity[]> {
  if (after) query.andWhere(`${column} ${direction === 'DESC' ? '<' : '>'} :after`, { after });
  return query
    .orderBy(column, direction)
    .limit(limit + 1)
    .getMany();
}
