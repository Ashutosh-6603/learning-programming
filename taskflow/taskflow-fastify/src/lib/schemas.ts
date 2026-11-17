import { Type, type TSchema, type TProperties } from 'typebox';

/** A UUID string (the validator's `uuid` format is tightened in http/validation.ts). */
export const Id = Type.String({ format: 'uuid' });

export const Timestamp = Type.String({ format: 'date-time' });

export const Nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);

/** A string trimmed before its length is checked (the `transform` keyword from ajv-keywords). */
export const Trimmed = (minLength: number, maxLength: number) =>
  Type.String({ transform: ['trim'], minLength, maxLength });

/** RFC 5322 address, stored lowercase. */
export const Email = Type.String({ format: 'email', maxLength: 254, transform: ['toLowerCase'] });

export const PageQuery = Type.Object({
  limit: Type.Integer({ minimum: 1, maximum: 100, default: 20 }),
  cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 512, pattern: '^[A-Za-z0-9_-]+$' })),
});

export const Page = <T extends TSchema>(item: T) =>
  Type.Object({ items: Type.Array(item), nextCursor: Nullable(Type.String()) });

/** PATCH bodies: every field optional, but after unknown keys are stripped at least one must remain. */
export const Patch = <T extends TProperties>(properties: T) =>
  Type.Partial(Type.Object(properties), { atLeastOneField: true });
