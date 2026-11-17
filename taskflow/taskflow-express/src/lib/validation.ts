import type { Request } from 'express';
import { z } from 'zod';
import { ProblemError } from './problem.js';

type Location = 'body' | 'query' | 'path';

function parse<T extends z.ZodType>(schema: T, data: unknown, location: Location): z.infer<T> {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const errors = result.error.issues.map((issue) => {
    const path = issue.path.map(String).join('.');
    const field = location === 'body' ? path || 'body' : [location, path].filter(Boolean).join('.');
    return { field, message: issue.message };
  });
  throw new ProblemError('validation-error', 'The request contains invalid fields', errors);
}

export const parseBody = <T extends z.ZodType>(schema: T, req: Request) =>
  parse(schema, req.body ?? {}, 'body');
export const parseQuery = <T extends z.ZodType>(schema: T, req: Request) =>
  parse(schema, req.query, 'query');
export const parseParams = <T extends z.ZodType>(schema: T, req: Request) =>
  parse(schema, req.params, 'path');

/** Any 8-4-4-4-12 hex string, matching JSON Schema's `format: uuid`. */
export const Id = z.guid();

export const PageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z
    .string()
    .min(1)
    .max(512)
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional(),
});

/** For PATCH bodies: zod omits absent optional keys, so an empty object means nothing to change. */
export const atLeastOneField = [
  (b: object) => Object.keys(b).length > 0,
  'at least one field is required',
] as const;

/** RFC 5322, matching JSON Schema's `format: email`; stored lowercase. */
export const Email = z
  .email({ pattern: z.regexes.rfc5322Email })
  .max(254)
  .transform((e) => e.toLowerCase());

export const trimmed = (min: number, max: number) => z.string().trim().min(min).max(max);
