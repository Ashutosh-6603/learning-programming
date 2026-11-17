import type { ValidationError } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { fieldErrors } from './field-errors.js';

const error = (
  property: string,
  constraints?: Record<string, string>,
  children: ValidationError[] = [],
): ValidationError => ({ property, constraints, children });

describe('validation field paths', () => {
  it('uses the DTO property names and drops the repeated name from the message', () => {
    const errors = [error('dueAt', { isDateTime: 'dueAt must be an ISO-8601 date-time' })];
    expect(fieldErrors(errors, 'body')).toEqual([
      { field: 'dueAt', message: 'must be an ISO-8601 date-time' },
    ]);
  });

  it('walks nested objects and reports one message per field', () => {
    const nested = error('nested', undefined, [
      error('projectId', { matches: 'must be a UUID', isString: 'projectId must be a string' }),
    ]);
    expect(fieldErrors([nested], 'body')).toEqual([
      { field: 'nested.projectId', message: 'must be a UUID' },
    ]);
  });

  it('prefixes query and path parameters', () => {
    expect(fieldErrors([error('limit', { isInt: 'x' })], 'query')[0]?.field).toBe('query.limit');
    expect(fieldErrors([error('workspaceId', { isUuid: 'x' })], 'param')[0]?.field).toBe(
      'path.workspaceId',
    );
  });
});
