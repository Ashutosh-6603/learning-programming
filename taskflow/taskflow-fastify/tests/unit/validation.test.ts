import type { FastifySchemaValidationError } from 'fastify';
import { describe, expect, it } from 'vitest';
import { fieldErrors } from '../../src/http/validation.js';

const error = (
  instancePath: string,
  keyword = 'type',
  params: Record<string, unknown> = {},
): FastifySchemaValidationError => ({
  instancePath,
  keyword,
  params,
  schemaPath: '#',
  message: 'x',
});

describe('validation field paths', () => {
  it('uses camelCase wire paths for body fields, including missing ones', () => {
    const errors = [
      error('', 'required', { missingProperty: 'dueAt' }),
      error('/nested', 'required', { missingProperty: 'projectId' }),
      error('', 'atLeastOneField'),
    ];
    expect(fieldErrors(errors, 'body').map((e) => e.field)).toEqual([
      'dueAt',
      'nested.projectId',
      'body',
    ]);
  });

  it('prefixes query and path parameters', () => {
    expect(fieldErrors([error('/limit')], 'querystring')[0]?.field).toBe('query.limit');
    expect(fieldErrors([error('/workspaceId')], 'params')[0]?.field).toBe('path.workspaceId');
  });
});
