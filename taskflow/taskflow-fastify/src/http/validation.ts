import { Ajv, type Options } from 'ajv';
import addFormats from 'ajv-formats';
import addKeywords from 'ajv-keywords';
import type { FastifyInstance, FastifySchemaValidationError } from 'fastify';
import type { FieldError } from '../lib/problem.js';

function createAjv(options: Options): Ajv {
  const ajv = new Ajv({ useDefaults: true, allErrors: true, strict: false, ...options });
  // Both are CommonJS packages: under Node's ESM rules their function is the `.default` export.
  addFormats.default(ajv);
  addKeywords.default(ajv, ['transform']);
  // ajv-formats' uuid also accepts a `urn:uuid:` prefix, which Postgres would reject with a 500.
  ajv.addFormat('uuid', /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  // Custom keywords run after `properties`, i.e. after unknown keys were stripped.
  ajv.addKeyword({
    keyword: 'atLeastOneField',
    type: 'object',
    schemaType: 'boolean',
    validate: (required: boolean, data: object) => !required || Object.keys(data).length > 0,
    error: { message: 'at least one field is required' },
  });
  return ajv;
}

/**
 * Fastify compiles one validator per route part. Query strings and path params arrive as text,
 * so they need type coercion ("20" → 20); JSON bodies already carry types, so coercion there
 * would wrongly accept `{"title": 5}`.
 */
export function installValidators(app: FastifyInstance): void {
  const body = createAjv({ coerceTypes: false, removeAdditional: 'all' });
  const text = createAjv({ coerceTypes: 'array', removeAdditional: true });
  app.setValidatorCompiler(({ schema, httpPart }) =>
    (httpPart === 'body' ? body : text).compile(schema),
  );
}

export type RequestPart = 'body' | 'querystring' | 'params' | 'headers';

const PREFIX: Record<RequestPart, string> = {
  body: '',
  querystring: 'query',
  params: 'path',
  headers: 'header',
};

/** Ajv errors → our `{ field, message }` list, using the camelCase wire names. */
export function fieldErrors(
  errors: FastifySchemaValidationError[],
  context: RequestPart,
): FieldError[] {
  return errors.map((e) => {
    const segments = e.instancePath.split('/').filter(Boolean);
    if (e.keyword === 'required') segments.push(String(e.params.missingProperty));
    const path = segments.join('.');
    const prefix = PREFIX[context];
    const field = prefix ? [prefix, path].filter(Boolean).join('.') : path || 'body';
    return { field, message: e.message ?? 'is invalid' };
  });
}
