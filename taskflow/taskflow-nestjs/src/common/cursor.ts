import { invalid } from './problem.js';
import { UUID } from './validation/parse-id.pipe.js';

export interface IdCursor {
  id: string;
}

export interface RankCursor {
  rank: number;
  id: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const isIdCursor = (value: unknown): value is IdCursor =>
  isRecord(value) && typeof value.id === 'string' && UUID.test(value.id);

export const isRankCursor = (value: unknown): value is RankCursor =>
  isRecord(value) && typeof value.rank === 'number' && isIdCursor(value);

export function encodeCursor(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

/** A cursor comes from the client, so it is checked like any other input before use. */
export function decodeCursor<T>(cursor: string, isValid: (value: unknown) => value is T): T {
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw invalid('query.cursor', 'is not a valid cursor');
  }
  if (!isValid(json)) throw invalid('query.cursor', 'is not a valid cursor');
  return json;
}

export class Page<T> {
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
  cursorOf: (row: Row) => object,
): Page<Item> {
  const pageRows = rows.slice(0, limit);
  const last = pageRows.at(-1);
  return {
    items: pageRows.map(toItem),
    nextCursor: rows.length > limit && last !== undefined ? encodeCursor(cursorOf(last)) : null,
  };
}
