import { z } from 'zod';
import { invalid } from './problem.js';

export const IdCursor = z.object({ id: z.guid() });
export const RankCursor = z.object({ rank: z.number(), id: z.guid() });

export function encodeCursor(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function decodeCursor<T extends z.ZodType>(schema: T, cursor: string): z.infer<T> {
  try {
    const json: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    return schema.parse(json);
  } catch {
    throw invalid('query.cursor', 'is not a valid cursor');
  }
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
