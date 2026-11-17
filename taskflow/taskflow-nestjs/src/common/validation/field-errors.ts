import type { Paramtype } from '@nestjs/common';
import type { ValidationError } from 'class-validator';
import type { FieldError } from '../problem.js';

const PREFIX: Partial<Record<Paramtype, string>> = { query: 'query', param: 'path' };

/**
 * class-validator errors → our `{ field, message }` list, one entry per field. Property names
 * on a DTO are the camelCase wire names already, so the path needs no renaming.
 */
export function fieldErrors(errors: ValidationError[], source: Paramtype): FieldError[] {
  const prefix = PREFIX[source];
  const out: FieldError[] = [];
  const visit = (error: ValidationError, parents: string[]) => {
    const path = [...parents, error.property];
    const [message] = Object.values(error.constraints ?? {});
    if (message !== undefined) {
      out.push({
        field: [prefix, ...path].filter(Boolean).join('.'),
        // class-validator starts every message with the property name; the field carries it already.
        message: message.startsWith(`${error.property} `)
          ? message.slice(error.property.length + 1)
          : message,
      });
    }
    for (const child of error.children ?? []) visit(child, path);
  };
  for (const error of errors) visit(error, []);
  return out;
}
