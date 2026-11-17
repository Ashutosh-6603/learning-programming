import { Type, type Static, type TSchema } from 'typebox';
import { Value } from 'typebox/value';
import { invalid } from './problem.js';
import { Id } from './schemas.js';

export const IdCursor = Type.Object({ id: Id });
export const RankCursor = Type.Object({ rank: Type.Number(), id: Id });

export function encodeCursor(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function decodeCursor<T extends TSchema>(schema: T, cursor: string): Static<T> {
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw invalid('query.cursor', 'is not a valid cursor');
  }
  if (!Value.Check(schema, json)) throw invalid('query.cursor', 'is not a valid cursor');
  return json;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/**
 * Callers fetch `limit + 1` rows. The extra row only tells us another page exists;
 * the cursor points at the last row we actually return.
 */
export function toPage<Row, Item>(
  rows: Row[],
  limit: number,
  toItem: (row: Row) => Item,
  cursorOf: (row: Row) => Record<string, unknown>,
): Page<Item> {
  const pageRows = rows.slice(0, limit);
  const last = pageRows.at(-1);
  return {
    items: pageRows.map(toItem),
    nextCursor: rows.length > limit && last !== undefined ? encodeCursor(cursorOf(last)) : null,
  };
}
