import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ProblemError } from '../../src/lib/problem.js';
import { parseBody, parseQuery } from '../../src/lib/validation.js';

const fakeRequest = (parts: Partial<Request>) => parts as Request;

function fieldsOf(fn: () => unknown): string[] {
  try {
    fn();
  } catch (err) {
    return (err as ProblemError).errors?.map((e) => e.field) ?? [];
  }
  return [];
}

describe('validation field paths', () => {
  it('uses camelCase wire paths for body fields', () => {
    const schema = z.object({ dueAt: z.string(), nested: z.object({ projectId: z.string() }) });
    expect(fieldsOf(() => parseBody(schema, fakeRequest({ body: { nested: {} } })))).toEqual([
      'dueAt',
      'nested.projectId',
    ]);
  });

  it('prefixes query parameters', () => {
    const schema = z.object({ limit: z.coerce.number().max(100) });
    expect(fieldsOf(() => parseQuery(schema, fakeRequest({ query: { limit: '500' } })))).toEqual([
      'query.limit',
    ]);
  });
});
